'use strict';
// Régression bug 015 : un réseau au repos (0 MB/s) doit produire des échantillons
// netRx/netTx = 0 (et non null) — sinon les courbes restent en "collecting".
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
config.set({ mode: 'standalone', historyEnabled: true, pushIntervalMs: 1000, historyMinutes: 10 });
const history = require('../src/main/history');
history.reset();

// Snapshot avec réseau présent mais INACTIF (0 MB/s)
const snap = {
  timestamp: Date.now(),
  host: { hostname: 'net-zero-test' },
  modules: {
    network: { ok: true, interfaces: [{ iface: 'eth0', rxMBs: 0, txMBs: 0 }] },
    cpu: { ok: true, usage: 5 },
    memory: { ok: true, usagePct: 30 }
  }
};

history.record('net-zero-test', snap);
const series = history.series('net-zero-test', 'netRx', 10);
if (series.length === 1 && series[0].v === 0) {
  console.log('NETWORK ZERO: sample recorded with netRx = 0 (curve will draw)');
  console.log('TEST PASSED (idle network no longer "collecting")');
  process.exit(0);
}
console.error('TEST FAILED — netRx series:', JSON.stringify(series));
process.exit(1);
