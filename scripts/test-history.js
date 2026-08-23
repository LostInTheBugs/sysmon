'use strict';
// Test historique : les snapshots du slave sont enregistrés côté master
// (history.record) et exposés via GET /api/history?host=<nom>.
const path = require('path');
const os = require('os');
const fs = require('fs');

const fakeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'sysmon-test-'));
require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: {
    app: { getPath: () => fakeUserData, whenReady: () => Promise.resolve() },
    BrowserWindow: class { constructor() {} loadFile() {} on() {} destroy() {} isDestroyed() { return true; } },
    Tray: class { constructor() {} setToolTip() {} setContextMenu() {} },
    Menu: { buildFromTemplate: () => ({}) },
    ipcMain: { handle: () => {} },
    shell: { openExternal: () => {} },
    nativeImage: { createFromDataURL: () => ({}) }
  }
};

const config = require('../src/main/config');
config.set({ mode: 'master', port: 8597, discoveryPort: 8598, masterIp: '', autoApproveSlaves: true, pushIntervalMs: 300, historyEnabled: true, historyMinutes: 30 });

const master = require('../src/main/master/server');
const slave = require('../src/main/slave/client');

let tick = 0;
const fakeSnapshot = () => ({
  timestamp: Date.now(),
  host: { hostname: os.hostname(), platform: 'linux' },
  modules: {
    cpu: { ok: true, usage: 10 + (tick++ % 50), speed: 3.2 },
    memory: { ok: true, usagePct: 40 + (tick % 10) },
    network: { ok: true, interfaces: [{ iface: 'eth0', rxMBs: 1.5, txMBs: 0.7 }] },
    sensors: { ok: true, cpuTemp: 48 },
    battery: { ok: true, present: false },
    gpu: { ok: true, controllers: [{ utilizationPct: 25 }] }
  }
});

master.start({ getSnapshot: fakeSnapshot, onChange: () => {} });
setTimeout(() => { config.set({ mode: 'slave', masterIp: '127.0.0.1', port: 8597 }); slave.start(fakeSnapshot); }, 300);

const t0 = Date.now();
const check = setInterval(async () => {
  try {
    const host = encodeURIComponent(os.hostname());
    const r = await fetch(`http://127.0.0.1:8597/api/history?host=${host}&minutes=30`);
    const data = await r.json();
    const series = data.hosts && data.hosts[os.hostname()];
    const cpu = (series && series.cpu) || [];
    // Au moins 3 échantillons CPU enregistrés côté master pour ce slave
    if (cpu.length >= 3 && cpu[0].v >= 10 && cpu[0].v <= 60) {
      console.log('HISTORY SERIES cpu points:', cpu.length, '| last:', JSON.stringify(cpu[cpu.length - 1]));
      console.log('TEST PASSED (resource history recorded by master and served via /api/history)');
      clearInterval(check);
      master.stop(); slave.stop();
      process.exit(0);
    }
  } catch { /* master pas encore prêt */ }
  if (Date.now() - t0 > 15000) {
    console.error('TEST FAILED — history series never reached 3 points');
    clearInterval(check);
    master.stop(); slave.stop();
    process.exit(1);
  }
}, 500);
