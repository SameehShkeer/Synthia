import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Wifi, WifiOff, AlertTriangle } from "lucide-react";

export type StreamConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type ScreenStreamProps = {
  /** WebSocket URL to the MJPEG streaming server (ws:// or wss://) */
  url: string;
  /** Inline styles applied to the wrapper */
  style?: CSSProperties;
  /** Additional CSS class names */
  className?: string;
  /** Called when connection state changes */
  onStateChange?: (state: StreamConnectionState) => void;
};

export type ScreenStreamHandle = {
  /** The underlying canvas element */
  canvas: HTMLCanvasElement | null;
};

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

/**
 * Raw BGRA WebSocket stream viewer with connection lifecycle management.
 * Receives raw BGRA pixel frames over WebSocket and renders via WebGL.
 * A fragment shader swaps R/B channels on the GPU (zero CPU cost).
 * Shows visual overlays for connecting/disconnected/error states
 * and auto-reconnects with exponential backoff.
 */
const ScreenStream = forwardRef<ScreenStreamHandle, ScreenStreamProps>(
  ({ url, style, className, onStateChange }, ref) => {
    const [connState, setConnState] =
      useState<StreamConnectionState>("connecting");
    const [countdown, setCountdown] = useState(0);
    const backoffRef = useRef(INITIAL_BACKOFF_MS);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(
      null,
    );
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const glRef = useRef<WebGL2RenderingContext | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    // Track FPS
    const [fps, setFps] = useState(0);
    const frameCountRef = useRef(0);
    const fpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Frame-dropping via rAF render loop: onmessage only stores latest frame,
    // requestAnimationFrame renders raw RGBA pixels at display refresh rate.
    const pendingFrameRef = useRef<ArrayBuffer | null>(null);
    const rafIdRef = useRef(0);

    // Stable refs for connect/scheduleReconnect to break circular dependency
    const connectRef = useRef<() => void>(() => {});
    const onStateChangeRef = useRef(onStateChange);
    onStateChangeRef.current = onStateChange;

    useImperativeHandle(ref, () => ({
      get canvas() {
        return canvasRef.current;
      },
    }));

    const updateState = useCallback((next: StreamConnectionState) => {
      setConnState(next);
      onStateChangeRef.current?.(next);
    }, []);

    const clearTimers = useCallback(() => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    }, []);

    const scheduleReconnect = useCallback(() => {
      clearTimers();
      const delay = backoffRef.current;
      setCountdown(Math.ceil(delay / 1000));

      countdownTimerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (countdownTimerRef.current)
              clearInterval(countdownTimerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      retryTimerRef.current = setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
        connectRef.current();
      }, delay);
    }, [clearTimers]);

    const handleRetryNow = useCallback(() => {
      clearTimers();
      backoffRef.current = INITIAL_BACKOFF_MS;
      connectRef.current();
    }, [clearTimers]);

    const connect = useCallback(() => {
      // Close existing connection
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      pendingFrameRef.current = null;
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }

      updateState("connecting");

      try {
        const ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        ws.onopen = () => {
          backoffRef.current = INITIAL_BACKOFF_MS;
          clearTimers();
          updateState("connected");
        };

        ws.onclose = () => {
          updateState("disconnected");
          scheduleReconnect();
        };

        ws.onerror = () => {
          updateState("error");
        };

        // onmessage ONLY stores the latest frame — no processing here.
        ws.onmessage = (event) => {
          if (!(event.data instanceof ArrayBuffer)) return;
          pendingFrameRef.current = event.data;
        };

        // WebGL render loop: uploads raw BGRA pixels as a GPU texture and
        // renders with a fragment shader that swaps R/B channels.
        // texSubImage2D → GPU is far faster than putImageData → CPU → GPU.
        let texW = 0;
        let texH = 0;

        function renderLoop() {
          rafIdRef.current = requestAnimationFrame(renderLoop);

          const data = pendingFrameRef.current;
          if (!data || data.byteLength < 4) return;
          pendingFrameRef.current = null;

          // Parse 4-byte header: u16 width + u16 height (little-endian)
          const header = new DataView(data);
          const w = header.getUint16(0, true);
          const h = header.getUint16(2, true);
          const expectedBytes = w * h * 4;
          if (data.byteLength < 4 + expectedBytes) return;

          const canvas = canvasRef.current;
          if (!canvas) return;

          // Lazy-init WebGL on first frame
          let gl = glRef.current;
          if (!gl) {
            gl = canvas.getContext("webgl2", {
              antialias: false,
              alpha: false,
            });
            if (!gl) return;
            glRef.current = gl;

            // Vertex shader: full-screen quad
            const vs = gl.createShader(gl.VERTEX_SHADER)!;
            gl.shaderSource(
              vs,
              `#version 300 es
              in vec2 a_pos;
              out vec2 v_uv;
              void main() {
                v_uv = a_pos * 0.5 + 0.5;
                v_uv.y = 1.0 - v_uv.y;
                gl_Position = vec4(a_pos, 0.0, 1.0);
              }`,
            );
            gl.compileShader(vs);

            // Fragment shader: swap R and B (BGRA → RGBA on GPU)
            const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
            gl.shaderSource(
              fs,
              `#version 300 es
              precision mediump float;
              in vec2 v_uv;
              uniform sampler2D u_tex;
              out vec4 fragColor;
              void main() {
                vec4 c = texture(u_tex, v_uv);
                fragColor = vec4(c.b, c.g, c.r, c.a);
              }`,
            );
            gl.compileShader(fs);

            const prog = gl.createProgram()!;
            gl.attachShader(prog, vs);
            gl.attachShader(prog, fs);
            gl.linkProgram(prog);
            gl.useProgram(prog);

            // Full-screen quad
            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(
              gl.ARRAY_BUFFER,
              new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
              gl.STATIC_DRAW,
            );
            const loc = gl.getAttribLocation(prog, "a_pos");
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

            // Texture
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(
              gl.TEXTURE_2D,
              gl.TEXTURE_WRAP_S,
              gl.CLAMP_TO_EDGE,
            );
            gl.texParameteri(
              gl.TEXTURE_2D,
              gl.TEXTURE_WRAP_T,
              gl.CLAMP_TO_EDGE,
            );
          }

          // Resize canvas and reallocate texture if needed
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            gl.viewport(0, 0, w, h);
            texW = 0;
          }

          // Upload BGRA pixels to GPU texture
          const pixels = new Uint8Array(data, 4, expectedBytes);
          if (texW !== w || texH !== h) {
            gl.texImage2D(
              gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0,
              gl.RGBA, gl.UNSIGNED_BYTE, pixels,
            );
            texW = w;
            texH = h;
          } else {
            gl.texSubImage2D(
              gl.TEXTURE_2D, 0, 0, 0, w, h,
              gl.RGBA, gl.UNSIGNED_BYTE, pixels,
            );
          }

          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          frameCountRef.current++;
        }
        rafIdRef.current = requestAnimationFrame(renderLoop);
      } catch {
        updateState("error");
        scheduleReconnect();
      }
    }, [url, updateState, clearTimers, scheduleReconnect]);

    // Keep connectRef in sync with the latest connect function
    connectRef.current = connect;

    // Connect on mount and when URL changes
    useEffect(() => {
      backoffRef.current = INITIAL_BACKOFF_MS;
      clearTimers();
      connect();

      return () => {
        clearTimers();
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = 0;
        }
        if (wsRef.current) {
          wsRef.current.onopen = null;
          wsRef.current.onclose = null;
          wsRef.current.onerror = null;
          wsRef.current.onmessage = null;
          wsRef.current.close();
          wsRef.current = null;
        }
      };
    }, [url, clearTimers, connect]);

    // FPS counter
    useEffect(() => {
      fpsIntervalRef.current = setInterval(() => {
        setFps(frameCountRef.current);
        frameCountRef.current = 0;
      }, 1000);

      return () => {
        if (fpsIntervalRef.current) {
          clearInterval(fpsIntervalRef.current);
        }
      };
    }, []);

    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          ...style,
        }}
        className={className}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
            background: "#000",
          }}
        />

        {/* FPS overlay when connected */}
        {connState === "connected" && (
          <div className="absolute top-2 right-2 font-mono text-[9px] text-primary/60 bg-black/60 px-1.5 py-0.5">
            {fps} FPS
          </div>
        )}

        {/* Connection state overlays */}
        {connState === "connecting" && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
            <div className="text-center">
              <Wifi className="h-5 w-5 text-primary animate-pulse mx-auto mb-2" />
              <div className="font-mono text-xs text-primary uppercase tracking-[0.3em] animate-pulse">
                CONNECTING...
              </div>
              <div className="font-mono text-[10px] text-muted-foreground mt-2">
                {url}
              </div>
            </div>
          </div>
        )}

        {connState === "disconnected" && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
            <div className="text-center">
              <WifiOff className="h-5 w-5 text-destructive mx-auto mb-2" />
              <div className="font-mono text-xs text-destructive uppercase tracking-widest mb-2">
                SIGNAL_LOST
              </div>
              {countdown > 0 && (
                <div className="font-mono text-[10px] text-muted-foreground">
                  RECONNECT IN {countdown}s
                </div>
              )}
              <button
                onClick={handleRetryNow}
                className="mt-3 font-mono text-[10px] text-primary border border-primary/30 px-3 py-1 uppercase tracking-wider hover:bg-primary hover:text-black transition-colors"
              >
                RETRY NOW
              </button>
            </div>
          </div>
        )}

        {connState === "error" && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
            <div className="text-center">
              <AlertTriangle className="h-5 w-5 text-destructive mx-auto mb-2" />
              <div className="font-mono text-xs text-destructive uppercase tracking-widest mb-2">
                CONNECTION_ERROR
              </div>
              <button
                onClick={handleRetryNow}
                className="mt-3 font-mono text-[10px] text-primary border border-primary/30 px-3 py-1 uppercase tracking-wider hover:bg-primary hover:text-black transition-colors"
              >
                RETRY
              </button>
            </div>
          </div>
        )}
      </div>
    );
  },
);

ScreenStream.displayName = "ScreenStream";

export { ScreenStream };
