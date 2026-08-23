'use strict';
// Fenêtre de paramètres SysMon (refonte — FR, cartes, toggles).

const MODULE_LABELS = {
  cpu: 'CPU', memory: 'Mémoire', disks: 'Disques', battery: 'Batterie',
  network: 'Réseau', connectivity: 'Périphériques (BT/USB)', sensors: 'Sondes',
  gpu: 'GPU', llm: 'LLM (serveurs locaux)', vms: 'Virtualisation / Docker'
};

let config = null;
let lastSlavesSig = '';
const $ = sel => document.querySelector(sel);

async function load() {
  config = await window.sysmon.getConfig();
  updateModeUI(config.mode);
  renderModules();
  refreshSlaves();
  $('#port').value = config.port;
  $('#webAccess').checked = !!config.webAccess;
  $('#autoApproveSlaves').checked = !!config.autoApproveSlaves;
  $('#masterIp').value = config.masterIp || '';
  $('#logLevel').value = config.logLevel || 'debug';
  $('#accent').value = config.accent || '#4fc3f7';
  $('#chartMode').value = config.chartMode || 'instant';
  $('#historyEnabled').checked = config.historyEnabled !== false;
  $('#historyMinutes').value = String(config.historyMinutes || 30);
  const bar = config.barMode || {};
  $('#barEnabled').checked = !!bar.enabled;
  $('#barMetric').value = bar.metric || 'cpu';
  applyTheme(config);
}

// --- thème : aperçu en direct, persisté au clic sur Enregistrer --------------
function applyTheme(cfg) {
  document.body.dataset.theme = cfg.theme || 'dark';
  document.body.classList.toggle('compact', cfg.theme === 'compact');
  document.body.style.setProperty('--accent', cfg.accent || '#4fc3f7');
  document.querySelectorAll('.theme').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === (cfg.theme || 'dark'));
  });
  $('#accent').value = cfg.accent || '#4fc3f7';
}

function updateModeUI(mode) {
  $('#mode-badge').textContent = mode;
  $('#mode-badge').className = 'badge ' + mode;
  document.querySelectorAll('.mode').forEach(el => {
    el.classList.toggle('active', el.dataset.mode === mode);
  });
  $('#master-card').style.display = mode === 'master' ? 'block' : 'none';
  $('#slave-card').style.display = mode === 'slave' ? 'block' : 'none';
}

function renderModules() {
  const box = $('#modules');
  box.innerHTML = '';
  for (const [key, label] of Object.entries(MODULE_LABELS)) {
    const div = document.createElement('div');
    div.className = 'mod';
    div.innerHTML = `<span>${label}</span>
      <span class="switch"><input type="checkbox" data-module="${key}" ${config.modules[key] ? 'checked' : ''} /><span class="sl"></span></span>`;
    box.appendChild(div);
  }
}

async function refreshSlaves() {
  const box = $('#slaves');
  if ($('#mode-badge').textContent !== 'master') {
    box.innerHTML = '<div class="hint">Visible uniquement en mode maître.</div>';
    return;
  }
  const list = await window.sysmon.listSlaves();
  const sig = JSON.stringify(list.map(s => [s.id, s.status, s.connected, s.ip]));
  if (sig === lastSlavesSig) return; // rien de changé → on ne réécrit pas le DOM
  lastSlavesSig = sig;
  if (!list.length) {
    box.innerHTML = '<div class="hint">Aucun esclave pour le moment — démarrez SysMon en mode esclave sur une autre machine.<br>Astuce : si rien n\'apparaît, autorisez les ports <b>8597 TCP</b> et <b>8598 UDP</b> dans le pare-feu Windows du maître.</div>';
    return;
  }
  box.innerHTML = '';
  for (const s of list) {
    const div = document.createElement('div');
    div.className = 'slave';
    div.innerHTML = `
      <div>
        <div class="name">${s.name}</div>
        <div class="meta">${s.hostname} · ${s.platform} · ${s.ip}${s.connected ? ' · en ligne' : ' · hors ligne'}</div>
      </div>
      <span class="st ${s.status}">${s.status === 'approved' ? 'validé' : s.status === 'pending' ? 'en attente' : 'refusé'}</span>
      <div class="actions">
        ${s.status !== 'approved' ? `<button class="mini" data-act="approve" data-id="${s.id}">Valider</button>` : ''}
        ${s.status !== 'rejected' ? `<button class="mini" data-act="reject" data-id="${s.id}">Refuser</button>` : ''}
        <button class="mini" data-act="remove" data-id="${s.id}">Suppr.</button>
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

document.querySelectorAll('.mode').forEach(el => {
  el.addEventListener('click', () => updateModeUI(el.dataset.mode));
});
// Aperçu thème/accent en direct (sans sauvegarder)
document.querySelectorAll('.theme').forEach(el => {
  el.addEventListener('click', () => applyTheme({ ...config, theme: el.dataset.theme }));
});
$('#accent').addEventListener('input', e => applyTheme({ ...config, accent: e.target.value }));
$('#win-close').addEventListener('click', () => window.close());
$('#close').addEventListener('click', () => window.close());
$('#save').addEventListener('click', async () => {
  const status = $('#status');
  try {
    const modules = {};
    document.querySelectorAll('input[data-module]').forEach(cb => { modules[cb.dataset.module] = cb.checked; });
    config = await window.sysmon.setConfig({
      mode: $('#mode-badge').textContent,
      webAccess: $('#webAccess').checked,
      autoApproveSlaves: $('#autoApproveSlaves').checked,
      port: parseInt($('#port').value, 10) || 8597,
      masterIp: $('#masterIp').value.trim(),
      theme: document.body.dataset.theme || 'dark',
      accent: $('#accent').value,
      logLevel: $('#logLevel').value,
      chartMode: $('#chartMode').value,
      historyEnabled: $('#historyEnabled').checked,
      historyMinutes: parseInt($('#historyMinutes').value, 10) || 30,
      barMode: { enabled: $('#barEnabled').checked, metric: $('#barMetric').value },
      modules
    });
    status.className = 'status ok';
    status.textContent = '✔ Enregistré et appliqué.';
    refreshSlaves();
  } catch (e) {
    status.className = 'status err';
    status.textContent = 'Erreur : ' + e.message;
  }
});

load();
// Rafraîchissement automatique de la liste des esclaves (le master peut les voir arriver en direct)
setInterval(() => { if (document.visibilityState === 'visible') refreshSlaves(); }, 3000);
