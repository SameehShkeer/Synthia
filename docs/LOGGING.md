# Logging Guide

This document describes how to view and manage application logs in Synthia.

## Log File Locations

Synthia uses `tauri-plugin-log` which stores log files in platform-specific directories.

| Platform | Log Directory |
|----------|---------------|
| macOS    | `~/Library/Logs/com.sameehshkeer.synthia/` |
| Windows  | `%APPDATA%\com.sameehshkeer.synthia\logs\` |
| Linux    | `~/.local/share/com.sameehshkeer.synthia/logs/` |

The log file is named `synthia.log`.

## Viewing Logs

### macOS

```bash
# View logs in real-time
tail -f ~/Library/Logs/com.sameehshkeer.synthia/synthia.log

# View last 100 lines
tail -100 ~/Library/Logs/com.sameehshkeer.synthia/synthia.log

# Open log directory in Finder
open ~/Library/Logs/com.sameehshkeer.synthia/

# Open in Console.app for advanced viewing
open -a Console ~/Library/Logs/com.sameehshkeer.synthia/
```

### Windows (PowerShell)

```powershell
# View logs in real-time
Get-Content "$env:APPDATA\com.sameehshkeer.synthia\logs\synthia.log" -Wait

# View last 100 lines
Get-Content "$env:APPDATA\com.sameehshkeer.synthia\logs\synthia.log" -Tail 100

# Open log directory in Explorer
explorer "$env:APPDATA\com.sameehshkeer.synthia\logs"
```

### Linux

```bash
# View logs in real-time
tail -f ~/.local/share/com.sameehshkeer.synthia/logs/synthia.log

# View last 100 lines
tail -100 ~/.local/share/com.sameehshkeer.synthia/logs/synthia.log

# Open log directory in file manager
xdg-open ~/.local/share/com.sameehshkeer.synthia/logs/
```

## Development vs Production Mode

### Development Mode

When running `cargo tauri dev`:

- **Terminal**: All logs appear in the terminal where you ran the dev command
- **Browser DevTools**: Frontend logs also appear in the Console tab (via `attachConsole()`)
- **Log Levels**: All levels are visible (trace, debug, info, warn, error)

```bash
# Start development server
cargo tauri dev
```

### Production Mode

In production builds:

- **Log File**: Logs are written to the platform-specific log directory
- **Rotation**: Log files rotate when they exceed 5 MB
- **Retention**: Previous log files are preserved with timestamps
- **Log Level**: Info and above (info, warn, error)

## Log Levels

| Level | Description | When to Use |
|-------|-------------|-------------|
| `trace` | Most verbose | High-frequency events, detailed flow tracing |
| `debug` | Debugging info | Development diagnostics, variable values |
| `info` | General events | User actions, significant state changes |
| `warn` | Warnings | Recoverable issues, deprecation notices |
| `error` | Errors | Failures that need attention |

## Log Format

Each log entry includes:

```
[TIMESTAMP] [LEVEL] [TARGET] MESSAGE
```

Example:
```
[2026-02-04 18:45:32] [INFO] [synthia_lib] Greeting user: Alice
[2026-02-04 18:45:33] [DEBUG] [synthia_lib] System stats: cpu=12.5%, mem=45.2% (7.23/16.00 GiB)
```

## Troubleshooting

### Logs not appearing in file

1. Ensure you're running a **production build** (not `cargo tauri dev`)
2. Check the correct platform-specific directory
3. Verify the app has write permissions to the log directory

### Logs not appearing in DevTools

1. Ensure you're in **development mode** (`cargo tauri dev`)
2. Open browser DevTools (F12 or Cmd+Option+I)
3. Check the Console tab
4. Verify `attachConsole()` is called in the frontend code

### Finding old log files

When log rotation occurs, previous logs are preserved with timestamps:
```
synthia.log          # Current log
synthia_2026-02-04.log  # Previous rotated log
```
