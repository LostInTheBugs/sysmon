# Roadmap SysMon

## 1. Système de logs (debug / info / warn / error)
- Logs locaux par niveau dans le fichier de log existant (`userData/sysmon-debug.log`)
- Rotation du fichier (taille max, historique)
- **Envoi des logs des slaves vers le master** (canal WebSocket dédié, tampon + rattrapage)
- Vue des logs dans le dashboard web (filtre par hôte/niveau) et dans la fenêtre paramètres
- Niveau configurable (`logLevel` : debug|info|warn|error)

## 2. Configuration des slaves à distance (via le master)
- Le master pousse une configuration (modules, cadence, logLevel…) à chaque slave
- Application à chaud sans redémarrage (collecteurs déjà modulaires)
- UI : gestion des slaves dans les paramètres + dashboard web (éditer la config d'un slave)
- Possibilité de forcer l'acceptation d'un slave par son IP

## 3. Sens de communication maître ↔ esclave configurable
- **`push`** (actuel) : le slave envoie périodiquement ses snapshots
- **`pull`** : le master interroge le slave à la demande (mode requête/réponse)
- **`bidirectional`** : les deux (push + interrogation ponctuelle)
- Réglage dans la config (`syncMode`), exposé dans les paramètres et le dashboard

## 4. Mise à jour des slaves
- **Via le master** : le master pousse le binaire/paquet aux slaves (mise à jour groupée)
- **Via internet** : le slave (ou le master) vérifie les releases GitHub (`api.github.com/repos/LostInTheBugs/sysmon/releases`), compare la version, télécharge et installe
- Avertissement + changelog affiché avant mise à jour, option de report

## 5. Thèmes d'affichage
- Thèmes prédéfinis : Sombre (défaut), Clair, AMOLED, Compact
- Accent color personnalisable (widget, paramètres, dashboard web)
- Sélecteur de thème dans les paramètres, appliqué en direct, persisté dans la config

## 6. Multilingue
- i18n des trois interfaces : widget, fenêtre paramètres, dashboard web
- Langues : français + anglais d'abord, autres ensuite
- Détection automatique de la langue système + choix manuel dans les paramètres (`language`)

---

### Ordre suggéré
1. Logs (fondation : debug de toutes les fonctionnalités suivantes)
2. Sens de communication (le mode `pull` conditionne la config à distance)
3. Configuration des slaves à distance
4. Mise à jour (repose sur la config à distance + le canal de logs)
5. Thèmes (UI pure, indépendant)
6. Multilingue (UI pure, indépendant)
