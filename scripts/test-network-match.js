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

// 6. débit calculé depuis les octets quand rx_sec = 0 (compteurs perf cassés)
const { computeRates } = require('../src/main/collectors/network');
const t0 = Date.now();
// 20 Mo reçus en 2 s → 10 MB/s
let r = computeRates({ rx: 0, tx: 0, at: t0 - 2000 }, { rx_bytes: 20971520, tx_bytes: 0, rx_sec: 0, tx_sec: 0 }, t0);
ok = ok && r.rxMBs === 10;
console.log('byte-delta rate:', ok ? 'OK' : 'FAIL', '→ rxMBs', r.rxMBs);
// repli rx_sec quand les octets ne bougent pas
r = computeRates({ rx: 100, tx: 100, at: t0 - 2000 }, { rx_bytes: 100, tx_bytes: 100, rx_sec: 5242880, tx_sec: 0 }, t0);
ok = ok && r.rxMBs === 5;
console.log('rx_sec fallback:', ok ? 'OK' : 'FAIL', '→ rxMBs', r.rxMBs);

// 7. parsing Get-NetAdapterStatistics (PowerShell → JSON)
const { parseAdapterStats } = require('../src/main/collectors/network');
let parsed = parseAdapterStats('[{"Name":"Ethernet 2","ReceivedBytes":10485760,"SentBytes":5242880},{"Name":"Wi-Fi","ReceivedBytes":0,"SentBytes":0}]');
ok = ok && parsed.length === 2 && parsed[0].iface === 'Ethernet 2' && parsed[0].rx_bytes === 10485760;
console.log('adapter stats parse:', ok ? 'OK' : 'FAIL', '→', parsed[0] && parsed[0].iface, parsed[0] && parsed[0].rx_bytes);
// cas objet unique (pas de tableau)
parsed = parseAdapterStats('{"Name":"Ethernet 2","ReceivedBytes":1,"SentBytes":2}');
ok = ok && parsed.length === 1 && parsed[0].rx_bytes === 1;
console.log('adapter stats single:', ok ? 'OK' : 'FAIL');

// 8. parsing netstat -e (EN + FR)
const { parseNetstatTotals } = require('../src/main/collectors/network');
let nst = parseNetstatTotals('Interface Statistics\n\n                    Received    Sent\nBytes              12345678    87654321\nUnicast packets    1234        5678\n');
ok = ok && !!nst && nst.rx_bytes === 12345678 && nst.tx_bytes === 87654321;
console.log('netstat EN:', ok ? 'OK' : 'FAIL', '→ rx', nst && nst.rx_bytes, 'tx', nst && nst.tx_bytes);
nst = parseNetstatTotals('Statistiques d\'interface\n\n                    Reçus       Envoyés\nOctets              111111      222222\nPaquets unicast     33          44\n');
ok = ok && !!nst && nst.rx_bytes === 111111 && nst.tx_bytes === 222222;
console.log('netstat FR:', ok ? 'OK' : 'FAIL', '→ rx', nst && nst.rx_bytes, 'tx', nst && nst.tx_bytes);
nst = parseNetstatTotals('rien du tout');
ok = ok && nst === null;
console.log('netstat empty:', ok ? 'OK' : 'FAIL');

// 9. filtre des interfaces macOS (awdl0/llw0/utun*) + IP link-local
const { isUsefulIface } = require('../src/main/collectors/network');
const macIfaces = [
  { iface: 'en0', ip4: '192.168.27.2', internal: false, virtual: false },
  { iface: 'awdl0', ip6: 'fe80::1234', internal: false, virtual: false },
  { iface: 'llw0', ip6: 'fe80::5678', internal: false, virtual: false },
  { iface: 'utun3', ip6: 'fe80::9abc', internal: false, virtual: false },
  { iface: 'lo0', ip4: '127.0.0.1', internal: true, virtual: false }
];
ok = ok && macIfaces.filter(isUsefulIface).length === 1 && macIfaces.filter(isUsefulIface)[0].iface === 'en0';
console.log('mac iface filter:', ok ? 'OK' : 'FAIL', '→', macIfaces.filter(isUsefulIface).map(i => i.iface).join(','));

// 10. parsing netstat -ib (macOS — vrai output du MacBook de Fred)
const { parseNetstatIB } = require('../src/main/collectors/network');
const macNetstat = `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
en0        1500  <Link#13>   8e:a8:b4:50:97:96 31545196     0 43396747262  6590740     0 2393761073     0
en0        1500  macbook-air fe80:d::14da:6a12 31545196     - 43396747262  6590740     - 2393761073     -
utun4      1380  <Link#18>                      1234567     0  40114604411  2345678     0  1888937232     0
awdl0      1500  <Link#14>   f2:43:86:02:df:ed        0     0          0        0     0          0     0`;
const ib = parseNetstatIB(macNetstat);
ok = ok && ib.length === 3 && ib[0].iface === 'en0' && ib[0].rx_bytes === 43396747262 && ib[0].tx_bytes === 2393761073
  && ib[1].iface === 'utun4' && ib[1].rx_bytes === 40114604411 && ib[1].tx_bytes === 1888937232;
console.log('netstat -ib parse:', ok ? 'OK' : 'FAIL', '→', ib.map(i => i.iface + ':' + i.rx_bytes).join(' '));

if (ok) {
  console.log('TEST PASSED (Windows interface name mismatch handled)');
  process.exit(0);
}
console.error('TEST FAILED');
process.exit(1);
