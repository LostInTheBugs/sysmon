'use strict';
// Agrégateur de collecteurs — chaque module a sa propre cadence de
// rafraîchissement, le snapshot fusionné est émis via un callback.

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

async function staticInfo() {
  if (!osInfo) osInfo = await si.osInfo();
  return osInfo;
}

async function tick() {
  const now = Date.now();
  await Promise.all(Object.values(MODULES).map(async m => {
    if (!enabled[m.collector.name]) { m.data = null; return; }
    if (now - m.last < m.interval) return;
    m.last = now;
    try {
      const res = await m.collector.collect();
      m.data = (res && res.ok) ? res : { ok: false, error: res ? res.error : 'unknown' };
    } catch (e) {
      m.data = { ok: false, error: String(e.message || e) };
    }
  }));
  const os = await staticInfo().catch(() => ({}));
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
  if (onSnapshot) onSnapshot(snapshot);
  return snapshot;
}

function start(cb, enabledModules) {
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
