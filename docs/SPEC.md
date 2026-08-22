# SysMon — Spécification

Widget de supervision système cross-platform (Windows / macOS / Linux),
avec mode **master/slave** optionnel et **accès web** côté master.

## 1. Modules d'information

### CPU
- Utilisation globale et par cœur
- Fréquence, charge (load average)

### Mémoire
- Mémoire utilisée / libre / swap
- Top consommateurs par processus

### Disques
- Espace utilisé / libre par partition
- Activité I/O

### Batterie
- Cycles de charge, santé, capacité (design vs actuelle)
- Température, temps restant, état de charge

### Réseau
- Trafic entrant / sortant
- Interfaces LAN / WAN, routes, adresses IP
- Vitesse de liaison, détection du pays (géolocalisation IP)

### Connectique
- Connexions Bluetooth
- Périphériques USB

### Sondes
- Températures (CPU, carte mère, disques…)
- Vitesses de ventilateurs
- SMART disques

### GPU
- Utilisation GPU, VRAM
- Moniteurs connectés, résolutions

### LLM (optionnel)
- Si un serveur LLM local est détecté : modèles chargés, statut,
  mémoire consommée, tâches en cours

## 2. Mode master / slave

- **Slave** : scan du réseau local pour trouver le master, ou adresse IP
  du master fournie manuellement.
- **Master** :
  - accès web activable (dashboard multi-machines dans le navigateur),
  - validation des slaves **automatique** ou **manuelle** (depuis
    l'application Windows ou l'interface web).
- Les slaves envoient leurs données au master ; le master agrège et
  affiche tous les hôtes.

## 3. UI

- Widget compact (always-on-top, transparent si possible) affichant les
  modules sélectionnés.
- Fenêtre principale avec la liste complète des informations.
- Dashboard web (côté master).

## 4. Plateformes

| Plateforme | Support |
|------------|---------|
| Windows    | ✅ cible |
| macOS      | ✅ cible |
| Linux      | ✅ cible |

## 5. Architecture pressentie

- Applicatif desktop cross-platform (Electron / Tauri — à valider)
- Collecte système via bibliothèque unifiée (ex. `systeminformation`)
- Serveur HTTP embarqué côté master (port configurable, variable `PORT`)
- Communication master↔slave : HTTP/WebSocket sur le réseau local

## 6. Hors périmètre (v1)

- Historique / graphes long terme (peut venir plus tard)
- Notifications push mobiles
