// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use thiserror::Error;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(e) = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
    {
        eprintln!("Application error: {}", e);
        std::process::exit(1);
    }
}
