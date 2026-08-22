'use strict';
const si = require('systeminformation');

let lastProcs = 0;

async function collect() {
  try {
    const [mem, procs] = await Promise.all([
      si.mem(),
      // processes() is expensive — only refresh top consumers every 30s
      (Date.now() - lastProcs > 30000) ? si.processes().then(p => {
        lastProcs = Date.now();
        return p;
      }) : Promise.resolve(null)
    ]);
    const gb = v => Math.round((v / 1073741824) * 10) / 10;
    let top = null;
    if (procs) {
      top = procs.list
        .filter(p => p.memRss != null)
        .sort((a, b) => b.memRss - a.memRss)
        .slice(0, 5)
        .map(p => ({ pid: p.pid, name: p.name, memGB: gb(p.memRss), cpu: Math.round((p.cpu || 0) * 10) / 10 }));
    }
    return {
      ok: true,
      totalGB: gb(mem.total),
      usedGB: gb(mem.used),
      freeGB: gb(mem.free),
      availableGB: gb(mem.available),
      usagePct: mem.total ? Math.round((mem.used / mem.total) * 100) : null,
      swapTotalGB: gb(mem.swaptotal),
      swapUsedGB: gb(mem.swapused),
      top
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

module.exports = { collect, name: 'memory' };
