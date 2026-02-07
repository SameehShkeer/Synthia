use std::net::SocketAddr;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tokio::net::TcpListener;
use tokio::sync::{broadcast, Mutex};
use tokio_tungstenite::tungstenite::Message;

use scap::frame::{Frame, FrameType, VideoFrame};
use scap::capturer::{Capturer, Options, Resolution};

// =============================================================================
// Types
// =============================================================================

/// Status information returned to the frontend
#[derive(Debug, Clone, Serialize)]
pub struct StreamStatus {
    pub active: bool,
    pub port: u16,
    pub fps: u32,
    pub quality: i32,
    pub clients: usize,
}

/// Display info for the frontend display picker
#[derive(Debug, Clone, Serialize)]
pub struct DisplayInfo {
    pub id: u32,
    pub title: String,
    pub is_primary: bool,
}

/// Active streaming session with handles to shut it down
struct StreamSession {
    shutdown_tx: tokio::sync::watch::Sender<bool>,
    port: u16,
    fps: u32,
    quality: i32,
    client_count: Arc<std::sync::atomic::AtomicUsize>,
}

/// Shared state managed by Tauri
pub struct StreamingState {
    session: Mutex<Option<StreamSession>>,
}

impl Default for StreamingState {
    fn default() -> Self {
        Self {
            session: Mutex::new(None),
        }
    }
}

// =============================================================================
// Tauri Commands
// =============================================================================

/// List all available displays for capture
#[tauri::command]
pub async fn list_displays() -> Result<Vec<DisplayInfo>, String> {
    if !scap::is_supported() {
        return Err("Screen capture not supported on this platform".into());
    }

    let main_display = scap::get_main_display();
    let targets = scap::get_all_targets();

    let displays: Vec<DisplayInfo> = targets
        .into_iter()
        .filter_map(|t| {
            if let scap::Target::Display(d) = t {
                Some(DisplayInfo {
                    id: d.id,
                    title: d.title.clone(),
                    is_primary: d.id == main_display.id,
                })
            } else {
                None
            }
        })
        .collect();

    Ok(displays)
}

/// Start the local MJPEG WebSocket streaming server
#[tauri::command]
pub async fn start_local_stream(
    state: tauri::State<'_, StreamingState>,
    port: u16,
    quality: i32,
    fps: u32,
    display_id: Option<u32>,
) -> Result<StreamStatus, String> {
    let mut session = state.session.lock().await;

    if session.is_some() {
        return Err("Stream already running. Stop it first.".into());
    }

    // Validate parameters
    let quality = quality.clamp(1, 100);
    let fps = fps.clamp(1, 60);

    if !scap::is_supported() {
        return Err("Screen capture not supported on this platform".into());
    }

    if !scap::has_permission() {
        scap::request_permission();
        return Err("Screen capture permission not granted. Please allow in System Settings and restart.".into());
    }

    // Find the target display
    let target = if let Some(id) = display_id {
        let targets = scap::get_all_targets();
        targets.into_iter().find(|t| {
            if let scap::Target::Display(d) = t {
                d.id == id
            } else {
                false
            }
        })
    } else {
        Some(scap::Target::Display(scap::get_main_display()))
    };

    // Create shutdown channel
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let client_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    // Bind the TCP listener for the WebSocket server
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind port {}: {}", port, e))?;

    let actual_port = listener
        .local_addr()
        .map(|a| a.port())
        .unwrap_or(port);

    log::info!("MJPEG WebSocket server starting on ws://127.0.0.1:{}", actual_port);

    // Broadcast channel for JPEG frames
    let (frame_tx, _) = broadcast::channel::<Arc<Vec<u8>>>(4);

    // Spawn the capture thread (blocking - scap uses blocking get_next_frame)
    let capture_frame_tx = frame_tx.clone();
    let capture_shutdown_rx = shutdown_rx.clone();
    let capture_quality = quality;
    let capture_fps = fps;

    std::thread::spawn(move || {
        let options = Options {
            fps: capture_fps,
            show_cursor: true,
            show_highlight: false,
            target,
            output_type: FrameType::BGRAFrame,
            output_resolution: Resolution::_1080p,
            ..Default::default()
        };

        let mut capturer = match Capturer::build(options) {
            Ok(c) => c,
            Err(e) => {
                log::error!("Failed to build capturer: {:?}", e);
                return;
            }
        };

        // Create turbojpeg compressor
        let mut compressor = match turbojpeg::Compressor::new() {
            Ok(c) => c,
            Err(e) => {
                log::error!("Failed to create JPEG compressor: {}", e);
                return;
            }
        };

        if let Err(e) = compressor.set_quality(capture_quality) {
            log::error!("Failed to set JPEG quality: {}", e);
            return;
        }
        if let Err(e) = compressor.set_subsamp(turbojpeg::Subsamp::Sub2x2) {
            log::error!("Failed to set JPEG subsampling: {}", e);
            return;
        }

        capturer.start_capture();
        log::info!("Screen capture started ({}fps, quality={})", capture_fps, capture_quality);

        loop {
            // Check for shutdown
            if *capture_shutdown_rx.borrow() {
                break;
            }

            match capturer.get_next_frame() {
                Ok(Frame::Video(VideoFrame::BGRA(frame))) => {
                    let image = turbojpeg::Image {
                        pixels: frame.data.as_slice(),
                        width: frame.width as usize,
                        pitch: frame.width as usize * 4,
                        height: frame.height as usize,
                        format: turbojpeg::PixelFormat::BGRA,
                    };

                    match compressor.compress_to_vec(image) {
                        Ok(jpeg_data) => {
                            // Ignore send error (no receivers)
                            let _ = capture_frame_tx.send(Arc::new(jpeg_data));
                        }
                        Err(e) => {
                            log::warn!("JPEG compression failed: {}", e);
                        }
                    }
                }
                Ok(_) => {
                    // Skip non-BGRA frames (audio, etc.)
                }
                Err(e) => {
                    log::error!("Frame capture error: {}", e);
                    break;
                }
            }
        }

        capturer.stop_capture();
        log::info!("Screen capture stopped");
    });

    // Spawn the WebSocket server task
    let ws_client_count = client_count.clone();
    let ws_shutdown_rx = shutdown_rx.clone();

    tokio::spawn(async move {
        loop {
            let mut shutdown = ws_shutdown_rx.clone();

            tokio::select! {
                result = listener.accept() => {
                    match result {
                        Ok((stream, addr)) => {
                            log::debug!("New WebSocket client: {}", addr);
                            let rx = frame_tx.subscribe();
                            let count = ws_client_count.clone();
                            let client_shutdown = ws_shutdown_rx.clone();

                            tokio::spawn(handle_ws_client(stream, rx, count, client_shutdown));
                        }
                        Err(e) => {
                            log::error!("Failed to accept connection: {}", e);
                        }
                    }
                }
                _ = shutdown.changed() => {
                    if *shutdown.borrow() {
                        log::info!("WebSocket server shutting down");
                        break;
                    }
                }
            }
        }
    });

    let status = StreamStatus {
        active: true,
        port: actual_port,
        fps,
        quality,
        clients: 0,
    };

    *session = Some(StreamSession {
        shutdown_tx,
        port: actual_port,
        fps,
        quality,
        client_count,
    });

    Ok(status)
}

/// Stop the local MJPEG WebSocket streaming server
#[tauri::command]
pub async fn stop_local_stream(
    state: tauri::State<'_, StreamingState>,
) -> Result<(), String> {
    let mut session = state.session.lock().await;

    if let Some(s) = session.take() {
        let _ = s.shutdown_tx.send(true);
        log::info!("Local stream stopped");
        Ok(())
    } else {
        Err("No stream is running".into())
    }
}

/// Get the current stream status
#[tauri::command]
pub async fn get_stream_status(
    state: tauri::State<'_, StreamingState>,
) -> Result<StreamStatus, String> {
    let session = state.session.lock().await;

    match &*session {
        Some(s) => Ok(StreamStatus {
            active: true,
            port: s.port,
            fps: s.fps,
            quality: s.quality,
            clients: s.client_count.load(std::sync::atomic::Ordering::Relaxed),
        }),
        None => Ok(StreamStatus {
            active: false,
            port: 0,
            fps: 0,
            quality: 0,
            clients: 0,
        }),
    }
}

// =============================================================================
// WebSocket Client Handler
// =============================================================================

async fn handle_ws_client(
    stream: tokio::net::TcpStream,
    mut frame_rx: broadcast::Receiver<Arc<Vec<u8>>>,
    client_count: Arc<std::sync::atomic::AtomicUsize>,
    shutdown_rx: tokio::sync::watch::Receiver<bool>,
) {
    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            log::error!("WebSocket handshake failed: {}", e);
            return;
        }
    };

    client_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let mut shutdown = shutdown_rx;

    loop {
        tokio::select! {
            // Send frames to the client
            frame = frame_rx.recv() => {
                match frame {
                    Ok(jpeg_data) => {
                        if let Err(e) = ws_sender.send(Message::Binary((*jpeg_data).clone().into())).await {
                            log::debug!("WebSocket send error (client disconnected): {}", e);
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        log::debug!("Client lagged, skipped {} frames", n);
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        break;
                    }
                }
            }
            // Handle incoming messages (ignore for now, could be control messages)
            msg = ws_receiver.next() => {
                match msg {
                    Some(Ok(_)) => {
                        // Could handle control messages here (quality, fps changes)
                    }
                    _ => {
                        break;
                    }
                }
            }
            // Check for shutdown
            _ = shutdown.changed() => {
                if *shutdown.borrow() {
                    break;
                }
            }
        }
    }

    client_count.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
    log::debug!("WebSocket client disconnected");
}
