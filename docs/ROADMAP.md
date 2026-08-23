# SysMon Roadmap

## 1. Logging system (debug / info / warn / error) — ✅ DONE (2026.08.011)
- Local level-based logs in the existing log file (`userData/sysmon-debug.log`) ✅
- File rotation (max size, history) 🔲
- **Slave logs forwarded to the master** (dedicated WebSocket channel, buffer + backfill) ✅
- Log view in the web dashboard (filter by host/level) ✅ — log view in the settings window 🔲
- Configurable level (`logLevel`: debug|info|warn|error) ✅

## 2. Remote slave configuration (via the master)
- The master pushes a configuration (modules, cadence, logLevel…) to each slave
- Hot application without restart (collectors are already modular)
- UI: slave management in the settings window + web dashboard (edit a slave's config)
- Ability to force-accept a slave by its IP

## 3. Configurable master ↔ slave communication direction
- **`push`** (current): the slave periodically sends its snapshots
- **`pull`**: the master queries the slave on demand (request/response mode)
- **`bidirectional`**: both (push + on-demand queries)
- Setting in the config (`syncMode`), exposed in the settings window and the dashboard

## 4. Slave updates
- **Via the master**: the master pushes the binary/package to the slaves (grouped update)
- **Via internet**: the slave (or the master) checks GitHub releases (`api.github.com/repos/LostInTheBugs/sysmon/releases`), compares versions, downloads and installs
- Warning + changelog shown before updating, with a postpone option

## 5. Display themes — ✅ DONE (2026.08.011) + resource history & curves (2026.08.013)
- Preset themes: Dark (default), Light, AMOLED, Compact ✅
- Customizable accent color (widget, settings window, web dashboard) ✅
- Theme selector in the settings window, applied live, persisted in the config ✅
- Bonus: in-memory resource history (10 min – 2 h) + historical curves mode (widget & dashboard) + "in the bar" tray mode ✅

## 6. Multilingual support
- i18n of the three interfaces: widget, settings window, web dashboard
- Languages: French + English first, more later
- Automatic system-language detection + manual choice in the settings window (`language`)

---

### Suggested order
1. Logging (foundation: debugging all following features)
2. Communication direction (the `pull` mode conditions remote configuration)
3. Remote slave configuration
4. Updates (relies on remote config + the log channel)
5. Themes (pure UI, independent)
6. Multilingual (pure UI, independent)
