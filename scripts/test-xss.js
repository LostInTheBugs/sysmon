'use strict';
// Test XSS stocké (T3) : les valeurs des snapshots slaves (noms de conteneurs
// Docker, modèles GPU, points de montage…) doivent être échappées dans le HTML
// produit par le dashboard. Un slave compromis ne doit pas pouvoir injecter
// du HTML/JS dans la page du master.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// --- DOM minimal pour charger app.js (script navigateur) ----------------------
const el = () => ({
  innerHTML: '', textContent: '', value: '', href: '', style: {}, title: '',
  dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {}, appendChild() {}, querySelector: () => null,
  querySelectorAll: () => [], setAttribute() {}, focus() {}
});
const document = {
  body: el(),
  getElementById: () => el(),
  querySelector: () => null,
  querySelectorAll: () => []
};
const sandbox = {
  document,
  localStorage: { getItem: () => null, setItem() {} },
  fetch: () => new Promise(() => {}), // jamais résolu — pas d'API appelée dans le test
  WebSocket: class { constructor() {} on() {} send() {} close() {} },
  navigator: { language: 'fr' },
  location: { protocol: 'http:', host: 'localhost:8597' },
  setInterval: () => 0, clearInterval() {},
  setTimeout, clearTimeout,
  console,
  sysmonI18n: { t: k => k, setLang() {}, apply() {} }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'app.js'), 'utf8');
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'app.js' });

if (typeof sandbox.hostCard !== 'function') {
  console.error('TEST FAILED — hostCard non exposé par app.js dans la sandbox');
  process.exit(1);
}

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log('  ✔ ' + name);
  else { console.error('  ✘ ' + name); failures++; }
};

const PAYLOAD = '<img src=x onerror=alert(1)>';
const ESCAPED = '&lt;img src=x onerror=alert(1)&gt;';

// 1. Nom de conteneur Docker malveillant dans une carte hôte
const h = {
  timestamp: Date.now(),
  host: { hostname: 'slave-evil', platform: 'linux' },
  modules: {
    vms: { ok: true, docker: { present: true, version: '27.0', running: 1, total: 1, containers: [{ name: PAYLOAD, cpu: 5 }] } }
  }
};
const html = sandbox.hostCard('slave-evil', h, true, 'slave-1');
check('nom de conteneur Docker échappé', html.includes(ESCAPED) && !html.includes(PAYLOAD), '');

// 2. Modèle GPU malveillant
const h2 = {
  timestamp: Date.now(),
  host: { hostname: 'slave-gpu', platform: 'linux' },
  modules: { gpu: { ok: true, controllers: [{ model: PAYLOAD, utilizationPct: 10 }] } }
};
const html2 = sandbox.hostCard('slave-gpu', h2, true, 'slave-2');
check('modèle GPU échappé', html2.includes(ESCAPED) && !html2.includes(PAYLOAD));

// 3. Nom d'hôte malveillant (titre de carte)
const h3 = { timestamp: Date.now(), host: { hostname: PAYLOAD, platform: 'linux' }, modules: {} };
const html3 = sandbox.hostCard(PAYLOAD, h3, true, 'slave-3');
check("nom d'hôte échappé", html3.includes(ESCAPED) && !html3.includes(PAYLOAD));

// 4. bar() avec une valeur non numérique → bornée à 0, pas d'injection style
const b = sandbox.bar('50%"><script>alert(1)</script>');
check('bar() borné numériquement', b.includes('width:0%') && !b.includes('<script>'));

// 5. row() avec valeur malveillante → échappée
const r = sandbox.row('k', PAYLOAD);
check('row() valeur échappée', r.includes(ESCAPED) && !r.includes(PAYLOAD));

// 6. row() avec null → tiret, pas d'erreur
check('row() null → tiret', sandbox.row('k', null).includes('—'));

console.log(failures ? `XSS TEST FAILED (${failures} échec(s))` : 'XSS TEST PASSED');
process.exit(failures ? 1 : 0);
