'use strict';
// Test config à distance : le master pousse une config (modules, cadence,
// logLevel) au slave approuvé ; le slave l'applique (config.json modifié +
// callback onConfig) et redémarre son push avec la nouvelle cadence.
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
config.set({ mode: 'master', port: 8597, discoveryPort: 8598, masterIp: '', autoApproveSlaves: true, pushIntervalMs: 300, historyEnabled: false, syncMode: 'push', authToken: TOKEN });

const master = require('../src/main/master/server');
const slave = require('../src/main/slave/client');

let tick = 0;
// Simule la boucle de collecte réelle (wiring d'index.js : onConfig →
// collectors.setEnabled) : les modules désactivés disparaissent des snapshots
let enabledModules = { cpu: true, memory: true };
const fakeSnapshot = () => ({
  timestamp: Date.now(),
  host: { hostname: os.hostname(), platform: 'linux' },
  modules: {
    ...(enabledModules.cpu ? { cpu: { ok: true, usage: 10 + (tick++ % 50) } } : {}),
    ...(enabledModules.memory ? { memory: { ok: true, usagePct: 40 } } : {})
  }
});

let receivedConfig = null;
let snapCount = 0;

master.start({ getSnapshot: fakeSnapshot, onChange: () => {} });
setTimeout(() => {
  config.set({ mode: 'slave', masterIp: '127.0.0.1', port: 8597, masterToken: TOKEN });
  slave.onConfig(cfg => {
    receivedConfig = cfg;
    // comme le fait index.js (collectors.setEnabled) : les modules désactivés
    // ne sont plus collectés → plus dans les snapshots poussés
    if (cfg.modules) enabledModules = { ...enabledModules, ...cfg.modules };
  });
  slave.onStatus(s => { if (s.status === 'connected') snapCount++; });
  slave.start(fakeSnapshot);
}, 300);

const t0 = Date.now();
let configPushed = false;
const check = setInterval(async () => {
  try {
    // 1. trouver l'id du slave approuvé
    const r = await fetch(`http://127.0.0.1:8597/api/slaves?token=${TOKEN}`);
    const list = await r.json();
    const s = list.find(x => x.status === 'approved');
    if (!s) return;
    // 2. pousser la config distante UNE SEULE fois (comme dans la vraie vie :
    //    une re-push toutes les 500 ms réinitialiserait le timer du slave à
    //    chaque fois et aucun snapshot ne partirait)
    if (!configPushed) {
      configPushed = true;
      const cfgPatch = { modules: { cpu: true, memory: false, disks: false, battery: false, network: false, connectivity: false, sensors: false, gpu: false, llm: false, vms: false }, pushIntervalMs: 1000, logLevel: 'warn' };
      await fetch(`http://127.0.0.1:8597/api/slave-config?token=${TOKEN}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id, config: cfgPatch })
      });
    }
  } catch { /* master pas encore prêt */ }
  // 3. vérifier que le slave a appliqué (callback + config.json)
  if (receivedConfig && receivedConfig.logLevel === 'warn' && receivedConfig.pushIntervalMs === 1000) {
    const saved = config.load();
    if (saved.logLevel === 'warn' && saved.pushIntervalMs === 1000 && saved.modules && saved.modules.cpu === true && saved.modules.memory === false) {
      // 4. CRITÈRE T5 : le module désactivé (memory) doit disparaître des
      // snapshots poussés au master (il n'est plus collecté côté slave)
      const snap = master.listSlaves()[0] && master.listSlaves()[0].snapshot;
      const snapMods = (snap && snap.modules) || {};
      if (snap && snapMods.cpu && !snapMods.memory) {
        console.log('REMOTE CONFIG applied by slave:', JSON.stringify(receivedConfig));
        console.log('SNAPSHOT modules after remote config:', Object.keys(snapMods).join(','));
        console.log('TEST PASSED (master pushes remote config, slave applies it — disabled module gone from snapshots)');
        clearInterval(check);
        master.stop(); slave.stop();
        process.exit(0);
      }
      if (snap) console.log('  … en attente du prochain snapshot (modules actuels:', Object.keys(snapMods).join(',') + ')');
    }
  }
  if (Date.now() - t0 > 15000) {
    console.error('TEST FAILED — remote config never applied by slave (got:', JSON.stringify(receivedConfig) + ')');
    clearInterval(check);
    master.stop(); slave.stop();
    process.exit(1);
  }
}, 500);
