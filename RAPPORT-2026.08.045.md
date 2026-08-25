# SysMon — RAPPORT 2026.08.045 (branche `fix/2026.08.045`)

**Date** : 2026-08-25
**Version de départ** : `2026.08.044` — **Version cible** : `2026.08.045` (alignée : `package.json` + `VERSION`, vérifiée par `scripts/check-version.js`)
**Branche** : `fix/2026.08.045` — **Aucun tag, aucune release créé** (validation et tag par l'utilisateur). Dossier `claude/` jamais poussé.

Les tâches T1→T8 ont été exécutées dans une première passe ; T9→T14 et les correctifs P1→P5 dans une seconde passe ; T15 (README + CHANGELOG + avertissement) en clôture. `npm test` : **16/16 PASS**.

---

## Bloc A — Sécurité

### T1 — Authentification par jeton sur le master — ✅ FAIT
`src/main/config.js`, `src/main/master/server.js`, `src/main/index.js`, `src/preload/preload.js`, `src/renderer/settings.html/js/css`, `src/renderer/i18n.js`, `src/web/app.js`, `scripts/test-auth.js`

- Jeton `crypto.randomBytes(24).toString('hex')` généré au premier démarrage du master, persisté dans `config.json`.
- `authorized(req, url, {allowCookie})` : en-tête `Authorization: Bearer`, `?token=`, cookie `sysmon_token` (HttpOnly, SameSite=Strict) ; comparaison `timingSafeEqual` (longueur d'abord).
- Routes `/api/*` authentifiées (401 JSON sinon) ; routes mutantes : jeton hors cookie exigé (anti-CSRF).
- Dashboard : `?token=` valide → 302 + cookie (le jeton disparaît de la barre d'adresse) ; sans jeton → page 401 ; jeton injecté dans la page via `<meta name="sysmon-token">` (CSP `script-src 'self'`).
- WebSocket : jeton en query string, refus `4401` avant tout traitement de message.
- Tray + IPC `open:dashboard` : `http://localhost:<port>/?token=<jeton>` ; IPC `auth:regenerate` (déconnecte tous les clients WS).
- Paramètres : jeton masqué (👁/Copier/Régénérer), sélecteur `bindAddress` (défaut `127.0.0.1`).

**Difficultés** : page 401 accessible sans jeton ; injection du jeton sans script inline (CSP).

### T2 — Authentification des slaves et durcissement du protocole — ✅ FAIT
`src/main/slave/client.js`, `src/main/master/server.js`, settings (champ « Jeton du maître »), 9 tests mis à jour

- Slave : `?token=<masterToken>` sur le WS + champ `token` dans `hello`.
- Master : refus avant tout traitement de message ; `maxPayload: 2 Mo` ; vérification `Origin` (localhost/loopback/IP locales) pour les connexions navigateur.
- Découverte UDP : la réponse ne contient jamais le jeton ; log `info` de chaque réponse.

### T3 — XSS stocké dans le dashboard et le widget — ✅ FAIT
`src/web/app.js`, `src/renderer/renderer.js`, `src/main/master/server.js`, `scripts/test-xss.js`

- `fmt = v => esc(v ?? '—')` (dashboard) ; widget déjà échappé ; `bar()` et pastilles CPU bornés numériquement.
- CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:` + `X-Content-Type-Options: nosniff`.
- Test sandbox vm : nom de conteneur `<img src=x onerror=alert(1)>` échappé dans le HTML produit.

### T4 — Routes mutantes en POST et traversée de chemin — ✅ FAIT
`src/main/master/server.js`, `scripts/test-auth.js` (checks 12–15)

- `approve/reject/remove` en POST uniquement (405 + `Allow: POST` en GET) ; cookie seul → 401 pour les mutations.
- Traversée : `path.resolve(WEB_DIR, file)` + garde `WEB_DIR + path.sep`.

## Bloc B — Bugs

### T5 — Config distante jamais appliquée — ✅ FAIT
`src/main/index.js`, `scripts/test-remote-config.js`

- Patch réellement persisté (`config.set`) et appliqué (`collectors.setEnabled`) ; test étendu : le module désactivé (memory) disparaît des snapshots poussés au master.

**Difficultés** : le test poussait la config toutes les 500 ms → timer du slave réinitialisé en boucle, aucun snapshot. Poussée unique corrige le test (comme dans la vraie vie).

### T6 — `barMode` dupliqué — ✅ FAIT
`src/main/config.js`, `scripts/test-config.js` (migration `{metric}` → `{metrics}`, whitelist, défauts — 6 checks).

### T7 — Verrou d'instance unique — ✅ FAIT
`src/main/index.js` — `requestSingleInstanceLock()` avant `whenReady` ; seconde instance quitte et réveille la première ; `--screenshot=` exempté.

### T8 — Journalisation — ✅ FAIT
`src/main/config.js` (défaut `info`), `src/main/logger.js` (file asynchrone 500 ms, filtre appliqué au fichier, `flush()` protégé contre la réentrance), `src/main/index.js` (`before-quit` → flush). Smoke test + `test-logs.js` OK.

### Correctifs P1–P5 (seconde passe) — ✅ FAIT
- **P1** : `cfg.bindAddress` réellement appliqué à `server.listen` (plus de `0.0.0.0` en dur) + test de joignabilité LAN.
- **P2** : plus de journalisation de l'URL WS avec sa query string (fuite du jeton) + test anti-régression.
- **P3** : `authToken` relu à chaque requête (fini le jeton figé au `start()` — boucle 401 après `auth:regenerate`) + test.
- **P4** : `flushSync()` sur `before-quit` (le vidage asynchrone pouvait être perdu à la sortie).
- **P5** : rotation comptée par lot de vidage (seuil 50 = 50 lignes) ; `reset()` restaure `writing`/`dirty`/`flushTimer`.

## Bloc C — Conventions

### T9 — Version 2026.08.045 alignée — ✅ FAIT
`package.json` + `VERSION` paddés, `scripts/check-version.js` (échec si divergence ou format ≠ `^\d{4}\.\d{2}\.\d{3}(-c\d+)?$`), appelé par `npm run lint`.

### T10 — Workflow de release GitHub — ✅ FAIT
`.github/workflows/release.yml` — déclenché sur tags `20XX.XX.NNN(-c*)`, notes extraites du CHANGELOG, release créée.

### T11 — Client de mise à jour complet — ✅ FAIT
`src/main/updater.js` : intervalle configurable (min 15 min) + jitter 0–60 s, ETag/`If-None-Match` (304 sans quota), notes complètes multi-releases, fenêtre de différences (Markdown minimal sans dépendance), mise à jour manuelle (téléchargement de l'artefact plateforme), option `autoUpdate` + notification système.

### T12 — Ports — ✅ FAIT
`DISCOVERY_PORT` surchargeable par variable d'environnement (comme `PORT`), les deux documentées dans le README (tableau Configuration + section Sécurité).

## Bloc D — Qualité et outillage

### T13 — `npm test` + CI — ✅ FAIT
`scripts/run-all.js` (résumé N/N, code de sortie non nul en cas d'échec), `"test"` npm, `.github/workflows/ci.yml` (Node 20 & 22). **`npm test` : 16/16 PASS.**

### T14 — Durcissement Electron — ✅ FAIT
Electron `^33` → `44` (dernière majeure stable), `sandbox: true` sur toutes les fenêtres (widget, paramètres, canvas barre), garde-fou de navigation (`setWindowOpenHandler` deny + `will-navigate` bloqué), `renderBarImage()` sans concaténation de code (`JSON.stringify(svgUrl)`).

### T15 — Documentation — ✅ FAIT (clôture)
`README.md` (section Sécurité : jeton, `bindAddress`, `DISCOVERY_PORT`), `CHANGELOG.md` (`## [2026.08.045]`, structuré Sécurité/Corrigé/Ajouté/Modifié), `src/main/index.js` (avertissement au démarrage : master en `127.0.0.1` → slaves distants découverts mais non joignables).

---

## Ruptures (⚠ arbitrage utilisateur pour la release)

1. **Slaves antérieurs à 2026.08.045** : ne peuvent plus se connecter tant que « Jeton du maître » n'est pas renseigné.
2. **Master** : écoute désormais en `127.0.0.1` par défaut → passer `bindAddress` à `0.0.0.0` dans Paramètres pour l'usage LAN (c'est la **deuxième cause** de rupture, mentionnée dans la note du CHANGELOG).
3. **Dashboard web** : plus accessible sans jeton ; routes mutantes en POST uniquement.
4. **Niveau de logs** par défaut : `debug` → `info`.

## État final

- `npm test` : **16/16 PASS** (auth, collectors, config, dashboard, discovery, history ×2, logs, master-slave, network-match, pull, reconnect, remote-config, restart, updater, xss).
- Branche `fix/2026.08.045` poussée (T1→T15 + P1→P5, un commit par tâche, messages FR préfixés).
- **Aucun tag, aucune release** — à toi de valider, tagger (`2026.08.045`) et publier (le workflow T10 extraira les notes du CHANGELOG).
