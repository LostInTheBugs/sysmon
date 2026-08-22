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

## Platform support

| Platform | Status |
|----------|--------|
| Windows  | ✅ Installer (NSIS) + portable exe |
| macOS    | 🔜 Build from a Mac (dmg) |
| Linux    | ✅ AppImage + deb |

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
