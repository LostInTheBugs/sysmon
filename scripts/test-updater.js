'use strict';
// Tests unitaires du module updater (détection de mises à jour GitHub).
const path = require('path');
const os = require('os');
const fs = require('fs');

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

// 2. parse de la réponse GitHub (tableau + objet)
const relArr = updater.parseRelease(JSON.stringify([{ tag_name: '2026.08.033', html_url: 'https://github.com/LostInTheBugs/sysmon/releases/tag/2026.08.033', body: 'Notes de release', prerelease: true }]));
check('parse array', !!relArr && relArr.latest === '2026.08.033' && relArr.url.includes('2026.08.033') && relArr.prerelease === true);
const relObj = updater.parseRelease(JSON.stringify({ tag_name: '2026.08.031', html_url: 'https://x', body: '' }));
check('parse object', !!relObj && relObj.latest === '2026.08.031');
check('parse garbage', updater.parseRelease('pas du json') === null);
check('parse empty array', updater.parseRelease('[]') === null);

// 3. check() complet avec la VRAIE API GitHub (résultat informatif, pas bloquant)
(async () => {
  const res = await updater.check();
  console.log('live GitHub check:', res.latest ? `latest=${res.latest} available=${res.available} (current=${res.current})` : 'offline/inaccessible');
  if (res.latest) {
    check('live: latest parseable', /^\d+\.\d+\.\d+/.test(res.latest));
    check('live: url non vide', !!res.url);
  }
  console.log(ok ? 'TEST PASSED (updater)' : 'TEST FAILED');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });
