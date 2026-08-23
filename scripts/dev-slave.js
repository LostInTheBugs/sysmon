'use strict';
// Slave de démo (pour test visuel du dashboard) : pousse un snapshot riche
// vers un master local, reste en vie indéfiniment. Ctrl+C pour arrêter.
const path = require('path');
const os = require('os');
const fs = require('fs');

const fakeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'sysmon-demo-'));
require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: {
    app: { getPath: () => fakeUserData, whenReady: () => Promise.resolve() },
    BrowserWindow: class { constructor() {} loadFile() {} on() {} destroy() {} isDestroyed() { return true; } },
    Tray: class { constructor() {} setToolTip() {} setContextMenu() {} },
    Menu: { buildFromTemplate: () => ({}) },
    ipcMain: { handle: () => {} },
    shell: { openExternal: () => {} },
    nativeImage: { createFromDataURL: () => ({}) }
  }
};

const config = require('../src/main/config');
config.set({ mode: 'slave', masterIp: '127.0.0.1', port: 8597, pushIntervalMs: 2000 });

const slave = require('../src/main/slave/client');

let tick = 0;
const fakeSnapshot = () => ({
  timestamp: Date.now(),
  host: { hostname: 'slave-demo', platform: 'linux', distro: 'Ubuntu 24.04', arch: 'x64' },
  modules: {
    cpu: { ok: true, usage: 23 + (tick++ % 30), loadAvg: '0.42 · 0.38 · 0.35', cores: 8, speed: 3.4, temp: 52 },
    memory: { ok: true, usedGB: 6.4, totalGB: 16, usagePct: 40, swapUsedGB: 0.2, swapTotalGB: 2 },
    disks: { ok: true, filesystems: [
      { mount: '/', usedGB: 42, totalGB: 120, usePct: 35 },
      { mount: '/home', usedGB: 210, totalGB: 500, usePct: 42 }
    ], io: { rxMBs: 3.2, wxMBs: 1.1 } },
    gpu: { ok: true, controllers: [{ model: 'NVIDIA GeForce RTX 4070', utilizationPct: 35, memoryUsedGB: 4.2, memoryTotalGB: 12, temperature: 61 }], displays: [{ resolution: '2560x1440' }, { resolution: '1920x1080' }] },
    network: { ok: true, interfaces: [{ iface: 'eth0', ip4: '192.168.1.42', rxMBs: 1.8, txMBs: 0.9, isDefault: true }], wan: { ip: '86.201.12.44', country: 'France', city: 'Paris' }, routes: [{ isDefault: true, gateway: '192.168.1.1' }] },
    battery: { ok: true, present: false },
    sensors: { ok: true, cpuTemp: 52, smart: [{ device: 'sda', status: 'PASSED', temperature: 38 }] },
    llm: { ok: true, detected: true, servers: [{ name: 'llama.cpp :8080', running: [{ model: 'qwen3-14b' }], memoryTotalGB: 8.4 }] },
    connectivity: { ok: true, bluetooth: [], usb: ['USB Keyboard', 'USB Mouse'] },
    vms: { ok: true, hypervisor: 'none', docker: { present: true, version: '27.1.1', running: 3, total: 5, containers: [{ name: 'nginx', cpu: 1.2, mem: 52428800, rx: 1024, tx: 512 }] }, vms: [] }
  }
});

slave.start(fakeSnapshot);
console.log('slave-demo running — push to ws://127.0.0.1:8597/ws every 2s. Ctrl+C to stop.');
setInterval(() => {}, 1000);
