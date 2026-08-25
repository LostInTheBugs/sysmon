'use strict';
// Test e2e dashboard : master + slave approuvé → le flux 'snapshots' envoyé
// aux dashboards web doit contenir le MASTER ET le SLAVE avec leurs modules.
const path = require('path');
const os = require('os');
const fs = require('fs');
const { WebSocket } = require('ws');

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
const TOKEN = 'test-token-1234567890abcdef';
config.set({ mode: 'master', port: 8597, discoveryPort: 8598, masterIp: '', autoApproveSlaves: false, pushIntervalMs: 500, authToken: TOKEN });

const master = require('../src/main/master/server');
const slave = require('../src/main/slave/client');

const slaveSnap = () => ({
  timestamp: Date.now(),
  host: { hostname: 'slave-dash', platform: 'linux' },
  modules: { cpu: { ok: true, usage: 42.5 }, memory: { ok: true, usedGB: 3.2, totalGB: 16, usagePct: 20 } }
});
const masterSnap = () => ({
  timestamp: Date.now(),
  host: { hostname: 'master-dash', platform: 'linux' },
  modules: { cpu: { ok: true, usage: 7.1 } }
});

master.start({ getSnapshot: masterSnap, onChange: () => {} });
setTimeout(() => { config.set({ mode: 'slave', masterIp: '127.0.0.1', port: 8597, masterToken: TOKEN }); slave.start(slaveSnap); }, 300);

const t0 = Date.now();
const check = setInterval(() => {
  const s = master.listSlaves()[0];
  if (s) master.setSlaveStatus(s.id, 'approved');
}, 500);

// Client dashboard
let gotSnapshots = 0;
let lastHosts = null;
const ws = new WebSocket(`ws://127.0.0.1:8597/ws?token=${TOKEN}`);
ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe' })));
ws.on('message', raw => {
  try {
    const msg = JSON.parse(raw);
    if (msg.type === 'snapshots') {
      gotSnapshots++;
      lastHosts = msg.hosts || {};
      const hosts = msg.hosts || {};
      const names = Object.values(hosts).map(h => h.name || '?');
      const slaveHost = Object.values(hosts).find(h => h.name === os.hostname());
      const hasSlaveModules = slaveHost && slaveHost.modules && slaveHost.modules.cpu && slaveHost.modules.cpu.usage === 42.5;
      const hasMaster = hosts.master && hosts.master.modules && hosts.master.modules.cpu;
      if (hasSlaveModules && hasMaster) {
        console.log('DASHBOARD FEED:', names.join(' + '), '| slave modules OK');
        console.log('TEST PASSED (dashboard receives master AND slave resources)');
        clearInterval(check);
        master.stop(); slave.stop(); ws.close();
        process.exit(0);
      }
    }
  } catch { /* ignore */ }
});
ws.on('error', e => { console.error('WS error:', e.message); process.exit(1); });

setTimeout(() => {
  const slaveIds = master.listSlaves().map(s => ({ id: s.id, name: s.name, status: s.status, connected: s.connected, hasSnapshot: !!s.snapshot, snapshotKeys: s.snapshot ? Object.keys(s.snapshot) : [] }));
  console.error('TEST FAILED — snapshots received:', gotSnapshots, '| master slaves:', JSON.stringify(slaveIds), '| last hosts keys:', lastHosts ? Object.keys(lastHosts) : 'null');
  clearInterval(check);
  master.stop(); slave.stop(); ws.close();
  process.exit(1);
}, 15000);
