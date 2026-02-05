//! PTY (pseudo-terminal) session management for the embedded terminal.
//!
//! Provides Tauri commands to spawn, interact with, resize, and kill
//! shell sessions. Each session runs in its own PTY with output streamed
//! to the frontend via Tauri events.

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

// =============================================================================
// Types
// =============================================================================

/// A single PTY session with its writer, master handle, and child process.
pub struct PtySession {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
}

/// Shared state holding all active PTY sessions.
pub struct PtyState {
    pub sessions: Mutex<HashMap<String, PtySession>>,
}

impl Default for PtyState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

/// Information about a terminal session returned to the frontend.
#[derive(Debug, Serialize, Clone)]
pub struct TerminalInfo {
    pub session_id: String,
    pub is_alive: bool,
}

/// Structured output event for AI agent consumption.
#[derive(Debug, Serialize, Clone)]
pub struct TerminalOutput {
    pub session_id: String,
    pub data: String,
    pub timestamp: String,
}

// =============================================================================
// Tauri Commands
// =============================================================================

/// Spawn a new terminal shell session.
///
/// Creates a PTY, spawns the user's default shell, and starts streaming
/// output to the frontend via `pty-output-{session_id}` events.
///
/// Returns the session ID (generated if not provided).
#[tauri::command]
pub async fn spawn_terminal(
    app: tauri::AppHandle,
    state: State<'_, PtyState>,
    session_id: Option<String>,
) -> Result<String, String> {
    let session_id = session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    // Idempotent: if session already exists, return it without spawning a new one.
    // This prevents session resets when multiple UI components share the same session
    // (e.g. panel card + focus dialog).
    {
        let sessions = state
            .sessions
            .lock()
            .map_err(|e| format!("Failed to lock sessions: {}", e))?;
        if sessions.contains_key(&session_id) {
            log::info!("Session {} already exists, reusing", session_id);
            return Ok(session_id);
        }
    }

    log::info!("Spawning terminal session: {}", session_id);

    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Determine shell from environment
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());

    let mut cmd = CommandBuilder::new(&shell);
    cmd.env("TERM", "xterm-256color");
    if let Ok(home) = std::env::var("HOME") {
        cmd.cwd(&home);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Drop slave after spawning — required for proper EOF behavior
    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

    let writer = Arc::new(Mutex::new(writer));

    // Store session
    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|e| format!("Failed to lock sessions: {}", e))?;

        sessions.insert(
            session_id.clone(),
            PtySession {
                writer: Arc::clone(&writer),
                master: pair.master,
                child,
            },
        );
    }

    // Spawn blocking reader that streams output to frontend via events
    let event_name = format!("pty-output-{}", session_id);
    let sid = session_id.clone();
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    log::info!("PTY reader EOF for session: {}", sid);
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    // Raw output for xterm.js rendering
                    if app.emit(&event_name, &data).is_err() {
                        log::warn!("Failed to emit PTY output for session: {}", sid);
                        break;
                    }
                    // Structured output for AI agent consumption
                    let _ = app.emit(
                        "terminal-output-captured",
                        TerminalOutput {
                            session_id: sid.clone(),
                            data: data.clone(),
                            timestamp: chrono::Local::now().to_rfc3339(),
                        },
                    );
                }
                Err(e) => {
                    log::error!("PTY read error for session {}: {}", sid, e);
                    break;
                }
            }
        }
        // Emit a close event so the frontend knows the session ended
        let _ = app.emit(&format!("pty-close-{}", sid), ());
    });

    log::info!("Terminal session {} started with shell: {}", session_id, shell);

    Ok(session_id)
}

/// Write data to a terminal session's stdin.
#[tauri::command]
pub fn write_terminal(
    state: State<'_, PtyState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Failed to lock sessions: {}", e))?;

    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    let mut writer = session
        .writer
        .lock()
        .map_err(|e| format!("Failed to lock writer: {}", e))?;

    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write to PTY: {}", e))?;

    writer
        .flush()
        .map_err(|e| format!("Failed to flush PTY: {}", e))?;

    Ok(())
}

/// Resize a terminal session's PTY.
#[tauri::command]
pub fn resize_terminal(
    state: State<'_, PtyState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Failed to lock sessions: {}", e))?;

    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize PTY: {}", e))?;

    log::debug!(
        "Resized session {} to {}x{}",
        session_id,
        cols,
        rows
    );

    Ok(())
}

/// Kill a single PTY session and its entire process tree.
///
/// Uses POSIX process group signaling (SIGHUP → SIGKILL escalation)
/// to ensure all child processes (e.g. `claude`, `npm`) are terminated,
/// not just the direct shell. This matches the Alacritty/WezTerm pattern.
///
/// Safe implementation via the `nix` crate — no `unsafe` blocks required.
fn kill_session(session_id: &str, session: &mut PtySession) {
    if let Some(raw_pid) = session.child.process_id() {
        #[cfg(unix)]
        {
            use nix::sys::signal::{killpg, Signal};
            use nix::unistd::Pid;

            let pid = Pid::from_raw(raw_pid as i32);

            // 1. Send SIGHUP to entire process group (graceful shutdown).
            //    Since portable-pty calls setsid(), child PID == PGID.
            log::debug!("Sending SIGHUP to process group {} for session {}", raw_pid, session_id);
            if let Err(e) = killpg(pid, Signal::SIGHUP) {
                log::warn!("killpg(SIGHUP) failed for session {}: {}", session_id, e);
            }

            // 2. Brief grace period for processes to clean up
            std::thread::sleep(std::time::Duration::from_millis(100));

            // 3. Force-kill entire process group (catches stragglers)
            log::debug!("Sending SIGKILL to process group {} for session {}", raw_pid, session_id);
            if let Err(e) = killpg(pid, Signal::SIGKILL) {
                log::warn!("killpg(SIGKILL) failed for session {}: {}", session_id, e);
            }
        }

        // Fallback for non-unix (Windows)
        #[cfg(not(unix))]
        {
            if let Err(e) = session.child.kill() {
                log::warn!("Failed to kill child for session {}: {}", session_id, e);
            }
        }
    } else {
        // No PID available — fall back to portable-pty's kill
        if let Err(e) = session.child.kill() {
            log::warn!("Failed to kill child for session {}: {}", session_id, e);
        }
    }

    // 4. Reap zombie process
    if let Err(e) = session.child.wait() {
        log::warn!("Failed to wait on child for session {}: {}", session_id, e);
    }

    log::info!("Killed terminal session: {}", session_id);
    // Dropping session releases master PTY, writer, etc.
}

/// Kill a terminal session and clean up all child processes.
#[tauri::command]
pub fn kill_terminal(
    state: State<'_, PtyState>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Failed to lock sessions: {}", e))?;

    let mut session = sessions
        .remove(&session_id)
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    kill_session(&session_id, &mut session);

    Ok(())
}

/// Kill all active PTY sessions. Called on app exit to prevent leaked processes.
pub fn kill_all_sessions(state: &PtyState) {
    let mut sessions = match state.sessions.lock() {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to lock sessions for cleanup: {}", e);
            return;
        }
    };

    let count = sessions.len();
    if count == 0 {
        return;
    }

    let ids: Vec<String> = sessions.keys().cloned().collect();
    for id in &ids {
        if let Some(mut session) = sessions.remove(id) {
            kill_session(id, &mut session);
        }
    }

    log::info!("App exit: killed {} PTY session(s)", count);
}

/// List all active terminal sessions.
#[tauri::command]
pub fn list_terminals(
    state: State<'_, PtyState>,
) -> Result<Vec<TerminalInfo>, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Failed to lock sessions: {}", e))?;

    let terminals: Vec<TerminalInfo> = sessions
        .keys()
        .map(|id| TerminalInfo {
            session_id: id.clone(),
            is_alive: true,
        })
        .collect();

    Ok(terminals)
}

// =============================================================================
// AI Agent Commands
// =============================================================================

/// Inject a single command into a terminal session.
///
/// Appends a newline to execute the command. The command appears in the
/// terminal as if the user typed it.
#[tauri::command]
pub fn inject_command(
    state: State<'_, PtyState>,
    session_id: String,
    command: String,
) -> Result<(), String> {
    log::info!(
        "Injecting command into session {}: {}",
        session_id,
        command.chars().take(80).collect::<String>()
    );

    let sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Failed to lock sessions: {}", e))?;

    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    let mut writer = session
        .writer
        .lock()
        .map_err(|e| format!("Failed to lock writer: {}", e))?;

    // Write command followed by newline to execute
    writer
        .write_all(command.as_bytes())
        .map_err(|e| format!("Failed to write command: {}", e))?;
    writer
        .write_all(b"\n")
        .map_err(|e| format!("Failed to write newline: {}", e))?;
    writer
        .flush()
        .map_err(|e| format!("Failed to flush: {}", e))?;

    Ok(())
}

/// Inject multiple commands sequentially into a terminal session.
///
/// Each command is sent with a newline. A short delay between commands
/// allows the shell to process each one.
#[tauri::command]
pub async fn inject_commands(
    state: State<'_, PtyState>,
    session_id: String,
    commands: Vec<String>,
) -> Result<(), String> {
    log::info!(
        "Injecting {} commands into session {}",
        commands.len(),
        session_id
    );

    for (i, command) in commands.iter().enumerate() {
        log::debug!(
            "Injecting command {}/{}: {}",
            i + 1,
            commands.len(),
            command.chars().take(80).collect::<String>()
        );

        {
            let sessions = state
                .sessions
                .lock()
                .map_err(|e| format!("Failed to lock sessions: {}", e))?;

            let session = sessions
                .get(&session_id)
                .ok_or_else(|| format!("Session not found: {}", session_id))?;

            let mut writer = session
                .writer
                .lock()
                .map_err(|e| format!("Failed to lock writer: {}", e))?;

            writer
                .write_all(command.as_bytes())
                .map_err(|e| format!("Failed to write command: {}", e))?;
            writer
                .write_all(b"\n")
                .map_err(|e| format!("Failed to write newline: {}", e))?;
            writer
                .flush()
                .map_err(|e| format!("Failed to flush: {}", e))?;
        }

        // Brief delay between commands to let the shell process each one
        if i < commands.len() - 1 {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
    }

    Ok(())
}
