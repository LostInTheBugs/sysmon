'use strict';
// Test de régression : le slave doit retenter la connexion après un échec.
// Scénario du bug signalé : le master n'est PAS encore joignable quand le slave
// démarre (pare-feu, master pas lancé…) → l'ancien code ne retentait jamais.
// Ici on démarre le slave d'abord (connexion refusée), puis le master 14 s plus
// tard : le slave doit le trouver et s'y connecter tout seul.
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
config.set({ mode: 'slave', masterIp: '127.0.0.1', port: 8597, discoveryPort: 8598, pushIntervalMs: 1000 });

const slave = require('../src/main/slave/client');
const master = require('../src/main/master/server');

const fakeSnapshot = () => ({ timestamp: Date.now(), host: { hostname: 'slave-reconnect', platform: 'linux' }, modules: {} });

let slaveStatuses = [];
slave.onStatus(s => slaveStatuses.push(s.status));

// 1) Le slave démarre alors que RIEN n'écoute sur 8597 → connexion refusée
slave.start(fakeSnapshot);

// 2) 14 s plus tard, le master démarre → le slave doit se reconnecter seul
setTimeout(() => {
  console.log('→ starting master now (slave has been failing for 14 s)…');
  master.start({
    getSnapshot: () => ({ timestamp: Date.now(), host: { hostname: 'master-test', platform: 'linux' }, modules: {} }),
    onChange: () => {}
  });
}, 14000);

const t0 = Date.now();
const check = setInterval(() => {
  const slaves = master.listSlaves();
  const s = slaves[0];
  if (s) master.setSlaveStatus(s.id, 'approved');
  if (s && s.status === 'approved' && s.snapshot && s.connected) {
    console.log('SLAVE RECONNECTED AFTER FAILURE — statuses seen:', slaveStatuses.join(' → '));
    console.log('TEST PASSED (reconnect after failure works)');
    clearInterval(check);
    master.stop();
    slave.stop();
    process.exit(0);
  }
  if (Date.now() - t0 > 40000) {
    console.error('TEST FAILED — slave never reconnected. statuses:', slaveStatuses.join(','));
    clearInterval(check);
    master.stop();
    slave.stop();
    process.exit(1);
  }
}, 1000);
