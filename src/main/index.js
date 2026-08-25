'use strict';
// SysMon — process principal Electron.
// Fenêtre widget (frameless, transparent, always-on-top), tray,
// collecteurs système, mode master/slave, IPC.

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const config = require('./config');
const logger = require('./logger');
const history = require('./history');
const collectors = require('./collectors');
const masterServer = require('./master/server');
const slaveClient = require('./slave/client');
const updater = require('./updater');

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
// --- mode portable : un fichier portable.json à côté de l'exe → config + logs
// dans le même dossier (clé USB). ---
const PORTABLE_MODE = fs.existsSync(path.join(path.dirname(process.execPath), 'portable.json'));
if (PORTABLE_MODE) {
  app.setPath('userData', path.dirname(process.execPath));
} else {
  app.setPath('userData', path.join(app.getPath('appData'), 'sysmon'));
}
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
  // Icône explicite (Windows : le .ico doit être chargé par setIcon pour la
  // barre des tâches quand la fenêtre est réduite)
  const winIcon = nativeImage.createFromPath(APP_ICON);
  if (!winIcon.isEmpty()) widgetWin.setIcon(winIcon);
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
  const winIcon = nativeImage.createFromPath(APP_ICON);
  if (!winIcon.isEmpty()) settingsWin.setIcon(winIcon);
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
// Icônes dans l'image (macOS/Linux), lettres compactes dans le texte Windows
const BAR_ICONS = { cpu: '🖥️', mem: '🧠', gpu: '🎮', temp: '🌡️', net: '📶' };
const BAR_LETTERS = { cpu: 'C', mem: 'R', gpu: 'G', temp: 'T', net: '' };

// Retourne un tableau de paires "icône valeur" (ex. ['🖥️ 12%', '🧠 45%'])
function barParts(metrics, sample, icons) {
  if (!sample) return [];
  const n = v => (v == null ? '—' : (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10));
  const sym = m => (icons ? BAR_ICONS[m] + ' ' : BAR_LETTERS[m]);
  const parts = [];
  for (const m of metrics) {
    switch (m) {
      case 'cpu': if (sample.cpu != null) parts.push(sym('cpu') + n(sample.cpu) + '%'); break;
      case 'mem': if (sample.mem != null) parts.push(sym('mem') + n(sample.mem) + '%'); break;
      case 'gpu': if (sample.gpu != null) parts.push(sym('gpu') + n(sample.gpu) + '%'); break;
      case 'temp': if (sample.temp != null) parts.push(sym('temp') + n(sample.temp) + '°'); break;
      case 'net': if (sample.netRx != null || sample.netTx != null) parts.push(sym('net') + '↓' + n(sample.netRx) + '↑' + n(sample.netTx)); break;
      default: break;
    }
  }
  return parts;
}

function barText(metrics, sample, icons) {
  const parts = barParts(metrics, sample, icons);
  return parts.length ? parts.join(' ') : null;
}

// Sparkline SVG depuis l'historique (dernières valeurs, normalisées)
function sparkPoints(series, w, h) {
  const vals = (series || []).filter(v => v != null && isFinite(v)).slice(-40);
  if (vals.length < 2) return null;
  let min = Infinity, max = -Infinity;
  for (const v of vals) { if (v < min) min = v; if (v > max) max = v; }
  const range = max - min || 1;
  return vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * (w - 2) + 1;
    const y = h - 2 - ((v - min) / range) * (h - 4);
    return (Math.round(x * 10) / 10) + ',' + (Math.round(y * 10) / 10);
  }).join(' ');
}

const BAR_METRIC_KEYS = { cpu: 'cpu', mem: 'mem', gpu: 'gpu', temp: 'temp', net: 'netRx' };

// Texte compact : 1 ligne (≤3 métriques) ou 2 lignes, icônes + espace,
// basé un peu plus bas pour un centrage optique dans la barre
function barTextSvg(metrics, sample) {
  const parts = barParts(metrics, sample, true);
  if (!parts.length) return null;
  const lines = parts.length <= 3
    ? [parts.join(' ')]
    : [parts.slice(0, Math.ceil(parts.length / 2)).join(' '), parts.slice(Math.ceil(parts.length / 2)).join(' ')];
  const fontPx = lines.length > 1 ? 10 : 13;
  const W = Math.max(BAR_W, lines.reduce((m, l) => Math.max(m, [...l].reduce((a, ch) => a + (ch.codePointAt(0) > 0x2000 ? 11 : 7.5), 0) + 12), 0));
  const yBase = lines.length > 1 ? 13 : 20; // descendu pour le centrage vertical
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${BAR_H}">` +
    lines.map((l, i) =>
      `<text x="${W / 2}" y="${yBase + i * 14}" font-family="Menlo,Consolas,monospace" font-size="${fontPx}" font-weight="bold" fill="#ffffff" stroke="#0a0e14" stroke-width="0.6" text-anchor="middle">${l}</text>`
    ).join('') + '</svg>';
}

// Sparklines : grille 3 par ligne, hauteur totale ≤ ~30 px (barre macOS ~24 px)
// cellules 26x7 + valeurs 6px sous chaque courbe si withValues (style "les deux")
function barSparkSvg(metrics, sample, host, withValues) {
  const CELL_W = 26, CELL_H = 7;
  const perRow = metrics.length <= 2 ? metrics.length : 3;
  const rows = Math.ceil(metrics.length / perRow);
  const valH = withValues ? 6 : 0;
  const W = Math.max(perRow * (CELL_W + 3) + 3, 40);
  const H = rows * (CELL_H + 1 + valH) + 2;
  const n = v => (v == null ? '' : (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10));
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="0" y="0" width="${W}" height="${H}" fill="#0a0e14" rx="2"/>`;
  metrics.forEach((m, i) => {
    const cx = 3 + (i % perRow) * (CELL_W + 3);
    const cy = 2 + Math.floor(i / perRow) * (CELL_H + 1 + valH);
    const pts = sparkPoints(history.series(host, BAR_METRIC_KEYS[m], 10), CELL_W, CELL_H);
    out += `<rect x="${cx}" y="${cy}" width="${CELL_W}" height="${CELL_H}" fill="#16181d" rx="1"/>`;
    if (pts) out += `<polyline points="${pts}" fill="none" stroke="#4fc3f7" stroke-width="1.1"/>`;
    if (withValues) {
      const val = m === 'net'
        ? '📶 ' + n(sample && sample.netRx) + '/' + n(sample && sample.netTx)
        : BAR_ICONS[m] + ' ' + n(sample && sample[BAR_METRIC_KEYS[m]]) + (m === 'temp' ? '°' : '%');
      out += `<text x="${cx + CELL_W / 2}" y="${cy + CELL_H + 5}" font-family="Menlo,Consolas,monospace" font-size="6" fill="#cfd8dc" text-anchor="middle">${val}</text>`;
    }
  });
  return out + '</svg>';
}

// --- mode "dans la barre" : texte rendu en PNG --------------------------------
// Les SVG data URL ne sont PAS décodés par nativeImage (vides) sur Windows ET
// macOS → on rasterise le SVG en PNG via un canvas dans une fenêtre cachée,
// puis nativeImage.createFromDataURL(png) — fiable sur les 3 plateformes.
let barCanvasWin = null;
let barCanvasReady = null;
let barRenderToken = 0;
const BAR_W = 80;
const BAR_H = 32;

function ensureBarCanvas() {
  if (barCanvasWin && !barCanvasWin.isDestroyed() && barCanvasReady) return barCanvasReady;
  barCanvasWin = new BrowserWindow({
    width: BAR_W, height: BAR_H, show: false, frame: false, transparent: true,
    skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  barCanvasWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    `<!DOCTYPE html><html><body style="margin:0"><canvas id="c" width="${BAR_W}" height="${BAR_H}"></canvas></body></html>`
  ));
  barCanvasReady = new Promise(r => barCanvasWin.webContents.once('did-finish-load', r));
  barCanvasWin.on('closed', () => { barCanvasWin = null; barCanvasReady = null; });
  return barCanvasReady;
}

function renderBarImage(svg) {
  ensureBarCanvas().then(() => {
    if (!barCanvasWin || barCanvasWin.isDestroyed()) return;
    const svgUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    const token = ++barRenderToken;
    barCanvasWin.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const c = document.getElementById('c');
          if (c.width !== img.naturalWidth || c.height !== img.naturalHeight) {
            c.width = img.naturalWidth; c.height = img.naturalHeight;
          }
          const x = c.getContext('2d');
          x.clearRect(0, 0, c.width, c.height);
          x.drawImage(img, 0, 0);
          resolve(c.toDataURL('image/png'));
        };
        img.onerror = () => resolve(null);
        img.src = '${svgUrl}';
      })
    `).then(pngUrl => {
      if (token !== barRenderToken) return; // un rendu plus récent est en cours
      if (pngUrl && tray) {
        const img = nativeImage.createFromDataURL(pngUrl);
        if (!img.isEmpty()) {
          tray.setImage(img);
          dlog('bar png rendered', img.getSize().width + 'x' + img.getSize().height);
        } else {
          dlog('bar png empty');
        }
      }
    }).catch(e => dlog('bar png error:', String(e.message || e)));
  });
}

function updateTrayBar(snap) {
  if (!tray) return;
  const cfg = config.load();
  const bar = cfg.barMode || {};
  if (!bar.enabled) return;
  const histHost = snap && snap.host && snap.host.hostname ? snap.host.hostname : 'local';
  const sample = history.last(histHost) || history.last('local') || history.sampleFrom(snap);
  const metrics = (Array.isArray(bar.metrics) && bar.metrics.length ? bar.metrics : ['cpu'])
    .filter(m => ['cpu', 'mem', 'gpu', 'temp', 'net'].includes(m));
  const style = ['num', 'graph', 'both'].includes(bar.style) ? bar.style : 'num';
  const text = barText(metrics, sample);
  if (text == null) return;
  // Windows : texte natif via tray.setTitle() (affiché à côté de l'icône).
  // macOS/Linux : image PNG générée par canvas (les SVG data URL sont vides
  // pour nativeImage sur Windows ET macOS).
  if (process.platform === 'win32') {
    tray.setTitle(barText(metrics, sample, false).replace('\n', ' '));
  } else {
    const svg = style === 'num' ? barTextSvg(metrics, sample) : barSparkSvg(metrics, sample, histHost, style === 'both');
    if (svg) renderBarImage(svg);
  }
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
      { label: 'Open web dashboard', click: () => shell.openExternal(`http://localhost:${cfg.port}/?token=${cfg.authToken}`) }
    ] : []),
    { type: 'separator' },
    { label: 'Mode: ' + cfg.mode, enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

// --- autostart (démarrage au login) -------------------------------------------
function applyAutoStart(cfg) {
  const on = !!cfg.autoStart;
  try {
    if (process.platform === 'linux') {
      const dir = path.join(os.homedir(), '.config', 'autostart');
      const file = path.join(dir, 'sysmon.desktop');
      if (on) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=SysMon\nExec="${process.execPath}" --no-sandbox\nX-GNOME-Autostart-enabled=true\nComment=SysMon system monitor\n`);
        logger.info('main', 'autostart enabled', file);
      } else if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        logger.info('main', 'autostart disabled');
      }
    } else {
      app.setLoginItemSettings({ openAtLogin: on, path: process.execPath });
      logger.info('main', 'autostart', on ? 'enabled' : 'disabled');
    }
  } catch (e) {
    logger.warn('main', 'autostart error:', e);
  }
}

// ------------------------------------------------------------ IPC handlers --
function applyMode(cfg) {
  masterServer.stop();
  slaveClient.stop();
  try {
    if (cfg.mode === 'master') {
      masterServer.start({
        getSnapshot: () => latestSnapshot,
        onChange: () => {
          // Le widget du master suit l'état des slaves (résumé CPU/RAM/temp)
          if (widgetWin && !widgetWin.isDestroyed()) {
            widgetWin.webContents.send('slaves', masterServer.listSlaves());
          }
        }
      });
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

// Config poussée par le maître au slave (modules, cadence, logLevel, syncMode).
// Le patch reçu est APPLIQUÉ puis persisté — avant 2026.08.045, il était
// testé puis ignoré au profit de la config locale (modules jamais désactivés).
slaveClient.onConfig(clean => {
  const patch = {};
  if (clean.modules) patch.modules = clean.modules;
  if (clean.pushIntervalMs) patch.pushIntervalMs = clean.pushIntervalMs;
  if (clean.logLevel) patch.logLevel = clean.logLevel;
  if (clean.syncMode) patch.syncMode = clean.syncMode;
  const next = Object.keys(patch).length ? config.set(patch) : config.load();
  // Appliquer réellement les modules (la boucle de collecte n'émet plus les
  // modules désactivés → ils disparaissent des snapshots poussés au master)
  collectors.setEnabled(next.modules);
  logger.info('slave', 'remote config from master:', JSON.stringify(clean));
  // Refléter dans les fenêtres ouvertes (thème inchangé, mais modules…)
  for (const w of [widgetWin, settingsWin]) {
    if (w && !w.isDestroyed()) w.webContents.send('config', next);
  }
});

ipcMain.handle('config:get', () => ({ ...config.load(), portable: PORTABLE_MODE, version: pkg.version }));
ipcMain.handle('config:set', (_e, patch) => {
  const next = config.set(patch);
  applyMode(next);
  applyAutoStart(next);
  updater.start(next); // toggle checkUpdates → relance/arrête le timer
  // Restaurer l'icône radar si le mode barre est désactivé
  if (!(next.barMode || {}).enabled && tray) {
    tray.setImage(nativeImage.createFromPath(APP_ICON));
    tray.setTitle(''); // Windows : efface le texte natif du mode barre
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
  shell.openExternal(`http://localhost:${cfg.port}/?token=${cfg.authToken}`);
});
// Régénère le jeton d'accès web (l'ancien devient invalide ; tous les clients
// WebSocket sont déconnectés et devront se reconnecter avec le nouveau jeton)
ipcMain.handle('auth:regenerate', () => {
  const token = crypto.randomBytes(24).toString('hex');
  config.set({ authToken: token });
  masterServer.disconnectClients();
  logger.info('main', 'web access token regenerated');
  return token;
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
// --- mises à jour ------------------------------------------------------------
ipcMain.handle('update:check', () => updater.check());
ipcMain.handle('update:last', () => updater.getLastCheck());
ipcMain.handle('update:open', (_e, url) => { if (url) shell.openExternal(url); });

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
  applyAutoStart(cfg);
  updater.start(cfg);

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
