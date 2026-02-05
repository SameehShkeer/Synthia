import {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  type Ref,
} from "react";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

import type { ITheme } from "@xterm/xterm";

// =============================================================================
// Types
// =============================================================================

export interface EmbeddedTerminalProps {
  /** Unique ID for this terminal session */
  sessionId: string;
  /** Called when user types into the terminal */
  onData?: (data: string) => void;
  /** Called when terminal resizes */
  onResize?: (cols: number, rows: number) => void;
  /** Disable user input (monitoring mode) */
  readOnly?: boolean;
  /** Override xterm.js theme */
  theme?: ITheme;
  /** Additional CSS classes for the container */
  className?: string;
}

export interface EmbeddedTerminalHandle {
  /** Write data to the terminal */
  write: (data: string) => void;
  /** Clear the terminal screen */
  clear: () => void;
  /** Focus the terminal */
  focus: () => void;
}

// =============================================================================
// Synthia Default Theme
// =============================================================================

/** Dark brutalist theme matching Synthia's design system */
const SYNTHIA_THEME: ITheme = {
  background: "#050505", // --background: 0 0% 2%
  foreground: "#f2f2f2", // --foreground: 0 0% 95%
  cursor: "#ccff00", // --primary: acid green
  cursorAccent: "#000000",
  selectionBackground: "#ccff0040",
  selectionForeground: "#f2f2f2",
  black: "#050505",
  red: "#ff0000", // --destructive
  green: "#ccff00", // --primary
  yellow: "#ffcc00",
  blue: "#6666ff",
  magenta: "#cc00ff", // --accent
  cyan: "#00cccc",
  white: "#f2f2f2",
  brightBlack: "#808080", // --muted-foreground
  brightRed: "#ff4444",
  brightGreen: "#ddff44",
  brightYellow: "#ffdd44",
  brightBlue: "#8888ff",
  brightMagenta: "#dd44ff",
  brightCyan: "#44dddd",
  brightWhite: "#ffffff",
};

// =============================================================================
// Component
// =============================================================================

export const EmbeddedTerminal = forwardRef(function EmbeddedTerminal(
  props: EmbeddedTerminalProps,
  ref: Ref<EmbeddedTerminalHandle>
) {
  const { sessionId, onData, onResize, readOnly = false, theme, className } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // Expose write/clear/focus to parent via ref
  useImperativeHandle(ref, () => ({
    write(data: string) {
      terminalRef.current?.write(data);
    },
    clear() {
      terminalRef.current?.clear();
    },
    focus() {
      terminalRef.current?.focus();
    },
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ---- Create terminal instance ----
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: "'Space Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      theme: theme ?? SYNTHIA_THEME,
      allowProposedApi: true,
      disableStdin: readOnly,
    });

    terminalRef.current = terminal;

    // ---- Load addons ----
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);

    // Clickable URLs
    terminal.loadAddon(new WebLinksAddon());

    // ---- Mount to DOM ----
    terminal.open(container);

    // Initial fit
    fitAddon.fit();

    // ---- WebGL rendering (GPU-accelerated, with DOM fallback) ----
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not available — DOM renderer is the default fallback
    }

    // ---- Wire up callbacks ----
    const dataDisposable = terminal.onData((data) => {
      onData?.(data);
    });

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      onResize?.(cols, rows);
    });

    // ---- Auto-resize via ResizeObserver ----
    const resizeObserver = new ResizeObserver(() => {
      // requestAnimationFrame avoids layout thrashing
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
      });
    });
    resizeObserver.observe(container);

    // ---- Cleanup ----
    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // sessionId in deps ensures terminal reinitializes if session changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return (
    <div
      ref={containerRef}
      className={`h-full w-full overflow-hidden ${className ?? ""}`}
      data-testid={`terminal-${sessionId}`}
    />
  );
});
