'use strict';
// Historique des ressources : buffer circulaire en mémoire, par hôte.
// Chaque échantillon est compact (pas le snapshot entier) :
//   { ts, cpu, cpuSpeed, mem, gpu, netRx, netTx, temp, batt }
// - Slave : enregistre ses propres snapshots (widget en mode courbes)
// - Master : enregistre le sien + ceux reçus des slaves (dashboard)

const config = require('./config');

const MAX_POINTS = 3600; // garde-fou absolu (60 min @ 1 s)

let buffers = new Map(); // host -> [sample]

function sampleFrom(snap) {
  const m = snap.modules || {};
  let gpu = null;
  if (m.gpu && m.gpu.ok && m.gpu.controllers && m.gpu.controllers.length) {
    const usages = m.gpu.controllers.map(c => c.utilizationPct).filter(v => v != null);
    if (usages.length) gpu = Math.max(...usages);
  }
  let netRx = 0, netTx = 0;
  if (m.network && m.network.ok && m.network.interfaces) {
    for (const i of m.network.interfaces) {
      if (i.rxMBs != null) netRx += i.rxMBs;
      if (i.txMBs != null) netTx += i.txMBs;
    }
  }
  const cpu = m.cpu && m.cpu.ok ? m.cpu.usage : null;
  const mem = m.memory && m.memory.ok ? m.memory.usagePct : null;
  const batt = m.battery && m.battery.ok && m.battery.present ? m.battery.percent : null;
  return {
    ts: snap.timestamp || Date.now(),
    cpu,
    cpuSpeed: m.cpu && m.cpu.ok && m.cpu.speed != null ? m.cpu.speed : null,
    mem,
    gpu,
    netRx: netRx || null,
    netTx: netTx || null,
    temp: m.sensors && m.sensors.ok && m.sensors.cpuTemp != null ? m.sensors.cpuTemp : null,
    batt
  };
}

// Enregistre un snapshot dans l'historique de l'hôte donné
function record(host, snap) {
  try {
    if (!config.load().historyEnabled) return;
    const s = sampleFrom(snap);
    let buf = buffers.get(host);
    if (!buf) { buf = []; buffers.set(host, buf); }
    const last = buf[buf.length - 1];
    // déduplication si le snapshot n'a pas bougé (même ts)
    if (last && last.ts === s.ts) return;
    buf.push(s);
    const max = Math.min(MAX_POINTS, Math.max(60, Math.round((config.load().historyMinutes || 30) * 60 / (config.load().pushIntervalMs / 1000))));
    if (buf.length > max) buf.splice(0, buf.length - max);
  } catch { /* non-fatal */ }
}

// Série d'une métrique pour un hôte : [{ ts, v }] dans la fenêtre demandée
function series(host, key, minutes) {
  const buf = buffers.get(host);
  if (!buf) return [];
  const win = (minutes || config.load().historyMinutes || 30) * 60 * 1000;
  const now = Date.now();
  return buf.filter(s => s[key] != null && now - s.ts <= win).map(s => ({ ts: s.ts, v: s[key] }));
}

// Dernier échantillon d'un hôte (pour la barre système)
function last(host) {
  const buf = buffers.get(host);
  return buf && buf.length ? buf[buf.length - 1] : null;
}

function hosts() { return [...buffers.keys()]; }

function reset() { buffers.clear(); }

module.exports = { record, series, last, hosts, reset, sampleFrom };
