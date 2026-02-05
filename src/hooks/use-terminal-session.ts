import { useEffect, useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { EmbeddedTerminalHandle } from "@/components/embedded-terminal";

export type TerminalStatus = "connecting" | "running" | "exited";

interface UseTerminalSessionOptions {
  sessionId: string;
  /** If false, don't kill the PTY session on unmount (for shared sessions). Default: true */
  killOnCleanup?: boolean;
}

/**
 * Hook that manages a PTY session's lifecycle:
 * - Spawns PTY on mount
 * - Streams output to the terminal ref
 * - Provides write() for user keystrokes
 * - Provides resize() for dimension changes
 * - Kills PTY on unmount
 */
export function useTerminalSession({ sessionId, killOnCleanup = true }: UseTerminalSessionOptions) {
  const termRef = useRef<EmbeddedTerminalHandle | null>(null);
  const [status, setStatus] = useState<TerminalStatus>("connecting");

  const write = useCallback(
    async (data: string) => {
      try {
        await invoke("write_terminal", { sessionId, data });
      } catch (err) {
        console.error("write_terminal failed:", err);
      }
    },
    [sessionId],
  );

  const resize = useCallback(
    async (cols: number, rows: number) => {
      try {
        await invoke("resize_terminal", { sessionId, rows, cols });
      } catch (err) {
        console.error("resize_terminal failed:", err);
      }
    },
    [sessionId],
  );

  useEffect(() => {
    let unlistenOutput: UnlistenFn | null = null;
    let unlistenClose: UnlistenFn | null = null;
    let cancelled = false;

    async function setup() {
      // 1. Listen for PTY output BEFORE spawning (so we don't miss early data)
      unlistenOutput = await listen<string>(
        `pty-output-${sessionId}`,
        (event) => {
          termRef.current?.write(event.payload);
        },
      );

      unlistenClose = await listen<void>(
        `pty-close-${sessionId}`,
        () => {
          if (!cancelled) setStatus("exited");
        },
      );

      if (cancelled) {
        unlistenOutput();
        unlistenClose();
        return;
      }

      // 2. Spawn the PTY session
      try {
        await invoke<string>("spawn_terminal", { sessionId });
        if (!cancelled) setStatus("running");
      } catch (err) {
        console.error("spawn_terminal failed:", err);
        if (!cancelled) setStatus("exited");
      }
    }

    setup();

    // 3. Cleanup on unmount
    return () => {
      cancelled = true;
      unlistenOutput?.();
      unlistenClose?.();
      if (killOnCleanup) {
        invoke("kill_terminal", { sessionId }).catch((err) =>
          console.error("kill_terminal cleanup failed:", err),
        );
      }
    };
  }, [sessionId, killOnCleanup]);

  return { termRef, status, write, resize };
}
