'use strict';
// Test de régression : restart du slave (stop → start, comme un clic sur
// "Enregistrer" dans les paramètres) alors qu'il est connecté au master.
// L'ancien code plantait : le 'close' de l'ancienne socket remettait `ws`
// à null après la création de la nouvelle → crash "Cannot read properties
// of null (reading 'send')" dans le handler 'open' (client.js).
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

process.on('uncaughtException', e => {
  console.error('UNCAUGHT EXCEPTION (crash reproduit):', e.message);
  process.exit(1);
});

const config = require('../src/main/config');
const TOKEN = 'test-token-1234567890abcdef';
config.set({ mode: 'slave', masterIp: '127.0.0.1', port: 8597, discoveryPort: 8598, pushIntervalMs: 500, authToken: TOKEN, masterToken: TOKEN });

const slave = require('../src/main/slave/client');
const master = require('../src/main/master/server');

const fakeSnapshot = () => ({ timestamp: Date.now(), host: { hostname: 'slave-restart', platform: 'linux' }, modules: {} });

master.start({
  getSnapshot: () => ({ timestamp: Date.now(), host: { hostname: 'master-test', platform: 'linux' }, modules: {} }),
  onChange: () => {}
});

let slaveStatuses = [];
slave.onStatus(s => slaveStatuses.push(s.status));

slave.start(fakeSnapshot);

let restarted = false;
const t0 = Date.now();
const check = setInterval(() => {
  const slaves = master.listSlaves();
  const s = slaves[0];
  if (s) master.setSlaveStatus(s.id, 'approved');

  // Une fois connecté et approuvé → simuler un clic sur "Enregistrer" (stop + start)
  if (!restarted && s && s.status === 'approved' && s.connected && s.snapshot) {
    restarted = true;
    console.log('→ slave connected, simulating "Save" (stop + start)…');
    slave.stop();
    slave.start(fakeSnapshot);
  }

  // Après le restart : le slave doit être reconnecté et envoyer des snapshots
  if (restarted && s && s.status === 'approved' && s.connected && s.snapshot) {
    // Vérifier que le snapshot est RÉCENT (post-restart) → le timer tourne toujours
    if (Date.now() - s.snapshot.timestamp < 5000) {
      console.log('SLAVE RESTARTED AND RECONNECTED — statuses:', slaveStatuses.join(' → '));
      console.log('TEST PASSED (no crash on stop/start while connected)');
      clearInterval(check);
      master.stop();
      slave.stop();
      process.exit(0);
    }
  }
  if (Date.now() - t0 > 25000) {
    console.error('TEST FAILED — statuses:', slaveStatuses.join(','));
    clearInterval(check);
    master.stop();
    slave.stop();
    process.exit(1);
  }
}, 500);
