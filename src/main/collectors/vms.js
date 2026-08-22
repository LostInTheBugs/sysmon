'use strict';
// Virtualisation & Docker — hyperviseur courant (si on est dans une VM),
// conteneurs Docker (CPU/mémoire/réseau par conteneur),
// machines virtuelles locales (Hyper-V, VMware Workstation, VirtualBox, QEMU/KVM).
// Chaque sous-détection est best-effort : un échec ne fait jamais tomber le module.

const si = require('systeminformation');
const { exec } = require('child_process');
const fs = require('fs');

function run(cmd, timeoutMs = 3500) {
  return new Promise(resolve => {
    exec(cmd, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve(err ? String(stderr || '') : String(stdout));
    });
  });
}

// --------------------------------------------------------------- Docker ------
async function dockerData() {
  const [info, containers] = await Promise.all([
    si.dockerInfo().catch(() => null),
    si.dockerContainers().catch(() => [])
  ]);
  if (!info || !info.version) return { present: false };
  return {
    present: true,
    version: String(info.version),
    running: info.containersRunning || 0,
    total: info.containers || 0,
    images: info.images || 0,
    containers: (containers || [])
      .filter(c => c.state === 'running')
      .map(c => ({
        name: c.name,
        cpu: c.cpuPercent,
        mem: c.memUsage,
        rx: c.netIO ? c.netIO.rx : null,
        tx: c.netIO ? c.netIO.tx : null
      }))
      .slice(0, 12)
  };
}

// ------------------------------------------------------------- Hyper-V ------
async function hyperv() {
  if (process.platform !== 'win32') return [];
  const out = await run('powershell -NoProfile -Command "Get-VM | Select-Object Name,State,CPUUsage,MemoryAssigned,@{n=\'Adapters\';e={(@(Get-VMNetworkAdapter -VMName $_.Name -ErrorAction SilentlyContinue | Where-Object Status -eq \'Ok\')).Count}} | ConvertTo-Json -Compress"', 6000);
  if (!out.trim()) return [];
  try {
    const parsed = JSON.parse(out.trim());
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .filter(v => v && v.Name)
      .map(v => ({
        name: v.Name,
        state: String(v.State || '').toLowerCase(),
        cpu: v.CPUUsage != null ? v.CPUUsage : null,
        memory: v.MemoryAssigned || null,
        adapters: v.Adapters || 0
      }));
  } catch { return []; }
}

// ------------------------------------------------------ VMware Workstation --
async function vmware() {
  const isWin = process.platform === 'win32';
  const out = isWin
    ? await run('tasklist /FI "IMAGENAME eq vmware-vmx.exe" /FO CSV /NH')
    : await run('pgrep -a vmware-vmx');
  if (!out.trim()) return { running: 0, memory: 0 };
  const lines = out.trim().split(/\r?\n/).filter(Boolean);
  const pids = isWin
    ? lines.map(l => (l.match(/"vmware-vmx\.exe","(\d+)"/) || [])[1]).filter(Boolean)
    : lines.map(l => (l.match(/^(\d+)/) || [])[1]).filter(Boolean);
  let memory = 0;
  for (const pid of pids.slice(0, 5)) {
    if (isWin) {
      const w = await run(`wmic process where processid=${pid} get WorkingSetSize /value`, 2000);
      const m = w.match(/WorkingSetSize=(\d+)/);
      if (m) memory += parseInt(m[1], 10);
    } else {
      try {
        const statm = fs.readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ');
        memory += parseInt(statm[1], 10) * 4096; // RSS pages × 4096
      } catch { /* pid disparu */ }
    }
  }
  return { running: pids.length, memory };
}

// ------------------------------------------------------------ VirtualBox ----
async function virtualbox() {
  const out = await run('VBoxManage list runningvms --long');
  if (!out.trim()) return [];
  const vms = [];
  for (const b of out.split(/\n(?=Name:)/)) {
    const name = (b.match(/^Name:\s+(.+)$/m) || [])[1];
    if (!name) continue;
    const mem = (b.match(/^Memory size:\s+(\d+)MB/m) || [])[1];
    const cpus = (b.match(/^Number of CPUs:\s+(\d+)/m) || [])[1];
    vms.push({
      name,
      state: 'running',
      cpus: cpus ? parseInt(cpus, 10) : null,
      memory: mem ? parseInt(mem, 10) * 1024 * 1024 : null
    });
  }
  return vms;
}

// ----------------------------------------------------------- QEMU / KVM -----
async function qemu() {
  const out = await run('pgrep -a qemu-system');
  const lines = out.trim().split(/\r?\n/).filter(Boolean);
  const vms = [];
  for (const l of lines) {
    const pid = (l.match(/^(\d+)/) || [])[1];
    if (!pid) continue;
    const name = (l.match(/-name\s+([^\s,]+)/) || [])[1] || `qemu-${pid}`;
    const mm = l.match(/-m\s+(\d+)/);
    const cc = l.match(/-smp\s+(\d+)/);
    vms.push({
      name,
      state: 'running',
      cpus: cc ? parseInt(cc[1], 10) : null,
      memory: mm ? parseInt(mm[1], 10) * 1024 * 1024 : null
    });
  }
  return vms;
}

// ------------------------------------------------- hyperviseur courant ------
// systeminformation a retiré virtualization() en 5.33 — détection maison.
async function detectHypervisor() {
  const p = process.platform;
  if (p === 'linux') {
    const v = await run('systemd-detect-virt 2>/dev/null || true');
    const name = v.trim().toLowerCase();
    if (name && name !== 'none') return { hypervisor: name };
    try {
      const vendor = fs.readFileSync('/sys/class/dmi/id/sys_vendor', 'utf8').trim();
      const product = fs.readFileSync('/sys/class/dmi/id/product_name', 'utf8').trim();
      const s = (vendor + ' ' + product).toLowerCase();
      if (s.includes('vmware')) return { hypervisor: 'VMware' };
      if (s.includes('qemu') || s.includes('kvm')) return { hypervisor: 'KVM/QEMU' };
      if (s.includes('microsoft')) return { hypervisor: 'Hyper-V' };
      if (s.includes('virtualbox') || s.includes('innotek')) return { hypervisor: 'VirtualBox' };
      if (s.includes('xen')) return { hypervisor: 'Xen' };
    } catch { /* pas de DMI */ }
    return { hypervisor: null };
  }
  if (p === 'win32') {
    const out = await run('powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model | ConvertTo-Json -Compress)"', 4000);
    try {
      const j = JSON.parse(out.trim());
      const s = ((j.Manufacturer || '') + ' ' + (j.Model || '')).toLowerCase();
      if (s.includes('vmware')) return { hypervisor: 'VMware' };
      if (s.includes('microsoft')) return { hypervisor: 'Hyper-V' };
      if (s.includes('virtualbox') || s.includes('innotek')) return { hypervisor: 'VirtualBox' };
      if (s.includes('qemu')) return { hypervisor: 'QEMU' };
    } catch { /* parse échoué */ }
    return { hypervisor: null };
  }
  if (p === 'darwin') {
    const out = await run('sysctl -n machdep.cpu.brand_string 2>/dev/null || true');
    const s = out.toLowerCase();
    if (s.includes('vmware')) return { hypervisor: 'VMware' };
    if (s.includes('qemu')) return { hypervisor: 'QEMU' };
    if (s.includes('virtual')) return { hypervisor: 'VM' };
    return { hypervisor: null };
  }
  return { hypervisor: null };
}

// ---------------------------------------------------------------- module ----
function prettyHypervisor(h) {
  if (!h) return null;
  const map = {
    kvm: 'KVM', qemu: 'QEMU', vmware: 'VMware', microsoft: 'Hyper-V',
    hyperv: 'Hyper-V', virtualbox: 'VirtualBox', vbox: 'VirtualBox',
    xen: 'Xen', oracle: 'VirtualBox', none: null, '': null
  };
  return map[h.toLowerCase()] || h;
}

async function collect() {
  try {
    const [virt, docker, hv, vw, vb, q] = await Promise.all([
      detectHypervisor(),
      dockerData(),
      hyperv(),
      vmware(),
      virtualbox(),
      qemu()
    ]);
    const vms = [];
    for (const v of hv) vms.push({ engine: 'Hyper-V', ...v });
    if (vw.running > 0) {
      vms.push({ engine: 'VMware Workstation', name: `${vw.running} VM(s) en cours`, state: 'running', memory: vw.memory });
    }
    for (const v of vb) vms.push({ engine: 'VirtualBox', ...v });
    for (const v of q) vms.push({ engine: 'QEMU/KVM', ...v });
    return {
      ok: true,
      hypervisor: prettyHypervisor(virt.hypervisor),
      docker,
      vms
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

module.exports = { name: 'vms', collect };
