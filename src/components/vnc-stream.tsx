import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { VncScreen, type VncScreenHandle } from "react-vnc";
import { Wifi, WifiOff, AlertTriangle } from "lucide-react";

export type VncConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type VncStreamProps = {
  /** WebSocket URL to the websockified VNC server (ws:// or wss://) */
  url: string;
  /** Scale the remote desktop to fit the container (default: true) */
  scaleViewport?: boolean;
  /** View-only mode — no keyboard/mouse input sent (default: true) */
  viewOnly?: boolean;
  /** Inline styles applied to the VncScreen wrapper */
  style?: CSSProperties;
  /** Additional CSS class names */
  className?: string;
  /** Called when connection state changes */
  onStateChange?: (state: VncConnectionState) => void;
};

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

/**
 * VNC stream viewer with connection lifecycle management.
 * Shows visual overlays for connecting/disconnected/error states
 * and auto-reconnects with exponential backoff.
 */
const VncStream = forwardRef<VncScreenHandle, VncStreamProps>(
  (
    {
      url,
      scaleViewport = true,
      viewOnly = true,
      style,
      className,
      onStateChange,
    },
    ref,
  ) => {
    const [connState, setConnState] =
      useState<VncConnectionState>("connecting");
    const [countdown, setCountdown] = useState(0);
    const backoffRef = useRef(INITIAL_BACKOFF_MS);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(
      null,
    );
    // Bumping this key forces VncScreen to remount and reconnect
    const [retryKey, setRetryKey] = useState(0);

    const updateState = useCallback(
      (next: VncConnectionState) => {
        setConnState(next);
        onStateChange?.(next);
      },
      [onStateChange],
    );

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
        updateState("connecting");
        setRetryKey((k) => k + 1);
      }, delay);
    }, [clearTimers, updateState]);

    const handleConnect = useCallback(() => {
      backoffRef.current = INITIAL_BACKOFF_MS;
      clearTimers();
      updateState("connected");
    }, [clearTimers, updateState]);

    const handleDisconnect = useCallback(() => {
      updateState("disconnected");
      scheduleReconnect();
    }, [updateState, scheduleReconnect]);

    const handleRetryNow = useCallback(() => {
      clearTimers();
      backoffRef.current = INITIAL_BACKOFF_MS;
      updateState("connecting");
      setRetryKey((k) => k + 1);
    }, [clearTimers, updateState]);

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        clearTimers();
      };
    }, [clearTimers]);

    // Reset state when URL changes
    useEffect(() => {
      backoffRef.current = INITIAL_BACKOFF_MS;
      clearTimers();
      updateState("connecting");
      setRetryKey((k) => k + 1);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [url]);

    return (
      <div
        style={{ width: "100%", height: "100%", position: "relative", ...style }}
        className={className}
      >
        {/* VncScreen always mounted (except during error retry) so it can attempt connection */}
        <VncScreen
          key={retryKey}
          ref={ref}
          url={url}
          scaleViewport={scaleViewport}
          viewOnly={viewOnly}
          background="#000000"
          retryDuration={0}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          style={{ width: "100%", height: "100%" }}
        />

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

VncStream.displayName = "VncStream";

export { VncStream };
export type { VncScreenHandle };
