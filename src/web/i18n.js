'use strict';
// i18n du dashboard web (mêmes clés que le widget + clés dashboard).
// La langue vient du master (config.language, via /api/status).

const DICT = {
  fr: {
    'dash.logs': 'JOURNAUX',
    'dash.updateAvailable': 'Nouvelle version',
    'dash.curves': 'Courbes historiques',
    'dash.theme': 'Thème',
    'dash.conn.online': 'connecté',
    'dash.conn.offline': 'déconnecté',
    'dash.conn.waiting': 'connexion…',
    'dash.pending': 'Esclaves en attente de validation',
    'dash.approve': 'Valider',
    'dash.reject': 'Refuser',
    'dash.remove': 'Supprimer',
    'dash.waiting': 'En attente de données…',
    'dash.logsTitle': 'Logs centralisés',
    'dash.host': 'Machine',
    'dash.level': 'Niveau',
    'dash.allHosts': 'toutes les machines',
    'dash.logsEmpty': 'Aucun log pour le moment…',
    'dash.configTitle': 'Configuration du slave',
    'dash.configModules': 'Modules',
    'dash.configInterval': 'Cadence d\'envoi',
    'dash.configLogLevel': 'Niveau de logs',
    'dash.configSave': 'Appliquer',
    'dash.configCancel': 'Annuler',
    'dash.configReset': 'Réinitialiser',
    'dash.configSaved': '✔ Config envoyée au slave',
    'dash.configFailed': 'Erreur d\'envoi',
    'dash.history': 'Historique'
  },
  en: {
    'dash.logs': 'LOGS',
    'dash.updateAvailable': 'New version',
    'dash.curves': 'Historical curves',
    'dash.theme': 'Theme',
    'dash.conn.online': 'connected',
    'dash.conn.offline': 'disconnected',
    'dash.conn.waiting': 'connecting…',
    'dash.pending': 'Slaves pending approval',
    'dash.approve': 'Approve',
    'dash.reject': 'Reject',
    'dash.remove': 'Remove',
    'dash.waiting': 'Waiting for data…',
    'dash.logsTitle': 'Centralized logs',
    'dash.host': 'Host',
    'dash.level': 'Level',
    'dash.allHosts': 'all hosts',
    'dash.logsEmpty': 'No logs yet…',
    'dash.configTitle': 'Slave configuration',
    'dash.configModules': 'Modules',
    'dash.configInterval': 'Push interval',
    'dash.configLogLevel': 'Log level',
    'dash.configSave': 'Apply',
    'dash.configCancel': 'Cancel',
    'dash.configReset': 'Reset',
    'dash.configSaved': '✔ Config pushed to the slave',
    'dash.configFailed': 'Failed to push config',
    'dash.history': 'History'
  }
};

let current = 'en';
function detect() { return (navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en'; }
function setLang(lang) { current = lang === 'auto' ? detect() : (lang === 'fr' ? 'fr' : 'en'); document.documentElement.lang = current; }
function getLang() { return current; }
function t(key) {
  const d = DICT[current] || DICT.en;
  return d[key] !== undefined ? d[key] : (DICT.en[key] !== undefined ? DICT.en[key] : key);
}
function apply(root) {
  root = root || document;
  root.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = t(n.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach(n => { n.title = t(n.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-ph]').forEach(n => { n.placeholder = t(n.dataset.i18nPh); });
}

window.sysmonI18n = { t, apply, setLang, getLang };
