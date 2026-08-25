'use strict';
// Logger central SysMon : buffer en mémoire (ring) + fichier sysmon-debug.log.
// - Niveau configurable (config.logLevel : debug < info < warn < error) —
//   appliqué au buffer ET à l'écriture fichier
// - Chaque entrée a un id croissant (permet les envois incrémentaux slave → master)
// - drain() : renvoie les entrées non encore envoyées (pour le push au master)
// - Écriture fichier ASYNCHRONE : file d'attente vidée toutes les ~500 ms
//   (plus d'appendFileSync sur le thread principal à chaque snapshot)

const fs = require('fs');
const path = require('path');
const config = require('./config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_BUFFER = 500;
const MAX_FILE_BYTES = 1024 * 1024; // rotation à 1 Mo
const FLUSH_INTERVAL_MS = 500;      // vidage de la file d'écriture

let entries = [];
let nextId = 1;
let drainedUpTo = 0;
let fileLog = null;
let writesSinceCheck = 0;
let pendingLines = [];
let flushTimer = null;
let writing = false;   // un appendFile est en cours (protection réentrance)
let dirty = false;     // des lignes attendent pendant l'écriture en cours

function logPath() {
  return path.join(path.dirname(config.configPath()), 'sysmon-debug.log');
}

// Rotation : sysmon-debug.log → .1, .1 → .2 (2 archives conservées)
function rotateIfNeeded() {
  writesSinceCheck++;
  if (writesSinceCheck < 50) return;
  writesSinceCheck = 0;
  try {
    const st = fs.statSync(fileLog);
    if (st.size <= MAX_FILE_BYTES) return;
    try { fs.renameSync(fileLog + '.1', fileLog + '.2'); } catch { /* pas d'archive .1 */ }
    fs.renameSync(fileLog, fileLog + '.1'); // le prochain append crée un nouveau log
  } catch { /* pas encore de fichier */ }
}

function effectiveLevel() {
  const lvl = config.load().logLevel || 'info';
  return LEVELS[lvl] != null ? lvl : 'info';
}

// Écriture asynchrone de la file (concaténation des lignes en attente).
// Protection contre la réentrance : si un appendFile est déjà en cours
// (par ex. flush() rappelé par le timer 500 ms ou par before-quit pendant
// une écriture), on marque dirty et on relance une fois l'écriture finie —
// jamais deux appendFile simultanés sur le fichier de log.
function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (writing) { dirty = true; return; }
  if (!pendingLines.length) return;
  const chunk = pendingLines.join('');
  pendingLines = [];
  writing = true;
  try {
    if (!fileLog) fileLog = logPath();
    fs.mkdirSync(path.dirname(fileLog), { recursive: true });
    fs.appendFile(fileLog, chunk, () => {
      writing = false;
      rotateIfNeeded();
      if (dirty) { dirty = false; flush(); }
    });
  } catch {
    // le logging ne doit jamais planter l'appli : on remet le bloc en tête
    // de file pour ne pas perdre les lignes
    writing = false;
    pendingLines = [chunk, ...pendingLines];
  }
}

function scheduleFlush() {
  if (flushTimer || !pendingLines.length) return;
  flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

function log(level, tag, ...args) {
  try {
    const msg = args.join(' ');
    const now = new Date();
    const entry = { id: nextId++, ts: now.toISOString(), level, tag, msg };

    // Le filtre de niveau s'applique au buffer ET au fichier (sinon régler
    // logLevel: info ne réduit pas les entrées/sorties disque)
    if (LEVELS[level] >= LEVELS[effectiveLevel()]) {
      entries.push(entry);
      if (entries.length > MAX_BUFFER) entries.splice(0, entries.length - MAX_BUFFER);
      pendingLines.push(`[${entry.ts}] [${level}] [${tag}] ${msg}\n`);
      if (pendingLines.length >= 50) flush();
      else scheduleFlush();
    }
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

function reset() { entries = []; drainedUpTo = 0; pendingLines = []; }

module.exports = { log, debug, info, warn, error, drain, getBuffer, reset, flush, LEVELS };
