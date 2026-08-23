'use strict';
// SysMon — process principal Electron.
// Fenêtre widget (frameless, transparent, always-on-top), tray,
// collecteurs système, mode master/slave, IPC.

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require('electron');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const history = require('./history');
const collectors = require('./collectors');
const masterServer = require('./master/server');
const slaveClient = require('./slave/client');

let widgetWin = null;
let settingsWin = null;
let tray = null;
let latestSnapshot = null;

const pkg = require('../../package.json');
// Le tray Windows exige un vrai .ico (un PNG redimensionné s'affiche en carré vide)
const APP_ICON = process.platform === 'win32'
  ? path.join(__dirname, '..', '..', 'build', 'icon.ico')
  : path.join(__dirname, '..', '..', 'build', 'icon.png');

// userData stable et cohérent sur les 3 OS (productName mettrait une majuscule)
app.setPath('userData', path.join(app.getPath('appData'), 'sysmon'));
// Identité Windows : icône correcte dans la barre des tâches (pas de carré vide)
app.setAppUserModelId('com.lostinthebugs.sysmon');

// --- logger (buffer + fichier) ----------------------------------------------

function dlog(...args) {
  logger.debug('main', ...args);
}

// ---------------------------------------------------------------- fenêtres --
function createWidgetWindow() {
  const cfg = config.load();
  widgetWin = new BrowserWindow({
    width: cfg.widget.width,
    height: cfg.widget.height,
    x: 40, y: 40,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: cfg.widget.alwaysOnTop,
    skipTaskbar: false,
    icon: APP_ICON,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  widgetWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  widgetWin.webContents.on('console-message', (_e, _level, message) => logger.debug('renderer', message));
  widgetWin.on('closed', () => { widgetWin = null; });
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 520, height: 640,
    title: 'SysMon — Settings',
    frame: false,          // pas de barre de titre OS (blanche) — en-tête sombre comme le widget
    resizable: false,
    autoHideMenuBar: true, // pas de menu en haut de la fenêtre paramètres
    icon: APP_ICON,
    backgroundColor: '#16181d',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

function createTray() {
  // Icône réelle (ico sur Windows, png ailleurs)
  let img = nativeImage.createFromPath(APP_ICON);
  if (img.isEmpty()) {
    // repli : icône simple générée en mémoire (16x16, cercle)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#4fc3f7" stroke="#0b3d52" stroke-width="1"/><circle cx="8" cy="8" r="2.5" fill="#0b3d52"/></svg>`;
    img = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
  }
  tray = new Tray(img);
  tray.setToolTip('SysMon ' + pkg.version);
  rebuildTrayMenu();
}

// --- mode "dans la barre" : texte en direct dans le tray (Windows/macOS) -----
function barText(metric, sample) {
  if (!sample) return null;
  const n = v => (v == null ? '—' : (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10));
  switch (metric) {
    case 'cpu': return sample.cpu != null ? n(sample.cpu) + '%' : null;
    case 'mem': return sample.mem != null ? n(sample.mem) + '%' : null;
    case 'gpu': return sample.gpu != null ? n(sample.gpu) + '%' : null;
    case 'temp': return sample.temp != null ? n(sample.temp) + '°' : null;
    case 'batt': return sample.batt != null ? n(sample.batt) + '%' : null;
    case 'net': return sample.netRx != null || sample.netTx != null
      ? `↓${n(sample.netRx)}\n↑${n(sample.netTx)}` : null;
    default: return null;
  }
}

function renderBarImage(text) {
  // 32x32 (le tray Windows le redimensionne proprement, HiDPI net)
  const lines = String(text).split('\n');
  const fs = lines.length > 1 ? 12 : 15;
  const lineH = 15;
  const y0 = 32 / 2 - ((lines.length - 1) * lineH) / 2;
  const texts = lines.map((l, i) =>
    `<text x="16" y="${y0 + i * lineH}" font-family="Consolas, monospace" font-size="${fs}" font-weight="bold" fill="#ffffff" stroke="#0a0e14" stroke-width="0.6" text-anchor="middle">${l}</text>`
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">${texts}</svg>`;
  return nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
}

function updateTrayBar(snap) {
  if (!tray) return;
  const cfg = config.load();
  const bar = cfg.barMode || {};
  if (!bar.enabled) return;
  const sample = history.last(snap && snap.host ? snap.host.hostname : null) || history.last('local');
  const text = barText(bar.metric || 'cpu', sample || history.sampleFrom(snap));
  if (text == null) return;
  tray.setImage(renderBarImage(text));
  const h = snap && snap.host ? snap.host.hostname : 'SysMon';
  const s = sample || history.sampleFrom(snap);
  const parts = [];
  if (s) {
    if (s.cpu != null) parts.push('CPU ' + s.cpu + '%');
    if (s.mem != null) parts.push('RAM ' + s.mem + '%');
    if (s.gpu != null) parts.push('GPU ' + s.gpu + '%');
    if (s.netRx != null) parts.push('↓' + s.netRx + ' ↑' + s.netTx + ' MB/s');
    if (s.temp != null) parts.push(s.temp + '°C');
    if (s.batt != null) parts.push('Batt ' + s.batt + '%');
  }
  tray.setToolTip('SysMon ' + pkg.version + ' · ' + h + (parts.length ? '\n' + parts.join(' · ') : ''));
}

function rebuildTrayMenu() {
  if (!tray) return;
  const cfg = config.load();
  const menu = Menu.buildFromTemplate([
    { label: 'SysMon ' + pkg.version, enabled: false },
    { type: 'separator' },
    { label: 'Show widget', click: () => { if (widgetWin) widgetWin.show(); } },
    { label: 'Settings…', click: openSettings },
    ...(cfg.mode === 'master' && cfg.webAccess ? [
      { label: 'Open web dashboard', click: () => shell.openExternal(`http://localhost:${cfg.port}`) }
    ] : []),
    { type: 'separator' },
    { label: 'Mode: ' + cfg.mode, enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

// ------------------------------------------------------------ IPC handlers --
function applyMode(cfg) {
  masterServer.stop();
  slaveClient.stop();
  try {
    if (cfg.mode === 'master') {
      masterServer.start({ getSnapshot: () => latestSnapshot, onChange: () => {} });
      logger.info('main', 'master server started on port', cfg.port);
    } else if (cfg.mode === 'slave') {
      slaveClient.start(() => latestSnapshot);
    }
  } catch (e) {
    logger.error('main', 'applyMode error:', e);
  }
  collectors.setEnabled(cfg.modules);
  rebuildTrayMenu();
}

ipcMain.handle('config:get', () => config.load());
ipcMain.handle('config:set', (_e, patch) => {
  const next = config.set(patch);
  applyMode(next);
  // Restaurer l'icône radar si le mode barre est désactivé
  if (!(next.barMode || {}).enabled && tray) {
    tray.setImage(nativeImage.createFromPath(APP_ICON));
    tray.setToolTip('SysMon ' + pkg.version);
  } else {
    updateTrayBar(latestSnapshot);
  }
  // Appliquer la config en direct (thème, accent…) dans les fenêtres ouvertes
  for (const w of [widgetWin, settingsWin]) {
    if (w && !w.isDestroyed()) w.webContents.send('config', next);
  }
  return next;
});
ipcMain.handle('slaves:list', () => (masterServer.listSlaves ? masterServer.listSlaves() : []));
ipcMain.handle('slaves:set', (_e, id, action) => {
  if (!masterServer.setSlaveStatus) return false;
  const ok = masterServer.setSlaveStatus(id, action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : null);
  return ok;
});
ipcMain.handle('open:dashboard', (_e) => {
  const cfg = config.load();
  shell.openExternal(`http://localhost:${cfg.port}`);
});
ipcMain.handle('open:settings', () => openSettings());
ipcMain.handle('sysinfo:refresh', async () => {
  await collectors.tick();
  return latestSnapshot;
});
ipcMain.handle('history:get', () => {
  const cfg = config.load();
  const host = latestSnapshot && latestSnapshot.host ? latestSnapshot.host.hostname : 'local';
  const keys = ['cpu', 'cpuSpeed', 'mem', 'gpu', 'netRx', 'netTx', 'temp', 'batt'];
  const out = {};
  for (const k of keys) out[k] = history.series(host, k, cfg.historyMinutes);
  return { host, series: out, windowMs: (cfg.historyMinutes || 30) * 60 * 1000 };
});

// ---------------------------------------------------------------- lifecycle --
app.whenReady().then(() => {
  console.log('[sysmon] whenReady, config mode =', config.load().mode);
  const cfg = config.load();
  collectors.start(snap => {
    latestSnapshot = snap;
    history.record(snap.host && snap.host.hostname ? snap.host.hostname : 'local', snap);
    updateTrayBar(snap);
    dlog('snapshot emitted', snap.timestamp, 'modules:', Object.keys(snap.modules).join(','));
    if (widgetWin && !widgetWin.isDestroyed()) {
      widgetWin.webContents.send('snapshot', snap);
    }
  }, cfg.modules);
  createWidgetWindow();
  createTray();
  applyMode(cfg);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWidgetWindow();
  });

  // --- mode debug : --open-settings ouvre les paramètres (pour capture/CDP) --
  if (process.argv.includes('--open-settings')) openSettings();

  // --- mode debug : --screenshot=/path.png → capture le widget puis quitte ---
  const shotArg = process.argv.find(a => a.startsWith('--screenshot='));
  if (shotArg) {
    const outPath = shotArg.split('=')[1];
    const delayArg = process.argv.find(a => a.startsWith('--screenshot-delay='));
    const delay = delayArg ? parseInt(delayArg.split('=')[1], 10) : 8000;
    const openSettingsToo = process.argv.includes('--open-settings');
    setTimeout(async () => {
      try {
        if (openSettingsToo) openSettings();
        await new Promise(r => setTimeout(r, openSettingsToo ? 1800 : 0));
        const target = openSettingsToo && settingsWin && !settingsWin.isDestroyed() ? settingsWin : widgetWin;
        const img = await target.webContents.capturePage();
        require('fs').writeFileSync(outPath, img.toPNG());
        console.log('SCREENSHOT_SAVED ' + outPath);
      } catch (e) {
        console.error('SCREENSHOT_FAILED', e);
      }
      app.quit();
    }, delay);
  }
});

app.on('window-all-closed', () => {
  // L'appli vit dans le tray — ne pas quitter
});
