'use strict';
// Test de la couche config (T6) : la migration barMode {metric} → {metrics}
// doit fonctionner pour une ancienne config sur disque, et DEFAULTS ne doit
// contenir qu'une seule déclaration de barMode.
const path = require('path');
const os = require('os');
const fs = require('fs');

// --- stub electron -----------------------------------------------------------
const fakeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'sysmon-config-'));
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

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log('  ✔ ' + name);
  else { console.error('  ✘ ' + name + (extra ? ' — ' + extra : '')); failures++; }
};

// 1. DEFAULTS : une seule clé barMode
const barKeys = Object.keys(config.DEFAULTS).filter(k => k === 'barMode');
check('DEFAULTS contient barMode une seule fois', barKeys.length === 1, 'trouvé ' + barKeys.length);

// Recharge la config depuis le disque (la normalisation n'a lieu qu'au
// premier load() — on purge le cache du module pour simuler un redémarrage)
function reload() {
  delete require.cache[require.resolve('../src/main/config')];
  return require('../src/main/config');
}

// 2. Ancienne config sur disque (format {metric:'cpu'}) → migration en load()
fs.writeFileSync(path.join(fakeUserData, 'config.json'), JSON.stringify({
  mode: 'standalone', barMode: { enabled: true, metric: 'gpu' }
}));
let cfg = config.load();
check('migration metric → metrics', Array.isArray(cfg.barMode.metrics) && cfg.barMode.metrics.length === 1 && cfg.barMode.metrics[0] === 'gpu', JSON.stringify(cfg.barMode));
check('style par défaut après migration', cfg.barMode.style === 'num', cfg.barMode.style);

// 3. Métriques hors liste blanche filtrées
fs.writeFileSync(path.join(fakeUserData, 'config.json'), JSON.stringify({
  mode: 'standalone', barMode: { enabled: true, metrics: ['cpu', 'batt', 'zzz'], style: 'both' }
}));
cfg = reload().load();
check('métriques filtrées (whitelist)', JSON.stringify(cfg.barMode.metrics) === '["cpu"]', JSON.stringify(cfg.barMode.metrics));
check('style conservé', cfg.barMode.style === 'both', cfg.barMode.style);

// 4. barMode absent → défauts
fs.writeFileSync(path.join(fakeUserData, 'config.json'), JSON.stringify({ mode: 'standalone' }));
cfg = reload().load();
check('barMode absent → défauts', cfg.barMode.enabled === false && JSON.stringify(cfg.barMode.metrics) === '["cpu"]', JSON.stringify(cfg.barMode));

console.log(failures ? `CONFIG TEST FAILED (${failures} échec(s))` : 'CONFIG TEST PASSED');
process.exit(failures ? 1 : 0);
