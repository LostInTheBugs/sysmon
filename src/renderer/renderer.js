'use strict';
// SysMon widget — renderer. Reçoit les snapshots via preload et peint les sections.

const $ = sel => document.querySelector(sel);
const content = $('#content');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let config = { modules: {}, mode: 'standalone' };

async function init() {
  content.innerHTML = '<div class="loading">Collecting system info…</div>';
  config = await window.sysmon.getConfig();
  $('#mode-badge').textContent = config.mode;
  $('#mode-badge').className = config.mode;
  $('#btn-settings').addEventListener('click', () => window.sysmon.openSettings());
  $('#btn-close').addEventListener('click', () => window.close());
  window.sysmon.onSnapshot(render);
  window.sysmon.refresh();
}

// --- helpers d'affichage -----------------------------------------------------
function bar(pct, cls = '') {
  const p = Math.max(0, Math.min(100, pct || 0));
  return `<div class="bar"><div class="${p > 85 ? 'bad' : p > 65 ? 'warn' : cls}" style="width:${p}%"></div></div>`;
}
function row(k, v, cls = '') {
  return `<div class="row"><span class="k">${esc(k)}</span><span class="v ${cls}">${esc(v ?? '—')}</span></div>`;
}
function section(title, hint, body) {
  return `<div class="section"><h3>${esc(title)}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</h3>${body}</div>`;
}
function tempCls(t) { return t == null ? '' : t > 80 ? 'bad' : t > 65 ? 'warn' : 'good'; }
function fmtBytes(b) {
  if (b == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + ' ' + u[i];
}

// --- sections ----------------------------------------------------------------
function cpuSection(m) {
  if (!m || !m.ok) return section('CPU', 'unavailable', row('status', 'n/a'));
  const cores = m.perCore || [];
  const coreBars = cores.map(l => `<span class="${l > 85 ? 'hotter' : l > 60 ? 'hot' : ''}" style="opacity:${0.25 + l / 100 * 0.75}"></span>`).join('');
  return section('CPU', `${m.brand}`, `
    ${row('Usage', m.usage + '%', m.usage > 85 ? 'bad' : m.usage > 65 ? 'warn' : '')}
    ${bar(m.usage)}
    ${row('Load avg', m.loadAvg)}
    ${row('Cores', `${m.cores} (${m.physicalCores} phys)${m.speed ? ' @ ' + m.speed + ' GHz' : ''}`)}
    ${row('Temp', m.temp != null ? m.temp + '°C' : '—', tempCls(m.temp))}
    <div class="mini">${coreBars}</div>
  `);
}

function memorySection(m) {
  if (!m || !m.ok) return section('Memory', 'unavailable', row('status', 'n/a'));
  let top = '';
  if (m.top && m.top.length) {
    top = m.top.map(p => row(p.name, `${p.memGB} GB`)).join('');
  }
  return section('Memory', `${m.usedGB} / ${m.totalGB} GB`, `
    ${row('Used', `${m.usedGB} GB (${m.usagePct}%)`, m.usagePct > 85 ? 'bad' : m.usagePct > 65 ? 'warn' : '')}
    ${bar(m.usagePct)}
    ${row('Available', m.availableGB + ' GB')}
    ${row('Swap', `${m.swapUsedGB} / ${m.swapTotalGB} GB`)}
    ${top ? `<div style="margin-top:3px;opacity:0.85">${top}</div>` : ''}
  `);
}

function disksSection(m) {
  if (!m || !m.ok) return section('Disks', 'unavailable', row('status', 'n/a'));
  const rows = m.filesystems.map(f => row(`${f.mount}`, `${f.usedGB} GB / ${f.totalGB} GB (${f.usePct}%)`, f.usePct > 90 ? 'bad' : f.usePct > 75 ? 'warn' : '')).join('');
  const io = m.io ? `I/O ↓${m.io.rxMBs} ↑${m.io.wxMBs} MB/s` : '';
  return section('Disks', io, rows);
}

function batterySection(m) {
  if (!m || !m.ok) return section('Battery', 'unavailable', row('status', 'n/a'));
  if (m.present === false) return section('Battery', 'not present', row('status', 'no battery'));
  const charging = m.isCharging ? '⚡ charging' : m.acConnected ? '🔌 on AC' : '🔋 discharging';
  return section('Battery', charging, `
    ${row('Level', m.percent + '%', m.percent < 20 ? 'bad' : m.percent < 40 ? 'warn' : 'good')}
    ${bar(m.percent)}
    ${row('Time left', m.timeRemaining || '—')}
    ${row('Cycles', m.cycleCount ?? '—')}
    ${row('Health', m.healthPct != null ? m.healthPct + '%' : '—', m.healthPct != null && m.healthPct < 80 ? 'warn' : '')}
    ${row('Capacity', m.currentCapacity != null ? `${m.currentCapacity} mAh / ${m.designCapacity} mAh` : '—')}
    ${row('Temp', m.temperature != null ? m.temperature + '°C' : '—', tempCls(m.temperature))}
    ${row('Voltage', m.voltage != null ? m.voltage + ' V' : '—')}
  `);
}

function networkSection(m) {
  if (!m || !m.ok) return section('Network', 'unavailable', row('status', 'n/a'));
  const ifaces = m.interfaces || [];
  const rows = ifaces.map(i => row(`${i.iface} (${i.ip4 || i.ip6 || ''})${i.isDefault ? ' ⭐' : ''}`,
    `↓${i.rxMBs} ↑${i.txMBs} MB/s`, i.rxMBs > 5 || i.txMBs > 5 ? 'warn' : '')).join('');
  const wan = m.wan;
  const wanTxt = wan && wan.ip ? `${wan.ip}${wan.country ? ' · ' + wan.country : ''}` : '—';
  return section('Network', ifaces.length ? `${ifaces.length} iface(s)` : '', `
    ${rows}
    ${row('WAN', wanTxt)}
    ${m.routes && m.routes.length ? row('Routes', m.routes.length + ' (default: ' + (m.routes.find(r => r.isDefault)?.gateway || '—') + ')') : ''}
  `);
}

function connectivitySection(m) {
  if (!m || !m.ok) return section('Devices', 'unavailable', row('status', 'n/a'));
  const bt = m.bluetooth || [];
  const usb = m.usb || [];
  const btRows = bt.length ? bt.map(d => row(d.name, d.connected ? '✓ connected' : 'off', d.connected ? 'good' : '')).join('') : row('Bluetooth', 'none');
  const usbRows = usb.length ? usb.slice(0, 6).map(d => row(d.name, d.type || '')).join('') : row('USB', 'none');
  return section('Devices', `${bt.length} BT · ${usb.length} USB`, `${btRows}${usbRows}`);
}

function sensorsSection(m) {
  if (!m || !m.ok) return section('Sensors', 'unavailable', row('status', 'n/a'));
  const fans = m.fans && m.fans.length ? m.fans.map(f => row('Fan', f.speedRpm + ' RPM')).join('') : '';
  const smart = m.smart && m.smart.length ? m.smart.map(s => row(s.device, `${s.status || 'n/a'}${s.temperature != null ? ' · ' + s.temperature + '°C' : ''}`, s.status === 'FAILED' ? 'bad' : '')).join('') : '';
  return section('Sensors', m.cpuTemp != null ? `${m.cpuTemp}°C` : '', `
    ${row('CPU temp', m.cpuTemp != null ? m.cpuTemp + '°C' : '—', tempCls(m.cpuTemp))}
    ${fans || row('Fans', '—')}
    ${smart || row('SMART', '—')}
  `);
}

function gpuSection(m) {
  if (!m || !m.ok) return section('GPU', 'unavailable', row('status', 'n/a'));
  return (m.controllers || []).map(c => section('GPU', c.model, `
    ${c.utilizationPct != null ? `${row('Utilization', c.utilizationPct + '%', c.utilizationPct > 85 ? 'bad' : '')}${bar(c.utilizationPct)}` : row('Utilization', '—')}
    ${c.memoryUsedGB != null && c.memoryTotalGB != null ? row('VRAM', `${c.memoryUsedGB} / ${c.memoryTotalGB} GB`) : c.vramGB != null ? row('VRAM', c.vramGB + ' GB') : ''}
    ${c.temperature != null ? row('Temp', c.temperature + '°C', tempCls(c.temperature)) : ''}
    ${row('Displays', (m.displays || []).map(d => d.resolution).filter(Boolean).join(', ') || '—')}
  `)).join('');
}

function llmSection(m) {
  if (!m || !m.ok) return section('LLM', 'unavailable', row('status', 'n/a'));
  if (!m.detected) return section('LLM', 'not detected', row('status', 'no local LLM server'));
  return m.servers.map(s => section('LLM · ' + s.name, s.running && s.running.length ? `${s.running.length} task(s)` : 'idle', `
    ${s.models.length ? s.models.map(md => row(md.id, md.memGB != null ? md.memGB + ' GB' : '')).join('') : row('Models', 'none')}
    ${s.running && s.running.length ? '<div style="margin-top:3px">' + s.running.map(r => row('▶ ' + (r.id || r.prompt || ''), '')).join('') + '</div>' : ''}
    ${s.memoryTotalGB != null ? row('LLM memory', s.memoryTotalGB + ' GB') : ''}
  `)).join('');
}

function vmsSection(m) {
  if (!m || !m.ok) return section('Virtualization', 'unavailable', row('status', 'n/a'));
  const d = m.docker;
  const dockerRows = d && d.present && d.containers.length
    ? d.containers.map(c => row(c.name,
        `${c.cpu != null ? 'CPU ' + c.cpu + '%' : '—'} · ${fmtBytes(c.mem)}${c.rx != null ? ` · ↓${fmtBytes(c.rx)} ↑${fmtBytes(c.tx)}` : ''}`,
        c.cpu != null && c.cpu > 85 ? 'bad' : '')).join('')
    : '';
  const vmRows = (m.vms || []).map(v => {
    const details = [];
    if (v.cpu != null) details.push('CPU ' + v.cpu + '%');
    if (v.memory) details.push(fmtBytes(v.memory));
    if (v.cpus != null) details.push(v.cpus + ' vCPU');
    if (v.adapters != null) details.push(v.adapters + ' NIC');
    return row(`${v.engine} · ${v.name}`, details.join(' · ') || v.state);
  }).join('');
  const hint = d && d.present ? `Docker ${d.version} · ${d.running}/${d.total} run` : (m.vms && m.vms.length ? m.vms.length + ' VM(s)' : '');
  return section('Virtualization', hint, `
    ${m.hypervisor ? row('Hypervisor', m.hypervisor + ' (guest)') : ''}
    ${dockerRows || (!d || !d.present ? row('Docker', 'not installed') : '')}
    ${vmRows}
  `);
}

// --- rendu -------------------------------------------------------------------
function render(snap) {
  try {
    const m = snap.modules || {};
    $('#hostname').textContent = snap.host ? snap.host.hostname : '';
    const u = snap.host ? snap.host.uptime : 0;
    $('#uptime').textContent = u > 0 ? `up ${Math.floor(u / 3600)}h${String(Math.floor(u % 3600 / 60)).padStart(2, '0')}` : '';
    const mods = config.modules || {};
    let html = '';
    if (mods.cpu) html += cpuSection(m.cpu);
    if (mods.memory) html += memorySection(m.memory);
    if (mods.gpu) html += gpuSection(m.gpu);
    if (mods.disks) html += disksSection(m.disks);
    if (mods.battery) html += batterySection(m.battery);
    if (mods.network) html += networkSection(m.network);
    if (mods.sensors) html += sensorsSection(m.sensors);
    if (mods.connectivity) html += connectivitySection(m.connectivity);
    if (mods.llm) html += llmSection(m.llm);
    if (mods.vms) html += vmsSection(m.vms);
    content.innerHTML = html || '<div class="loading">No modules enabled…</div>';
    console.log('[renderer] render ok, snapshot', new Date(snap.timestamp).toISOString());
  } catch (e) {
    console.error('[renderer] render error:', e);
    content.innerHTML = '<div class="loading">Render error: ' + esc(e.message) + '</div>';
  }
}

init();
