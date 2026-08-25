'use strict';
// Vérifie la conformité du numéro de version (T9) :
//   - VERSION et package.json doivent porter le même numéro ;
//   - le format doit être AAAA.MM.NNN (mois et compteur paddés), suffixe
//     optionnel -cN uniquement (convention LostInTheBugs).
// Sort avec un code non nul si l'une des deux conditions échoue.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FORMAT = /^\d{4}\.\d{2}\.\d{3}(-c\d+)?$/;

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const versionFile = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();

let failures = 0;
const fail = msg => { console.error('  ✘ ' + msg); failures++; };

console.log('check-version : package.json=' + pkg.version + ' VERSION=' + versionFile);
if (!FORMAT.test(pkg.version)) fail('package.json version invalide : ' + pkg.version + ' (attendu ' + FORMAT + ')');
if (!FORMAT.test(versionFile)) fail('VERSION invalide : ' + versionFile);
if (pkg.version !== versionFile) fail('divergence entre package.json (' + pkg.version + ') et VERSION (' + versionFile + ')');

if (failures) { console.error('CHECK VERSION FAILED (' + failures + ' échec(s))'); process.exit(1); }
console.log('CHECK VERSION PASSED');
