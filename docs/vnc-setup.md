# VNC Streaming Setup

Stream the Antigravity IDE desktop into Synthia's viewport via noVNC.

## Architecture

```
Antigravity IDE  -->  macOS Screen Sharing (VNC :5900)
                          |
                      websockify
                          |
                  WebSocket :6080  -->  Synthia VncStream component
```

## Prerequisites

- macOS (uses built-in Screen Sharing as VNC server)
- Python 3 (`brew install python`)
- websockify (`pip install websockify`)

## Quick Start

### 1. Install websockify

```bash
# Option A: virtual environment (recommended)
python3 -m venv ~/vnc-env
source ~/vnc-env/bin/activate
pip install websockify numpy   # numpy improves performance

# Option B: system-wide
pip3 install websockify
```

### 2. Run the startup script

```bash
./scripts/start-vnc-stream.sh
```

This will:

1. Enable macOS Screen Sharing with VNC legacy mode on port 5900
2. Launch websockify on port 6080, bridging WebSocket to VNC
3. Auto-restart websockify if it crashes

The script requires `sudo` for the Screen Sharing kickstart command.

### 3. Connect from Synthia

Open the Synthia app. Any stream panel configured with a `ws://localhost:6080`
URL will connect automatically via the `VncStream` component.

## Configuration

Override defaults with environment variables:

| Variable       | Default       | Description                       |
| -------------- | ------------- | --------------------------------- |
| `VNC_PORT`     | `5900`        | VNC server listen port            |
| `WS_PORT`      | `6080`        | websockify WebSocket listen port  |
| `VNC_PASSWORD`  | `synthia`     | VNC authentication password       |
| `WEBSOCKIFY`   | `websockify`  | Path to websockify binary         |

Example with custom ports:

```bash
VNC_PORT=5901 WS_PORT=6081 ./scripts/start-vnc-stream.sh
```

## Auto-Start with launchd

For always-on streaming, install the launchd agent:

```bash
# 1. Copy the plist
cp scripts/com.synthia.websockify.plist ~/Library/LaunchAgents/

# 2. Edit the websockify path inside the plist to match your install
#    (e.g. ~/vnc-env/bin/websockify)

# 3. Load the agent
launchctl load ~/Library/LaunchAgents/com.synthia.websockify.plist
```

> **Note:** The launchd agent only manages websockify. macOS Screen Sharing
> must be enabled separately (the startup script does this, or enable it
> manually in System Settings > General > Sharing > Screen Sharing).

### Manage the agent

```bash
# Check status
launchctl list | grep websockify

# Stop
launchctl unload ~/Library/LaunchAgents/com.synthia.websockify.plist

# View logs
tail -f /tmp/synthia-websockify-stdout.log
tail -f /tmp/synthia-websockify-stderr.log
```

## Troubleshooting

### "websockify not found"

Activate your virtual environment first, or set the `WEBSOCKIFY` variable:

```bash
source ~/vnc-env/bin/activate
./scripts/start-vnc-stream.sh
```

### Nothing listening on port 5900

Screen Sharing may not have started. Enable it manually:

```bash
sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart \
  -activate -configure -access -on \
  -clientopts -setvnclegacy -vnclegacy yes \
  -clientopts -setvncpw -vncpw synthia \
  -restart -agent -privs -all
```

Or enable via **System Settings > General > Sharing > Screen Sharing**.

### Slow / laggy stream

1. Install numpy for better websockify performance: `pip install numpy`
2. Lower screen resolution on the VNC host
3. Ensure `viewOnly={true}` on the VncStream component (default)

### Connection drops immediately

Check that both services are running:

```bash
lsof -iTCP:5900 -sTCP:LISTEN -P -n   # VNC server
lsof -iTCP:6080 -sTCP:LISTEN -P -n   # websockify
```

### Screen is black after connecting

Re-enable Screen Sharing with the kickstart command above, or toggle it
off and on in System Settings.
