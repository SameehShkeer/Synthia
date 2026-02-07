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
 * MJPEG WebSocket stream viewer with connection lifecycle management.
 * Receives binary JPEG frames over WebSocket and renders them on a canvas.
 * Uses createImageBitmap for optimal rendering performance.
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
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    // Track FPS
    const [fps, setFps] = useState(0);
    const frameCountRef = useRef(0);
    const fpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

        ws.onmessage = (event) => {
          if (!(event.data instanceof ArrayBuffer)) return;

          const blob = new Blob([event.data], { type: "image/jpeg" });

          // createImageBitmap is faster than Blob→ObjectURL→Image pipeline:
          // decodes off main thread, avoids URL lifecycle management
          createImageBitmap(blob).then((bitmap) => {
            const canvas = canvasRef.current;
            if (!canvas) {
              bitmap.close();
              return;
            }

            // Resize canvas to match the frame if needed
            if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
              // Invalidate cached context on resize (canvas resets context)
              ctxRef.current = null;
            }

            // Cache canvas context to avoid per-frame getContext() overhead
            if (!ctxRef.current) {
              ctxRef.current = canvas.getContext("2d");
            }

            ctxRef.current?.drawImage(bitmap, 0, 0);
            bitmap.close();
            frameCountRef.current++;
          }).catch(() => {
            // Silently ignore decode failures (corrupted frame)
          });
        };
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
