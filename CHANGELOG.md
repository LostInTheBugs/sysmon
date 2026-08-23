# Changelog

All notable changes to SysMon are documented in this file.

## [2026.08.009] — 2026-08-23

### Fixed
- **Crash on Save in the settings window while the slave is connected**
  (`TypeError: Cannot read properties of null (reading 'send')` in `client.js`):
  clicking Save stops and restarts the slave; the old socket's `close` event then
  reset the module-level `ws` to `null` after the new socket was created, so the
  new socket's `open` handler crashed on `ws.send`. Every handler is now bound to
  its own socket and checks it is still the current one — stale events from a
  previous socket can no longer touch the new connection (this also protects the
  snapshot timer from being killed by the old socket)
- Regression test `scripts/test-restart.js` reproduces the exact scenario
  (connected slave → stop/start) and passes

### Changed
- Settings window: no more OS title bar (was white on Windows) — the window is
  frameless like the widget, with the dark SysMon header as the drag handle and a
  close ✕ button; no default menu bar either
- Web dashboard: approved slaves now always appear as host cards, even before
  their first snapshot ("Waiting for data…"), so a slave that was validated but
  crashed/just started is still visible on the web
- Master server: the snapshot broadcast timer is cleaned up on stop (no duplicate
  broadcasts after saving settings in master mode)
- Dashboard end-to-end test (`scripts/test-dashboard.js`): verifies the web feed
  contains master AND slave resources

## [2026.08.007] — 2026-08-23

### Fixed
- **Slave never reconnected after a failed WebSocket connection** — the biggest
  master/slave blocker: after any connection error (firewall, master not ready yet,
  transient network issue), `ws` was never reset to `null`, so `scheduleReconnect()`
  bailed out immediately and the slave stayed dead forever. It now clears the socket
  on close, re-discovers the master at every reconnect cycle, and retries every 10 s
- The debug log (`userData/sysmon-debug.log`) was silently empty: `fs` was used but
  never required in the main process. Fixed, and the master/slave modules now log
  their key events (discovery received, slave hello, status changes, WS errors) —
  useful to diagnose firewall or network issues
- Rejected slaves no longer reconnect in a loop: the slave stops retrying once the
  master has rejected it

### Changed
- Settings window: removed the default menu bar at the top (`autoHideMenuBar`)
- Documentation (`docs/SPEC.md`, `docs/ROADMAP.md`) translated to English — docs
  rule is English; only the user-facing UI stays French

## [2026.08.005] — 2026-08-23

### Fixed
- Widget scroll: the drag region (`-webkit-app-region: drag`) was swallowing the mouse wheel — content is now `no-drag` and scrolls properly
- Settings module toggles were unclickable: the hidden checkbox had zero size (`width:0;height:0`), it now covers the whole switch
- Master/slave discovery: broadcasts are sent to every subnet broadcast address (not only `255.255.255.255`), and the slave retries discovery every 10 s (previously tried once at startup only)
- The master now notifies a slave live when its status changes (manual validation/rejection)
- Slave list in settings refreshes automatically every 3 s (no need to reopen the window to see new requests)

### Added
- Broadcast discovery regression test (`scripts/test-discovery.js`)
- Windows Firewall troubleshooting section in README (ports 8597 TCP / 8598 UDP)

## [2026.08.003] — 2026-08-23

### Added
- Virtualization/Docker module (`vms`): current hypervisor detection (KVM, VMware, Hyper-V, VirtualBox, QEMU — via systemd-detect-virt/DMI on Linux, WMI on Windows, sysctl on macOS)
- Docker monitoring: version, running/total containers, per-container CPU/memory/network (rx/tx)
- Local VM monitoring: Hyper-V (state, CPU%, memory, NICs), VMware Workstation (running VMs + memory), VirtualBox (RAM/vCPU), QEMU/KVM (name, RAM, vCPU)
- Virtualization section in the widget and web dashboard; module toggle in settings (enabled by default)
- Settings window redesigned (French UI): mode cards, module toggle grid, slave list, status bar; external stylesheet
- Debug flag `--open-settings` to screenshot the settings window headlessly

### Fixed
- Settings window styling was completely broken: the CSP blocked the inline `<style>` — moved to external `settings.css`
- `vms` module missing from default enabled modules

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
