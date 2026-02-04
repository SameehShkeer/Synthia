/**
 * Frontend Logger Utility
 *
 * Bridges frontend logs to the Tauri logging system.
 * All logs from this module are forwarded to the Rust backend
 * and appear in the same unified log output.
 */

import {
  trace as tauriTrace,
  debug as tauriDebug,
  info as tauriInfo,
  warn as tauriWarn,
  error as tauriError,
  attachConsole,
} from "@tauri-apps/plugin-log";

// In development mode, attach to browser console
// This allows logs to appear in DevTools alongside the terminal
if (import.meta.env.DEV) {
  attachConsole();
}

/**
 * Logger instance with all standard log levels.
 * Logs are forwarded to the Tauri backend logging system.
 *
 * @example
 * ```typescript
 * import { logger } from "@/lib/logger";
 *
 * logger.info("User clicked submit button");
 * logger.error("Failed to fetch data");
 * logger.debug("Component rendered with props:", JSON.stringify(props));
 * ```
 */
export const logger = {
  /**
   * Trace level - most verbose, for detailed debugging
   * Use for high-frequency events or detailed flow tracing
   */
  trace: (message: string) => tauriTrace(message),

  /**
   * Debug level - detailed information for debugging
   * Use for development-time diagnostics
   */
  debug: (message: string) => tauriDebug(message),

  /**
   * Info level - general operational messages
   * Use for significant events (user actions, state changes)
   */
  info: (message: string) => tauriInfo(message),

  /**
   * Warn level - potentially problematic situations
   * Use for recoverable issues or deprecation notices
   */
  warn: (message: string) => tauriWarn(message),

  /**
   * Error level - error events that might still allow continued operation
   * Use for failures that need attention
   */
  error: (message: string) => tauriError(message),
};

// Also export individual functions for tree-shaking
export { tauriTrace as trace };
export { tauriDebug as debug };
export { tauriInfo as info };
export { tauriWarn as warn };
export { tauriError as error };
