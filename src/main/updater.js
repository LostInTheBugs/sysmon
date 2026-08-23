'use strict';
// SysMon — détection de mises à jour.
// Vérifie la dernière release publiée sur GitHub (LostInTheBugs/sysmon) et
// compare avec la version locale. Les releases de test (impaires) sont
// incluses : la plus récente publiée = version la plus haute.
const https = require('https');
const { app } = require('electron');
const logger = require('./logger');

const CHECK_INTERVAL_MS = 6 * 3600 * 1000; // 6 h
const GITHUB_OWNER = 'LostInTheBugs';
const GITHUB_REPO = 'sysmon';

let lastCheck = null;
let timer = null;

// '2026.08.031' → [2026, 8, 31] (null si illisible)
function parseVersion(v) {
  const m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : null;
}

function isNewerThan(current, latest) {
  const a = parseVersion(current);
  const b = parseVersion(latest);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return b[i] > a[i];
  }
  return false;
}

// Corps de la réponse GitHub (objet OU tableau — ?per_page=1 renvoie un tableau)
function parseRelease(body) {
  try {
    const r = JSON.parse(body);
    const rel = Array.isArray(r) ? r[0] : r;
    if (!rel || !rel.tag_name) return null;
    return {
      latest: String(rel.tag_name),
      url: rel.html_url || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
      notes: String(rel.body || '').slice(0, 400) || null,
      prerelease: !!rel.prerelease
    };
  } catch {
    return null;
  }
}

function fetchLatest() {
  return new Promise(resolve => {
    const req = https.get({
      host: 'api.github.com',
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=1`,
      headers: {
        'User-Agent': `SysMon/${app.getVersion()}`,
        Accept: 'application/vnd.github+json'
      },
      timeout: 8000
    }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => resolve(parseRelease(body)));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function check() {
  const rel = await fetchLatest();
  const result = {
    checkedAt: Date.now(),
    current: app.getVersion(),
    available: false,
    latest: null,
    url: null,
    notes: null
  };
  if (rel && rel.latest) {
    result.latest = rel.latest;
    result.url = rel.url;
    result.notes = rel.notes;
    result.available = isNewerThan(result.current, rel.latest);
  }
  lastCheck = result;
  logger.debug('updater', 'check:', JSON.stringify({ current: result.current, latest: result.latest, available: result.available }));
  return result;
}

function start(cfg) {
  stop();
  if (cfg.checkUpdates === false) return;
  const run = () => { check().catch(() => {}); };
  run();
  timer = setInterval(run, CHECK_INTERVAL_MS);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { check, start, stop, isNewerThan, parseRelease, parseVersion, getLastCheck: () => lastCheck };
