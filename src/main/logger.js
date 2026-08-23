'use strict';
// Logger central SysMon : buffer en mémoire (ring) + fichier sysmon-debug.log.
// - Niveau configurable (config.logLevel : debug < info < warn < error)
// - Chaque entrée a un id croissant (permet les envois incrémentaux slave → master)
// - drain() : renvoie les entrées non encore envoyées (pour le push au master)

const fs = require('fs');
const path = require('path');
const config = require('./config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_BUFFER = 500;

let entries = [];
let nextId = 1;
let drainedUpTo = 0;
let fileLog = null;

function logPath() {
  return path.join(path.dirname(config.configPath()), 'sysmon-debug.log');
}

function effectiveLevel() {
  const lvl = config.load().logLevel || 'debug';
  return LEVELS[lvl] != null ? lvl : 'debug';
}

function log(level, tag, ...args) {
  try {
    const msg = args.join(' ');
    const now = new Date();
    const entry = { id: nextId++, ts: now.toISOString(), level, tag, msg };

    if (LEVELS[level] >= LEVELS[effectiveLevel()]) {
      entries.push(entry);
      if (entries.length > MAX_BUFFER) entries.splice(0, entries.length - MAX_BUFFER);
    }

    // Écriture fichier (toujours, quel que soit le niveau de filtre du buffer)
    if (!fileLog) fileLog = logPath();
    fs.mkdirSync(path.dirname(fileLog), { recursive: true });
    fs.appendFileSync(fileLog, `[${now.toISOString()}] [${level}] [${tag}] ${msg}\n`);
  } catch { /* le logging ne doit jamais planter l'appli */ }
}

const debug = (...a) => log('debug', ...a);
const info = (...a) => log('info', ...a);
const warn = (...a) => log('warn', ...a);
const error = (...a) => log('error', ...a);

// Entrées non encore envoyées (pour le push incrémental slave → master)
function drain() {
  const out = entries.filter(e => e.id > drainedUpTo);
  if (out.length) drainedUpTo = out[out.length - 1].id;
  return out;
}

// Buffer complet (optionnellement filtré), pour l'API / dashboard
function getBuffer(limit = 200, minLevel = 'debug') {
  const min = LEVELS[minLevel] || 10;
  const all = entries.filter(e => LEVELS[e.level] >= min);
  return all.slice(-limit);
}

function reset() { entries = []; drainedUpTo = 0; }

module.exports = { log, debug, info, warn, error, drain, getBuffer, reset, LEVELS };
