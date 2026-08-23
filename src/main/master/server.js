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
  const cfg = config.load();

  server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    // --- API REST ---
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
    // --- Dashboard web ---
    let file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    file = path.normalize(file).replace(/^(\.\.[\/\\])+/, '');
    const full = path.join(WEB_DIR, file);
    if (!full.startsWith(WEB_DIR) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(full);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });

  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
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
  server.listen(cfg.port, '0.0.0.0', () => {
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
        const reply = JSON.stringify({ type: 'SYSMON_MASTER', name: os.hostname(), port: cfg.port });
        udpSock.send(reply, 0, reply.length, rinfo.port, rinfo.address);
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

module.exports = { start, stop, listSlaves, setSlaveStatus, setSlaveConfig, getLogs };
