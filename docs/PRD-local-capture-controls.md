# PRD: Local Screen Capture Controls

**Author:** Synthia Engineering
**Status:** Draft
**Date:** 2026-02-08
**Related Issues:** KAN-55 (Epic), KAN-64 (Mixed Content Blocker)

---

## 1. Problem Statement

The MJPEG local screen capture server (`start_local_stream`) has no UI controls. Users must invoke Tauri commands via the browser console to start streaming. There is no way to:

- Select which display/monitor to capture
- Configure quality and FPS before starting
- Start or stop the capture server
- See whether the server is running or how many clients are connected

This makes the streaming feature effectively unusable for anyone who isn't a developer.

---

## 2. User Persona

**Synthia Operator** — A technical user (developer, DevOps, team lead) who uses Synthia to orchestrate AI agents across terminals and IDE streams. They understand concepts like ports, FPS, and display selection, but should not need to open a browser console or know Tauri internals to start a screen capture.

---

## 3. Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| UI adoption | 100% of streaming sessions started from Settings UI (0% from console) | Remove console-only workaround after this ships |
| Time to first frame | < 3 seconds from clicking START to first frame in Command Center | Manual QA timing |
| Error clarity | Zero user-reported "I don't know what went wrong" incidents | Support channel monitoring |
| Control discoverability | New users find and start capture without documentation | Usability walkthrough with 2 team members |

---

## 4. Goal

Add a **"Local Capture"** section to the Settings page (Config > Streams tab) that lets users configure and control the local MJPEG screen capture server through the UI.

**Non-goals:**
- Remote stream source management (already handled by the existing stream source cards)
- Replacing the existing stream source configuration UI
- Auto-start on app launch (future enhancement)

---

## 5. User Flow

```
User opens Config → Streams tab
        │
        ▼
┌─────────────────────────────────┐
│  LOCAL CAPTURE section (new)    │
│                                 │
│  [Display Picker ▼]            │
│  "Built-in Retina Display" ●    │
│  "DELL U2723QE"                 │
│                                 │
│  Quality: [====●=====] 80%     │
│  FPS:     [====●=====] 30      │
│  Port:    [ 9100 ]              │
│                                 │
│  [ ● START CAPTURE ]            │
│                                 │
└─────────────────────────────────┘
        │
        ▼  (user clicks START)
        │
┌─────────────────────────────────┐
│  LOCAL CAPTURE                  │
│                                 │
│  STATUS: ● ACTIVE               │
│  Port: 9100 · 30fps · Q80      │
│  Clients: 1                     │
│                                 │
│  [ ■ STOP CAPTURE ]             │
│                                 │
└─────────────────────────────────┘
        │
        ▼  (user goes to Command Center)
        │
    Stream panels auto-connect to ws://localhost:9100
    and show the live screen capture
```

---

## 6. UI Specification

### 6.1 Placement

The new section goes **above** the existing stream source list in the **Streams tab** of Settings, separated by a visual divider. It is a single, persistent card — not a list item. There is only one local capture server per app instance.

### 6.2 Section Layout: "Local Capture"

**Section header:**
- Title: `LOCAL CAPTURE` (follows existing `SectionTitle` pattern)
- Description: `"Capture a display on this machine and serve it as an MJPEG WebSocket stream."`

**Card (single, always visible):**

```
┌──────────────────────────────────────────────────────────────┐
│  ┌─ Status Badge ─┐                                         │
│  │ ● INACTIVE     │                        [ ● START ]      │
│  └────────────────┘                                          │
│                                                              │
│  ┌─ Display ──────────────────────────────────────────────┐  │
│  │ [▼ Built-in Retina Display (Primary)                 ] │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ Quality ─────┐  ┌─ FPS ─────────┐  ┌─ Port ─────────┐  │
│  │ [slider] 80   │  │ [slider] 30   │  │ [input] 9100   │  │
│  └───────────────┘  └───────────────┘  └────────────────┘  │
│                                                              │
│  Endpoint: ws://127.0.0.1:9100                              │
└──────────────────────────────────────────────────────────────┘
```

**When active (streaming):**

```
┌──────────────────────────────────────────────────────────────┐
│  ┌─ Status Badge ─┐                                         │
│  │ ● STREAMING    │                        [ ■ STOP ]       │
│  └────────────────┘                                          │
│                                                              │
│  Display: Built-in Retina Display                            │
│  30fps · Quality 80 · Port 9100 · 1 client connected        │
│                                                              │
│  Endpoint: ws://127.0.0.1:9100                              │
└──────────────────────────────────────────────────────────────┘
```

### 6.3 Component Breakdown

| Element | Component | Details |
|---------|-----------|---------|
| Status badge | Custom badge | `INACTIVE` (muted), `STARTING...` (pulse), `STREAMING` (green/primary), `ERROR` (destructive) |
| Display picker | `<Select>` dropdown | Populated from `list_displays` Tauri command. Shows display title + "(Primary)" tag for the primary display. Disabled while streaming. |
| Quality slider | `<Slider>` or `<Input type="number">` | Range: 1–100, default: 80, step: 1. Label: "QUALITY". Disabled while streaming. |
| FPS slider | `<Slider>` or `<Input type="number">` | Range: 1–30, default: 30, step: 1. Label: "FPS". Disabled while streaming. |
| Port input | `<Input type="number">` | Range: 9100–9199, default: 9100. Label: "PORT". Disabled while streaming. |
| Start button | `<Button>` | Primary style. Text: `"START CAPTURE"`. Calls `start_local_stream`. |
| Stop button | `<Button>` | Destructive style. Text: `"STOP CAPTURE"`. Calls `stop_local_stream`. |
| Endpoint display | Monospace text | Shows `ws://127.0.0.1:{port}`. Selectable for copy-paste. |
| Client count | Monospace text | Shows number of connected WebSocket clients. Polls `get_stream_status`. |

### 6.4 States

| State | Badge | Controls | Button |
|-------|-------|----------|--------|
| **Inactive** | `INACTIVE` (muted) | All editable | `START CAPTURE` (primary) |
| **Starting** | `STARTING...` (pulse) | All disabled | Disabled spinner |
| **Streaming** | `STREAMING` (primary, pulse dot) | All disabled (read-only display) | `STOP CAPTURE` (destructive) |
| **Error** | `ERROR` (destructive) | All editable | `START CAPTURE` (primary) + error message below |

### 6.5 Error Handling

| Error | Display |
|-------|---------|
| Permission not granted | `"Screen capture permission not granted. Allow in System Settings → Privacy → Screen Recording, then restart."` with a system-warning style box |
| Port in use | `"Port {port} is already in use. Try a different port."` inline error under port input |
| Invalid params | Inline validation — prevent submission. Inputs should enforce min/max ranges. |
| Platform not supported | Hide the entire Local Capture section. Show nothing. |

---

## 7. Backend API (Already Implemented)

All Tauri commands are already built. The frontend just needs to call them:

| Command | Args | Returns | Purpose |
|---------|------|---------|---------|
| `list_displays` | none | `DisplayInfo[]` | Get available screens |
| `start_local_stream` | `{ port, quality, fps, display_id? }` | `StreamStatus` | Start capture server |
| `stop_local_stream` | none | `void` | Stop capture server |
| `get_stream_status` | none | `StreamStatus` | Poll current status |

**TypeScript types** (already in `src/types/tauri.ts`):

```typescript
interface StreamStatus {
  active: boolean;
  port: number;
  fps: number;
  quality: number;
  clients: number;
}

interface DisplayInfo {
  id: number;
  title: string;
  is_primary: boolean;
}
```

---

## 8. Design Guidelines

- **Follow existing Settings page patterns exactly** — `SectionTitle`, `brutal-border`, `bg-black/40` cards, monospace fonts, uppercase labels, `rounded-none` inputs
- The card style should match the existing stream source cards (border-border, bg-black/40, p-4)
- Use the existing color vocabulary: `text-primary` for active/success, `text-destructive` for errors, `text-muted-foreground` for labels
- The status badge should use the same dot-indicator pattern from Command Center's `StatusIndicator`
- Inputs disabled during streaming should appear visually muted but still readable
- No emojis — text-only status indicators

---

## 9. Dependencies & Risks

| # | Item | Type | Impact | Mitigation |
|---|------|------|--------|------------|
| 1 | **KAN-64: Mixed Content Blocker** | Dependency (Critical) | `https://tauri.localhost/` blocks `ws://` WebSocket connections in production builds. This feature works in dev but **will not work in release builds** until KAN-64 is resolved. | Resolve KAN-64 first (switch to `tauri-plugin-localhost` or Tauri IPC events), OR scope this PRD to dev-only and add a production warning banner. |
| 2 | **macOS Screen Recording Permission** | Risk (High) | First-time users must grant Screen Recording permission in System Settings. macOS does not re-prompt — if denied, the user must manually navigate to System Settings. | Show a clear permission error message (Section 6.5) with a direct link/instructions to the System Settings pane. |
| 3 | **`scap` crate stability** | Risk (Medium) | `scap` is pinned to `0.1.0-beta.1`. A breaking change or bug in future versions could affect capture reliability. | Pin exact version in `Cargo.toml` (already done). Test capture on each `scap` update before bumping. |
| 4 | **Single-display fallback** | Risk (Low) | If `list_displays` returns an empty list (e.g., headless CI, remote desktop), the display picker has nothing to show. | Show an informative empty state: "No displays detected. Screen capture requires a physical or virtual display." |

---

## 10. Scope & Constraints

- **One local capture at a time** — the backend enforces this. No multi-stream UI needed.
- **Port range 9100–9199** — validated by backend, enforce in UI too.
- **FPS cap 30** — backend rejects higher values.
- **macOS only for now** — `scap` supports macOS and Windows, but we only test macOS. Hide the section if `list_displays` fails with "not supported".
- **No persistence yet** — settings are in-memory like the rest of the Settings page. Persistence is a separate ticket.
- **No auto-start** — user must explicitly click START. Auto-start on app launch is a future enhancement.

---

## 11. Acceptance Criteria

**Display Picker:**
- [ ] `list_displays` is called on component mount and populates the dropdown
- [ ] Each display shows its title; the primary display is tagged with "(Primary)"
- [ ] If only one display exists, it is pre-selected
- [ ] If `list_displays` returns an empty array, show "No displays detected" empty state
- [ ] Dropdown is disabled while streaming is active

**Configuration Controls:**
- [ ] Quality slider range: 1–100, default: 80, step: 1. Current value displayed next to slider.
- [ ] FPS slider range: 1–30, default: 30, step: 1. Current value displayed next to slider.
- [ ] Port input range: 9100–9199, default: 9100. Rejects out-of-range values on blur.
- [ ] All three controls are disabled while streaming is active

**Start/Stop Flow:**
- [ ] Clicking START calls `start_local_stream({ port, quality, fps, display_id })` with current form values
- [ ] On success, UI transitions to STREAMING state within 3 seconds
- [ ] Clicking STOP calls `stop_local_stream()` and transitions back to INACTIVE state
- [ ] During start, button shows disabled spinner and badge shows `STARTING...` with pulse animation

**Status Polling:**
- [ ] While streaming, `get_stream_status` is polled every 2 seconds via `setInterval`
- [ ] Client count is displayed and updates in real-time from poll results
- [ ] Polling stops when the stream is stopped or component unmounts (cleanup in `useEffect`)

**Error Handling:**
- [ ] Screen recording permission denied: warning box with System Settings instructions
- [ ] Port already in use: inline error under port input reading "Port {port} is already in use"
- [ ] On error, badge shows `ERROR` in destructive color and controls remain editable for retry

**Visual & Integration:**
- [ ] Section placed above existing stream source list, separated by divider
- [ ] Card uses `brutal-border`, `bg-black/40`, monospace fonts, uppercase labels, `rounded-none` inputs
- [ ] Endpoint URL (`ws://127.0.0.1:{port}`) displayed in monospace, selectable for copy
- [ ] Entire Local Capture section is hidden if `list_displays` rejects with "not supported"

---

## 12. Out of Scope (Future)

- Auto-start capture on app launch
- Persistent settings (save/load config)
- Multiple simultaneous local captures
- Region-of-screen capture (scap doesn't support it yet)
- Audio capture
- Recording to file
- Remote capture agent configuration (KAN-62)
