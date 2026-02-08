/**
 * Tauri IPC Type Definitions
 *
 * This file contains TypeScript interfaces that mirror Rust structs
 * used in Tauri commands. Keep these in sync with src-tauri/src/lib.rs.
 */

/**
 * System statistics returned by the get_system_stats command.
 * Must match SystemStats struct in src-tauri/src/lib.rs
 */
export interface SystemStats {
  /** CPU usage percentage (0-100) averaged across all cores */
  cpu: number;
  /** Memory usage percentage (0-100) */
  mem: number;
  /** Used memory in GiB */
  mem_used_gb: number;
  /** Total memory in GiB */
  mem_total_gb: number;
}

/**
 * Terminal session info returned by list_terminals command.
 * Must match TerminalInfo struct in src-tauri/src/pty.rs
 */
export interface TerminalInfo {
  session_id: string;
  is_alive: boolean;
}

/**
 * Structured terminal output event for AI agent consumption.
 * Emitted on the "terminal-output-captured" event channel.
 * Must match TerminalOutput struct in src-tauri/src/pty.rs
 */
export interface TerminalOutput {
  session_id: string;
  data: string;
  timestamp: string;
}

/**
 * Stream status returned by get_stream_status command.
 * Must match StreamStatus struct in src-tauri/src/streaming.rs
 */
export interface StreamStatus {
  active: boolean;
  port: number;
  fps: number;
  quality: number;
  clients: number;
  display_id: number | null;
}

/**
 * Display info returned by list_displays command.
 * Must match DisplayInfo struct in src-tauri/src/streaming.rs
 */
export interface DisplayInfo {
  id: number;
  title: string;
  is_primary: boolean;
}
