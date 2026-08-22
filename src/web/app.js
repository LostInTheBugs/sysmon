'use strict';
// SysMon web dashboard — se connecte en WebSocket au master,
// affiche le master + tous les slaves approuvés, permet la validation.

const hostsEl = document.getElementById('hosts');
const connEl = document.getElementById('conn');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = v => v ?? '—';

function row(k, v, cls = '') { return `<div class="row"><span class="k">${esc(k)}</span><span class="v ${cls}">${fmt(v)}</span></div>`; }
function bar(pct) {
  const p = Math.max(0, Math.min(100, pct || 0));
  return `<div class="bar"><div class="${p > 85 ? 'bad' : p > 65 ? 'warn' : ''}" style="width:${p}%"></div></div>`;
}
function modTitle(t) { return `<div class="mod-title">${esc(t)}</div>`; }

function hostCard(name, h, online) {
  const m = h.modules || {};
  let html = `<div class="host"><h2><span class="dot ${online ? 'on' : ''}"></span>${esc(name)}</h2>`;
  html += `<div class="sub">${esc(h.host ? [h.host.platform, h.host.distro, h.host.arch, h.host.kernel].filter(Boolean).join(' · ') : '')} · ${esc(h.host ? h.host.hostname : '')}</div><div class="grid">`;

  const cpu = m.cpu;
  if (cpu && cpu.ok) {
    html += modTitle('CPU') + row('Usage', cpu.usage + '%', cpu.usage > 85 ? 'bad' : cpu.usage > 65 ? 'warn' : '') + bar(cpu.usage)
      + row('Load', cpu.loadAvg) + row('Cores', `${cpu.cores}${cpu.speed ? ' @ ' + cpu.speed + ' GHz' : ''}`)
      + (cpu.temp != null ? row('Temp', cpu.temp + '°C', cpu.temp > 80 ? 'bad' : '') : '');
  }
  const mem = m.memory;
  if (mem && mem.ok) {
    html += modTitle('Memory') + row('Used', `${mem.usedGB} / ${mem.totalGB} GB (${mem.usagePct}%)`, mem.usagePct > 85 ? 'bad' : mem.usagePct > 65 ? 'warn' : '') + bar(mem.usagePct)
      + row('Swap', `${mem.swapUsedGB} / ${mem.swapTotalGB} GB`);
  }
  const gpu = m.gpu;
  if (gpu && gpu.ok && gpu.controllers && gpu.controllers.length) {
    for (const c of gpu.controllers) {
      html += modTitle('GPU') + row('Model', c.model)
        + (c.utilizationPct != null ? row('Utilization', c.utilizationPct + '%', c.utilizationPct > 85 ? 'bad' : '') + bar(c.utilizationPct) : '')
        + (c.memoryUsedGB != null && c.memoryTotalGB != null ? row('VRAM', `${c.memoryUsedGB} / ${c.memoryTotalGB} GB`) : '')
        + (c.temperature != null ? row('Temp', c.temperature + '°C') : '')
        + row('Displays', (gpu.displays || []).map(d => d.resolution).filter(Boolean).join(', ') || '—');
    }
  }
  const disks = m.disks;
  if (disks && disks.ok) {
    html += modTitle('Disks');
    for (const f of disks.filesystems) {
      html += row(f.mount, `${f.usedGB} / ${f.totalGB} GB (${f.usePct}%)`, f.usePct > 90 ? 'bad' : f.usePct > 75 ? 'warn' : '') + bar(f.usePct);
    }
    html += row('I/O', `↓${disks.io.rxMBs} ↑${disks.io.wxMBs} MB/s`);
  }
  const bat = m.battery;
  if (bat && bat.ok && bat.present) {
    html += modTitle('Battery') + row('Level', bat.percent + '%', bat.percent < 20 ? 'bad' : '') + bar(bat.percent)
      + row('State', bat.isCharging ? 'charging' : bat.acConnected ? 'on AC' : 'discharging')
      + row('Time left', bat.timeRemaining || '—') + row('Cycles', bat.cycleCount ?? '—')
      + row('Health', bat.healthPct != null ? bat.healthPct + '%' : '—', bat.healthPct != null && bat.healthPct < 80 ? 'warn' : '');
  }
  const net = m.network;
  if (net && net.ok) {
    html += modTitle('Network');
    for (const i of net.interfaces) {
      html += row(i.iface + ' (' + (i.ip4 || '') + ')', `↓${i.rxMBs} ↑${i.txMBs} MB/s${i.isDefault ? ' ⭐' : ''}`);
    }
    if (net.wan && net.wan.ip) html += row('WAN', `${net.wan.ip}${net.wan.country ? ' · ' + net.wan.country : ''}${net.wan.city ? ' · ' + net.wan.city : ''}`);
    if (net.routes && net.routes.length) html += row('Routes', net.routes.filter(r => r.isDefault).map(r => r.gateway).join(', ') || net.routes.length + ' routes');
  }
  const sens = m.sensors;
  if (sens && sens.ok && (sens.cpuTemp != null || (sens.smart || []).length)) {
    html += modTitle('Sensors') + (sens.cpuTemp != null ? row('CPU temp', sens.cpuTemp + '°C') : '');
    for (const s of sens.smart || []) html += row('SMART ' + s.device, `${s.status || 'n/a'}${s.temperature != null ? ' · ' + s.temperature + '°C' : ''}`, s.status === 'FAILED' ? 'bad' : '');
  }
  const llm = m.llm;
  if (llm && llm.ok && llm.detected) {
    html += modTitle('LLM');
    for (const s of llm.servers) {
      html += row(s.name, (s.running || []).length + ' task(s)');
      if (s.memoryTotalGB != null) html += row('LLM memory', s.memoryTotalGB + ' GB');
    }
  }
  html += '</div></div>';
  return html;
}

function renderSlavesBar(slaves) {
  const pending = (slaves || []).filter(s => s.status === 'pending');
  const barEl = document.getElementById('slaves-bar');
  if (!pending.length) {
    if (barEl) barEl.remove();
    return;
  }
  if (!barEl) {
    const el = document.createElement('div');
    el.id = 'slaves-bar';
    el.className = 'slaves-bar';
    document.querySelector('main').prepend(el);
    renderSlavesBar(slaves);
    return;
  }
  barEl.innerHTML = '';
  for (const s of pending) {
    const div = document.createElement('div');
    div.className = 'slave-card';
    div.innerHTML = `<span class="badge pending">pending</span><span>${esc(s.name)}</span><span class="meta">${esc(s.ip || '')}</span>
      <button data-id="${s.id}" data-act="approve">✓ Approve</button><button data-id="${s.id}" data-act="reject">✕ Reject</button>`;
    div.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch(`/api/slaves/${btn.dataset.id}/${btn.dataset.act}`, { method: 'POST' });
      });
    });
    barEl.appendChild(div);
  }
}

function render(data) {
  if (!data) return;
  if (data.type === 'slaves') { renderSlavesBar(data.list); return; }
  if (data.type !== 'snapshots') return;
  let html = '';
  for (const [id, h] of Object.entries(data.hosts || {})) {
    const online = !!h.timestamp;
    html += hostCard(h.name || id, h, online);
  }
  hostsEl.innerHTML = html || '<div style="color:#7f8ea3;padding:20px">No data yet…</div>';
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => { connEl.textContent = '● live'; connEl.className = 'conn on'; ws.send(JSON.stringify({ type: 'subscribe' })); };
  ws.onmessage = e => { try { render(JSON.parse(e.data)); } catch { /* ignore */ } };
  ws.onclose = () => { connEl.textContent = '● disconnected — retrying…'; connEl.className = 'conn off'; setTimeout(connect, 3000); };
  ws.onerror = () => ws.close();
}
connect();
