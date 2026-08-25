'use strict';
// Test découverte par BROADCAST UDP (sans IP directe) : le slave doit trouver le master local.
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
const TOKEN = 'test-token-1234567890abcdef';
config.set({ mode: 'master', port: 8597, masterIp: '', autoApproveSlaves: false, discoveryPort: 8598, authToken: TOKEN, bindAddress: '0.0.0.0' });

const master = require('../src/main/master/server');
const slave = require('../src/main/slave/client');

const fakeSnapshot = () => ({ timestamp: Date.now(), host: { hostname: 'slave-bcast', platform: 'linux' }, modules: {} });

master.start({ getSnapshot: fakeSnapshot, onChange: () => {} });

let slaveStatuses = [];
slave.onStatus(s => slaveStatuses.push(s.status));

// Slave SANS masterIp → découverte broadcast
config.set({ mode: 'slave', masterIp: '', port: 8597, pushIntervalMs: 1000, masterToken: TOKEN });

setTimeout(() => slave.start(fakeSnapshot), 500);

const t0 = Date.now();
const check = setInterval(() => {
  const slaves = master.listSlaves();
  const s = slaves[0];
  if (s && s.status === 'pending') {
    master.setSlaveStatus(s.id, 'approved');
    console.log('→ slave validated manually');
  }
  if (s && s.status === 'approved' && s.snapshot && s.connected) {
    console.log('SLAVE FOUND VIA BROADCAST:', JSON.stringify(master.listSlaves().map(x => ({ name: x.name, ip: x.ip, status: x.status, connected: x.connected }))));
    console.log('SLAVE STATUSES SEEN:', slaveStatuses.join(' → '));
    console.log('TEST PASSED');
    clearInterval(check);
    master.stop();
    slave.stop();
    process.exit(0);
  }
  if (Date.now() - t0 > 15000) {
    console.error('TEST FAILED — slaves:', JSON.stringify(slaves), '| statuses:', slaveStatuses.join(','));
    clearInterval(check);
    master.stop();
    slave.stop();
    process.exit(1);
  }
}, 1000);
