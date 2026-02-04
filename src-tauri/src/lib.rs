// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use serde::Serialize;
use sysinfo::System;
use thiserror::Error;

#[cfg(target_os = "macos")]
use std::process::Command;

// =============================================================================
// Constants
// =============================================================================

/// Number of bytes in one gibibyte (GiB) - 2^30
const BYTES_PER_GIB: f64 = 1024.0 * 1024.0 * 1024.0;

/// Maximum allowed length for user input names
const MAX_NAME_LENGTH: usize = 100;

/// Get actual memory usage on macOS using vm_stat (matches htop)
#[cfg(target_os = "macos")]
fn get_macos_memory_usage() -> Option<(f64, f64)> {
    // Run vm_stat to get memory page statistics
    let output = Command::new("vm_stat").output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse page size (usually 16384 bytes on Apple Silicon, 4096 on Intel)
    let page_size: f64 = stdout
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
        stdout
            .lines()
            .find(|l| l.starts_with(name))
            .and_then(|l| l.split(':').nth(1))
            .and_then(|v| v.trim().trim_end_matches('.').parse().ok())
            .unwrap_or(0.0)
    };

    // Get page counts - Active + Wired = "Used" memory (what htop shows)
    // Note: Excludes compressed memory as htop does
    let pages_active = get_pages("Pages active");
    let pages_wired = get_pages("Pages wired down");

    let used_bytes = (pages_active + pages_wired) * page_size;

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

/// Validates that a name meets application requirements
fn validate_name(name: &str) -> Result<(), AppError> {
    if name.is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }
    if name.len() > MAX_NAME_LENGTH {
        return Err(AppError::Validation(
            format!("Name must be {} characters or less", MAX_NAME_LENGTH),
        ));
    }
    // Prevent potential injection by checking for control characters
    if name.chars().any(|c| c.is_control()) {
        return Err(AppError::Validation("Name contains invalid characters".into()));
    }
    Ok(())
}

/// Greets a user by name with input validation
#[tauri::command]
fn greet(name: &str) -> Result<String, AppError> {
    validate_name(name)?;
    Ok(format!("Hello, {}! You've been greeted from Rust!", name))
}

/// Returns real-time system CPU and memory statistics
#[tauri::command]
fn get_system_stats() -> Result<SystemStats, AppError> {
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

    Ok(SystemStats {
        cpu: cpu_usage,
        mem: mem_percent,
        mem_used_gb,
        mem_total_gb,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(e) = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, get_system_stats])
        .run(tauri::generate_context!())
    {
        eprintln!("Application error: {}", e);
        std::process::exit(1);
    }
}
