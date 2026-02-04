//! Log streaming commands for the Logs UI.
//!
//! This module provides Tauri commands to read, parse, and clear application logs
//! that are written by tauri-plugin-log.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use tauri::Manager;

// =============================================================================
// Types
// =============================================================================

/// A single log entry matching the frontend LogEntry type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub id: String,
    pub ts: String,
    pub level: String,
    pub source: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<HashMap<String, String>>,
}

/// Result type for log operations.
#[derive(Debug, Serialize)]
pub struct LogResult {
    pub success: bool,
    pub count: usize,
    pub logs: Vec<LogEntry>,
}

// =============================================================================
// Log File Location
// =============================================================================

/// Get the path to the application log file.
///
/// On macOS: ~/Library/Logs/{identifier}/{filename}.log
/// On Linux: ~/.local/share/{identifier}/logs/{filename}.log
/// On Windows: %APPDATA%/{identifier}/logs/{filename}.log
fn get_log_file_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let log_dir = app.path().app_log_dir().ok()?;
    Some(log_dir.join("synthia.log"))
}

// =============================================================================
// Log Parsing
// =============================================================================

/// Parse a single log line into a LogEntry.
///
/// Expected format from tauri-plugin-log:
/// `[2024-02-04][12:34:56][INFO][source] message`
/// or
/// `2024-02-04 12:34:56 INFO [source] message`
fn parse_log_line(line: &str, index: usize) -> Option<LogEntry> {
    // Skip empty lines
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    // Try to parse tauri-plugin-log format
    // Format: [date][time][LEVEL][target] message
    if line.starts_with('[') {
        return parse_bracketed_format(line, index);
    }

    // Try space-separated format: date time LEVEL [target] message
    parse_space_format(line, index)
}

/// Parse bracketed log format: [date][time][LEVEL][target] message
fn parse_bracketed_format(line: &str, index: usize) -> Option<LogEntry> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_bracket = false;
    let mut remainder = String::new();
    let mut bracket_count = 0;

    for ch in line.chars() {
        match ch {
            '[' if !in_bracket => {
                in_bracket = true;
                bracket_count += 1;
            }
            ']' if in_bracket => {
                in_bracket = false;
                parts.push(current.clone());
                current.clear();
                if bracket_count >= 4 {
                    // After 4 brackets, rest is message
                    break;
                }
            }
            _ if in_bracket => {
                current.push(ch);
            }
            _ if !in_bracket && bracket_count >= 4 => {
                remainder.push(ch);
            }
            _ => {}
        }
    }

    // Get remaining message after the last bracket
    let msg_start = line.rfind(']').map(|i| i + 1).unwrap_or(0);
    let message = line[msg_start..].trim().to_string();

    if parts.len() >= 4 {
        Some(LogEntry {
            id: format!("L-{:04}", index + 1),
            ts: format!("{}T{}", parts.get(0).unwrap_or(&String::new()), parts.get(1).unwrap_or(&String::new())),
            level: parts.get(2).unwrap_or(&"INFO".to_string()).to_uppercase(),
            source: parts.get(3).unwrap_or(&"app".to_string()).to_string(),
            message,
            meta: None,
        })
    } else {
        // Fallback: treat whole line as message
        Some(LogEntry {
            id: format!("L-{:04}", index + 1),
            ts: chrono::Local::now().format("%H:%M:%S").to_string(),
            level: "INFO".to_string(),
            source: "app".to_string(),
            message: line.to_string(),
            meta: None,
        })
    }
}

/// Valid log levels for parsing validation
const VALID_LOG_LEVELS: &[&str] = &["TRACE", "DEBUG", "INFO", "WARN", "WARNING", "ERROR", "FATAL"];

/// Check if a string looks like a valid log level
fn is_valid_log_level(s: &str) -> bool {
    VALID_LOG_LEVELS.contains(&s.to_uppercase().as_str())
}

/// Parse space-separated format: date time LEVEL [target] message
fn parse_space_format(line: &str, index: usize) -> Option<LogEntry> {
    let parts: Vec<&str> = line.splitn(5, ' ').collect();

    // Only parse as structured if we have enough parts AND the third part is a valid log level
    if parts.len() >= 4 && is_valid_log_level(parts[2]) {
        let date = parts[0];
        let time = parts[1];
        let level = parts[2].to_uppercase();

        // Target might be in brackets or just a word
        let (source, message) = if parts.len() >= 5 {
            let target = parts[3].trim_matches(|c| c == '[' || c == ']');
            (target.to_string(), parts[4].to_string())
        } else {
            ("app".to_string(), parts[3].to_string())
        };

        Some(LogEntry {
            id: format!("L-{:04}", index + 1),
            ts: format!("{}T{}", date, time),
            level,
            source,
            message,
            meta: None,
        })
    } else {
        // Fallback for unrecognized format: treat whole line as message
        Some(LogEntry {
            id: format!("L-{:04}", index + 1),
            ts: chrono::Local::now().format("%H:%M:%S").to_string(),
            level: "INFO".to_string(),
            source: "app".to_string(),
            message: line.to_string(),
            meta: None,
        })
    }
}

// =============================================================================
// Tauri Commands
// =============================================================================

/// Fetch logs from the application log file.
///
/// # Arguments
/// * `limit` - Maximum number of log entries to return (default: 1000)
/// * `offset` - Number of entries to skip from the end (for pagination)
///
/// # Returns
/// A LogResult containing parsed log entries.
#[tauri::command]
pub async fn get_logs(
    app: tauri::AppHandle,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<LogResult, String> {
    log::debug!("get_logs called with limit={:?}, offset={:?}", limit, offset);

    let log_path = get_log_file_path(&app)
        .ok_or_else(|| "Could not determine log file path".to_string())?;

    log::debug!("Reading logs from: {:?}", log_path);

    // Check if file exists
    if !log_path.exists() {
        log::info!("Log file does not exist yet: {:?}", log_path);
        return Ok(LogResult {
            success: true,
            count: 0,
            logs: vec![],
        });
    }

    // Read and parse log file
    let file = File::open(&log_path)
        .map_err(|e| format!("Failed to open log file: {}", e))?;

    let reader = BufReader::new(file);
    let limit = limit.unwrap_or(1000);
    let offset = offset.unwrap_or(0);

    // Parse all lines
    let mut entries: Vec<LogEntry> = reader
        .lines()
        .enumerate()
        .filter_map(|(idx, line)| {
            line.ok().and_then(|l| parse_log_line(&l, idx))
        })
        .collect();

    let total = entries.len();

    // Apply offset and limit (from the end, most recent first)
    entries.reverse();
    let entries: Vec<LogEntry> = entries
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect();

    log::info!("Returning {} of {} log entries", entries.len(), total);

    Ok(LogResult {
        success: true,
        count: entries.len(),
        logs: entries,
    })
}

/// Clear the application log file.
///
/// This truncates the log file rather than deleting it,
/// so the logging system continues to work without interruption.
#[tauri::command]
pub async fn clear_logs(app: tauri::AppHandle) -> Result<bool, String> {
    log::info!("clear_logs called");

    let log_path = get_log_file_path(&app)
        .ok_or_else(|| "Could not determine log file path".to_string())?;

    if !log_path.exists() {
        log::debug!("Log file does not exist, nothing to clear");
        return Ok(true);
    }

    // Truncate the file
    let mut file = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to clear log file: {}", e))?;

    // Write a marker so we know the file was cleared
    writeln!(file, "[{}][{}][INFO][synthia] Log file cleared",
        chrono::Local::now().format("%Y-%m-%d"),
        chrono::Local::now().format("%H:%M:%S"))
        .map_err(|e| format!("Failed to write clear marker: {}", e))?;

    log::info!("Log file cleared successfully");
    Ok(true)
}

/// Get the path to the log file (for debugging/display purposes).
#[tauri::command]
pub async fn get_log_path(app: tauri::AppHandle) -> Result<String, String> {
    let log_path = get_log_file_path(&app)
        .ok_or_else(|| "Could not determine log file path".to_string())?;

    Ok(log_path.to_string_lossy().to_string())
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_bracketed_format() {
        let line = "[2024-02-04][12:34:56][INFO][synthia] Application started";
        let entry = parse_log_line(line, 0).unwrap();

        assert_eq!(entry.id, "L-0001");
        assert_eq!(entry.level, "INFO");
        assert_eq!(entry.source, "synthia");
        assert!(entry.message.contains("Application started"));
    }

    #[test]
    fn test_parse_empty_line() {
        let entry = parse_log_line("", 0);
        assert!(entry.is_none());
    }

    #[test]
    fn test_parse_whitespace_line() {
        let entry = parse_log_line("   ", 0);
        assert!(entry.is_none());
    }

    #[test]
    fn test_parse_fallback_format() {
        let line = "Some random log message";
        let entry = parse_log_line(line, 5).unwrap();

        assert_eq!(entry.id, "L-0006");
        assert_eq!(entry.level, "INFO");
        assert_eq!(entry.source, "app");
        assert_eq!(entry.message, "Some random log message");
    }
}
