'use strict';
// SysMon — process principal Electron.
// Fenêtre widget (frameless, transparent, always-on-top), tray,
// collecteurs système, mode master/slave, IPC.

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require('electron');
const path = require('path');
const config = require('./config');
const collectors = require('./collectors');
const masterServer = require('./master/server');
const slaveClient = require('./slave/client');

let widgetWin = null;
let settingsWin = null;
let tray = null;
let latestSnapshot = null;

const pkg = require('../../package.json');

// userData stable et cohérent sur les 3 OS (productName mettrait une majuscule)
app.setPath('userData', path.join(app.getPath('appData'), 'sysmon'));

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
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  widgetWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  widgetWin.on('closed', () => { widgetWin = null; });
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 520, height: 640,
    title: 'SysMon — Settings',
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
  // Icône simple générée en mémoire (16x16, cercle)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#4fc3f7" stroke="#0b3d52" stroke-width="1"/><circle cx="8" cy="8" r="2.5" fill="#0b3d52"/></svg>`;
  const img = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
  tray = new Tray(img);
  tray.setToolTip('SysMon ' + pkg.version);
  rebuildTrayMenu();
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
      console.log('[sysmon] master server started on port ' + cfg.port);
    } else if (cfg.mode === 'slave') {
      slaveClient.start(() => latestSnapshot);
    }
  } catch (e) {
    console.error('[sysmon] applyMode error:', e);
  }
  collectors.setEnabled(cfg.modules);
  rebuildTrayMenu();
}

ipcMain.handle('config:get', () => config.load());
ipcMain.handle('config:set', (_e, patch) => {
  const next = config.set(patch);
  applyMode(next);
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

// ---------------------------------------------------------------- lifecycle --
app.whenReady().then(() => {
  console.log('[sysmon] whenReady, config mode =', config.load().mode);
  const cfg = config.load();
  collectors.start(snap => {
    latestSnapshot = snap;
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

  // --- mode debug : --screenshot=/path.png → capture le widget puis quitte ---
  const shotArg = process.argv.find(a => a.startsWith('--screenshot='));
  if (shotArg) {
    const outPath = shotArg.split('=')[1];
    setTimeout(async () => {
      try {
        if (widgetWin && !widgetWin.isDestroyed()) {
          const img = await widgetWin.webContents.capturePage();
          require('fs').writeFileSync(outPath, img.toPNG());
          console.log('SCREENSHOT_SAVED ' + outPath);
        }
      } catch (e) {
        console.error('SCREENSHOT_FAILED', e);
      }
      app.quit();
    }, 8000);
  }
});

app.on('window-all-closed', () => {
  // L'appli vit dans le tray — ne pas quitter
});
