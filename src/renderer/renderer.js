'use strict';
// SysMon widget — renderer. Reçoit les snapshots via preload et peint les sections.

const $ = sel => document.querySelector(sel);
const content = $('#content');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let config = { modules: {}, mode: 'standalone' };
let histData = null;
let lastSnap = null;
let slavesList = [];

async function init() {
  content.innerHTML = '<div class="loading">' + (window.sysmonI18n ? sysmonI18n.t('widget.loading') : 'Collecting system info…') + '</div>';
  config = await window.sysmon.getConfig();
  if (window.sysmonI18n) sysmonI18n.setLang(config.language);
  applyTheme(config);
  $('#mode-badge').textContent = config.mode;
  $('#mode-badge').className = config.mode;
  $('#btn-settings').addEventListener('click', () => window.sysmon.openSettings());
  $('#btn-close').addEventListener('click', () => window.close());
  $('#btn-charts').addEventListener('click', async () => {
    await window.sysmon.setConfig({ chartMode: config.chartMode === 'history' ? 'instant' : 'history' });
    refreshHistory();
  });
  window.sysmon.onSnapshot(render);
  window.sysmon.onSlaves(list => { slavesList = list; render(lastSnap); });
  window.sysmon.onConfig(cfg => { config = cfg; applyTheme(cfg); render(lastSnap); });
  window.sysmon.refresh();
  // En mode courbes, on recharge l'historique périodiquement
  setInterval(refreshHistory, 5000);
  refreshHistory();
}

async function refreshHistory() {
  try {
    histData = await window.sysmon.getHistory();
    if (config.chartMode === 'history') render(null);
  } catch { /* main pas encore prêt */ }
}

// --- thème / accent (appliqué en direct depuis les paramètres) ---------------
function applyTheme(cfg) {
  document.body.dataset.theme = cfg.theme || 'dark';
  document.body.classList.toggle('compact', cfg.theme === 'compact');
  document.body.style.setProperty('--accent', cfg.accent || '#4fc3f7');
  $('#btn-charts').textContent = cfg.chartMode === 'history' ? '📈' : '📊';
  $('#btn-charts').title = cfg.chartMode === 'history' ? 'Courbes historiques — clic pour instantané' : 'Instantané — clic pour courbes historiques';
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
    ${row('Cores', `${m.cores} (${m.physicalCores} phys)${m.speedLive || m.speed ? ' @ ' + (m.speedLive || m.speed) + ' GHz' : ''}`)}
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
// Courbe SVG (aire + ligne + dernière valeur) depuis une série {ts, v}
function svgChart(series, opts = {}) {
  const { h = 60, max = null, digits = 0, suffix = '', cls = '' } = opts;
  if (!series || series.length < 2) return '<div class="chart-empty">collecting…</div>';
  const w = 320;
  const pts = series.slice(-150);
  const vals = pts.map(p => p.v);
  const maxV = max != null ? max : (Math.max(...vals) || 1) * 1.15;
  const minV = Math.min(0, ...vals);
  const x = i => (i / (pts.length - 1)) * w;
  const y = v => h - ((v - minV) / (maxV - minV)) * (h - 4) - 2;
  const line = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  const lastV = pts[pts.length - 1].v;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="chart ${cls}">
    <path class="fill" d="${area}"/>
    <path class="line" d="${line}"/>
    <text class="last" x="${w}" y="${h - 1}" text-anchor="end">${lastV.toFixed(digits)}${suffix}</text>
  </svg>`;
}

function chartSection(title, hint, series, opts) {
  return section(title, hint, svgChart(series, opts));
}

// Mode "courbes historiques" : un graphique par métrique des modules activés
function renderHistory() {
  const mods = config.modules || {};
  const s = (histData && histData.series) || {};
  const host = histData ? histData.host : '';
  $('#hostname').textContent = host;
  $('#uptime').textContent = '';
  let html = '';
  if (mods.cpu) {
    html += chartSection('CPU usage', '', s.cpu, { suffix: '%', digits: 0 });
    html += chartSection('CPU frequency', '', s.cpuSpeed, { suffix: ' GHz', digits: 2, cls: 'spd' });
  }
  if (mods.memory) html += chartSection('Memory', '', s.mem, { suffix: '%', digits: 0 });
  if (mods.gpu) html += chartSection('GPU', '', s.gpu, { suffix: '%', digits: 0 });
  if (mods.network) {
    html += section('Network', '', `
      <div class="legend"><span class="lg rx"></span>↓ in <span class="lg tx"></span>↑ out</div>
      ${svgChart(s.netRx, { suffix: ' MB/s ↓', digits: 1, cls: 'rx' })}
      ${svgChart(s.netTx, { suffix: ' MB/s ↑', digits: 1, cls: 'tx' })}`);
  }
  if (mods.sensors) html += chartSection('Temperature', '', s.temp, { suffix: '°C', digits: 1, cls: 'temp' });
  if (mods.battery) html += chartSection('Battery', '', s.batt, { suffix: '%', digits: 0, cls: 'batt' });
  html += slavesSection();
  content.innerHTML = html || '<div class="loading">No modules enabled…</div>';
  console.log('[renderer] history render ok');
}

// Bloc SLAVES (visible uniquement sur le master) : état + résumé de chaque slave
function slavesSection() {
  if (config.mode !== 'master' || !slavesList.length) return '';
  const t = window.sysmonI18n ? sysmonI18n.t : k => k;
  const rows = slavesList.map(s => {
    const dot = s.connected ? 'on' : '';
    const vals = [];
    if (s.summary) {
      if (s.summary.cpu != null) vals.push('CPU ' + s.summary.cpu + '%');
      if (s.summary.mem != null) vals.push('RAM ' + s.summary.mem + '%');
      if (s.summary.temp != null) vals.push(s.summary.temp + '°C');
    }
    const sub = s.status === 'pending' ? t('slaves.pending') : vals.join(' · ') || (s.status === 'approved' ? t('slaves.waiting') : s.status);
    return `<div class="row"><span class="dot ${dot}"></span><span class="lbl">${esc(s.name)}</span><span class="val ${s.status === 'pending' ? 'warn' : ''}">${esc(sub)}</span></div>`;
  }).join('');
  return section(t('slaves.title'), slavesList.length + (slavesList.length > 1 ? ' machines' : ' machine'), rows);
}

function render(snap) {
  if (snap) lastSnap = snap;
  snap = lastSnap;
  if (config.chartMode === 'history') { renderHistory(); return; }
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
    html += slavesSection();
    content.innerHTML = html || '<div class="loading">No modules enabled…</div>';
    console.log('[renderer] render ok, snapshot', new Date(snap.timestamp).toISOString());
  } catch (e) {
    console.error('[renderer] render error:', e);
    content.innerHTML = '<div class="loading">Render error: ' + esc(e.message) + '</div>';
  }
}

init();
