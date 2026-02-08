use std::net::SocketAddr;
use std::sync::Arc;

use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tokio::net::TcpListener;
use tokio::sync::{watch, Mutex};
use tokio_tungstenite::tungstenite::Message;

use scap::frame::{Frame, FrameType, VideoFrame};
use scap::capturer::{Capturer, Options, Resolution};

// =============================================================================
// Constants
// =============================================================================

/// Allowed streaming port range (unprivileged, dedicated to streaming)
const STREAM_PORT_MIN: u16 = 9100;
const STREAM_PORT_MAX: u16 = 9199;

/// Maximum FPS to prevent resource exhaustion
const MAX_FPS: u32 = 30;

/// Maximum frame width for raw RGBA streaming. Frames wider than this are
/// nearest-neighbor downscaled to reduce bandwidth and frontend render time.
const STREAM_MAX_WIDTH: u32 = 960;

/// Allowed WebSocket Origin values for the Tauri webview
const ALLOWED_ORIGINS: &[&str] = &[
    "tauri://localhost",
    "https://tauri.localhost",
    "http://localhost:1420", // dev server
];

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
    pub display_id: Option<u32>,
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
    capture_handle: Option<std::thread::JoinHandle<()>>,
    ws_handle: Option<tokio::task::JoinHandle<()>>,
    port: u16,
    fps: u32,
    quality: i32,
    display_id: Option<u32>,
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

    // Validate parameters with explicit errors instead of silent clamping
    if !(1..=100).contains(&quality) {
        return Err(format!("Quality must be 1-100, got: {}", quality));
    }
    if !(1..=MAX_FPS).contains(&fps) {
        return Err(format!("FPS must be 1-{}, got: {}", MAX_FPS, fps));
    }
    if !(STREAM_PORT_MIN..=STREAM_PORT_MAX).contains(&port) {
        return Err(format!(
            "Streaming port must be {}-{}, got: {}",
            STREAM_PORT_MIN, STREAM_PORT_MAX, port
        ));
    }

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
        let found = targets.into_iter().find(|t| {
            if let scap::Target::Display(d) = t {
                d.id == id
            } else {
                false
            }
        });
        if found.is_none() {
            log::warn!("Display id={} not found in available targets", id);
        }
        found
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

    // Watch channel for JPEG frames — latest-frame semantics for real-time streaming.
    // Only the most recent frame is retained, eliminating stale-frame buffering.
    let (frame_tx, _) = watch::channel(Bytes::new());
    let frame_tx = Arc::new(frame_tx);

    // Spawn the capture thread (blocking - scap uses blocking get_next_frame)
    let capture_frame_tx = frame_tx.clone();
    let capture_shutdown_rx = shutdown_rx.clone();
    let capture_fps = fps;

    let capture_handle = std::thread::spawn(move || {
        let options = Options {
            fps: capture_fps,
            show_cursor: true,
            show_highlight: false,
            target,
            output_type: FrameType::BGRAFrame,
            output_resolution: Resolution::Captured,
            ..Default::default()
        };

        let mut capturer = match Capturer::build(options) {
            Ok(c) => c,
            Err(e) => {
                log::error!("Failed to build capturer: {:?}", e);
                return;
            }
        };

        // Reusable buffer for raw RGBA pixels with 4-byte dimension header.
        // Resized once on first frame (or resolution change), reused thereafter.
        let mut rgba_buf: Vec<u8> = Vec::new();

        capturer.start_capture();
        log::info!("Screen capture started ({}fps, raw RGBA)", capture_fps);

        loop {
            // Check for shutdown
            if *capture_shutdown_rx.borrow() {
                break;
            }

            match capturer.get_next_frame() {
                Ok(Frame::Video(VideoFrame::BGRA(frame))) => {
                    // Guard: skip empty frames (scap returns 0x0 on transient
                    // capture failures, common with external HDMI/USB displays)
                    if frame.width == 0 || frame.height == 0 {
                        log::debug!("Skipping empty frame ({}x{})", frame.width, frame.height);
                        continue;
                    }

                    // Guard: verify pixel buffer length matches dimensions.
                    // ScreenCaptureKit can return mismatched buffers on non-Retina
                    // external displays due to scale-factor calculation issues.
                    let expected_len = frame.width as usize * frame.height as usize * 4;
                    if frame.data.len() < expected_len {
                        log::warn!(
                            "Frame data mismatch: {}x{} expects {} bytes, got {}. Skipping.",
                            frame.width, frame.height, expected_len, frame.data.len()
                        );
                        continue;
                    }

                    // Downscale to fit within STREAM_MAX_WIDTH and convert
                    // BGRA→RGBA for direct putImageData() on the frontend.
                    // Raw pixels eliminate WebKit's slow JPEG decode pipeline.
                    let src_w = frame.width as usize;
                    let src_h = frame.height as usize;
                    let scale = if (frame.width as u32) > STREAM_MAX_WIDTH {
                        (frame.width as u32).div_ceil(STREAM_MAX_WIDTH) as usize
                    } else {
                        1
                    };
                    let dst_w = src_w / scale;
                    let dst_h = src_h / scale;

                    // 4-byte header (u16 width + u16 height LE) + RGBA pixels
                    let total = 4 + dst_w * dst_h * 4;
                    rgba_buf.resize(total, 0);
                    rgba_buf[0..2].copy_from_slice(&(dst_w as u16).to_le_bytes());
                    rgba_buf[2..4].copy_from_slice(&(dst_h as u16).to_le_bytes());

                    let out = &mut rgba_buf[4..];
                    if scale == 1 {
                        // BGRA→RGBA swap only (no downscale)
                        for i in 0..(src_w * src_h) {
                            let si = i * 4;
                            let di = i * 4;
                            out[di]     = frame.data[si + 2]; // R
                            out[di + 1] = frame.data[si + 1]; // G
                            out[di + 2] = frame.data[si];     // B
                            out[di + 3] = frame.data[si + 3]; // A
                        }
                    } else {
                        // Downscale + BGRA→RGBA swap
                        for y in 0..dst_h {
                            let src_row = y * scale * src_w;
                            for x in 0..dst_w {
                                let si = (src_row + x * scale) * 4;
                                let di = (y * dst_w + x) * 4;
                                out[di]     = frame.data[si + 2]; // R
                                out[di + 1] = frame.data[si + 1]; // G
                                out[di + 2] = frame.data[si];     // B
                                out[di + 3] = frame.data[si + 3]; // A
                            }
                        }
                    }

                    let _ = capture_frame_tx.send(Bytes::copy_from_slice(&rgba_buf[..total]));
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

    let ws_handle = tokio::spawn(async move {
        loop {
            let mut shutdown = ws_shutdown_rx.clone();

            tokio::select! {
                result = listener.accept() => {
                    match result {
                        Ok((stream, addr)) => {
                            // Disable Nagle's algorithm for low-latency frame delivery
                            stream.set_nodelay(true).ok();
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
        display_id,
    };

    *session = Some(StreamSession {
        shutdown_tx,
        capture_handle: Some(capture_handle),
        ws_handle: Some(ws_handle),
        port: actual_port,
        fps,
        quality,
        display_id,
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
        // Signal shutdown to capture thread and WS server
        let _ = s.shutdown_tx.send(true);

        // Wait for the WebSocket server task to finish
        if let Some(ws) = s.ws_handle {
            let _ = ws.await;
        }

        // Wait for the capture thread to finish
        if let Some(cap) = s.capture_handle {
            let _ = cap.join();
        }

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
            display_id: s.display_id,
        }),
        None => Ok(StreamStatus {
            active: false,
            port: 0,
            fps: 0,
            quality: 0,
            clients: 0,
            display_id: None,
        }),
    }
}

// =============================================================================
// WebSocket Client Handler
// =============================================================================

/// Validate WebSocket Origin header against allowed origins.
/// Returns true if the origin is in the allowlist.
fn is_allowed_origin(origin: &str) -> bool {
    ALLOWED_ORIGINS.iter().any(|a| *a == origin)
}

async fn handle_ws_client(
    stream: tokio::net::TcpStream,
    mut frame_rx: watch::Receiver<Bytes>,
    client_count: Arc<std::sync::atomic::AtomicUsize>,
    shutdown_rx: watch::Receiver<bool>,
) {
    // Validate Origin header during WebSocket handshake to prevent
    // DNS rebinding and Cross-Site WebSocket Hijacking (CSWSH) attacks.
    let ws_stream = match tokio_tungstenite::accept_hdr_async(
        stream,
        |req: &tokio_tungstenite::tungstenite::handshake::server::Request,
         resp: tokio_tungstenite::tungstenite::handshake::server::Response| {
            let origin = req
                .headers()
                .get("Origin")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");

            if is_allowed_origin(origin) {
                Ok(resp)
            } else {
                log::warn!("Rejected WebSocket connection from origin: {}", origin);
                Err(tokio_tungstenite::tungstenite::handshake::server::Response::builder()
                    .status(403)
                    .body(Some("Forbidden: invalid origin".into()))
                    .unwrap())
            }
        },
    )
    .await
    {
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
            // Send latest frame to the client (watch = always latest, no stale buffering)
            result = frame_rx.changed() => {
                match result {
                    Ok(()) => {
                        let frame_data = frame_rx.borrow_and_update().clone();
                        if frame_data.is_empty() { continue; }
                        if let Err(e) = ws_sender.send(Message::Binary(frame_data)).await {
                            log::debug!("WebSocket send error (client disconnected): {}", e);
                            break;
                        }
                    }
                    Err(_) => {
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
