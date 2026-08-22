'use strict';
const si = require('systeminformation');
const os = require('os');

let staticCpu = null;

async function staticInfo() {
  if (staticCpu) return staticCpu;
  staticCpu = await si.cpu();
  return staticCpu;
}

async function collect() {
  try {
    const [cpu, load] = await Promise.all([
      staticInfo(),
      si.currentLoad()
    ]);
    const la = os.loadavg();
    return {
      ok: true,
      brand: cpu.brand,
      cores: cpu.cores,
      physicalCores: cpu.physicalCores,
      speed: cpu.speed > 0 ? cpu.speed : null,
      loadAvg: Math.round(la[0] * 10) / 10,
      loadAvg5: Math.round(la[1] * 10) / 10,
      loadAvg15: Math.round(la[2] * 10) / 10,
      usage: Math.round(load.currentLoad * 10) / 10,
      perCore: load.cpus.map(c => Math.round(c.load))
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

module.exports = { collect, name: 'cpu' };
