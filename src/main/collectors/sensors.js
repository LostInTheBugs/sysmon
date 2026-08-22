'use strict';
const si = require('systeminformation');
const fs = require('fs');
const path = require('path');

let smartCache = {};      // device -> { data, at }
const SMART_TTL = 120000; // 2 min

// si.fans() a été retiré de systeminformation ≥5.33 — lecture hwmon directe (Linux).
function readFans() {
  try {
    const fans = [];
    const base = '/sys/class/hwmon';
    if (!fs.existsSync(base)) return fans;
    for (const hw of fs.readdirSync(base)) {
      const dir = path.join(base, hw);
      for (const f of fs.readdirSync(dir)) {
        if (/^fan\d+_input$/.test(f)) {
          const rpm = parseInt(fs.readFileSync(path.join(dir, f), 'utf8').trim(), 10);
          if (!isNaN(rpm)) fans.push({ speedRpm: rpm });
        }
      }
    }
    return fans;
  } catch {
    return [];
  }
}

async function collect() {
  try {
    const [temp, layout] = await Promise.all([
      si.cpuTemperature(),
      si.diskLayout().catch(() => [])
    ]);
    // SMART: rotate through physical disks, one per tick, cached 2 min
    const smart = [];
    const disks = layout.filter(d => d.device && d.type === 'HDD' || d.device && d.type === 'SSD' || d.device);
    const due = disks.find(d => !smartCache[d.device] || Date.now() - smartCache[d.device].at > SMART_TTL);
    if (due) {
      try {
        const sd = await si.smartData(due.device);
        const j = sd && sd.json;
        smartCache[due.device] = {
          at: Date.now(),
          data: {
            device: due.device,
            status: j && j.smart_status ? (j.smart_status.passed ? 'PASSED' : 'FAILED') : null,
            temperature: j && j.temperature ? j.temperature.current : null,
            powerOnHours: j && j.power_on_time ? j.power_on_time.hours : null,
            powerCycles: j && j.power_cycle_count ? j.power_cycle_count : null
          }
        };
      } catch {
        smartCache[due.device] = { at: Date.now(), data: { device: due.device, status: null } };
      }
    }
    for (const d of disks) if (smartCache[d.device]) smart.push(smartCache[d.device].data);

    return {
      ok: true,
      cpuTemp: temp.main != null ? Math.round(temp.main * 10) / 10 : null,
      cpuTempMax: temp.max != null ? Math.round(temp.max * 10) / 10 : null,
      coresTemp: (temp.cores || []).map(c => Math.round(c * 10) / 10),
      fans: readFans(),
      smart
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

module.exports = { collect, name: 'sensors' };
