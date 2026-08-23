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

const WEB_DIR = path.join(__dirname, '..', '..', 'web');

const DEBUG_LOG = path.join(path.dirname(config.configPath()), 'sysmon-debug.log');
function dlog(...args) {
  try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] [master] ${args.join(' ')}\n`); } catch { /* ignore */ }
}

let server = null;
let wss = null;
let udpSock = null;
let snapshotsTimer = null;
let slaves = new Map();   // id -> { id, name, hostname, platform, version, ip, status, lastSeen, snapshot }
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
    connected: s.connected, snapshot: s.snapshot
  }));
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
    s = { id, name: hello.name, hostname: hello.hostname, platform: hello.platform, version: hello.version, ip, status: 'pending', lastSeen: Date.now(), connected: true, snapshot: null };
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ mode: 'master', version: require('../../../package.json').version, slaves: listSlaves() }));
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
      } else if (msg.type === 'snapshot' && ws.slaveId) {
        const s = slaves.get(ws.slaveId);
        if (s && s.status === 'approved') {
          s.snapshot = msg.data;
          s.lastSeen = Date.now();
        }
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
  if (server) { server.close(); server = null; }
  if (udpSock) { try { udpSock.close(); } catch {} udpSock = null; }
}

module.exports = { start, stop, listSlaves, setSlaveStatus };
