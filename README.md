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
- **Master/slave mode** — slaves scan the network or use the master's IP; the master can enable a web access and validate slaves automatically or manually (from the app or the web interface)

## Platform support

| Platform | Status |
|----------|--------|
| Windows  | Planned |
| macOS    | Planned |
| Linux    | Planned |

## Installation

*(Development build — instructions will be completed with the first release.)*

```bash
npm install
npm start
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `8597`  | Master web access port |

## Project structure

```
sysmon/
├── src/
│   ├── main/        # Main process (widget, tray, master/slave)
│   ├── preload/     # Secure bridge between main and renderer
│   └── renderer/    # Widget UI
├── docs/
│   └── SPEC.md      # Full specification
├── VERSION
├── CHANGELOG.md
└── README.md
```

## License

MIT — see [LICENSE](LICENSE).
