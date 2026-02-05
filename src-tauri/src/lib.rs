// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod logging;
mod pty;

use log::LevelFilter;
use serde::Serialize;
use sysinfo::System;
use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
use thiserror::Error;

#[cfg(target_os = "macos")]
use std::process::Command;

// =============================================================================
// Constants
// =============================================================================

/// Number of bytes in one gibibyte (GiB) - 2^30
const BYTES_PER_GIB: f64 = 1024.0 * 1024.0 * 1024.0;

/// Maximum log file size before rotation (5 MB)
/// Keeps logs manageable while preserving enough context for debugging
const MAX_LOG_FILE_SIZE: u128 = 5 * 1024 * 1024;

// =============================================================================
// Logging Configuration
// =============================================================================

/// Returns log targets for development builds.
/// Logs to stdout (terminal), webview (browser DevTools), and file (for Logs UI).
#[cfg(debug_assertions)]
fn get_log_targets() -> Vec<Target> {
    vec![
        Target::new(TargetKind::Stdout),
        Target::new(TargetKind::Webview),
        Target::new(TargetKind::LogDir {
            file_name: Some("synthia".into()),
        }),
    ]
}

/// Returns log targets for production/release builds.
/// Logs to stdout and a file in the OS-appropriate log directory.
#[cfg(not(debug_assertions))]
fn get_log_targets() -> Vec<Target> {
    vec![
        Target::new(TargetKind::Stdout),
        Target::new(TargetKind::LogDir {
            file_name: Some("synthia".into()),
        }),
    ]
}

/// Parsed vm_stat output containing page statistics
#[derive(Debug, PartialEq)]
pub struct VmStatData {
    pub page_size: f64,
    pub pages_active: f64,
    pub pages_wired: f64,
}

/// Parse vm_stat output into structured data.
///
/// This is a pure function that can be unit tested without running vm_stat.
/// Returns None if the output cannot be parsed (missing page size header).
/// Missing page counts default to 0.0.
pub fn parse_vm_stat_output(output: &str) -> Option<VmStatData> {
    // Parse page size from first line (e.g., "Mach Virtual Memory Statistics: (page size of 16384 bytes)")
    let page_size: f64 = output
        .lines()
        .next()?
        .split("page size of ")
        .nth(1)?
        .split(" bytes")
        .next()?
        .parse()
        .ok()?;

    // Helper to extract page count from vm_stat output
    let get_pages = |name: &str| -> f64 {
        output
            .lines()
            .find(|l| l.starts_with(name))
            .and_then(|l| l.split(':').nth(1))
            .and_then(|v| v.trim().trim_end_matches('.').parse().ok())
            .unwrap_or(0.0)
    };

    Some(VmStatData {
        page_size,
        pages_active: get_pages("Pages active"),
        pages_wired: get_pages("Pages wired down"),
    })
}

/// Calculate used memory in bytes from vm_stat data.
/// Uses Active + Wired pages (matches htop display).
pub fn calculate_used_memory(data: &VmStatData) -> f64 {
    (data.pages_active + data.pages_wired) * data.page_size
}

/// Get actual memory usage on macOS using vm_stat (matches htop)
#[cfg(target_os = "macos")]
fn get_macos_memory_usage() -> Option<(f64, f64)> {
    // Run vm_stat to get memory page statistics
    let output = Command::new("vm_stat").output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse the output
    let data = parse_vm_stat_output(&stdout)?;
    let used_bytes = calculate_used_memory(&data);

    // Get total from sysinfo (more reliable than vm_stat)
    let mut sys = System::new();
    sys.refresh_memory();
    let total_bytes = sys.total_memory() as f64;

    Some((used_bytes, total_bytes))
}

/// System statistics for the Infrastructure widget
#[derive(Debug, Serialize)]
pub struct SystemStats {
    pub cpu: f32,
    pub mem: f32,
    pub mem_used_gb: f32,
    pub mem_total_gb: f32,
}

/// Application-level errors that can be returned from commands
#[derive(Debug, Error)]
pub enum AppError {
    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

// Implement serialization for frontend consumption
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// Returns real-time system CPU and memory statistics
#[tauri::command]
async fn get_system_stats() -> Result<SystemStats, AppError> {
    log::trace!("get_system_stats() called");
    let mut sys = System::new();

    // Refresh CPU and memory info
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    // Calculate CPU usage (average across all cores)
    let cpu_usage = sys.cpus().iter().map(|cpu| cpu.cpu_usage()).sum::<f32>()
        / sys.cpus().len().max(1) as f32;

    // Calculate memory usage based on platform
    #[cfg(target_os = "macos")]
    let (mem_used, mem_total) = {
        // On macOS, use vm_stat to get actual app memory (Active + Wired)
        // This matches what htop displays (excludes compressed/cached memory)
        get_macos_memory_usage().unwrap_or_else(|| {
            log::debug!("vm_stat failed, falling back to sysinfo");
            // Fallback to sysinfo if vm_stat fails
            (sys.used_memory() as f64, sys.total_memory() as f64)
        })
    };

    #[cfg(not(target_os = "macos"))]
    let (mem_used, mem_total) = {
        // On Linux, use available_memory() for accurate "application" memory usage
        let total = sys.total_memory() as f64;
        let available = sys.available_memory() as f64;
        let used = if available > 0.0 {
            total - available // Excludes cache/buffers
        } else {
            log::debug!("available_memory unavailable, falling back to used_memory");
            sys.used_memory() as f64 // Fallback
        };
        (used, total)
    };

    let mem_percent = if mem_total > 0.0 {
        (mem_used / mem_total * 100.0) as f32
    } else {
        0.0
    };

    // Convert bytes to GiB
    let mem_total_gb = (mem_total / BYTES_PER_GIB) as f32;
    let mem_used_gb = (mem_used / BYTES_PER_GIB) as f32;

    log::debug!(
        "System stats: cpu={:.1}%, mem={:.1}% ({:.2}/{:.2} GiB)",
        cpu_usage,
        mem_percent,
        mem_used_gb,
        mem_total_gb
    );

    Ok(SystemStats {
        cpu: cpu_usage,
        mem: mem_percent,
        mem_used_gb,
        mem_total_gb,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets(get_log_targets())
                .level(LevelFilter::Info)
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .max_file_size(MAX_LOG_FILE_SIZE)
                .rotation_strategy(RotationStrategy::KeepAll)
                .build(),
        )
        .manage(pty::PtyState::default())
        .invoke_handler(tauri::generate_handler![
            get_system_stats,
            logging::get_logs,
            logging::clear_logs,
            logging::get_log_path,
            pty::spawn_terminal,
            pty::write_terminal,
            pty::resize_terminal,
            pty::kill_terminal,
            pty::list_terminals,
            pty::inject_command,
            pty::inject_commands
        ])
        .build(tauri::generate_context!())
        .expect("Failed to build Tauri application");

    // Use App::run() (not Builder::run()) to hook into RunEvent::Exit.
    // Tauri calls std::process::exit() which skips Drop — so we must
    // explicitly kill all PTY sessions here to prevent leaked processes.
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            let state = app_handle.state::<pty::PtyState>();
            pty::kill_all_sessions(state.inner());
        }
    });
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // Sample vm_stat output for Apple Silicon (16384 byte pages)
    const SAMPLE_VM_STAT_APPLE_SILICON: &str = r#"Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                4238.
Pages active:                            220207.
Pages inactive:                          217715.
Pages speculative:                         1205.
Pages throttled:                              0.
Pages wired down:                        139137.
Pages purgeable:                              0.
"Translation faults":                2831385771.
Pages copy-on-write:                   51228142.
"#;

    // Sample vm_stat output for Intel Mac (4096 byte pages)
    const SAMPLE_VM_STAT_INTEL: &str = r#"Mach Virtual Memory Statistics: (page size of 4096 bytes)
Pages free:                               50000.
Pages active:                            500000.
Pages inactive:                          300000.
Pages speculative:                        10000.
Pages throttled:                              0.
Pages wired down:                        200000.
"#;

    // ==========================================================================
    // Happy Path Tests
    // ==========================================================================

    #[test]
    fn test_parse_vm_stat_apple_silicon() {
        let result = parse_vm_stat_output(SAMPLE_VM_STAT_APPLE_SILICON);
        assert!(result.is_some());

        let data = result.unwrap();
        assert_eq!(data.page_size, 16384.0);
        assert_eq!(data.pages_active, 220207.0);
        assert_eq!(data.pages_wired, 139137.0);
    }

    #[test]
    fn test_parse_vm_stat_intel() {
        let result = parse_vm_stat_output(SAMPLE_VM_STAT_INTEL);
        assert!(result.is_some());

        let data = result.unwrap();
        assert_eq!(data.page_size, 4096.0);
        assert_eq!(data.pages_active, 500000.0);
        assert_eq!(data.pages_wired, 200000.0);
    }

    #[test]
    fn test_calculate_used_memory_apple_silicon() {
        let data = VmStatData {
            page_size: 16384.0,
            pages_active: 220207.0,
            pages_wired: 139137.0,
        };

        let used = calculate_used_memory(&data);
        // (220207 + 139137) * 16384 = 359344 * 16384 = 5,887,492,096 bytes
        assert_eq!(used, 5_887_492_096.0);
    }

    #[test]
    fn test_calculate_used_memory_intel() {
        let data = VmStatData {
            page_size: 4096.0,
            pages_active: 500000.0,
            pages_wired: 200000.0,
        };

        let used = calculate_used_memory(&data);
        // (500000 + 200000) * 4096 = 700000 * 4096 = 2,867,200,000 bytes
        assert_eq!(used, 2_867_200_000.0);
    }

    // ==========================================================================
    // Edge Case Tests
    // ==========================================================================

    #[test]
    fn test_parse_vm_stat_empty_input() {
        let result = parse_vm_stat_output("");
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_vm_stat_missing_page_size() {
        let input = r#"Some random output
Pages active: 100.
Pages wired down: 50.
"#;
        let result = parse_vm_stat_output(input);
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_vm_stat_malformed_page_size() {
        let input = r#"Mach Virtual Memory Statistics: (page size of INVALID bytes)
Pages active:                            100.
Pages wired down:                         50.
"#;
        let result = parse_vm_stat_output(input);
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_vm_stat_missing_active_pages() {
        let input = r#"Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                              4238.
Pages wired down:                        139137.
"#;
        let result = parse_vm_stat_output(input);
        assert!(result.is_some());

        let data = result.unwrap();
        assert_eq!(data.page_size, 16384.0);
        assert_eq!(data.pages_active, 0.0); // Defaults to 0
        assert_eq!(data.pages_wired, 139137.0);
    }

    #[test]
    fn test_parse_vm_stat_missing_wired_pages() {
        let input = r#"Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                              4238.
Pages active:                            220207.
"#;
        let result = parse_vm_stat_output(input);
        assert!(result.is_some());

        let data = result.unwrap();
        assert_eq!(data.page_size, 16384.0);
        assert_eq!(data.pages_active, 220207.0);
        assert_eq!(data.pages_wired, 0.0); // Defaults to 0
    }

    #[test]
    fn test_parse_vm_stat_non_numeric_page_counts() {
        let input = r#"Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages active:                            INVALID.
Pages wired down:                        ALSO_INVALID.
"#;
        let result = parse_vm_stat_output(input);
        assert!(result.is_some());

        let data = result.unwrap();
        assert_eq!(data.page_size, 16384.0);
        assert_eq!(data.pages_active, 0.0); // Defaults to 0 on parse failure
        assert_eq!(data.pages_wired, 0.0);  // Defaults to 0 on parse failure
    }

    #[test]
    fn test_parse_vm_stat_whitespace_handling() {
        // Test that various whitespace patterns are handled correctly
        let input = r#"Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages active:     100.
Pages wired down:                        50.
"#;
        let result = parse_vm_stat_output(input);
        assert!(result.is_some());

        let data = result.unwrap();
        assert_eq!(data.pages_active, 100.0);
        assert_eq!(data.pages_wired, 50.0);
    }
}
