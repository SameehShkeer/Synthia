import { forwardRef, useCallback, type CSSProperties } from "react";
import { VncScreen, type VncScreenHandle } from "react-vnc";

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
  /** Retry connection after disconnect (ms). 0 = no retry. Default: 3000 */
  retryDuration?: number;
  /** Called when VNC connection is established */
  onConnect?: () => void;
  /** Called when VNC connection is lost */
  onDisconnect?: () => void;
};

/**
 * Thin wrapper around react-vnc's VncScreen that fills its parent container
 * with a black background. Designed for embedding in Synthia viewport panels.
 */
const VncStream = forwardRef<VncScreenHandle, VncStreamProps>(
  (
    {
      url,
      scaleViewport = true,
      viewOnly = true,
      style,
      className,
      retryDuration = 3000,
      onConnect,
      onDisconnect,
    },
    ref,
  ) => {
    const handleConnect = useCallback(() => {
      onConnect?.();
    }, [onConnect]);

    const handleDisconnect = useCallback(() => {
      onDisconnect?.();
    }, [onDisconnect]);

    return (
      <VncScreen
        ref={ref}
        url={url}
        scaleViewport={scaleViewport}
        viewOnly={viewOnly}
        background="#000000"
        retryDuration={retryDuration}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        style={{
          width: "100%",
          height: "100%",
          ...style,
        }}
        className={className}
      />
    );
  },
);

VncStream.displayName = "VncStream";

export { VncStream };
export type { VncScreenHandle };
