# Changelog

All notable changes to SysMon are documented in this file.

## [2026.08.041] — 2026-08-23

### Changed
- Bar mode now uses **icons** instead of letters: 🖥️ CPU, 🧠 RAM, 🎮 GPU,
  🌡️ temperature, 📶 network (macOS/Linux image; Windows keeps compact
  letters in the native tray text since emoji do not render there)
- "Both" style: each sparkline shows its icon + value underneath (e.g.
  🧠45%) so curves are identifiable without labels

## [2026.08.039] — 2026-08-23

### Changed
- "In the bar" mode upgraded (user request):
  - **Multiple metrics** at once: CPU, RAM, GPU, network ↓/↑, temperature
    (checkboxes in settings; old single-metric config auto-migrated)
  - **3 display styles**: numeric only (smaller compact text), sparklines
    (mini history curves, 3 per row), or both (curves + values)
  - Windows keeps the native `tray.setTitle()` text; macOS/Linux rasterize
    the SVG to a PNG canvas whose size now matches the content
  - `barMode` config: `{ enabled, metrics: [...], style: 'num'|'graph'|'both' }`

## [2026.08.037] — 2026-08-23

### Fixed
- macOS menu-bar text not showing in the "in the bar" mode: SVG data URLs are
  not decoded by `nativeImage` on macOS either (same root cause as the
  Windows notification-area icon in 035) — the bar text is now rasterized
  to a real PNG (SVG → hidden canvas → `toDataURL('image/png')`) and
  applied via `nativeImage.createFromDataURL(png)` on macOS/Linux; Windows
  keeps the native `tray.setTitle()`. Render result is logged
  (`bar png rendered WxH` / `bar png empty`)

## [2026.08.035] — 2026-08-23

### Fixed
- Windows notification-area icon invisible when the "in the bar" mode is
  enabled: the bar text was rendered as an SVG data URL, which
  `nativeImage` does NOT support on Windows (empty image → invisible tray
  icon). Windows now uses the native `tray.setTitle()` text next to the
  radar icon (SVG image stays for macOS/Linux where it works); the title
  is cleared when the bar mode is disabled

## [2026.08.033] — 2026-08-23

### Added
- **Update detection** (roadmap item 2): checks the latest GitHub release at
  startup then every 6 hours (test builds included, toggle in settings —
  `checkUpdates`). UI everywhere:
  - widget: ⬆ button in the title bar (shown only when a new version exists,
    click → GitHub release page)
  - settings: "Updates" card with current version, check-now button and the
    result (up to date / new version + View release / offline)
  - web dashboard: green pill in the header linking to the release
  - `/api/status` exposes `update` for the dashboard
- `scripts/test-updater.js`: version comparison, GitHub response parsing,
  live API check (10 assertions)

## [2026.08.031] — 2026-08-23

### Fixed
- macOS 26: `si.networkStats()` returns a single `utun` entry instead of all
  interfaces (systeminformation broken on the new macOS netstat output) —
  the collector now reads `netstat -ib` directly on macOS (stable format,
  counters per interface, tunnel lines without MAC handled). Verified live
  on the target MacBook: en0 shows real rates during a 10 MB download
- Tunnel interfaces (utun/tap/tun) now appear only while they carry traffic
  (active VPN) — no more dead tunnel rows

### Tests
- `scripts/test-network-match.js`: netstat -ib parsing with real MacBook
  output (15 checks)

## [2026.08.029] — 2026-08-23

### Fixed
- macOS showed system pseudo-interfaces in the network section (awdl0,
  llw0, utun0–4, …): these virtual interfaces carry only link-local IPv6
  and never user traffic. New `isUsefulIface()` filter drops them by name
  pattern (awdl/llw/utun/gif/stf/tap/tun/isatap/teredo/p2p/ap) AND any
  interface whose only address is link-local (`fe80::`) — only real,
  routable interfaces remain (en0, etc.)

### Tests
- `scripts/test-network-match.js`: macOS interface filter
  (14 checks)

## [2026.08.027] — 2026-08-23

### Fixed
- Upload (TX) still 0 while download works: `Get-NetAdapterStatistics` reports
  a working `ReceivedBytes` but a stuck `SentBytes` on some machines. A
  persistent latch detects the broken TX counter (RX bytes moving, TX stuck
  at 0) and switches the outgoing rate to `netstat -e` totals (always
  reliable, locale-independent parsing), applied to the default interface

### Tests
- `scripts/test-network-match.js`: netstat -e parsing (English + French)
  (13 checks)

## [2026.08.025] — 2026-08-23

### Fixed
- Network on Windows machines with broken performance counters: the raw log
  proved `si.networkStats()` returns `rx_bytes: 0, rx_sec: null` even during
  a speedtest (known Windows perfmon corruption issue). New fallback reads
  the byte counters via `Get-NetAdapterStatistics` (native PowerShell, no
  admin) when every si counter is zero — rates are computed from those
  byte deltas. A debug line confirms which source is used

### Tests
- `scripts/test-network-match.js`: Get-NetAdapterStatistics JSON parsing
  (array + single-object forms)

## [2026.08.023] — 2026-08-23

### Changed
- Network rates are now computed from the byte counters (`rx_bytes` deltas)
  instead of relying on `si.rx_sec` — Windows systems with broken performance
  counters report `rx_sec = 0` while the byte counters still move. `rx_sec` is
  kept as a fallback when bytes don't move
- New debug log (once per minute): raw `si.networkStats()` values per
  interface — makes it possible to see exactly what the library reports
  during a speedtest (visible in the centralized logs)

### Tests
- `scripts/test-network-match.js`: byte-delta rate + rx_sec fallback
  (still 11/11 passing)

## [2026.08.021] — 2026-08-23

### Fixed
- Network diagnostic warning fired on every tick at idle (0 MB/s is valid) —
  it now only fires when no interface matched the stats (once per minute max)

## [2026.08.019] — 2026-08-23

### Fixed
- **Network shows 0 MB/s on Windows even with traffic** (speedtest, downloads):
  `si.networkStats()` and `si.networkInterfaces()` report different interface
  names on Windows ("Ethernet" vs "Realtek PCIe GbE Family Controller") — the
  name-based join failed and every interface read 0. New `matchStats()` joins
  by exact name, adapter description (`ifaceName`) or normalized name
  (case/spaces); a warning with the real names is logged if the join still
  fails, so it can be diagnosed from the centralized logs

### Tests
- `scripts/test-network-match.js`: Windows name-mismatch cases
  (11/11 passing)

## [2026.08.017] — 2026-08-23

### Fixed
- **History curves stuck on "collecting…"** (network, temperature):
  - an idle network (0 MB/s) was stored as `null` (`netRx || null` bug) — zero
    is now a valid sample → the network curve draws even at rest
  - CPU frequency now uses the **live** speed (`si.cpuCurrentSpeed`) instead of
    the static base clock (often 0/absent on Windows and VMs)
  - temperature falls back to the max core temperature on Windows when the
    main sensor is unavailable (no admin rights)
- **Settings mode badge corrupted**: the Save button read the mode from the
  badge text, which is translated since 015 ("Maître"/"Master") — each save
  wrapped it further (`mode.mode.mode.mode.maitre`). The mode now comes from
  the selected tile only; a config normalizer heals corrupted values on load
  (mode, syncMode, chartMode, language, logLevel, theme)
- **Windows taskbar icon when the widget is minimized**: the `.ico` is now
  generated with proper Windows ICO encoding (7 sizes, PIL) and the icon is
  also applied via `setIcon()` on both windows
- Slaves list in the settings window now works with a translated badge
  (it checked the raw text `master`)

### Tests
- `scripts/test-history-zero.js`: idle network must produce a 0 sample
  (10/10 passing)

## [2026.08.015] — 2026-08-23

### Added
- **Remote slave configuration**: the master stores a per-slave config
  (modules, push interval, log level — never mode/masterIp) in `slaves.json`,
  pushes it over the WebSocket on connection/approval/change, and the slave
  applies it live (collectors restart, push timer restarts). Dashboard UI: ⚙
  button on each slave card → modal (module checkboxes, interval, log level,
  reset). REST: `POST /api/slave-config`
- **Master ↔ slave sync modes**: `push` (default), `pull` (the master requests
  each snapshot, the slave stops pushing), `both`. Setting in the System card;
  the master pushes the mode to slaves on connect
- **Slaves block in the master widget**: the widget shows each slave with its
  status and a compact summary (CPU %, RAM %, temperature) — live
- **Resource history persisted to disk** (`userData/history.json`, debounced
  15 s, loaded at startup) — curves survive app restarts
- **Auto-start at login** (System card): Windows/macOS login item,
  Linux `~/.config/autostart/sysmon.desktop`
- **Portable mode**: drop an empty `portable.json` next to the executable →
  config, slaves, history and logs live in the same folder (USB stick)
- **i18n FR/EN**: settings window (full), widget chrome + slaves block,
  web dashboard — language in Apparence (auto = system language, applied
  live); the dashboard follows the master's language
- **Log rotation**: `sysmon-debug.log` rotates at 1 MB (2 archives)

### Tests
- `scripts/test-remote-config.js`: master pushes config → slave applies
  (all 9 tests passing)
- `scripts/test-pull.js`: syncMode=pull — master requests, slave answers

## [2026.08.013] — 2026-08-23

### Added
- **Resource history** (in-memory, per machine): compact samples (CPU %, CPU
  frequency, RAM %, GPU %, network ↓/↑, temperature, battery) recorded every
  snapshot tick. Slave: its own resources. Master: its own + every approved
  slave's. Exposed via `GET /api/history?host=&minutes=`. Window and
  enable/disable configurable in settings (Historique card, 10 min – 2 h)
- **Historical curves display mode** — second chart mode alongside the instant
  one: area/line SVG charts per metric (CPU usage, CPU frequency, Memory, GPU,
  Network ↓/↑, Temperature, Battery) in the widget and on the web dashboard
  (📈 button per dashboard, 📊/📈 button in the widget title bar). The widget
  chart mode is a setting (Affichage des graphiques) and can be toggled live
  with the title-bar button
- **"In the bar" mode** (like macOS menu-bar monitors): the tray icon on
  Windows shows a live value (CPU %, RAM %, GPU %, network ↓/↑, temperature,
  battery) rendered as text on the icon, updated every snapshot tick; the
  tooltip shows the full summary. Metric and enable/disable configurable in
  settings (Barre système card). Disabling restores the radar icon

### Fixed
- **Tray icon blank square on Windows**: the tray was fed a resized 16×16 PNG,
  which Windows renders as an empty square. The tray now loads the real
  multi-size `icon.ico` on Windows (PNG elsewhere)

### Tests
- `scripts/test-history.js`: slave snapshots are recorded by the master and
  served through `/api/history` (all 7 tests passing)

## [2026.08.011] — 2026-08-23

### Added
- **Centralized logs**: new `logger` module (in-memory ring buffer + level filter +
  existing `sysmon-debug.log`). Slaves stream their logs to the master
  (incremental drain attached to the snapshot push); the master keeps a per-host
  buffer (300 lines) and exposes it via `GET /api/logs?host=&level=&limit=`. The
  web dashboard has a **LOGS panel** (button in the header) with host/level
  filters, auto-refresh every 3 s. Log level configurable in settings
  (`logLevel`: debug/info/warn/error)
- **Themes**: 4 presets — Dark (default), Light, AMOLED, Compact — plus a
  custom **accent color**, applied live to the widget, the settings window and
  the web dashboard (dashboard keeps its choice in localStorage, cycle with the
  ◐ button). Theme/accent picker in settings → Apparence card, live preview
  before saving, config broadcast to open windows on save
- **Real application icon**: `build/icon.ico` (7 sizes) + `icon-512.png`
  generated from the radar SVG. Applied to both windows and the tray, and
  `app.setAppUserModelId()` on Windows so the taskbar shows the icon instead of
  a blank square

### Fixed
- CSP `style-src` blocked the inline accent color (`style.setProperty`) in the
  widget and settings window — `'unsafe-inline'` added for styles only

### Tests
- `scripts/test-logs.js`: slave log → master → `/api/logs` round-trip (all 6
  tests passing)

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
