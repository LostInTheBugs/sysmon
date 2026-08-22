'use strict';
// Agrégateur de collecteurs — chaque module a sa propre cadence de
// rafraîchissement, le snapshot fusionné est émis via un callback.

const fs = require('fs');
const path = require('path');
const os = require('os');
const si = require('systeminformation');
const cpu = require('./cpu');
const memory = require('./memory');
const disks = require('./disks');
const battery = require('./battery');
const network = require('./network');
const connectivity = require('./connectivity');
const sensors = require('./sensors');
const gpu = require('./gpu');
const llm = require('./llm');

const DEBUG_LOG = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'sysmon', 'sysmon-debug.log');
function dlog(...args) {
  try {
    fs.mkdirSync(path.dirname(DEBUG_LOG), { recursive: true });
    fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${args.join(' ')}\n`);
  } catch { /* ignore */ }
}

const FAST_MS = 2000;   // cpu, memory, network, gpu
const MEDIUM_MS = 10000; // disks, battery, sensors
const SLOW_MS = 60000;  // connectivity, llm

const MODULES = {
  cpu: { collector: cpu, interval: FAST_MS, last: 0, data: null },
  memory: { collector: memory, interval: FAST_MS, last: 0, data: null },
  network: { collector: network, interval: FAST_MS, last: 0, data: null },
  gpu: { collector: gpu, interval: FAST_MS, last: 0, data: null },
  disks: { collector: disks, interval: MEDIUM_MS, last: 0, data: null },
  battery: { collector: battery, interval: MEDIUM_MS, last: 0, data: null },
  sensors: { collector: sensors, interval: MEDIUM_MS, last: 0, data: null },
  connectivity: { collector: connectivity, interval: SLOW_MS, last: 0, data: null },
  llm: { collector: llm, interval: SLOW_MS, last: 0, data: null }
};

let osInfo = null;
let timer = null;
let onSnapshot = null;
let enabled = null;

const MODULE_TIMEOUT_MS = 8000;

function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function staticInfo() {
  if (!osInfo) osInfo = await si.osInfo();
  return osInfo;
}

async function tick() {
  const now = Date.now();
  await Promise.allSettled(Object.values(MODULES).map(async m => {
    if (!enabled[m.collector.name]) { m.data = null; return; }
    if (now - m.last < m.interval) return;
    m.last = now;
    try {
      const res = await withTimeout(m.collector.collect(), MODULE_TIMEOUT_MS);
      m.data = (res && res.ok) ? res : { ok: false, error: res ? res.error : 'unknown' };
      dlog('module', m.collector.name, '→', m.data.ok ? 'OK' : 'ERR ' + m.data.error);
    } catch (e) {
      m.data = { ok: false, error: String(e.message || e) };
      dlog('module', m.collector.name, '→ TIMEOUT/ERR', String(e.message || e));
    }
  }));
  dlog('tick: all modules settled');
  const os = await withTimeout(staticInfo(), 5000).catch(() => ({}));
  const snapshot = {
    timestamp: Date.now(),
    host: {
      hostname: os.hostname || require('os').hostname(),
      platform: os.platform || process.platform,
      distro: os.distro || null,
      release: os.release || null,
      arch: os.arch || process.arch,
      kernel: os.kernel || null,
      uptime: Math.floor(process.uptime())
    },
    modules: {}
  };
  for (const [name, m] of Object.entries(MODULES)) snapshot.modules[name] = m.data;
  dlog('tick: snapshot built, onSnapshot set =', !!onSnapshot);
  if (onSnapshot) onSnapshot(snapshot);
  return snapshot;
}

function start(cb, enabledModules) {
  dlog('collectors.start called');
  onSnapshot = cb;
  enabled = enabledModules;
  tick();
  timer = setInterval(tick, 1000); // tick chaque seconde, chaque module filtre sa cadence
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function setEnabled(modules) { enabled = modules; }

module.exports = { start, stop, setEnabled, tick };
