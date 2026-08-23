'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  mode: 'standalone', // 'standalone' | 'master' | 'slave'
  port: Number(process.env.PORT) || 8597,
  discoveryPort: 8598,
  masterIp: '',
  autoApproveSlaves: false,
  webAccess: true,
  pushIntervalMs: 2000,
  theme: 'dark',        // 'dark' | 'light' | 'amoled' | 'compact'
  accent: '#4fc3f7',    // couleur d'accent (widget, paramètres, dashboard)
  logLevel: 'debug',    // 'debug' | 'info' | 'warn' | 'error'
  widget: {
    alwaysOnTop: true,
    opacity: 0.95,
    width: 360,
    height: 620
  },
  modules: {
    cpu: true, memory: true, disks: true, battery: true, network: true,
    connectivity: true, sensors: true, gpu: true, llm: true, vms: true
  }
};

let cache = null;

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
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
