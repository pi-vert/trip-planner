# Sauvegarde et restauration

## Contenu du dépôt

- `src/` : interface UIBUILDER, bibliothèques cartographiques et logique métier.
- `api/`, `*-store.js`, `yaml-transfer.js`, `gpx-import.js` : services serveur.
- `node-red/flows.json` : export du seul onglet Trip Planner et de ses dépendances.
- `node-red/companions/trips/` : page de présentation des voyages utilisée par le second nœud UIBUILDER de l’onglet.
- `data/trips/` : instantané des voyages, registre, métadonnées, comparaisons, météo et enregistrements GPS.
- `test/`, `docs/`, `scripts/` : tests, documentation et outils de sauvegarde.

Les dépendances `node_modules`, les identifiants Node-RED et les anciennes copies `.save`/`.old` ne sont pas versionnés. Le dépôt public contient les données de voyage incluses dans l’instantané.

## Vérifier une copie indépendante

Prérequis : Node.js 22 et npm.

```bash
git clone https://github.com/pi-vert/trip-planner.git
cd trip-planner
npm ci
npm run check
npm run check:experience
npm run check:yaml
npm run check:gps
npm test
```

Les tests utilisent l’export Node-RED du dépôt. Pour vérifier les flows de l’installation active, définir `TRIP_PLANNER_FLOWS` avec le chemin de son `flows.json`.

## Restaurer l’application

1. Installer Node-RED et `node-red-contrib-uibuilder` (version de l’export : 7.5.0). Activer `functionExternalModules: true` dans les réglages Node-RED : les fonctions du flow utilisent les modules natifs `fs` et `module`.
2. Arrêter Node-RED pendant l’installation des fichiers. Dans le dossier UIBUILDER de l’installation cible, cloner ce dépôt sous le nom **`trip_planner`**, puis y lancer `npm ci`. Ce dossier est généralement `~/.node-red/uibuilder/`, ou `<projet-node-red>/uibuilder/` lorsque le mode projets est activé.
3. Copier le contenu de `node-red/companions/trips/` dans le dossier UIBUILDER voisin **`trips`**.
4. Restaurer le contenu de **`data/trips/` dans `/home/pi/trips/`**, en conservant les sous-dossiers. Le compte qui exécute Node-RED doit pouvoir lire et écrire ce dossier. Cette localisation correspond aux chemins enregistrés dans le registre et le flow. Pour une autre localisation, il faut adapter ensemble le flow, le registre et les valeurs par défaut des modules de stockage.
5. Définir la variable d’environnement **`TRIP_PLANNER_APP_DIR`** avec le chemin absolu du dossier contenant le `package.json` de l’application, puis démarrer Node-RED avec cette variable. Par exemple :

   ```bash
   export TRIP_PLANNER_APP_DIR="$HOME/.node-red/uibuilder/trip_planner"
   node-red
   ```

   Pour un service systemd ou Docker, définir cette variable dans l’environnement du service/conteneur. Le chemin par défaut de l’export est `/home/pi/.node-red/uibuilder/trip_planner`.

6. Dans l’éditeur Node-RED, importer **`node-red/flows.json`** puis déployer. Sur une installation possédant déjà cet onglet, remplacer sa version existante plutôt que créer des nœuds ou routes en double.
7. Ouvrir `http://localhost:1880/trip_planner/`, puis **Gérer → Actualiser les YAML**. La page compagnon est accessible à `/trips/`.

L’export conserve l’état des routes de l’installation sauvegardée. Les services externes (cartes, routage, images, météo) nécessitent un accès réseau ; GitHub ne les héberge pas et ne lance pas Node-RED.

## Sauvegarder les prochaines modifications

Dans le dépôt local de l’application :

```bash
npm run snapshot
npm run check
npm test
git status
git diff
git add --all
git -c user.name=pi-vert -c user.email=37361508+pi-vert@users.noreply.github.com commit -m "Mise à jour du planificateur et des voyages"
git -c credential.helper='!gh auth git-credential' push
```

Ces commandes utilisent l’identité publique GitHub et l’authentification de `gh` pour cette opération, sans modifier la configuration Git globale. Elles supposent que `gh auth status` indique une connexion au compte `pi-vert`.

`npm run snapshot` exporte le flow depuis le `flows.json` situé deux dossiers au-dessus de l’application, et copie les données actuelles de `/home/pi/trips/` dans `data/trips/`. Il remplace les fichiers de cet instantané et en retire ceux qui ont disparu des données actives ; l’historique Git conserve les versions précédentes. Il ne modifie pas les voyages actifs.

Pour une installation différente :

```bash
node scripts/snapshot.cjs --flows /chemin/projet-node-red/flows.json --data /home/pi/trips --include-data
```

Effectuer l’instantané après la fin des enregistrements et imports de l’application. Le flow de l’installation active reste la source de vérité : refaire cet export après chaque modification dans l’éditeur Node-RED.

Les prochains envois sont **manuels** ; les commandes ci-dessus effectuent les vérifications avant chaque sauvegarde.
