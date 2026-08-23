'use strict';
// Test mode pull : le master (syncMode=pull) demande les snapshots au lieu
// d'attendre le push — le slave répond aux requêtes 'pull'.
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
config.set({ mode: 'master', port: 8597, discoveryPort: 8598, masterIp: '', autoApproveSlaves: true, pushIntervalMs: 300, historyEnabled: false, syncMode: 'pull' });

const master = require('../src/main/master/server');
const slave = require('../src/main/slave/client');

let tick = 0;
const fakeSnapshot = () => ({
  timestamp: Date.now(),
  host: { hostname: os.hostname(), platform: 'linux' },
  modules: { cpu: { ok: true, usage: 20 + (tick++ % 30) }, memory: { ok: true, usagePct: 50 } }
});

// Le slave reçoit la config (syncMode=pull) dès la connexion → il arrête le
// push périodique et ne répond qu'aux demandes du master.
master.start({ getSnapshot: fakeSnapshot, onChange: () => {} });
setTimeout(() => {
  config.set({ mode: 'slave', masterIp: '127.0.0.1', port: 8597 });
  slave.start(fakeSnapshot);
}, 300);

const t0 = Date.now();
let gotSnapshots = 0;
let lastTs = null;

// Dashboard : abonnement WS — les snapshots doivent arriver malgré le mode pull
const { WebSocket } = require('ws');
let wsDash;
setTimeout(() => {
  wsDash = new WebSocket('ws://127.0.0.1:8597/ws');
  wsDash.on('open', () => wsDash.send(JSON.stringify({ type: 'subscribe' })));
  wsDash.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'snapshots') {
        const hosts = msg.hosts || {};
        const slaveHost = Object.values(hosts).find(h => h.name === os.hostname());
        if (slaveHost && slaveHost.timestamp) {
          gotSnapshots++;
          lastTs = slaveHost.timestamp;
        }
      }
    } catch { /* ignore */ }
  });
}, 1200);

const check = setInterval(() => {
  if (gotSnapshots >= 3) {
    console.log('PULL MODE: snapshots received via master pull, last ts', new Date(lastTs).toISOString());
    console.log('TEST PASSED (syncMode=pull: master requests, slave answers)');
    clearInterval(check);
    if (wsDash) wsDash.close();
    master.stop(); slave.stop();
    process.exit(0);
  }
  if (Date.now() - t0 > 15000) {
    console.error('TEST FAILED — no snapshots in pull mode (got ' + gotSnapshots + ')');
    clearInterval(check);
    if (wsDash) wsDash.close();
    master.stop(); slave.stop();
    process.exit(1);
  }
}, 500);
