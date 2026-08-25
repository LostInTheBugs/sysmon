'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  mode: 'standalone', // 'standalone' | 'master' | 'slave'
  port: Number(process.env.PORT) || 8597,
  discoveryPort: Number(process.env.DISCOVERY_PORT) || 8598,
  masterIp: '',
  masterToken: '',        // jeton d'accès au master (mode esclave — T2)
  authToken: '',          // généré au premier démarrage du master
  bindAddress: '127.0.0.1', // '127.0.0.1' | '0.0.0.0' — exposition LAN explicite
  autoApproveSlaves: false,
  webAccess: true,
  pushIntervalMs: 2000,
  theme: 'dark',        // 'dark' | 'light' | 'amoled' | 'compact'
  accent: '#4fc3f7',    // couleur d'accent (widget, paramètres, dashboard)
  logLevel: 'info',     // 'debug' | 'info' | 'warn' | 'error'
  chartMode: 'instant', // 'instant' | 'history' (courbes)
  historyEnabled: true,
  historyMinutes: 30,   // fenêtre de l'historique en mémoire
  autoStart: false,     // démarrage au login (Windows/macOS/Linux)
  syncMode: 'push',     // maître ↔ esclave : 'push' | 'pull' | 'both'
  language: 'auto',     // 'auto' | 'fr' | 'en'
  widget: {
    alwaysOnTop: true,
    opacity: 0.95,
    width: 360,
    height: 620
  },
  modules: {
    cpu: true, memory: true, disks: true, battery: true, network: true,
    connectivity: true, sensors: true, gpu: true, llm: true, vms: true
  },
  // Mode "dans la barre" : tray texte Windows / menu bar macOS
  barMode: { enabled: false, metrics: ['cpu'], style: 'num' },
  checkUpdates: true,
  updateIntervalSec: 3600,  // cadence de vérification des mises à jour (min 900)
  autoUpdate: false         // téléchargement automatique d'une nouvelle version
};

let cache = null;

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

// Normalise les valeurs énumérées (répare une config corrompue — ex. le bug
// 015 où le badge traduit était réécrit dans mode, donnant
// "mode.mode.mode.mode.maitre").
function normalize(v, allowed, def) {
  if (v == null) return def;
  const s = String(v).toLowerCase();
  if (allowed.includes(s)) return s;
  if (s.includes('maitre') || s.includes('master')) return 'master';
  if (s.includes('esclave') || s.includes('slave')) return 'slave';
  if (s.includes('autonome') || s.includes('standalone')) return 'standalone';
  return def;
}

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw);
    cache = { ...DEFAULTS, ...parsed, widget: { ...DEFAULTS.widget, ...(parsed.widget || {}) }, modules: { ...DEFAULTS.modules, ...(parsed.modules || {}) } };
  } catch {
    cache = { ...DEFAULTS, widget: { ...DEFAULTS.widget }, modules: { ...DEFAULTS.modules } };
  }
  // Réparation des valeurs corrompues
  cache.mode = normalize(cache.mode, ['standalone', 'master', 'slave'], 'standalone');
  cache.syncMode = ['push', 'pull', 'both'].includes(cache.syncMode) ? cache.syncMode : 'push';
  cache.chartMode = ['instant', 'history'].includes(cache.chartMode) ? cache.chartMode : 'instant';
  cache.language = ['auto', 'fr', 'en'].includes(cache.language) ? cache.language : 'auto';
  cache.logLevel = ['debug', 'info', 'warn', 'error'].includes(cache.logLevel) ? cache.logLevel : 'info';
  cache.theme = ['dark', 'light', 'amoled', 'compact'].includes(cache.theme) ? cache.theme : 'dark';
  // barMode : migration depuis l'ancien format {metric:'cpu'} → {metrics:[...]}
  const bar = cache.barMode || {};
  if (typeof bar.metric === 'string' && !Array.isArray(bar.metrics)) bar.metrics = [bar.metric];
  bar.metrics = (Array.isArray(bar.metrics) ? bar.metrics : ['cpu']).filter(m => ['cpu', 'mem', 'gpu', 'net', 'temp'].includes(m));
  if (!bar.metrics.length) bar.metrics = ['cpu'];
  bar.style = ['num', 'graph', 'both'].includes(bar.style) ? bar.style : 'num';
  cache.barMode = { enabled: !!bar.enabled, metrics: bar.metrics, style: bar.style };
  return cache;
}

function save(cfg) {
  cache = cfg;
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

function set(patch) {
  const cfg = load();
  const next = { ...cfg, ...patch, widget: { ...cfg.widget, ...(patch.widget || {}) }, modules: { ...cfg.modules, ...(patch.modules || {}) } };
  save(next);
  return next;
}

module.exports = { DEFAULTS, load, save, set, configPath };
