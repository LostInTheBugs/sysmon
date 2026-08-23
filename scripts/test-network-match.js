'use strict';
// Régression : sur Windows, les noms d'interfaces diffèrent entre
// si.networkStats() ("Realtek PCIe GbE Family Controller") et
// si.networkInterfaces() ("Ethernet") → la jointure par nom exact donnait 0
// partout. matchStats doit trouver la bonne entrée par tous les moyens.
const { matchStats } = require('../src/main/collectors/network');

// Cas Windows typique : stats avec le nom complet, interfaces avec le nom court
const stats = [
  { iface: 'Loopback Pseudo-Interface 1', rx_sec: 0, tx_sec: 0 },
  { iface: 'Realtek PCIe GbE Family Controller', rx_sec: 15728640, tx_sec: 5242880 } // 15 MB/s ↓ 5 MB/s ↑
];

let ok = true;

// 1. correspondance par ifaceName (description)
let s = matchStats(stats, 'Ethernet', 'Realtek PCIe GbE Family Controller');
ok = ok && !!s && s.rx_sec === 15728640;
console.log('ifaceName match:', ok ? 'OK' : 'FAIL', '→ rx_sec', s && s.rx_sec);

// 2. correspondance par nom exact
s = matchStats(stats, 'Realtek PCIe GbE Family Controller', null);
ok = ok && !!s && s.rx_sec === 15728640;
console.log('exact name match:', ok ? 'OK' : 'FAIL');

// 3. correspondance normalisée (casse/espaces/parenthèses)
const s3 = matchStats([{ iface: 'Wi-Fi2' }], 'Wi-Fi 2', 'Intel Wi-Fi 6 AX201');
ok = ok && !!s3 && s3.iface === 'Wi-Fi2';
console.log('normalized match:', ok ? 'OK' : 'FAIL');

// 4. pas de stats → null (pas de crash)
s = matchStats([], 'Ethernet', null);
ok = ok && s === null;
console.log('empty stats:', ok ? 'OK' : 'FAIL');

// 5. cas réel de Fred (Windows) : stats "Ethernet2" vs iface "Ethernet 2"
const s5 = matchStats([{ iface: 'Ethernet2', rx_sec: 10485760 }], 'Ethernet 2', 'Realtek PCIe GbE Family Controller #2');
ok = ok && !!s5 && s5.rx_sec === 10485760;
console.log('fred windows case:', ok ? 'OK' : 'FAIL', '→ rx_sec', s5 && s5.rx_sec);

if (ok) {
  console.log('TEST PASSED (Windows interface name mismatch handled)');
  process.exit(0);
}
console.error('TEST FAILED');
process.exit(1);
