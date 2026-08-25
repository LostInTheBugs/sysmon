'use strict';
// Test logs centralisés : le slave envoie ses logs au master (drain incrémental
// attaché au push), le master les expose via GET /api/logs?host=<nom>.
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
config.set({ mode: 'master', port: 8597, discoveryPort: 8598, masterIp: '', autoApproveSlaves: true, pushIntervalMs: 500, authToken: TOKEN });

const logger = require('../src/main/logger');
const master = require('../src/main/master/server');
const slave = require('../src/main/slave/client');

const fakeSnapshot = () => ({ timestamp: Date.now(), host: { hostname: os.hostname(), platform: 'linux' }, modules: {} });

master.start({ getSnapshot: fakeSnapshot, onChange: () => {} });
setTimeout(() => { config.set({ mode: 'slave', masterIp: '127.0.0.1', port: 8597, masterToken: TOKEN }); slave.start(fakeSnapshot); }, 300);

// Le "slave" génère un log après connexion → doit remonter au master
setTimeout(() => logger.info('slavetest', 'hello-from-slave-42'), 2000);

const MARKER = 'hello-from-slave-42';
const t0 = Date.now();
const check = setInterval(async () => {
  try {
    const host = encodeURIComponent(os.hostname());
    const r = await fetch(`http://127.0.0.1:8597/api/logs?host=${host}&limit=300&token=${TOKEN}`);
    const data = await r.json();
    const entries = (data.hosts && data.hosts[os.hostname()]) || [];
    const found = entries.find(e => e.msg && e.msg.includes(MARKER));
    // Le master doit aussi avoir ses propres logs
    const r2 = await fetch(`http://127.0.0.1:8597/api/logs?host=master&limit=50&token=${TOKEN}`);
    const data2 = await r2.json();
    const masterEntries = (data2.hosts && data2.hosts.master) || [];
    if (found && masterEntries.length) {
      console.log('SLAVE LOG RECEIVED BY MASTER:', JSON.stringify(found));
      console.log('MASTER LOGS COUNT:', masterEntries.length, '| slave log entries:', entries.length);
      console.log('TEST PASSED (centralized logs: slave → master → /api/logs)');
      clearInterval(check);
      master.stop(); slave.stop();
      process.exit(0);
    }
  } catch { /* master pas encore prêt */ }
  if (Date.now() - t0 > 15000) {
    console.error('TEST FAILED — marker', MARKER, 'never appeared in /api/logs');
    clearInterval(check);
    master.stop(); slave.stop();
    process.exit(1);
  }
}, 500);
