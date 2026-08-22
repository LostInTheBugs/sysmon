'use strict';
// Test master/slave sans Electron : stub electron, démarre le master,
// connecte un slave (IP directe), vérifie hello/validation/snapshot.
const path = require('path');
const os = require('os');
const fs = require('fs');

// --- stub electron -----------------------------------------------------------
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
config.set({ mode: 'master', port: 8597, masterIp: '', autoApproveSlaves: false });

const master = require('../src/main/master/server');
const slave = require('../src/main/slave/client');

const fakeSnapshot = () => ({
  timestamp: Date.now(),
  host: { hostname: 'slave-test', platform: 'linux' },
  modules: { cpu: { ok: true, usage: 12.3 } }
});

// slave config → IP directe du master (loopback)
config.set({ mode: 'slave', masterIp: '127.0.0.1', port: 8597, pushIntervalMs: 1000 });

let slaveStatuses = [];
slave.onStatus(s => slaveStatuses.push(s.status));

master.start({
  getSnapshot: () => ({ timestamp: Date.now(), host: { hostname: 'master-test', platform: 'linux' }, modules: {} }),
  onChange: () => {}
});

setTimeout(() => {
  slave.start(fakeSnapshot);
}, 500);

const t0 = Date.now();
const check = setInterval(() => {
  const slaves = master.listSlaves();
  const s = slaves[0];
  if (s && s.status === 'pending') {
    // validation manuelle
    master.setSlaveStatus(s.id, 'approved');
    console.log('→ slave validated manually');
  }
  if (s && s.status === 'approved' && s.snapshot && s.connected) {
    console.log('SLAVE LIST:', JSON.stringify(master.listSlaves().map(x => ({ name: x.name, status: x.status, connected: x.connected, snapshot: x.snapshot })), null, 2));
    console.log('SLAVE STATUSES SEEN:', slaveStatuses.join(' → '));
    console.log('TEST PASSED');
    clearInterval(check);
    master.stop();
    slave.stop();
    process.exit(0);
  }
  if (Date.now() - t0 > 15000) {
    console.error('TEST FAILED — slaves:', JSON.stringify(slaves));
    clearInterval(check);
    process.exit(1);
  }
}, 1000);
