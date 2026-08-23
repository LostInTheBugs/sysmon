# SysMon — Specification

Cross-platform (Windows / macOS / Linux) system monitoring widget,
with optional **master/slave** mode and **web access** on the master.

## 1. Information modules

### CPU
- Global and per-core usage
- Frequency, load average

### Memory
- Used / free memory, swap
- Top consumers by process

### Disks
- Used / free space per partition
- I/O activity

### Battery
- Charge cycles, health, capacity (design vs current)
- Temperature, time remaining, charge state

### Network
- Incoming / outgoing traffic
- LAN / WAN interfaces, routes, IP addresses
- Link speed, country detection (IP geolocation)

### Connectivity
- Bluetooth connections
- USB devices

### Sensors
- Temperatures (CPU, motherboard, disks…)
- Fan speeds
- Disk SMART

### GPU
- GPU usage, VRAM
- Connected monitors, resolutions

### LLM (optional)
- If a local LLM server is detected: loaded models, status,
  memory consumption, running tasks

## 2. Master / slave mode

- **Slave**: scans the local network to find the master, or the master's
  IP address is provided manually.
- **Master**:
  - optional web access (multi-host dashboard in the browser),
  - slave validation **automatic** or **manual** (from the Windows
    application or the web interface).
- Slaves send their data to the master; the master aggregates and
  displays every host.

## 3. UI

- Compact widget (always-on-top, transparent where possible) showing the
  selected modules.
- Main window with the full information list.
- Web dashboard (master side).

## 4. Platforms

| Platform | Support |
|----------|---------|
| Windows  | ✅ target |
| macOS    | ✅ target |
| Linux    | ✅ target |

## 5. Intended architecture

- Cross-platform desktop app (Electron / Tauri — to be validated)
- System collection through a unified library (e.g. `systeminformation`)
- Embedded HTTP server on the master (configurable port, `PORT` env var)
- Master↔slave communication: HTTP/WebSocket over the local network

## 6. Out of scope (v1)

- History / long-term graphs (may come later)
- Mobile push notifications
