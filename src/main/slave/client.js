'use strict';
// Slave : découverte du master (broadcast UDP ou IP directe), puis
// connexion WebSocket et push des snapshots.

const dgram = require('dgram');
const { WebSocket } = require('ws');
const config = require('../config');
const pkg = require('../../../package.json');
const os = require('os');

let ws = null;
let timer = null;
let reconnectTimer = null;
let getSnapshot = null;
let discoveredMaster = null;
let statusListeners = [];

function broadcastDiscovery() {
  return new Promise(resolve => {
    const sock = dgram.createSocket('udp4');
    const cfg = config.load();
    const payload = JSON.stringify({ type: 'SYSMON_DISCOVER', name: os.hostname() });
    sock.on('message', (msg, rinfo) => {
      try {
        const reply = JSON.parse(msg.toString());
        if (reply.type === 'SYSMON_MASTER') {
          discoveredMaster = { ip: rinfo.address, port: reply.port };
          sock.close();
          resolve(discoveredMaster);
        }
      } catch { /* ignore */ }
    });
    sock.bind(() => {
      sock.setBroadcast(true);
      sock.send(payload, 0, payload.length, cfg.discoveryPort, '255.255.255.255', () => {
        // timeout de découverte : 2s puis abandon
        setTimeout(() => { try { sock.close(); } catch {} resolve(null); }, 2000);
      });
    });
  });
}

function notifyStatus(status, extra) {
  for (const l of statusListeners) l({ status, ...extra });
}

function connect() {
  const cfg = config.load();
  const target = cfg.masterIp || (discoveredMaster ? discoveredMaster.ip : null);
  if (!target) {
    notifyStatus('no-master');
    scheduleReconnect();
    return;
  }
  const port = discoveredMaster && !cfg.masterIp ? discoveredMaster.port : cfg.port;
  const url = `ws://${target}:${port}/ws`;
  notifyStatus('connecting', { url });
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }
  ws.on('open', () => {
    notifyStatus('connected', { url });
    ws.send(JSON.stringify({
      type: 'hello',
      name: os.hostname(),
      hostname: os.hostname(),
      platform: process.platform,
      version: pkg.version
    }));
    timer = setInterval(() => {
      const snap = getSnapshot ? getSnapshot() : null;
      if (snap && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'snapshot', data: snap }));
    }, cfg.pushIntervalMs);
  });
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'welcome') {
        notifyStatus('validated', { status: msg.status, id: msg.id });
        if (msg.status === 'rejected') {
          // Arrêt propre : le master ne veut pas de nous
          disconnect();
        }
      }
    } catch { /* ignore */ }
  });
  ws.on('close', () => {
    if (timer) { clearInterval(timer); timer = null; }
    notifyStatus('disconnected');
    scheduleReconnect();
  });
  ws.on('error', () => {
    try { ws.close(); } catch { /* ignore */ }
  });
}

function scheduleReconnect() {
  if (reconnectTimer || ws) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 10000);
}

function disconnect() {
  if (timer) { clearInterval(timer); timer = null; }
  if (ws) { try { ws.close(); } catch {} ws = null; }
}

function start(snapshotFn) {
  getSnapshot = snapshotFn;
  (async () => {
    const cfg = config.load();
    if (!cfg.masterIp) {
      discoveredMaster = await broadcastDiscovery();
    }
    connect();
  })();
}

function stop() {
  disconnect();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

function onStatus(cb) { statusListeners.push(cb); }

module.exports = { start, stop, onStatus };
