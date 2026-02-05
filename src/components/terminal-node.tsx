import {
  EmbeddedTerminal,
  type EmbeddedTerminalHandle,
} from "@/components/embedded-terminal";
import {
  useTerminalSession,
  type TerminalStatus,
} from "@/hooks/use-terminal-session";

// =============================================================================
// Types
// =============================================================================

interface TerminalNodeProps {
  /** Stable session ID tied to this node (e.g. "terminal-term-claude-1") */
  sessionId: string;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Status Dot
// =============================================================================

function StatusDot({ status }: { status: TerminalStatus }) {
  if (status === "running") {
    return <div className="h-1.5 w-1.5 bg-primary animate-pulse" />;
  }
  if (status === "connecting") {
    return <div className="h-1.5 w-1.5 bg-yellow-400 animate-pulse" />;
  }
  return <div className="h-1.5 w-1.5 bg-destructive" />;
}

// =============================================================================
// Component
// =============================================================================

export function TerminalNode({ sessionId, className }: TerminalNodeProps) {
  const { termRef, status, write, resize } = useTerminalSession({ sessionId });

  return (
    <div className={`flex flex-col h-full w-full ${className ?? ""}`}>
      {/* Status bar */}
      <div className="flex items-center gap-2 px-2 py-1 bg-black/80 border-b border-border/50 shrink-0">
        <StatusDot status={status} />
        <span className="font-mono text-[9px] uppercase text-muted-foreground tracking-widest">
          {status === "running"
            ? "SHELL_ACTIVE"
            : status === "connecting"
              ? "INITIALIZING"
              : "SESSION_ENDED"}
        </span>
        <span className="font-mono text-[9px] text-primary/40 ml-auto">
          {sessionId}
        </span>
      </div>

      {/* Terminal */}
      <div className="flex-1 min-h-0">
        <EmbeddedTerminal
          ref={termRef as React.Ref<EmbeddedTerminalHandle>}
          sessionId={sessionId}
          onData={write}
          onResize={resize}
          readOnly={status === "exited"}
        />
      </div>
    </div>
  );
}
