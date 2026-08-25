'use strict';
// Test de l'authentification par jeton du master (T1) :
//  - /api/* sans jeton → 401, avec Bearer / ?token= → 200
//  - / sans jeton → 401 (page), /?token= → 302 + cookie HttpOnly
//  - / avec cookie → 200 + meta sysmon-token injecté
//  - WebSocket sans jeton → fermé 4401, avec jeton → accepté
const path = require('path');
const os = require('os');
const fs = require('fs');
const { WebSocket } = require('ws');

const TOKEN = 'test-token-1234567890abcdef';
const PORT = 8711;

// --- stub electron -----------------------------------------------------------
const fakeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'sysmon-auth-'));
require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: {
    app: { getPath: () => fakeUserData, whenReady: () => Promise.resolve() },
    BrowserWindow: class { constructor() {} loadFile() {} on() {} destroy() {} isDestroyed() { return true; } },
    Tray: class { constructor() {} setToolTip() {} setContextMenu() {} },
    Menu: { buildFromTemplate: () => ({}) },
    ipcMain: { handle: () => {} },
    shell: { openExternal: () => {} },
    nativeImage: { createFromDataURL: () => ({}) }
  }
};

const config = require('../src/main/config');
config.set({ mode: 'master', port: PORT, authToken: TOKEN, autoApproveSlaves: false });

const master = require('../src/main/master/server');
master.start({
  getSnapshot: () => ({ timestamp: Date.now(), host: { hostname: 'auth-test', platform: 'linux' }, modules: {} }),
  onChange: () => {}
});

const BASE = `http://127.0.0.1:${PORT}`;
let failures = 0;

function check(name, cond, extra) {
  if (cond) console.log('  ✔ ' + name);
  else { console.error('  ✘ ' + name + (extra ? ' — ' + extra : '')); failures++; }
}

async function run() {
  // 1. /api/logs sans jeton → 401
  let r = await fetch(BASE + '/api/logs');
  check('GET /api/logs sans jeton → 401', r.status === 401, 'got ' + r.status);

  // 2. /api/logs avec Authorization: Bearer → 200
  r = await fetch(BASE + '/api/logs', { headers: { Authorization: 'Bearer ' + TOKEN } });
  check('GET /api/logs Bearer → 200', r.status === 200, 'got ' + r.status);

  // 3. /api/logs avec ?token= → 200
  r = await fetch(BASE + '/api/logs?token=' + TOKEN);
  check('GET /api/logs?token= → 200', r.status === 200, 'got ' + r.status);

  // 4. /api/logs avec un mauvais jeton → 401
  r = await fetch(BASE + '/api/logs?token=wrong');
  check('GET /api/logs?token=mauvais → 401', r.status === 401, 'got ' + r.status);

  // 5. / sans jeton → 401 (page HTML)
  r = await fetch(BASE + '/');
  const body = await r.text();
  check('GET / sans jeton → 401 HTML', r.status === 401 && body.includes('Accès refusé'), 'got ' + r.status);

  // 6. /?token= valide → 302 + Set-Cookie HttpOnly
  r = await fetch(BASE + '/?token=' + TOKEN, { redirect: 'manual' });
  const setCookie = r.headers.get('set-cookie') || '';
  check('GET /?token= → 302', r.status === 302, 'got ' + r.status);
  check('Set-Cookie sysmon_token HttpOnly', /sysmon_token=test-token-1234567890abcdef/.test(setCookie) && /HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie), setCookie);

  // 7. / avec cookie → 200 + meta injecté
  r = await fetch(BASE + '/', { headers: { Cookie: 'sysmon_token=' + TOKEN } });
  const html = await r.text();
  check('GET / avec cookie → 200 + meta', r.status === 200 && html.includes('<meta name="sysmon-token" content="' + TOKEN + '">'), 'status ' + r.status);

  // 8. WebSocket sans jeton → fermé 4401
  const wsBad = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const badResult = await new Promise(resolve => {
    const t = setTimeout(() => resolve('timeout'), 5000);
    wsBad.on('close', (code, reason) => { clearTimeout(t); resolve(code + ':' + reason); });
    wsBad.on('error', () => {});
  });
  check('WS sans jeton → fermé 4401', badResult.startsWith('4401'), badResult);

  // 9. WebSocket avec ?token= → accepté, subscribe reçoit la liste
  const wsGood = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${TOKEN}`);
  const subResult = await new Promise(resolve => {
    const t = setTimeout(() => resolve('timeout'), 5000);
    wsGood.on('open', () => wsGood.send(JSON.stringify({ type: 'subscribe' })));
    wsGood.on('message', d => { clearTimeout(t); resolve(String(d)); });
    wsGood.on('error', () => {});
  });
  check('WS avec jeton → subscribe reçoit slaves', subResult.includes('"type":"slaves"'), subResult);
  wsGood.close();

  // --- partie slave (T2) ---
  const slave = require('../src/main/slave/client');
  let slaveStatuses = [];
  slave.onStatus(s => slaveStatuses.push(s.status));
  const fakeSnapshot = () => ({ timestamp: Date.now(), host: { hostname: 'slave-auth', platform: 'linux' }, modules: { cpu: { ok: true, usage: 5 } } });

  // 10. Slave SANS jeton → connexion refusée, jamais enregistré
  config.set({ mode: 'slave', masterIp: '127.0.0.1', port: PORT, masterToken: '' });
  slave.start(fakeSnapshot);
  await new Promise(r => setTimeout(r, 4500));
  check('slave sans jeton → refusé (aucun hello)', master.listSlaves().length === 0, 'slaves: ' + master.listSlaves().length);
  check('slave sans jeton → jamais validé', !slaveStatuses.includes('validated'), slaveStatuses.join(','));
  slave.stop();

  // 11. Slave AVEC le bon jeton → hello, validation, snapshot
  slaveStatuses = [];
  config.set({ masterToken: TOKEN });
  slave.start(fakeSnapshot);
  const slaveResult = await new Promise(resolve => {
    const t = setTimeout(() => resolve('timeout'), 12000);
    const iv = setInterval(() => {
      const s = master.listSlaves()[0];
      if (s && s.status === 'pending') master.setSlaveStatus(s.id, 'approved');
      if (s && s.status === 'approved' && s.snapshot && s.connected) {
        clearTimeout(t); clearInterval(iv);
        resolve('connected:' + JSON.stringify(slaveStatuses));
      }
    }, 500);
  });
  check('slave avec jeton → hello + validation + snapshot', slaveResult.startsWith('connected:'), slaveResult);
  // Le welcome porte son propre champ status (pending→approved) qui remplace
  // la clé 'validated' dans le callback — la preuve du round-trip est le
  // statut final reçu du master.
  check('slave avec jeton → statut final reçu (approved)', slaveResult.includes('approved'), slaveResult);
  slave.stop();

  // --- T4 : routes mutantes en POST, anti-CSRF, traversée de chemin ---
  const slaveId = (master.listSlaves()[0] || {}).id || 'fake-id';

  // 12. GET sur une route mutante → 405
  r = await fetch(`${BASE}/api/slaves/${slaveId}/approve?token=${TOKEN}`);
  check('GET /api/slaves/:id/approve → 405', r.status === 405, 'got ' + r.status);

  // 13. POST avec SEUL le cookie (pas d'en-tête/query) → 401 (anti-CSRF)
  r = await fetch(`${BASE}/api/slaves/${slaveId}/approve`, { method: 'POST', headers: { Cookie: 'sysmon_token=' + TOKEN } });
  check('POST approve avec cookie seul → 401 (anti-CSRF)', r.status === 401, 'got ' + r.status);

  // 14. POST avec ?token= → autorisé (404 car id inconnu, PAS 401)
  r = await fetch(`${BASE}/api/slaves/fake-id/approve?token=${TOKEN}`, { method: 'POST' });
  check('POST approve avec ?token= → autorisé (404 id inconnu, pas 401)', r.status === 404, 'got ' + r.status);

  // 15. Traversée de chemin → 404 (jamais un fichier hors de WEB_DIR)
  r = await fetch(`${BASE}/..%2fpackage.json?token=${TOKEN}`);
  check('traversée de chemin → 404', r.status === 404, 'got ' + r.status);
  r = await fetch(`${BASE}/%2e%2e%2fpackage.json?token=${TOKEN}`);
  check('traversée encodée → 404', r.status === 404, 'got ' + r.status);

  // --- P1 : bindAddress — master en 127.0.0.1 non joignable sur une IP LAN ---
  // (le défaut DEFAULTS est 127.0.0.1 ; l'implémentation initiale écoutait en
  // dur sur 0.0.0.0 — ce test échoue sur ce code-là)
  function lanIP() {
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
      for (const a of ifs[name] || []) {
        if (a.family === 'IPv4' && !a.internal) return a.address;
      }
    }
    return null;
  }
  const lan = lanIP();
  if (lan) {
    master.stop();
    config.set({ bindAddress: '127.0.0.1' });
    master.start({
      getSnapshot: () => ({ timestamp: Date.now(), host: { hostname: 'auth-test', platform: 'linux' }, modules: {} }),
      onChange: () => {}
    });
    await new Promise(r => setTimeout(r, 500));
    let reachable = false;
    try {
      const resp = await fetch(`http://${lan}:${PORT}/api/logs?token=${TOKEN}`, { signal: AbortSignal.timeout(2000) });
      reachable = resp.status < 500;
    } catch { /* connexion refusée → bind 127.0.0.1 respecté */ }
    check('bindAddress=127.0.0.1 → master NON joignable sur l\'IP LAN (' + lan + ')', !reachable, reachable ? 'joignable : ' + lan : 'refusé');
    let loopback = false;
    try {
      const resp = await fetch(BASE + '/api/logs?token=' + TOKEN, { signal: AbortSignal.timeout(2000) });
      loopback = resp.status === 200;
    } catch { /* ignore */ }
    check('bindAddress=127.0.0.1 → joignable en loopback', loopback);
    master.stop();
  } else {
    console.log('  (aucune IP LAN — check bindAddress ignoré)');
  }

  master.stop();
  console.log(failures ? `AUTH TEST FAILED (${failures} échec(s))` : 'AUTH TEST PASSED');
  process.exit(failures ? 1 : 0);
}

setTimeout(run, 400);
