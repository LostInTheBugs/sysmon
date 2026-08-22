'use strict';
const si = require('systeminformation');

async function collect() {
  try {
    const b = await si.battery();
    if (!b || !b.hasBattery) return { ok: true, present: false };
    const health = (b.designCapacity && b.maxCapacity)
      ? Math.round((b.maxCapacity / b.designCapacity) * 100)
      : null;
    const hms = s => {
      if (s == null || !isFinite(s)) return null;
      const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
      return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
    };
    return {
      ok: true,
      present: true,
      percent: Math.round(b.percent),
      isCharging: !!b.isCharging,
      acConnected: !!b.acConnected,
      timeRemaining: hms(b.timeRemaining),
      timeRemainingSec: b.timeRemaining,
      cycleCount: b.cycleCount,
      healthPct: health,
      designCapacity: b.designCapacity ? Math.round(b.designCapacity / 1000) : null,
      maxCapacity: b.maxCapacity ? Math.round(b.maxCapacity / 1000) : null,
      currentCapacity: b.currentCapacity ? Math.round(b.currentCapacity / 1000) : null,
      voltage: b.voltage != null ? Math.round(b.voltage * 10) / 10 : null,
      model: b.model || null,
      manufacturer: b.manufacturer || null,
      temperature: b.temperature != null ? Math.round(b.temperature * 10) / 10 : null
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

module.exports = { collect, name: 'battery' };
