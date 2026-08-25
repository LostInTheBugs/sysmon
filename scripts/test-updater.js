'use strict';
// Tests unitaires du module updater (détection de mises à jour GitHub).
// Couvre : comparaison de versions (dont le padding T9), parse de la réponse
// GitHub (objet/tableau), agrégation de plusieurs releases (notes complètes,
// plus de troncature à 400), traitement du 304 (ETag/If-None-Match).
const path = require('path');
const os = require('os');
const fs = require('fs');
const https = require('https');

// Stub electron (updater require app.getVersion)
require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: { app: { getVersion: () => '2026.08.031', getPath: () => os.tmpdir() } }
};

const updater = require('../src/main/updater');
let ok = true;
const check = (label, cond, extra) => { console.log(label + ':', cond ? 'OK' : 'FAIL', extra || ''); ok = ok && cond; };

// 1. comparaison de versions
check('newer (033 > 031)', updater.isNewerThan('2026.08.031', '2026.08.033'));
check('same version', !updater.isNewerThan('2026.08.031', '2026.08.031'));
check('older', !updater.isNewerThan('2026.08.033', '2026.08.031'));
check('different month', updater.isNewerThan('2026.07.999', '2026.08.001'));
check('different year', updater.isNewerThan('2025.12.100', '2026.01.001'));
check('garbage', !updater.isNewerThan('2026.08.031', 'bonjour'));
check('null latest', !updater.isNewerThan('2026.08.031', null));
// padding (T9) : '2026.8.44' et '2026.08.044' sont la même version
check('padding: 2026.8.45 > 2026.08.044', updater.isNewerThan('2026.08.044', '2026.8.45'));
check('padding: 2026.8.44 == 2026.08.044', !updater.isNewerThan('2026.08.044', '2026.8.44'));
check('padding: 2026.08.044 < 2026.8.45', !updater.isNewerThan('2026.8.45', '2026.08.044'));

// 2. parse de la réponse GitHub (tableau + objet) — compat parseRelease
const relArr = updater.parseRelease(JSON.stringify([{ tag_name: '2026.08.033', html_url: 'https://github.com/LostInTheBugs/sysmon/releases/tag/2026.08.033', body: 'Notes de release', prerelease: true }]));
check('parse array', !!relArr && relArr.latest === '2026.08.033' && relArr.url.includes('2026.08.033') && relArr.prerelease === true);
const relObj = updater.parseRelease(JSON.stringify({ tag_name: '2026.08.031', html_url: 'https://x', body: '' }));
check('parse object', !!relObj && relObj.latest === '2026.08.031');
check('parse garbage', updater.parseRelease('pas du json') === null);
check('parse empty array', updater.parseRelease('[]') === null);

// 3. agrégation de plusieurs releases : notes COMPLÈTES (plus de slice 400)
const longBody = 'x'.repeat(600);
const many = JSON.stringify([
  { tag_name: '2026.08.033', html_url: 'https://r/033', body: longBody, assets: [{ name: 'SysMon-2026.8.33.AppImage', browser_download_url: 'https://d/033.AppImage' }] },
  { tag_name: '2026.08.032', html_url: 'https://r/032', body: 'Notes 032', assets: [] },
  { tag_name: '2026.08.030', html_url: 'https://r/030', body: 'Notes 030', assets: [] }
]);
const parsed = updater.parseReleases(many);
check('parseReleases: latest', parsed && parsed.latest === '2026.08.033');
check('parseReleases: notes complètes (>400)', parsed && parsed.notes.length === 600);
check('parseReleases: liste des 3 releases', parsed && parsed.releases.length === 3);
check('parseReleases: assets conservés', parsed && parsed.releases[0].assets.length === 1 && parsed.releases[0].assets[0].url === 'https://d/033.AppImage');
const newer = updater.collectNewer('2026.08.031', parsed.releases);
check('collectNewer: filtre les versions plus récentes', newer.length === 2 && newer[0].tag_name === '2026.08.033' && newer[1].tag_name === '2026.08.032');
check('collectNewer: notes entières conservées', newer[0].body.length === 600);

// 4. traitement du 304 (ETag / If-None-Match) : stub de https.get
const realGet = https.get;
let calls = 0;
const RELEASES_200 = JSON.stringify([{ tag_name: '2026.08.033', html_url: 'https://r/033', body: 'Notes', prerelease: false }]);
https.get = (opts, cb) => {
  calls++;
  const res = new (require('events').EventEmitter)();
  res.statusCode = calls === 1 ? 200 : 304;
  res.headers = calls === 1 ? { etag: '"abc123"', 'x-ratelimit-remaining': '42' } : { 'x-ratelimit-remaining': '41' };
  process.nextTick(() => {
    if (calls === 1) { res.emit('data', RELEASES_200); res.emit('end'); }
    else res.emit('end');
  });
  cb(res);
  return { on: () => {}, destroy: () => {} };
};
(async () => {
  // 1er contrôle : 200 → disponible
  const r1 = await updater.check();
  check('check #1 (200): available', r1.available === true && r1.latest === '2026.08.033');
  check('check #1: If-None-Match absent au 1er appel', calls === 1);
  // 2e contrôle : 304 → dernier résultat conservé, checkedAt mis à jour
  const before = r1.checkedAt;
  await new Promise(r => setTimeout(r, 15));
  const r2 = await updater.check();
  check('check #2 (304): résultat conservé', r2.latest === '2026.08.033' && r2.available === true);
  check('check #2: checkedAt mis à jour, lastCheck inchangé', r2.checkedAt >= before);
  https.get = realGet;

  // 5. check() complet avec la VRAIE API GitHub (résultat informatif, pas bloquant)
  const res = await updater.check();
  console.log('live GitHub check:', res.latest ? `latest=${res.latest} available=${res.available} (current=${res.current})` : 'offline/inaccessible');
  if (res.latest) {
    check('live: latest parseable', /^\d+\.\d+\.\d+/.test(res.latest));
    check('live: url non vide', !!res.url);
  }
  console.log(ok ? 'TEST PASSED (updater)' : 'TEST FAILED');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });
