'use strict';
// Fenêtre de réglages SysMon.

const MODULE_LABELS = {
  cpu: 'CPU', memory: 'Memory', disks: 'Disks', battery: 'Battery',
  network: 'Network', connectivity: 'Devices (BT/USB)', sensors: 'Sensors',
  gpu: 'GPU', llm: 'LLM'
};

let config = null;

const $ = sel => document.querySelector(sel);

async function load() {
  config = await window.sysmon.getConfig();
  $('#mode').value = config.mode;
  $('#webAccess').checked = !!config.webAccess;
  $('#autoApproveSlaves').checked = !!config.autoApproveSlaves;
  $('#port').value = config.port;
  $('#masterIp').value = config.masterIp || '';
  updateModeUI();
  renderModules();
  refreshSlaves();
}

function updateModeUI() {
  const mode = $('#mode').value;
  $('#master-options').style.display = mode === 'master' ? 'block' : 'none';
  $('#slave-options').style.display = mode === 'slave' ? 'block' : 'none';
}

function renderModules() {
  const box = $('#modules');
  box.innerHTML = '';
  for (const [key, label] of Object.entries(MODULE_LABELS)) {
    const div = document.createElement('div');
    div.className = 'check';
    div.innerHTML = `<span>${label}</span><input type="checkbox" data-module="${key}" ${config.modules[key] ? 'checked' : ''} />`;
    box.appendChild(div);
  }
}

async function refreshSlaves() {
  const box = $('#slaves');
  if ($('#mode').value !== 'master') {
    box.innerHTML = '<div class="hint">Only visible in master mode.</div>';
    return;
  }
  const list = await window.sysmon.listSlaves();
  if (!list.length) {
    box.innerHTML = '<div class="hint">No slaves yet — start SysMon in slave mode on another machine.</div>';
    return;
  }
  box.innerHTML = '';
  for (const s of list) {
    const div = document.createElement('div');
    div.className = 'slave';
    div.innerHTML = `
      <div>
        <div class="name">${s.name}</div>
        <div class="meta">${s.hostname} · ${s.platform} · ${s.ip}${s.connected ? ' · online' : ' · offline'}</div>
      </div>
      <span class="badge ${s.status}">${s.status}</span>
      <div class="actions">
        ${s.status !== 'approved' ? `<button data-act="approve" data-id="${s.id}">Approve</button>` : ''}
        ${s.status !== 'rejected' ? `<button data-act="reject" data-id="${s.id}">Reject</button>` : ''}
        <button data-act="remove" data-id="${s.id}">Remove</button>
      </div>`;
    div.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await window.sysmon.setSlave(btn.dataset.id, btn.dataset.act);
        refreshSlaves();
      });
    });
    box.appendChild(div);
  }
}

$('#mode').addEventListener('change', updateModeUI);
$('#save').addEventListener('click', async () => {
  const status = $('#status');
  try {
    const modules = {};
    document.querySelectorAll('input[data-module]').forEach(cb => { modules[cb.dataset.module] = cb.checked; });
    config = await window.sysmon.setConfig({
      mode: $('#mode').value,
      webAccess: $('#webAccess').checked,
      autoApproveSlaves: $('#autoApproveSlaves').checked,
      port: parseInt($('#port').value, 10) || 8597,
      masterIp: $('#masterIp').value.trim(),
      modules
    });
    status.className = 'status ok';
    status.textContent = 'Saved and applied.';
    refreshSlaves();
  } catch (e) {
    status.className = 'status err';
    status.textContent = 'Error: ' + e.message;
  }
});

load();
