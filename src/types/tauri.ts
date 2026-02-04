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
