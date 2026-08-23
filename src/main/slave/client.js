'use strict';
// Slave : découverte du master (broadcast UDP ou IP directe), puis
// connexion WebSocket et push des snapshots.

const dgram = require('dgram');
const path = require('path');
const { WebSocket } = require('ws');
const config = require('../config');
const logger = require('../logger');
const pkg = require('../../../package.json');
const os = require('os');

// Compat : les anciens appels dlog() passent par le logger central
function dlog(...args) { logger.debug('slave', ...args); }

let ws = null;
let timer = null;
let reconnectTimer = null;
let getSnapshot = null;
let discoveredMaster = null;
let statusListeners = [];
let discovering = false;
let rejected = false;

// Broadcasts de sous-réseau (multi-interfaces, plus fiable que 255.255.255.255 seul)
function subnetBroadcasts() {
  const addrs = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === 'IPv4' && !i.internal) {
        const ip = i.address.split('.').map(Number);
        const mask = (i.netmask || '255.255.255.0').split('.').map(Number);
        addrs.push(ip.map((o, n) => (o | (~mask[n] & 255))).join('.'));
      }
    }
  }
  addrs.push('255.255.255.255');
  return [...new Set(addrs)];
}

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
      for (const target of subnetBroadcasts()) {
        sock.send(payload, 0, payload.length, cfg.discoveryPort, target);
      }
      dlog('discovery broadcast sent, targets:', subnetBroadcasts().join(','));
      // timeout de découverte : 2.5s puis abandon
      setTimeout(() => { try { sock.close(); } catch {} resolve(null); }, 2500);
    });
  });
}

function notifyStatus(status, extra) {
  dlog('status →', status, extra ? JSON.stringify(extra) : '');
  for (const l of statusListeners) l({ status, ...extra });
}

// Ré-découverte du master si l'IP n'est pas configurée en dur :
// le master a pu démarrer après nous, changer d'adresse, ou le broadcast
// a pu se perdre (pare-feu, réseau). À chaque cycle de reconnexion.
async function refreshDiscovery() {
  const cfg = config.load();
  if (cfg.masterIp || discovering) return;
  discovering = true;
  try {
    const m = await broadcastDiscovery();
    if (m) { dlog('master discovered at', m.ip + ':' + m.port); }
  } catch { /* ignore */ }
  finally { discovering = false; }
}

function connect() {
  if (rejected) return;
  const cfg = config.load();
  const target = cfg.masterIp || (discoveredMaster ? discoveredMaster.ip : null);
  if (!target) {
    notifyStatus('no-master');
    // Aucun master connu → on re-découvre à chaque cycle, puis on retente
    (async () => {
      await refreshDiscovery();
      if (discoveredMaster) connect();
      else scheduleReconnect();
    })();
    return;
  }
  const port = discoveredMaster && !cfg.masterIp ? discoveredMaster.port : cfg.port;
  const url = `ws://${target}:${port}/ws`;
  notifyStatus('connecting', { url });
  let sock;
  try {
    sock = new WebSocket(url);
    ws = sock;
  } catch (e) {
    dlog('websocket creation failed:', e.message);
    ws = null;
    scheduleReconnect();
    return;
  }
  // Chaque handler est lié à SA socket (sock) et vérifie qu'elle est toujours
  // la socket courante : après un stop/start (ex. Enregistrer dans les
  // paramètres), les événements de l'ancienne socket ne doivent pas toucher
  // l'état de la nouvelle (crash ws.send sur null, timer tué, reconnexion).
  sock.on('open', () => {
    if (ws !== sock) { try { sock.close(); } catch { /* ignore */ } return; }
    notifyStatus('connected', { url });
    sock.send(JSON.stringify({
      type: 'hello',
      name: os.hostname(),
      hostname: os.hostname(),
      platform: process.platform,
      version: pkg.version
    }));
    timer = setInterval(() => {
      if (ws !== sock) return;
      const snap = getSnapshot ? getSnapshot() : null;
      if (sock.readyState !== WebSocket.OPEN) return;
      if (snap) sock.send(JSON.stringify({ type: 'snapshot', data: snap }));
      // Logs non encore envoyés → centralisés chez le master
      const logs = logger.drain();
      if (logs.length) sock.send(JSON.stringify({ type: 'logs', logs }));
    }, cfg.pushIntervalMs);
  });
  sock.on('message', raw => {
    if (ws !== sock) return;
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'welcome') {
        notifyStatus('validated', { status: msg.status, id: msg.id });
        if (msg.status === 'rejected') { rejected = true; disconnect(); }
      } else if (msg.type === 'status') {
        // Le master a changé notre statut (validation manuelle / rejet)
        notifyStatus('validated', { status: msg.status, id: msg.id });
        if (msg.status === 'rejected') { rejected = true; disconnect(); }
      }
    } catch { /* ignore */ }
  });
  sock.on('error', e => {
    if (ws !== sock) return;
    dlog('websocket error:', e && e.message ? e.message : e);
    // 'close' suit toujours 'error' → c'est lui qui planifie la reconnexion
  });
  sock.on('close', () => {
    if (ws !== sock) return; // vieille socket (stop/restart) → ne rien toucher
    if (timer) { clearInterval(timer); timer = null; }
    ws = null;
    notifyStatus('disconnected');
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (rejected) return;
  if (reconnectTimer || ws) return;
  dlog('scheduling reconnect in 10s');
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await refreshDiscovery();
    connect();
  }, 10000);
}

function disconnect() {
  if (timer) { clearInterval(timer); timer = null; }
  if (ws) {
    const old = ws;
    ws = null; // évite que 'close' planifie une reconnexion pendant un arrêt volontaire
    try { old.close(); } catch { /* ignore */ }
  }
}

function start(snapshotFn) {
  getSnapshot = snapshotFn;
  rejected = false;
  (async () => {
    const cfg = config.load();
    if (!cfg.masterIp) {
      discoveredMaster = await broadcastDiscovery();
      if (discoveredMaster) dlog('master discovered at', discoveredMaster.ip + ':' + discoveredMaster.port);
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
