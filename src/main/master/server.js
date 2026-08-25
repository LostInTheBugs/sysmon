'use strict';
// Master : serveur HTTP (dashboard web + API REST) + WebSocket
// (slaves → push snapshots, dashboards → subscribe). Validation des
// slaves auto (autoApproveSlaves) ou manuelle (app ou web).

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dgram = require('dgram');
const os = require('os');
const { WebSocketServer } = require('ws');
const config = require('../config');
const logger = require('../logger');
const history = require('../history');
const updater = require('../updater');

const WEB_DIR = path.join(__dirname, '..', '..', 'web');
const MAX_HOST_LOGS = 300;

// Compat : les anciens appels dlog() passent par le logger central
function dlog(...args) { logger.debug('master', ...args); }

// --- Authentification par jeton ----------------------------------------------
// Le jeton est généré au premier démarrage (config.authToken). Il est exigé
// sur toutes les routes /api/* et sur le WebSocket :
//   - en-tête Authorization: Bearer <jeton>
//   - paramètre ?token= (dashboard ouvert depuis le tray, WebSocket)
//   - cookie HttpOnly sysmon_token (posé après validation du ?token — sert
//     uniquement à servir la page statique et les GET /api/*)
// Comparaison à temps constant (timingSafeEqual) pour ne pas fuir le jeton.

function tokenMatches(given, expected) {
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function extractToken(req, url) {
  // 1. en-tête Authorization: Bearer xxx
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  if (m) return m[1].trim();
  // 2. paramètre de requête ?token=
  const q = url.searchParams.get('token');
  if (q) return q;
  // 3. cookie sysmon_token
  const cookie = req.headers.cookie || '';
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === 'sysmon_token') return part.slice(eq + 1).trim();
  }
  return null;
}

// Jeton hors cookie (en-tête Authorization ou ?token=) — exigé pour les routes
// mutantes : un site tiers ne peut pas forger ces deux-là (anti-CSRF), le cookie
// seul ne suffit donc pas pour POST /api/slaves/* et /api/slave-config.
function tokenFromHeaderOrQuery(req, url) {
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  if (m) return m[1].trim();
  return url.searchParams.get('token');
}

// allowCookie=false : le cookie ne compte pas (routes mutantes).
function authorized(req, url, opts = {}) {
  const token = opts.allowCookie === false ? tokenFromHeaderOrQuery(req, url) : extractToken(req, url);
  if (token == null) return false;
  return tokenMatches(token, config.load().authToken);
}

// Origine des connexions WebSocket de type dashboard : localhost, loopback ou
// une IP locale du master. Les clients natifs (slaves) n'envoient pas d'Origin.
function checkOrigin(origin) {
  try {
    const o = new URL(origin);
    if (o.protocol !== 'http:' && o.protocol !== 'https:') return false;
    const port = config.load().port;
    const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const i of ifaces[name] || []) {
        if (i.family === 'IPv4' && !i.internal) hosts.add(`${i.address}:${port}`);
      }
    }
    return hosts.has(o.host);
  } catch {
    return false;
  }
}

// Page 401 servie quand le dashboard est ouvert sans jeton valide
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
  'X-Content-Type-Options': 'nosniff'
};
const UNAUTHORIZED_HTML = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>SysMon — Accès refusé</title>
<style>body{background:#0a0e14;color:#cfd8dc;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{max-width:460px;padding:32px;background:#16181d;border:1px solid #23272f;border-radius:10px}
h1{font-size:18px;color:#fff;margin:0 0 12px}p{line-height:1.5;color:#8b97a5;margin:0 0 8px}code{background:#0a0e14;padding:2px 6px;border-radius:4px}</style></head>
<body><div class="card"><h1>🔒 Accès refusé (401)</h1>
<p>Le dashboard web est protégé par un jeton d'authentification.</p>
<p>Ouvrez-le depuis l'application : <b>Paramètres → Options du maître → Jeton d'accès web</b>, puis <b>Ouvrir le dashboard</b> dans le menu du tray.</p>
<p>En CLI : <code>curl "http://localhost:8597/?token=&lt;jeton&gt;"</code></p></div></body></html>`;

let server = null;
let wss = null;
let udpSock = null;
let snapshotsTimer = null;
let pullTimer = null;
let slaves = new Map();   // id -> { id, name, hostname, platform, version, ip, status, lastSeen, snapshot }
let slaveLogs = new Map(); // slaveId -> [entries] (logs centralisés des slaves)
let dashboards = new Set();
let getSnapshot = null;
let onSlavesChange = null;

function loadSlaves() {
  try {
    const raw = fs.readFileSync(path.join(config.configPath(), '..', 'slaves.json'), 'utf8');
    const arr = JSON.parse(raw);
    for (const s of arr) if (s.status === 'approved' || s.status === 'rejected') slaves.set(s.id, { ...s, snapshot: null, connected: false });
  } catch { /* no saved slaves yet */ }
}

function saveSlaves() {
  try {
    const arr = [...slaves.values()].map(({ snapshot, ...s }) => s);
    fs.writeFileSync(path.join(config.configPath(), '..', 'slaves.json'), JSON.stringify(arr, null, 2));
  } catch { /* non-fatal */ }
}

function listSlaves() {
  return [...slaves.values()].map(s => ({
    id: s.id, name: s.name, hostname: s.hostname, platform: s.platform,
    version: s.version, ip: s.ip, status: s.status, lastSeen: s.lastSeen,
    connected: !!s.connected, remoteConfig: s.remoteConfig || null,
    // Résumé compact pour le widget/dashboard : dernière valeurs connues
    summary: s.snapshot ? {
      ts: s.snapshot.timestamp,
      cpu: s.snapshot.modules && s.snapshot.modules.cpu && s.snapshot.modules.cpu.ok ? s.snapshot.modules.cpu.usage : null,
      mem: s.snapshot.modules && s.snapshot.modules.memory && s.snapshot.modules.memory.ok ? s.snapshot.modules.memory.usagePct : null,
      temp: s.snapshot.modules && s.snapshot.modules.sensors && s.snapshot.modules.sensors.ok ? s.snapshot.modules.sensors.cpuTemp : null
    } : null,
    snapshot: s.snapshot
  }));
}
// --- Logs centralisés --------------------------------------------------------
function appendSlaveLogs(id, logs) {
  let buf = slaveLogs.get(id);
  if (!buf) { buf = []; slaveLogs.set(id, buf); }
  for (const l of logs) if (l && l.msg) buf.push(l);
  if (buf.length > MAX_HOST_LOGS) buf.splice(0, buf.length - MAX_HOST_LOGS);
}

function getLogs(minLevel = 'debug', limit = 200) {
  const lv = logger.LEVELS[minLevel] != null ? logger.LEVELS[minLevel] : 10;
  const hosts = { master: logger.getBuffer(limit, minLevel) };
  for (const [id, buf] of slaveLogs) {
    const s = slaves.get(id);
    if (s) hosts[s.name] = buf.filter(e => logger.LEVELS[e.level] >= lv).slice(-limit);
  }
  return hosts;
}

function setSlaveStatus(id, status) {
  const s = slaves.get(id);
  if (!s) return false;
  s.status = status;
  s.lastSeen = Date.now();
  saveSlaves();
  broadcastSlaves();
  if (onSlavesChange) onSlavesChange();
  // Informer le slave de son nouveau statut (validation manuelle, rejet)
  if (wss) {
    for (const ws of wss.clients) {
      if (ws.slaveId === id) {
        try { ws.send(JSON.stringify({ type: 'status', status, id })); } catch { /* ignore */ }
      }
    }
  }
  return true;
}

function upsertSlave(hello, ip) {
  let s = [...slaves.values()].find(x => x.name === hello.name && x.hostname === hello.hostname);
  if (!s) {
    const id = crypto.randomUUID();
    s = { id, name: hello.name, hostname: hello.hostname, platform: hello.platform, version: hello.version, ip, status: 'pending', lastSeen: Date.now(), connected: true, snapshot: null, remoteConfig: null };
    slaves.set(id, s);
  } else {
    s.ip = ip;
    s.version = hello.version;
    s.lastSeen = Date.now();
    s.connected = true;
  }
  // Validation automatique si activée
  if (s.status === 'pending' && config.load().autoApproveSlaves) s.status = 'approved';
  saveSlaves();
  broadcastSlaves();
  return s;
}

// --- Config à distance des slaves -------------------------------------------
// Champs acceptés (le slave ne reçoit jamais mode/masterIp — pas de boucle)
const REMOTE_KEYS = ['modules', 'pushIntervalMs', 'logLevel', 'syncMode'];

function pushConfig(s) {
  if (!s || !wss) return;
  const cfg = config.load();
  const payload = { type: 'config', config: { syncMode: cfg.syncMode, ...(s.remoteConfig || {}) } };
  for (const ws of wss.clients) {
    if (ws.slaveId === s.id) {
      try { ws.send(JSON.stringify(payload)); } catch { /* ignore */ }
    }
  }
}

function setSlaveConfig(id, patch) {
  const s = slaves.get(id);
  if (!s) return false;
  const clean = {};
  for (const k of REMOTE_KEYS) if (patch[k] !== undefined) clean[k] = patch[k];
  s.remoteConfig = Object.keys(clean).length ? { ...(s.remoteConfig || {}), ...clean } : null;
  saveSlaves();
  broadcastSlaves();
  if (s.status === 'approved') pushConfig(s);
  return true;
}

// --- Mode pull : le master demande le snapshot au lieu d'attendre le push ----
function pullLoop() {
  const cfg = config.load();
  if (cfg.syncMode === 'push') return;
  if (!wss) return;
  for (const s of slaves.values()) {
    if (s.status !== 'approved') continue;
    for (const ws of wss.clients) {
      if (ws.slaveId === s.id) {
        try { ws.send(JSON.stringify({ type: 'pull' })); } catch { /* ignore */ }
      }
    }
  }
}

function broadcastSlaves() {
  const payload = JSON.stringify({ type: 'slaves', list: listSlaves() });
  for (const d of dashboards) if (d.readyState === 1) d.send(payload);
}

function broadcastSnapshots() {
  const hosts = { master: { name: 'master', ...(getSnapshot ? getSnapshot() : {}) } };
  // Tous les slaves approuvés apparaissent — avec leurs données si déjà reçues,
  // sinon en attente (le slave peut être approuvé avant d'avoir poussé un snapshot)
  for (const s of slaves.values()) {
    if (s.status === 'approved') hosts[s.id] = { name: s.name, ...(s.snapshot || {}) };
  }
  const payload = JSON.stringify({ type: 'snapshots', hosts });
  for (const d of dashboards) if (d.readyState === 1) d.send(payload);
  // Le widget du master suit les slaves (résumé) — 1 notification / tick max
  if (onSlavesChange) onSlavesChange();
}

function start({ getSnapshot: gs, onChange }) {
  if (server) return;
  getSnapshot = gs;
  onSlavesChange = onChange;
  loadSlaves();
  // Jeton d'authentification : généré au premier démarrage du master, persisté
  if (!config.load().authToken) config.set({ authToken: crypto.randomBytes(24).toString('hex') });
  const cfg = config.load();

  server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const auth = authorized(req, url);
    const authNoCookie = authorized(req, url, { allowCookie: false });
    const deny = () => { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'unauthorized' })); };
    // --- API REST : tout /api/* est authentifié. Les routes mutantes exigent
    // le jeton hors cookie (Authorization ou ?token=) — anti-CSRF (T4). ---
    if (url.pathname.startsWith('/api/')) {
      const mutating = req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE';
      if (!(mutating ? authNoCookie : auth)) { deny(); return; }
      if (url.pathname === '/api/status') {
      const cfg = config.load();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        mode: 'master', version: require('../../../package.json').version,
        language: cfg.language || 'auto', syncMode: cfg.syncMode || 'push',
        update: updater ? updater.getLastCheck() : null,
        slaves: listSlaves()
      }));
      return;
    }
    if (url.pathname.startsWith('/api/slaves/')) {
      const parts = url.pathname.split('/'); // /api/slaves/:id/:action
      if (parts.length === 5 && ['approve', 'reject', 'remove'].includes(parts[4])) {
        // Routes mutantes : POST uniquement (une requête GET est déclenchable
        // par CSRF — une simple balise <img> sur un site tiers)
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
          res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
          return;
        }
        const ok = parts[4] === 'remove' ? (slaves.delete(parts[3]), saveSlaves(), broadcastSlaves(), true) : setSlaveStatus(parts[3], parts[4] === 'approve' ? 'approved' : 'rejected');
        res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok }));
        return;
      }
    }
    if (url.pathname === '/api/slaves') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(listSlaves()));
      return;
    }
    if (url.pathname === '/api/slave-config' && req.method === 'POST') {
      // Config à distance d'un slave : { id, config: { modules?, pushIntervalMs?, logLevel? } }
      let body = '';
      req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try {
          const { id, config: patch } = JSON.parse(body || '{}');
          const ok = patch && setSlaveConfig(id, patch);
          res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: !!ok }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'bad request' }));
        }
      });
      return;
    }
    if (url.pathname === '/api/logs') {
      // Logs centralisés : master + tous les slaves (filtres host/level/limit)
      const level = url.searchParams.get('level') || 'debug';
      const limit = parseInt(url.searchParams.get('limit'), 10) || 200;
      const host = url.searchParams.get('host');
      let hosts = getLogs(level, Math.min(limit, 500));
      if (host) hosts = { [host]: hosts[host] || [] };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hosts }));
      return;
    }
    if (url.pathname === '/api/history') {
      // Historique des ressources : master + slaves (fenêtre en minutes)
      const masterName = (getSnapshot && getSnapshot().host && getSnapshot().host.hostname) || 'master';
      const host = url.searchParams.get('host');
      const minutes = parseInt(url.searchParams.get('minutes'), 10) || config.load().historyMinutes || 30;
      const keys = ['cpu', 'cpuSpeed', 'mem', 'gpu', 'netRx', 'netTx', 'temp', 'batt'];
      const hosts = {};
      const list = host ? [host === 'master' ? masterName : host] : [masterName, ...history.hosts().filter(h => h !== masterName)];
      for (const h of list) {
        const series = {};
        for (const k of keys) series[k] = history.series(h, k, minutes);
        hosts[h] = series;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hosts }));
      return;
    }
    }
    // --- Dashboard web (authentifié) ---
    // Le jeton est lu à CHAQUE requête (config.load()) : après auth:regenerate,
    // cfg.authToken figé au start() serait périmé → boucle 401 sur le dashboard
    const authToken = config.load().authToken;
    // ?token= valide → poser le cookie HttpOnly puis rediriger sans le jeton
    // dans la barre d'adresse. Les sous-requêtes (css/js/api) passent ensuite
    // par le cookie.
    if (url.pathname === '/' && url.searchParams.get('token') && tokenMatches(url.searchParams.get('token'), authToken)) {
      res.writeHead(302, { Location: '/', 'Set-Cookie': `sysmon_token=${authToken}; HttpOnly; SameSite=Strict; Path=/` });
      res.end();
      return;
    }
    if (!auth) {
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
      res.end(UNAUTHORIZED_HTML);
      return;
    }
    let file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    // Traversée de chemin : le fichier servi doit rester SOUS WEB_DIR (un
    // dossier frère nommé « web-autre » ne doit pas passer le test)
    const full = path.resolve(WEB_DIR, file);
    if ((full !== WEB_DIR && !full.startsWith(WEB_DIR + path.sep)) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(full);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript' };
    // Le dashboard connaît le jeton (WS + appels API) : injecté dans un <meta>
    // (pas de script inline — CSP script-src 'self').
    if (ext === '.html') {
      const html = fs.readFileSync(full, 'utf8').replace('<head>', `<head><meta name="sysmon-token" content="${authToken}">`);
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', ...SECURITY_HEADERS });
      res.end(html);
      return;
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', ...SECURITY_HEADERS });
    fs.createReadStream(full).pipe(res);
  });

  wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2 * 1024 * 1024 });
  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    // Authentification : le jeton passe en query string (/ws?token=…), ou en
    // cookie pour les dashboards déjà connectés. Refus avant tout traitement.
    const url = new URL(req.url, `http://${req.headers.host}`);
    // Anti cross-site WebSocket hijacking : si un en-tête Origin est présent
    // (navigateur → dashboard), il doit être localhost/loopback/une IP du
    // master. Les clients natifs (slaves) n'envoient pas d'Origin.
    if (!authorized(req, url) || (req.headers.origin && !checkOrigin(req.headers.origin))) {
      dlog('websocket rejected (unauthorized or bad origin) from', ip);
      ws.close(4401, 'unauthorized');
      return;
    }
    dlog('websocket connection from', ip);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'hello') {
        const s = upsertSlave(msg, ip);
        ws.slaveId = s.id;
        dlog('hello from slave', s.name, '(' + ip + ') → status', s.status);
        ws.send(JSON.stringify({ type: 'welcome', status: s.status, id: s.id, pushIntervalMs: config.load().pushIntervalMs }));
        // Pousser la config distante (syncMode + remoteConfig) dès la connexion
        if (s.status === 'approved') pushConfig(s);
      } else if (msg.type === 'snapshot' && ws.slaveId) {
        const s = slaves.get(ws.slaveId);
        if (s && s.status === 'approved') {
          s.snapshot = msg.data;
          s.lastSeen = Date.now();
          // Historique du slave côté master (clé = hostname du snapshot, comme le dashboard)
          history.record((msg.data.host && msg.data.host.hostname) || s.name, msg.data);
        }
      } else if (msg.type === 'logs' && ws.slaveId) {
        const s = slaves.get(ws.slaveId);
        if (s && msg.logs && msg.logs.length) appendSlaveLogs(s.id, msg.logs);
      } else if (msg.type === 'subscribe') {
        dashboards.add(ws);
        ws.send(JSON.stringify({ type: 'slaves', list: listSlaves() }));
      }
    });
    ws.on('error', e => dlog('slave websocket error:', e && e.message ? e.message : e));
    ws.on('close', () => {
      dashboards.delete(ws);
      if (ws.slaveId) {
        const s = slaves.get(ws.slaveId);
        if (s) { s.connected = false; s.lastSeen = Date.now(); broadcastSlaves(); }
      }
    });
  });

  const keepAlive = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15000);

  server.on('close', () => clearInterval(keepAlive));
  // bindAddress : '127.0.0.1' par défaut (DEFAULTS) — l'exposition LAN est un
  // choix explicite ('0.0.0.0' dans les paramètres). Ne jamais écouter en dur
  // sur 0.0.0.0 (régression T1/2026.08.045, couverte par test-auth.js)
  server.listen(cfg.port, cfg.bindAddress, () => {
    // Broadcast régulier des snapshots vers les dashboards
    snapshotsTimer = setInterval(broadcastSnapshots, cfg.pushIntervalMs);
    // Mode pull / both : le master demande régulièrement les snapshots
    if (cfg.syncMode !== 'push') pullTimer = setInterval(pullLoop, cfg.pushIntervalMs);
  });

  // --- Découverte UDP : répond aux broadcasts SYSMON_DISCOVER des slaves ---
  udpSock = dgram.createSocket('udp4');
  udpSock.on('message', (msg, rinfo) => {
    try {
      const req = JSON.parse(msg.toString());
      if (req.type === 'SYSMON_DISCOVER') {
        dlog('SYSMON_DISCOVER from', rinfo.address + ':' + rinfo.port, '(' + (req.name || '?') + ')');
        // La réponse ne contient JAMAIS le jeton — service de découverte uniquement
        const reply = JSON.stringify({ type: 'SYSMON_MASTER', name: os.hostname(), port: cfg.port });
        udpSock.send(reply, 0, reply.length, rinfo.port, rinfo.address);
        logger.info('master', 'discovery reply sent to', rinfo.address + ':' + rinfo.port, '(' + (req.name || '?') + ')');
      }
    } catch { /* ignore */ }
  });
  udpSock.bind(cfg.discoveryPort, () => {
    udpSock.setBroadcast(true);
  });
  return server;
}

function stop() {
  if (wss) { for (const ws of wss.clients) ws.terminate(); wss.close(); wss = null; }
  if (snapshotsTimer) { clearInterval(snapshotsTimer); snapshotsTimer = null; }
  if (pullTimer) { clearInterval(pullTimer); pullTimer = null; }
  if (server) { server.close(); server = null; }
  if (udpSock) { try { udpSock.close(); } catch {} udpSock = null; }
  slaveLogs.clear();
}

// Déconnecte tous les clients WebSocket (régénération du jeton : ils se
// reconnecteront avec l'ancien jeton et seront refusés).
function disconnectClients() {
  if (wss) for (const ws of wss.clients) ws.terminate();
}

module.exports = { start, stop, disconnectClients, listSlaves, setSlaveStatus, setSlaveConfig, getLogs };
