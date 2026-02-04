// =============================================================================
// Application Constants
// =============================================================================

/**
 * Interval in milliseconds between system stats polling requests.
 * Used by the Infrastructure widget to fetch CPU and memory metrics.
 */
export const SYSTEM_STATS_POLL_INTERVAL_MS = 2000;

/**
 * Animation durations for UI transitions (in milliseconds).
 * Used for consistent timing across the application.
 */
export const ANIMATION_DURATION = {
  /** Fast transitions for immediate feedback */
  fast: 150,
  /** Standard transitions for most UI elements */
  normal: 300,
  /** Slow transitions for emphasis */
  slow: 500,
  /** Progress bar transitions */
  progress: 1000,
} as const;

/**
 * Default panel sizes for the resizable layout (percentages).
 */
export const PANEL_SIZES = {
  /** Main content area default width */
  main: 75,
  /** Minimum width for main content */
  mainMin: 30,
  /** Side panel default width */
  side: 25,
  /** Minimum width for side panel */
  sideMin: 20,
  /** Maximum width for side panel */
  sideMax: 40,
} as const;
