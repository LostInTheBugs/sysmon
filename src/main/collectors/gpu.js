'use strict';
const si = require('systeminformation');

let staticGfx = null;

async function collect() {
  try {
    const g = staticGfx ? staticGfx : await si.graphics();
    if (!staticGfx) staticGfx = g;
    return {
      ok: true,
      controllers: (g.controllers || []).map(c => ({
        model: c.model, vendor: c.vendor, vramGB: c.vram != null ? Math.round(c.vram / 1024 * 10) / 10 : null,
        driver: c.driverVersion,
        utilizationPct: c.utilizationGpu != null ? Math.round(c.utilizationGpu) : null,
        temperature: c.temperatureGpu != null ? Math.round(c.temperatureGpu * 10) / 10 : null,
        fanSpeed: c.fanSpeed != null ? Math.round(c.fanSpeed) : null,
        memoryUsedGB: c.memoryUsed != null ? Math.round(c.memoryUsed / 1024 * 10) / 10 : null,
        memoryTotalGB: c.memoryTotal != null ? Math.round(c.memoryTotal / 1024 * 10) / 10 : null
      })),
      displays: (g.displays || []).map(d => ({
        model: d.model, vendor: d.vendor, connection: d.connection,
        resolution: d.currentResX && d.currentResY ? `${d.currentResX}x${d.currentResY}` : (d.resolutionX && d.resolutionY ? `${d.resolutionX}x${d.resolutionY}` : null),
        refreshRate: d.currentRefreshRate || d.refreshRate || null,
        main: !!d.main
      }))
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

module.exports = { collect, name: 'gpu' };
