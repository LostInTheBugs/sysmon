'use strict';
// Fenêtre « différences » : rendu Markdown minimal (titres, listes, gras,
// code) des notes de chaque version intermédiaire — aucune dépendance.
// Données reçues du main via IPC (update:diff-data), jamais de HTML fourni
// par GitHub interprété tel quel : échappement avant rendu.

const $ = sel => document.querySelector(sel);

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Rendu Markdown minimal : # ## ###, listes -/*, **gras**, `code`.
function mdToHtml(md) {
  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trimEnd();
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      let li = esc(line.replace(/^\s*[-*]\s+/, ''));
      li = li.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
      out.push('<li>' + li + '</li>');
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    let l = esc(line);
    l = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    if (/^###\s+/.test(l)) out.push('<h3>' + l.replace(/^###\s+/, '') + '</h3>');
    else if (/^##\s+/.test(l)) out.push('<h2>' + l.replace(/^##\s+/, '') + '</h2>');
    else if (/^#\s+/.test(l)) out.push('<h1>' + l.replace(/^#\s+/, '') + '</h1>');
    else out.push('<p>' + l + '</p>');
  }
  closeList();
  return out.join('\n');
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : ' — ' + d.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
}

let releases = [];

function render() {
  const list = $('#list');
  if (!releases.length) {
    list.innerHTML = '<p class="empty">Aucune version intermédiaire.</p>';
    return;
  }
  list.innerHTML = releases.map(r => (
    '<section class="release">' +
      '<h2>' + esc(r.tag_name) + esc(fmtDate(r.published_at)) + '</h2>' +
      '<div class="body">' + mdToHtml(r.body) + '</div>' +
    '</section>'
  )).join('\n');
}

$('#btnClose').addEventListener('click', () => window.close());
$('#btnDownload').addEventListener('click', () => {
  const latest = releases[0];
  if (latest) window.sysmon.downloadUpdate(latest);
});

window.sysmon.onDiffData(list => { releases = list || []; render(); });
