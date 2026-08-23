# SysMon

SysMon is a cross-platform system monitoring widget for **Windows**, **macOS** and **Linux**. It displays live hardware and system information in a compact, always-on-top widget, and can operate in **master/slave mode** to monitor multiple machines on your network from a single dashboard (local app or web browser).

## Features

- **CPU** — usage, frequency, load, per-core stats
- **Memory** — used/free, swap, per-process top consumers
- **Disks** — usage, free space, I/O activity, partitions
- **Battery** — cycle count, health, capacity, temperature, time remaining, charge state
- **Network** — incoming/outgoing traffic, LAN/WAN interfaces, routes, IP addresses, link speed, country detection
- **Connectivity** — Bluetooth connections, USB devices
- **Sensors** — temperatures, fan speeds, disk SMART status
- **GPU** — GPU utilization, VRAM usage, connected monitors, resolutions
- **LLM** — if a local LLM server is detected: loaded models, status, memory consumption, running tasks
- **Virtualization / Docker** — current hypervisor (KVM, VMware, Hyper-V, VirtualBox, QEMU), Docker engine: per-container CPU/memory/network, local VMs: Hyper-V, VMware Workstation, VirtualBox, QEMU/KVM (state, CPU, memory, NICs)
- **Master/slave mode** — slaves scan the network or use the master's IP; the master can enable a web access and validate slaves automatically or manually (from the app or the web interface)
- **Web dashboard** — served by the master (`http://localhost:8597`): all hosts with live resources, slave validation, **centralized logs** (host + level filters, auto-refresh), **historical curves** per host (📈 button), themes (◐ button)
- **Centralized logs** — leveled logger (debug/info/warn/error) on every machine; slaves stream their logs to the master; log level configurable in settings
- **Resource history** — compact in-memory samples (CPU, frequency, RAM, GPU, network, temperature, battery) on each machine; the master keeps the slaves' history too (10 min – 2 h window)
- **Two chart modes** — *instant* values or *historical curves* (SVG area/line charts per metric), toggled live with the 📊/📈 button in the widget title bar or in settings
- **Themes** — Dark (default), Light, AMOLED, Compact + custom accent color, applied live to the widget, settings window and web dashboard
- **"In the bar" mode** — the tray/menu-bar icon shows live values: choose any combination of CPU, RAM, GPU, network ↓/↑ and temperature, in **numeric**, **sparkline** (mini history curves) or **both** styles; full details in the tooltip
- **Update detection** — checks GitHub for new releases at startup then every 6 hours (test builds included); ⬆ badge in the widget, notification in settings with a "View release" button, and a pill on the web dashboard — all linking to the GitHub release page (check can be disabled in settings)

## Platform support

| Platform | Status |
|----------|--------|
| Windows  | ✅ Installer (NSIS) + portable exe |
| macOS    | ✅ DMG (arm64, Apple Silicon) — unsigned build: right-click → Open on first launch |
| Linux    | ✅ AppImage + deb |

## Troubleshooting

### Master/slave: the slave does not appear on the master

1. On Windows, allow the ports **8597 (TCP)** and **8598 (UDP)** inbound on the master machine (Windows Firewall usually blocks them for unsigned apps):
   ```
   netsh advfirewall firewall add rule name="SysMon master" dir=in action=allow protocol=TCP localport=8597
   netsh advfirewall firewall add rule name="SysMon discovery" dir=in action=allow protocol=UDP localport=8598
   ```
2. Or set the master's IP directly in the slave's settings (Slave mode → Master IP) — this bypasses broadcast discovery entirely.
3. The slave retries discovery every 10 s, so no restart is needed once the master is reachable.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md). Done: logging system (local + master, dashboard log view) ✅, display themes ✅. Next: remote slave configuration, configurable master/slave communication direction (push/pull/both), slave updates, i18n.

## Installation

```bash
npm install
npm start        # lance le widget
```

Dev notes: `npm run start:no-sandbox` for headless/CI environments (Linux).

## Usage

- The widget shows live system info; click ⚙ for settings (mode, port, modules, slave validation).
- **Master mode**: enables the web dashboard at `http://localhost:8597` (port from `PORT` or settings), plus UDP discovery on port `8598` for slaves.
- **Slave mode**: auto-discovers the master on the LAN (UDP broadcast) or connects to `masterIp` if set.
- Slaves are validated manually (app or web) or automatically when *auto-approve* is on.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `8597`  | Master web access port |

All settings are also editable in the app (Settings window) and persisted in the platform user-data folder.

## Project structure

```
sysmon/
├── src/
│   ├── main/           # Main process: widget window, tray, master/slave
│   │   ├── collectors/ # System info modules (CPU, mem, disks, battery,
│   │   │               #  network, devices, sensors, GPU, LLM)
│   │   ├── master/     # Web server + WebSocket + slave validation
│   │   └── slave/      # UDP discovery + WebSocket push to master
│   ├── preload/        # Secure bridge between main and renderer
│   ├── renderer/       # Widget UI + settings window
│   └── web/            # Web dashboard served by the master
├── scripts/            # Headless test scripts (collectors, master/slave)
├── docs/
│   └── SPEC.md         # Full specification
├── VERSION
├── CHANGELOG.md
└── README.md
```

## License

MIT — see [LICENSE](LICENSE).
