'use strict';
const si = require('systeminformation');

async function collect() {
  try {
    const [usb, bt] = await Promise.all([
      si.usb().catch(() => []),
      si.bluetoothDevices().catch(() => [])
    ]);
    return {
      ok: true,
      usb: usb.map(d => ({
        name: d.name, vendor: d.vendor || d.manufacturer, type: d.type,
        serial: d.serial, removable: !!d.removable
      })).filter(d => d.name),
      bluetooth: bt.map(d => ({
        name: d.name, mac: d.macAddress, type: d.type,
        connected: String(d.connectionState).toLowerCase().includes('connect') || d.connectionState === true,
        rssi: d.rssi != null ? d.rssi : null
      })).filter(d => d.name)
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

module.exports = { collect, name: 'connectivity' };
