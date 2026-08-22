'use strict';
const si = require('systeminformation');

let staticDisks = null;

async function collect() {
  try {
    const [fsSize, stats, layout] = await Promise.all([
      si.fsSize(),
      si.fsStats(),
      staticDisks ? Promise.resolve(staticDisks) : si.diskLayout().then(d => { staticDisks = d; return d; })
    ]);
    const gb = v => Math.round((v / 1073741824) * 10) / 10;
    return {
      ok: true,
      filesystems: fsSize.map(f => ({
        fs: f.fs, mount: f.mount, type: f.type,
        totalGB: gb(f.size), usedGB: gb(f.used), availableGB: gb(f.available),
        usePct: Math.round(f.use), rw: !!f.rw
      })),
      io: { rxMBs: Math.round((stats.rx_sec || 0) / 1048576 * 10) / 10, wxMBs: Math.round((stats.wx_sec || 0) / 1048576 * 10) / 10 },
      physical: layout.map(d => ({
        device: d.device, name: d.name, type: d.type, vendor: d.vendor,
        sizeGB: gb(d.size), interfaceType: d.interfaceType, smartStatus: d.smartStatus
      }))
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

module.exports = { collect, name: 'disks' };
