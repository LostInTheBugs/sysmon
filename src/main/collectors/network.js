'use strict';
const si = require('systeminformation');
const { exec } = require('child_process');
const { promisify } = require('util');
const execP = promisify(exec);

let staticIfaces = null;
let wanInfo = null;
let wanFetchedAt = 0;
let lastJoinWarnAt = 0;
let lastRawLogAt = 0;
let prevBytes = new Map(); // clé iface -> { rx, tx, at } pour le calcul du débit
let prevNetstat = null;    // { rx, tx, at } pour le repli netstat -e
let lastNetstatAt = 0;
let txBrokenWin = false;   // SentBytes cassé (latch, Windows uniquement)

// --- Routes (best-effort, per-OS) -------------------------------------------
async function routes() {
  try {
    const { platform } = process;
    let out;
    if (platform === 'win32') out = (await execP('route print -4')).stdout;
    else if (platform === 'darwin') out = (await execP('netstat -rn')).stdout;
    else out = (await execP('ip -4 route')).stdout;
    const lines = out.split('\n').filter(l => l.trim());
    const res = [];
    for (const line of lines) {
      const m = line.match(/^(\S+)\s+(?:via\s+)?(\S+)/);
      if (!m) continue;
      const dst = m[1], gw = m[2];
      if (!gw || gw === 'Iface') continue;
      if (/^(default|0\.0\.0\.0|::|fe80|ff00)/.test(dst)) {
        res.push({ dest: dst, gateway: gw, isDefault: dst === 'default' || dst === '0.0.0.0' || dst === '::/0' });
      }
    }
    return res.slice(0, 20);
  } catch {
    return [];
  }
}

// --- WAN IP + country (cached 1h) -------------------------------------------
async function wan() {
  if (wanInfo && Date.now() - wanFetchedAt < 3600000) return wanInfo;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const ipRes = await fetch('https://api.ipify.org?format=json', { signal: ctrl.signal });
    const { ip } = await ipRes.json();
    let country = null, city = null, isp = null;
    try {
      const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,isp`, { signal: ctrl.signal });
      const geo = await geoRes.json();
      if (geo.status === 'success') {
        country = geo.country;
        city = geo.city;
        isp = geo.isp;
      }
    } catch { /* geo is best-effort */ }
    clearTimeout(t);
    wanInfo = { ip, country, city, isp, fetchedAt: Date.now() };
    return wanInfo;
  } catch {
    return wanInfo || { ip: null, country: null, city: null, isp: null };
  }
}

// Jointure stats↔interfaces : sur Windows, si.networkStats() et
// si.networkInterfaces() ne partagent pas le même nom d'interface
// ("Ethernet" vs "Realtek PCIe GbE Family Controller"). On essaie plusieurs
// correspondances : nom exact, ifaceName (description), nom sans espaces/casse.
function matchStats(stats, iface, ifaceName) {
  if (!Array.isArray(stats) || !stats.length) return null;
  const norm = s => String(s || '').toLowerCase().replace(/[\s()#]+/g, '');
  const target = norm(iface);
  const targetName = norm(ifaceName);
  return stats.find(x => x.iface === iface)
    || (ifaceName ? stats.find(x => x.iface === ifaceName) : null)
    || stats.find(x => norm(x.iface) === target)
    || (ifaceName ? stats.find(x => norm(x.iface) === targetName) : null)
    || null;
}

// Débit calculé depuis les compteurs d'octets (fiables) : si.rx_sec peut
// rester à 0 sur certains Windows (compteurs de perf cassés) alors que
// rx_bytes bouge. Repli sur rx_sec si les octets ne bougent pas.
function computeRates(prev, s, now) {
  let rxMBs = 0, txMBs = 0;
  const dt = prev ? (now - prev.at) / 1000 : 0;
  if (prev && dt > 0.5) {
    const drx = s.rx_bytes != null && prev.rx != null ? (s.rx_bytes - prev.rx) / 1048576 : 0;
    const dtx = s.tx_bytes != null && prev.tx != null ? (s.tx_bytes - prev.tx) / 1048576 : 0;
    if (drx > 0) rxMBs = Math.round(drx / dt * 10) / 10;
    if (dtx > 0) txMBs = Math.round(dtx / dt * 10) / 10;
  }
  if (rxMBs === 0 && (s.rx_sec || 0) > 0) rxMBs = Math.round(s.rx_sec / 1048576 * 10) / 10;
  if (txMBs === 0 && (s.tx_sec || 0) > 0) txMBs = Math.round(s.tx_sec / 1048576 * 10) / 10;
  return { rxMBs, txMBs };
}

function parseAdapterStats(stdout) {
  const data = JSON.parse(String(stdout).trim());
  const list = Array.isArray(data) ? data : [data];
  return list.filter(a => a && a.Name).map(a => ({ iface: String(a.Name), rx_bytes: a.ReceivedBytes || 0, tx_bytes: a.SentBytes || 0 }));
}

// Repli Windows : si si.networkStats() renvoie des compteurs à 0 (perfmon
// cassé — connu après certaines mises à jour Windows), on lit les compteurs
// d'octets via Get-NetAdapterStatistics (PowerShell natif, sans admin).
async function windowsAdapterStats() {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execP = promisify(exec);
    const { stdout } = await execP('powershell.exe -NoProfile -NonInteractive -Command "Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json -Compress"', { timeout: 8000, windowsHide: true });
    return parseAdapterStats(stdout);
  } catch {
    return null;
  }
}

// Repli ultime (Windows) : netstat -e — fonctionne toujours, indépendant de
// perfmon. La 1re ligne à deux nombres est la ligne "Octets/Bytes" (toujours
// la première dans netstat -e, label localisé mais position stable).
function parseNetstatTotals(stdout) {
  for (const line of String(stdout).split('\n')) {
    const m = line.match(/^\s*\S+\s+(\d+)\s+(\d+)\s*$/);
    if (m) return { rx_bytes: parseInt(m[1], 10), tx_bytes: parseInt(m[2], 10) };
  }
  return null;
}

async function netstatTotals() {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execP = promisify(exec);
    const { stdout } = await execP('netstat -e', { timeout: 5000, windowsHide: true });
    return parseNetstatTotals(stdout);
  } catch {
    return null;
  }
}

async function collect() {
  try {
    const [stats0, ifaces, defGw, wanData] = await Promise.all([
      si.networkStats().catch(() => []),
      staticIfaces ? Promise.resolve(staticIfaces) : si.networkInterfaces().then(i => { staticIfaces = i; return i; }).catch(() => []),
      si.networkGatewayDefault().catch(() => null),
      wan()
    ]);
    // Windows : si tous les compteurs sont à 0 (perfmon cassé), repli sur
    // Get-NetAdapterStatistics
    let stats = stats0 || [];
    if (process.platform === 'win32' && stats.length && stats.every(s => !s.rx_bytes)) {
      const as = await windowsAdapterStats();
      if (as && as.length) {
        stats = as;
        try {
          const logger = require('../logger');
          logger.debug('network', 'si.networkStats empty → Get-NetAdapterStatistics fallback:', as.length, 'adapter(s)');
        } catch { /* logger pas dispo (test) */ }
      }
    }
    let anyMatched = false;
    const now = Date.now();
    const ifaceList = (ifaces || [])
      .filter(i => !i.internal && !i.virtual && (i.ip4 || i.ip6))
      .map(i => {
        const s = matchStats(stats, i.iface, i.ifaceName);
        if (s) anyMatched = true;
        let rxMBs = 0, txMBs = 0;
        if (s) {
          const key = i.iface + '|' + (i.ifaceName || '');
          const rates = computeRates(prevBytes.get(key), s, now);
          rxMBs = rates.rxMBs; txMBs = rates.txMBs;
          prevBytes.set(key, { rx: s.rx_bytes, tx: s.tx_bytes, at: now });
          // Latch : compteur d'envoi cassé (octets reçus qui bougent, envoyés à 0)
          if (s.rx_bytes > 0 && s.tx_bytes === 0) txBrokenWin = true;
        }
        return {
          iface: i.iface,
          ifaceName: i.ifaceName || null,
          type: i.type === 'wifi' ? 'Wi-Fi' : i.type === 'ethernet' ? 'Ethernet' : i.type,
          ip4: i.ip4, ip6: i.ip6, mac: i.mac,
          speed: i.speed ? `${i.speed} Mb/s` : null,
          operstate: i.operstate,
          rxMBs,
          txMBs,
          rxTotalGB: s ? Math.round(s.rx_bytes / 1073741824 * 100) / 100 : 0,
          txTotalGB: s ? Math.round(s.tx_bytes / 1073741824 * 100) / 100 : 0,
          isDefault: defGw && defGw.iface === i.iface
        };
      });
    // Repli tx Windows : compteur SentBytes cassé (latch txBrokenWin) — le
    // débit sortant vient de netstat -e (agrégé, affecté à l'interface par
    // défaut qui porte l'essentiel du trafic). Toutes les 2 s tant que cassé.
    if (process.platform === 'win32' && txBrokenWin && now - lastNetstatAt > 2000) {
      lastNetstatAt = now;
      const nt = await netstatTotals();
      if (nt) {
        const dt = prevNetstat ? (now - prevNetstat.at) / 1000 : 0;
        if (prevNetstat && dt > 0.5) {
          const dtx = (nt.tx_bytes - prevNetstat.tx) / 1048576;
          if (dtx > 0) {
            const target = ifaceList.find(i => i.isDefault) || ifaceList[0];
            target.txMBs = Math.round(dtx / dt * 10) / 10;
            try {
              const logger = require('../logger');
              logger.debug('network', 'netstat -e fallback for TX:', target.iface, target.txMBs, 'MB/s');
            } catch { /* logger pas dispo (test) */ }
          }
        }
        prevNetstat = { rx: nt.rx_bytes, tx: nt.tx_bytes, at: now };
      }
    }
    // Diagnostic (seulement si AUCUNE interface n'a pu être jointe, 1×/min) :
    // un réseau au repos (0 MB/s) n'est PAS une erreur de jointure.
    if ((stats || []).length && ifaceList.length && !anyMatched) {
      if (now - lastJoinWarnAt > 60000) {
        lastJoinWarnAt = now;
        try {
          const logger = require('../logger');
          logger.warn('network', 'stats/iface join failed — stats names:', (stats || []).map(s => s.iface).join(' | '), '— iface names:', ifaceList.map(i => i.iface + (i.ifaceName ? ' (' + i.ifaceName + ')' : '')).join(' | '));
        } catch { /* logger pas dispo (test) */ }
      }
    }
    // Log brut (debug, 1×/min) : valeurs réelles de si.networkStats() — permet
    // de voir si les compteurs bougent pendant un speedtest.
    if (now - lastRawLogAt > 60000) {
      lastRawLogAt = now;
      try {
        const logger = require('../logger');
        logger.debug('network', 'raw stats:', JSON.stringify((stats || []).map(s => ({ iface: s.iface, rx_sec: s.rx_sec, tx_sec: s.tx_sec, rx_bytes: s.rx_bytes, tx_bytes: s.tx_bytes }))).slice(0, 900));
      } catch { /* logger pas dispo (test) */ }
    }
    return {
      ok: true,
      interfaces: ifaceList,
      defaultGateway: defGw ? { iface: defGw.iface, ip4: defGw.ip4 } : null,
      wan: wanData,
      routes: await routes()
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

module.exports = { collect, matchStats, computeRates, parseAdapterStats, parseNetstatTotals, name: 'network' };
