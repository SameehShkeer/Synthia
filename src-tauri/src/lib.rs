// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use serde::Serialize;
use sysinfo::System;
use thiserror::Error;

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
    if name.len() > 100 {
        return Err(AppError::Validation("Name must be 100 characters or less".into()));
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

    // Calculate memory usage
    let mem_total = sys.total_memory() as f64;
    let mem_used = sys.used_memory() as f64;
    let mem_percent = if mem_total > 0.0 {
        (mem_used / mem_total * 100.0) as f32
    } else {
        0.0
    };

    // Convert bytes to GB
    let mem_total_gb = (mem_total / 1_073_741_824.0) as f32;
    let mem_used_gb = (mem_used / 1_073_741_824.0) as f32;

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
