'use strict';
// Test rapide des collecteurs (sans Electron)
const c = require('../src/main/collectors');
const mods = { cpu: true, memory: true, disks: true, battery: true, network: true, connectivity: true, sensors: true, gpu: true, llm: true, vms: true };
let ticks = 0;
c.start(s => {
  ticks++;
  if (ticks < 3) return; // laisse les modules medium/slow se remplir
  const out = {};
  for (const [k, v] of Object.entries(s.modules)) out[k] = v && v.ok ? 'OK' : JSON.stringify(v);
  console.log('HOST:', JSON.stringify(s.host));
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}, mods);
setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 40000);
