'use strict';
// SysMon — détection et mise à jour depuis GitHub (LostInTheBugs/sysmon).
// - Vérification périodique configurable (updateIntervalSec, minimum 900 s),
//   premier contrôle décalé d'un jitter aléatoire 0-60 s (pas de synchro au
//   démarrage, ne bloque jamais le démarrage).
// - ETag mémorisé + If-None-Match : un 304 ne consomme pas le quota API —
//   dans ce cas lastCheck est conservé, seul checkedAt est mis à jour.
// - Notes COMPLÈTES (plus de troncature) : toutes les releases plus récentes
//   que la version installée sont agrégées (per_page=30).
// Les releases de test (impaires) sont incluses : la plus récente publiée =
// version la plus haute.
const https = require('https');
const { app } = require('electron');
const logger = require('./logger');

const MIN_INTERVAL_SEC = 900;         // borne basse (15 min)
const DEFAULT_INTERVAL_SEC = 3600;    // 1 h
const JITTER_MAX_MS = 60 * 1000;      // premier contrôle : 0-60 s
const GITHUB_OWNER = 'LostInTheBugs';
const GITHUB_REPO = 'sysmon';

let lastCheck = null;
let timer = null;
let etag = null;

// '2026.08.031' → [2026, 8, 31] — accepte aussi '2026.8.44' (padding ignoré,
// la comparaison se fait sur les segments numériques)
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

// Corps de la réponse GitHub : objet OU tableau. Retourne la release la plus
// récente (compat, notes complètes) + la liste complète des releases.
function parseReleases(body) {
  try {
    const r = JSON.parse(body);
    const list = Array.isArray(r) ? r : [r];
    const rel = list[0];
    if (!rel || !rel.tag_name) return null;
    return {
      latest: String(rel.tag_name),
      url: rel.html_url || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
      notes: String(rel.body || '') || null,
      prerelease: !!rel.prerelease,
      releases: list.map(x => ({
        tag_name: String(x.tag_name || ''),
        published_at: x.published_at || null,
        body: String(x.body || ''),
        html_url: x.html_url || '',
        assets: Array.isArray(x.assets)
          ? x.assets.map(a => ({ name: String(a.name || ''), url: String(a.browser_download_url || '') }))
          : []
      }))
    };
  } catch {
    return null;
  }
}

// Compat anciens tests : même format que parseReleases mais sans la liste.
function parseRelease(body) {
  const r = parseReleases(body);
  return r ? { latest: r.latest, url: r.url, notes: r.notes, prerelease: r.prerelease } : null;
}

// Releases plus récentes que current, triées de la plus récente à la plus
// ancienne (pour la fenêtre de différences).
function collectNewer(current, releases) {
  return (releases || []).filter(r => isNewerThan(current, r.tag_name));
}

function fetchLatest() {
  return new Promise(resolve => {
    const headers = {
      'User-Agent': `SysMon/${app.getVersion()}`,
      Accept: 'application/vnd.github+json'
    };
    if (etag) headers['If-None-Match'] = etag;
    const req = https.get({
      host: 'api.github.com',
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=30`,
      headers,
      timeout: 8000
    }, res => {
      if (res.statusCode === 304) { resolve({ notModified: true }); return; }
      if (res.headers.etag) etag = res.headers.etag;
      logger.debug('updater', 'github X-RateLimit-Remaining:', res.headers['x-ratelimit-remaining'] != null ? res.headers['x-ratelimit-remaining'] : 'n/a');
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => resolve(parseReleases(body)));
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
    notes: null,
    releases: []
  };
  if (rel && rel.notModified) {
    // 304 : rien de nouveau depuis le dernier contrôle — on conserve le
    // dernier résultat connu, seul checkedAt change
    const prev = lastCheck;
    logger.debug('updater', 'check: 304 not modified (dernier résultat conservé)');
    if (prev) return { ...prev, checkedAt: result.checkedAt };
    return result;
  }
  if (rel && rel.latest) {
    result.latest = rel.latest;
    result.url = rel.url;
    result.notes = rel.notes;
    result.releases = collectNewer(result.current, rel.releases);
    result.available = isNewerThan(result.current, rel.latest);
  }
  lastCheck = result;
  logger.debug('updater', 'check:', JSON.stringify({ current: result.current, latest: result.latest, available: result.available, newer: result.releases.length }));
  return result;
}

// start(cfg, onUpdate) : onUpdate(result) est appelé après chaque contrôle où
// une nouvelle version est disponible (utilisé pour autoUpdate côté main).
function start(cfg, onUpdate) {
  stop();
  if (cfg.checkUpdates === false) return;
  const intervalSec = Math.max(MIN_INTERVAL_SEC, Number(cfg.updateIntervalSec) || DEFAULT_INTERVAL_SEC);
  const intervalMs = intervalSec * 1000;
  // Jitter : premier contrôle décalé de 0 à 60 s (pas de rafale au démarrage)
  const firstDelay = Math.floor(Math.random() * JITTER_MAX_MS);
  const run = () => {
    check().then(result => {
      if (result.available && onUpdate) onUpdate(result);
    }).catch(() => {});
  };
  timer = setTimeout(() => {
    run();
    timer = setInterval(run, intervalMs);
  }, firstDelay);
}

function stop() {
  if (timer) {
    clearTimeout(timer);
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { check, start, stop, isNewerThan, parseRelease, parseReleases, collectNewer, parseVersion, getLastCheck: () => lastCheck };
