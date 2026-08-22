# Changelog

All notable changes to SysMon are documented in this file.

## [2026.08.001] — 2026-08-22

### Added
- Project scaffold: repository structure, README, LICENSE, VERSION, CHANGELOG
- Full specification drafted in `docs/SPEC.md` (CPU, memory, disks, battery, network, connectivity, sensors, GPU, LLM, master/slave mode, web access)
- Electron app skeleton: frameless transparent always-on-top widget + tray
- System collectors via `systeminformation`: CPU (usage, load, per-core), memory (used/swap/top processes), disks (filesystems + I/O + SMART), battery (cycles, health, capacity, time remaining), network (per-interface traffic, LAN/WAN, routes, WAN IP + country detection), USB/Bluetooth, sensors (CPU temp, fans via hwmon, SMART), GPU (utilization, VRAM, displays), LLM local server detection (llama.cpp, Ollama, LM Studio, KoboldCpp)
- Master mode: HTTP server + WebSocket, web dashboard, slave registry with automatic or manual validation (app + web)
- Slave mode: UDP broadcast discovery or direct master IP, WebSocket push of snapshots
- Settings window (mode, port, master IP, auto-approve, module toggles, slave management)
- Headless test scripts (`scripts/test-collectors.js`, `scripts/test-master-slave.js`)
- Installable builds: Windows (NSIS installer + portable), Linux (AppImage + deb) via electron-builder
- App icon (radar design) and widget loading placeholder
- File-based debug logging (user-data folder)

### Fixed
- Collectors resilience: per-subcall error isolation (one failing probe no longer drops the whole module)
- Module timeout (8s) so a hanging probe never blocks the snapshot pipeline
- Renderer crash on null disk I/O data (`io: null`) — widget now degrades gracefully
- CPU speed display when the OS reports 0 GHz
