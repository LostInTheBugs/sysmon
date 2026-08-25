'use strict';
// Exécute tous les scripts/test-*.js de scripts/ (T13) : résumé N/N et code
// de sortie non nul en cas d'échec. Les tests nécessitant une machine réelle
// (Docker…) sont ignorés quand CI=true.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const inCI = process.env.CI === 'true';
// Tests qui exigent une machine réelle (jamais en CI)
const REQUIRE_HOST = ['test-docker-host.js'];

const tests = fs.readdirSync(DIR)
  .filter(f => /^test-.*\.js$/.test(f))
  .filter(f => !(inCI && REQUIRE_HOST.includes(f)))
  .sort();

let failed = 0;
for (const t of tests) {
  process.stdout.write(t + ' … ');
  const r = spawnSync(process.execPath, [path.join(DIR, t)], { stdio: 'pipe', timeout: 180000 });
  if (r.status === 0) {
    console.log('PASS');
  } else {
    failed++;
    console.log('FAIL (status ' + r.status + ')');
    if (r.stdout) process.stdout.write(String(r.stdout));
    if (r.stderr) process.stdout.write(String(r.stderr));
  }
}
console.log(`\n${tests.length - failed}/${tests.length} tests passés`);
process.exit(failed ? 1 : 0);
