# Trip Planner

Application UIBUILDER de préparation collaborative de voyages. Elle gère les étapes, la carte, l'itinéraire, le planning contraint, le budget, les candidats et les votes.

## Sauvegarde GitHub

Ce dépôt contient l’application, ses tests, le flow Node-RED dans `node-red/flows.json`, la page compagnon `/trips` et un instantané des voyages dans `data/trips/` (YAML, registre, comparaisons, météo et enregistrements GPS).

Voir **[Installation, restauration et prochaines sauvegardes](docs/github.md)**. Les données de `data/trips/` sont une sauvegarde ; l’application continue à lire et écrire ses données dans `/home/pi/trips`.

## Deux parcours pour un même voyage

**Préparer** guide librement la conception : choisir les lieux, organiser les étapes, puis préciser les dates et les réservations. Les dates restent facultatives. Les fiches sont compactes et les réglages détaillés se déplient au besoin.

**En voyage** affiche un carnet de consultation avec photos, visites, hébergements et repas, ainsi que les accès au planning, à la carte et au suivi GPS. **Modifier le voyage** ou **Modifier cette étape** ramène à la préparation à tout moment. Les deux modes utilisent le même voyage ; aucune copie ni validation définitive n’est nécessaire.

Le menu **Outils** donne accès aux autres fonctions dans les deux modes. **Gérer** regroupe le renommage et les opérations YAML. Le prénom pour les votes se trouve dans **Réglages**.

L’[analyse des YAML et les choix ergonomiques](docs/ergonomie.md) documentent cette hiérarchie. L’audit est reproductible avec `node scripts/analyze-yaml-usage.cjs`.

## Accès

```text
http://<adresse-du-raspberry>:1880/trip_planner/
```

## Dépôt des YAML

La barre YAML, sous les onglets, propose :

- **Importer des YAML** : sélectionner un ou plusieurs fichiers `.yaml` ou `.yml` depuis son ordinateur (1 Mo maximum par fichier). Chaque fichier valide est ajouté comme voyage et apparaît dans la liste. Les erreurs de syntaxe ou de structure sont indiquées par fichier ; les autres fichiers du lot continuent à être importés.
- **Exporter le YAML** : télécharger le fichier enregistré du voyage sélectionné, avec son contenu et ses commentaires d'origine.

L'import conserve le contenu YAML et normalise le nom de fichier. Si ce nom existe déjà, un suffixe (`-2`, `-3`, etc.) crée un nouveau voyage. Les fichiers existants sont conservés. Les données de météo et de comparaison sont stockées séparément et ne sont pas incluses dans ces exports YAML.

Les routes HTTP `GET /trip_planner/api/yaml?id=<id>` et `POST /trip_planner/api/yaml` sont définies dans le flow Trip Planner. Le POST reçoit `{ "filename": "voyage.yaml", "content": "…" }`. Le module serveur `yaml-transfer.js` valide les voyages et gère les fichiers ; le Trip Manager actualise ensuite le registre.

Déposer les fichiers `.yaml` ou `.yml` directement dans :

```text
/home/pi/trips
```

L'application détecte les fichiers au démarrage et avec le bouton **Actualiser les YAML**. Les extensions `.save` et `.old` sont ignorées. Le registre généré est `/home/pi/trips/trips.json`.

Le fichier historique principal est `/home/pi/trips/trip-planner.yaml`; il apparaît sous le nom `Voyage principal`.

## Format minimal

```yaml
itinerary:
  - geneve
  - annecy

places:
  geneve:
    name: Genève
    lat: 46.2044
    lng: 6.1432
    duration_h: 2
    budget: 30
    desc: Vieille ville et bord du lac
    closedDays: []
    ratings: {}
    tags: [ville, lac]
    image: ''
    optionGroup: ''
    url: https://www.geneve.com/
    stageType: main
    parentStageId: ''
    arrivalDate: '2026-09-10'
    departureDate: '2026-09-11'

  annecy:
    name: Annecy
    lat: 45.8992
    lng: 6.1294
    duration_h: 3
    budget: 45
    desc: Canaux et vieille ville
    closedDays: []
    ratings: {}
    tags: [ville, lac]
    image: ''
    optionGroup: ''
    url: https://www.lac-annecy.com/
    stageType: detail
    parentStageId: geneve
    arrivalDate: ''
    departureDate: ''

view:
  center:
    lat: 46.05
    lng: 6.14
    zoom: 9

edges: {}

planning:
  startDate: '2026-09-10'
  endDate: '2026-09-13'
  startTime: '07:00'
  dayStart: '07:00'
  dayEnd: '22:00'
  speedKmh: 60
  meals:
    breakfast: { at: '07:00', durationMin: 60 }
    lunch: { at: '12:00', durationMin: 60 }
    dinner: { at: '19:00', durationMin: 60 }
  reservations:
    - id: restaurant-annecy
      title: La Table du Lac
      kind: meal
      meal: dinner
      placeId: annecy
      placeIds: [annecy]
      start: '2026-09-11T19:30'
      end: '2026-09-11T21:00'
      notes: Réservation au nom de Martin
    - id: visite-guidee
      title: Visite guidée du centre
      kind: activity
      placeId: annecy
      placeIds: [annecy]
      dateMode: stage
      relativeDay: arrival
      startTime: '14:00'
      endTime: '16:00'
```

Les clés de `itinerary` doivent correspondre aux clés de `places`. Un fichier déposé reste la source de vérité et sera mis à jour lors des modifications effectuées dans l'interface.

## Images automatiques

Lorsqu'un résultat d'adresse est sélectionné, l'application recherche automatiquement son image principale dans Wikidata, puis dans Wikipédia et Wikimedia Commons. L'aperçu et l'URL directe sont affichés avant l'ajout du lieu. Le bouton **Trouver** permet de relancer la recherche manuellement.

Dans **Vue globale** et **Itinéraire détaillé**, le bouton **Compléter les photos** traite tous les lieux sans image du voyage sélectionné. Il convertit aussi les anciennes pages `commons.wikimedia.org/wiki/File:...` en URL d'image directement affichables. Une image déjà renseignée avec une autre URL n'est pas remplacée. Chaque lieu dispose également d'un bouton de recherche individuel.

La **Vue globale** affiche une galerie par grande étape, avec les photos légendées des sous-étapes, restaurants et hébergements associés. Cliquer sur une photo l'ouvre en grand dans un nouvel onglet. Les images sont chargées à la demande ; une photo absente ou inaccessible affiche un emplacement permettant de relancer la recherche. Les photos trouvées sont enregistrées dans le YAML via la sauvegarde habituelle. Changer de voyage interrompt le remplissage en cours.

## Comparer des circuits

L'onglet **Comparer** permet de créer un groupe contenant au moins deux voyages existants. Chaque circuit reste dans son propre YAML et le comparateur les lit sans changer le voyage actif.

La synthèse met côte à côte le prix du forfait, le statut du vol, le coût du vol à ajouter, le total comparable, le budget des étapes, la durée, les visites, les distances, le temps de déplacement, les réservations et les notes. Les lieux communs et propres à chaque circuit sont distingués, et les tracés sont superposés sur la carte. Les informations commerciales du voyagiste (prix, vol, inclus, exclus, annulation, URL et notes) sont enregistrées dans `/home/pi/trips/trip-comparisons.json`.

Les routes `GET` et `PUT /trip_planner/api/comparison` sont déclarées dans le flow Trip Planner et utilisent les gestionnaires de `api/comparison.js`. Elles fonctionnent ainsi également lorsque les API d'instance UIBUILDER sont désactivées.

## Météo

L’onglet **Météo** propose une vue mensuelle pour chaque grande étape. Le bouton **Remplir automatiquement** calcule les tendances à partir des dix dernières années complètes d’Open-Meteo/ERA5 : températures minimale, moyenne et maximale, humidité, précipitations, jours de pluie, neige et ensoleillement. Un indice indicatif met en avant les mois offrant le meilleur compromis météo.

Le bouton **Remplir la météo du séjour** utilise les dates du Planning et les dates effectives des grandes étapes. Il enregistre une prévision lorsque le séjour se trouve dans l’horizon de 16 jours, la météo historique pour un séjour passé, ou une tendance climatique clairement signalée pour une date future plus lointaine. Une icône résume ensuite la météo de chaque étape dans la **Vue globale** et les indicateurs du séjour apparaissent dans **Comparer**.

Les données sont enregistrées dans `/home/pi/trips/trip-weather.json`, séparément des YAML de voyage. L’accès à Open-Meteo passe par l’API locale `./api/weather`.

Chaque réponse Open-Meteo est fusionnée immédiatement dans ce fichier avant d’être renvoyée à l’interface. Si une limite de requêtes interrompt le remplissage, une nouvelle tentative ignore les étapes déjà complètes et reprend sur les données manquantes. Les prévisions datant de plus de six heures restent actualisables.

## Trame globale et itinéraire détaillé

La **Vue globale** ne montre que les grandes étapes, leurs dates, leurs sous-étapes et l'hébergement prévu pour chaque nuit. L'**Itinéraire détaillé** conserve tous les lieux et permet de définir leur niveau :

- `stageType: main` désigne une grande étape affichée dans la trame globale ;
- `stageType: detail` désigne un lieu secondaire ;
- `parentStageId` rattache un lieu secondaire à la clé d'une grande étape ;
- `arrivalDate` et `departureDate` fixent les dates d'une grande étape.

La nuit de la date d'arrivée appartient à l'étape, tandis que la date de départ marque le passage vers l'étape suivante. Ces champs sont facultatifs. Pour un ancien YAML, l'application suggère automatiquement des grandes étapes à partir des zones géographiques et des lieux portant un tag d'hébergement. En l'absence de dates propres à une étape, la durée totale définie dans le Planning est répartie entre les grandes étapes.

Le nom et les dates des grandes étapes sont modifiables directement dans la Vue globale. Les pastilles de sous-étapes et d'hébergement peuvent être glissées sur une autre grande étape pour changer leur rattachement. Déplacer un hébergement ne modifie pas ses dates de réservation : la section **Chaque nuit** continue donc à signaler les nuits éventuellement non couvertes.

Chaque grande étape possède également les lignes **Hébergement**, **Déjeuner** et **Dîner**. Une sous-étape déposée sur l'une de ces lignes disparaît de la ligne **Sous-étapes** et reçoit automatiquement le tag `hébergement` ou `restaurant`. Chaque affectation conserve sa propre étape cible dans `stageId` : un même lieu peut ainsi servir dans plusieurs étapes, au déjeuner, au dîner et à l'hébergement. L'application crée un créneau relatif : l'hébergement couvre la période de l'étape, tandis que les repas reprennent les horaires configurés dans le Planning. Une seule réservation est conservée par repas et par étape. La croix d'une pastille, ou son déplacement vers **Sous-étapes**, retire uniquement l'affectation concernée. Les étapes de la Vue globale sont classées par date d'arrivée puis de départ. Le tableau **Chaque jour** récapitule les trois affectations pour chaque date, avec la couverture réelle de l'hébergement.

## Planning et dates fixes

L'onglet **Planning** répartit les activités et les trajets entre les contraintes enregistrées. Les trois repas sont toujours affichés, par défaut à 07:00, 12:00 et 19:00. Une information absente apparaît comme **À compléter**.

Lorsqu'un hébergement est réservé et associé à un lieu, chaque journée commence à l'hôtel de la nuit précédente et se termine à celui du soir, à l'heure de fin de journée configurée. Les trajets aller et retour sont inclus dans le temps disponible, y compris lors d'un changement d'hôtel ou de la reprise d'une visite le lendemain. Le jour d'arrivée conserve son point de départ habituel ; le jour du départ de l'hôtel ne prévoit plus de retour à cet hôtel, sauf nouvelle nuit réservée.

Dans **Itinéraire détaillé**, la section **Parcours quotidiens** reprend les lieux planifiés et les références **Départ** et **Nuit** des hôtels. Ces liens ouvrent la fiche existante du lieu : un même hôtel reste défini une seule fois, même s'il est utilisé plusieurs jours. Les repères d'hébergement du Planning sont également cliquables. Un hébergement saisi sans lieu associé reste affiché et son lien ouvre la réservation ; il faut lui associer un lieu pour calculer les trajets.

Les types de réservation acceptés sont :

- `activity` pour une visite ou une activité à heure fixe ;
- `meal` pour un restaurant, avec `meal` égal à `breakfast`, `lunch` ou `dinner` ;
- `lodging` pour un hôtel entre l'arrivée et le départ ;
- `travel` pour un vol, train ou autre transport réservé ;
- `other` pour une autre contrainte.

Chaque réservation accepte deux modes de date :

- `dateMode: fixed` conserve une date absolue dans `start` et `end` ; c'est le mode appliqué aux anciens YAML ;
- `dateMode: stage` utilise uniquement `startTime` et `endTime`. La date est reprise depuis la grande étape associée au lieu ; `relativeDay` vaut `arrival` ou `departure`.

Pour un lieu secondaire, le créneau relatif utilise les dates de son étape principale. Un créneau dont l'heure de fin précède l'heure de début se termine le lendemain.

`placeId` est facultatif. Lorsqu'il correspond à un lieu, le calcul ajoute le trajet nécessaire et ne planifie pas une seconde fois la même occurrence de ce lieu. Les bornes `startDate` et `endDate` peuvent être décalées depuis l'interface sans modifier les réservations fixes.

Une date fixe peut contenir plusieurs étapes grâce à `placeIds`. La liste suit l'ordre de l'itinéraire : le calcul rejoint le premier lieu avant le créneau, considère le dernier comme point de départ après le créneau et évite de replanifier chacun de ces lieux. `placeId` reste renseigné avec le premier lieu pour assurer la compatibilité avec les voyages existants.

## Garmin : Prévu / Réalisé

L'onglet **Prévu / Réalisé** permet de comparer une référence préparée avant le départ aux activités GPX exportées depuis Garmin Connect sur ordinateur.

1. Avant le départ, cliquez sur **Figer le prévu actuel**. Une référence datée conserve les grandes étapes, les noms et coordonnées des lieux, les dates, les durées/distances du planning et les tracés routiers OSRM. Chaque sauvegarde crée une nouvelle version, sans modifier les précédentes. Une référence créée après le voyage représente le planning au moment de cette sauvegarde, pas un historique reconstruit.
2. Après synchronisation de la montre, ouvrez l'activité dans Garmin Connect sur ordinateur et choisissez **Exporter en GPX** dans son menu.
3. Sélectionnez la référence et la grande étape dans Trip Planner, puis **Importer des GPX**. Plusieurs fichiers peuvent être associés à la même étape. Limites : 20 Mo et 100 000 points par fichier. Les GPX 1.0/1.1, espaces de noms Garmin, segments discontinus et horodatages avec fuseau sont pris en charge. Un fichier invalide est signalé sans empêcher les autres imports du lot. Un fichier déjà importé est reconnu par son contenu et conserve son affectation.
4. La carte superpose le **prévu figé en bleu** et les **enregistrements en vert**, pour toute l'étape ou un jour donné. Les points sans horodatage restent visibles dans « Toute l'étape » ; le filtre journalier n'utilise que les points datés, sans relier les portions exclues. Les dates et horaires sont affichés dans le fuseau du navigateur.

Les indicateurs présentent la distance prévue/réalisée, leur différence, les durées des déplacements prévus, la durée totale enregistrée et le temps en mouvement **estimé** (vitesse entre points d'au moins 1,8 km/h, intervalle au plus deux minutes). La durée totale est la somme des durées de chaque fichier, sans ajouter le temps entre fichiers. Elle inclut les pauses à l'intérieur d'un enregistrement. Des horaires absents, non croissants ou très espacés sont signalés ; les durées inconnues restent vides. Les distances sont calculées sur tous les points conservés, sans liaison artificielle entre segments GPX. Seul l'affichage cartographique est allégé pour les longues traces.

La distance hors du couloir prévu est une estimation par milieu de segment, avec une tolérance réglable de 50 à 500 mètres. Elle n'est calculée que si la référence contient des tracés routiers complets ; une liaison indicative (transport réservé ou routage indisponible) ne permet pas cette mesure. Le routage de référence est automobile, comme les cartes existantes. La proximité des lieux est affichée comme **À proximité**, **Non observé** ou **Non vérifiable**, sans prétendre confirmer une visite. Les interruptions de trace et grands sauts GPS ne sont pas utilisés pour déduire un passage. Les traces qui se chevauchent dans le temps sont signalées car leurs totaux peuvent compter deux fois un même parcours.

La liste **Toutes les traces enregistrées pour ce voyage** permet de supprimer une trace ou de la rattacher à la référence et à l'étape sélectionnées. Les lieux et références archivés restent disponibles même si le voyage courant change. Les données sont enregistrées sur le serveur dans `/home/pi/trips/recordings/`, un fichier JSON par voyage (identifiant haché), séparément du YAML. Elles sont donc conservées après rechargement et accessibles depuis un autre navigateur. Elles ne font pas partie de l'export YAML. Les routes `GET`, `POST`, `PUT` et `DELETE /trip_planner/api/recordings` sont définies dans le flow Trip Planner ; le module `recordings-store.js` effectue les validations et écrit les mises à jour de façon atomique.

Le réglage Node-RED `apiMaxLength: '50mb'` dans `/home/eric/.node-red-clean/settings.js` permet le transport des GPX de 20 Mo avec l'échappement JSON et les métadonnées. Un changement de ce réglage nécessite un redémarrage de Node-RED.

### Une randonnée couvrant plusieurs jours prévus

Choisissez **Périmètre prévu → Ensemble du voyage**, puis votre randonnée dans **Enregistrement à comparer**. Une trace déjà rattachée à une étape peut être comparée à tout le voyage sans réimportation ni réaffectation. Le filtre **Jour enregistré** limite uniquement les points GPS : tous les trajets et lieux prévus du voyage restent comparés, y compris les monuments des jours suivants. Les lieux répétés sont regroupés avec les noms de leurs étapes. Les visites actives du voyage absentes de la référence sont aussi recherchées et indiquées comme **lieu actuel ajouté**, sans modifier la référence figée. Un GPX peut également être importé directement au niveau **Ensemble du voyage**.

Le bouton **Marquer réalisés les lieux à ≤ 100 m** marque en une fois les visites détectées par les traces affichées. Le seuil de ce bouton reste fixé à 100 m, indépendamment du seuil choisi pour afficher la proximité sur la carte. Chaque lieu dispose aussi d'une case **Réalisé**, modifiable dans cette vue et dans **Itinéraire détaillé**. Les hôtels, restaurants réservés, transports, points de départ et grandes étapes regroupant des sous-étapes ne sont pas marqués comme des monuments réalisés. La suppression d'une trace ne remet pas automatiquement les visites à faire ; décochez **Réalisé** pour annuler un statut.

Les visites réalisées gardent leur fiche et leur rattachement, mais sont exclues des trajets et activités du planning restant, ainsi que de leurs contraintes de visite. Le statut **Optionnel** reste indépendant. La vue globale signale les sous-étapes réalisées ; le carnet PDF les liste séparément. Les références GPS déjà figées conservent leur contenu initial.

Choisissez ensuite **Premier jour restant**, puis **Replanifier les visites restantes**. Le premier jour du planning est déplacé à cette date et le planning est recalculé. Les dates propres aux grandes étapes et les réservations restantes sont conservées : ajustez-les si nécessaire et ajoutez des visites depuis les Options ou le formulaire d'ajout pour remplir les créneaux libérés.

Les statuts sont conservés dans `completedPlaces` dans le fichier serveur du voyage sous `/home/pi/trips/recordings/`, avec la date de marquage et, pour un marquage GPS, la référence et les traces sources. Ils sont chargés dans toutes les vues et restent enregistrés après rechargement. Ils sont distincts du YAML et ne sont pas inclus dans son export. `GET /trip_planner/api/recordings?tripId=…&progress=1` renvoie uniquement les statuts ; `PUT` avec `action: completed` permet leur mise à jour, après validation des lieux du YAML courant.

## Carnet de route PDF

L'onglet Planning propose quatre exports :

- **Planning PDF** présente le planning dans un tableau A4 paysage, avec une ligne par jour et les colonnes `07:00–09:00`, `09:00–12:00`, `12:00–14:00`, `14:00–16:00`, `16:00–19:00` et `19:00–22:00` ;
- **Carnet complet PDF** génère un carnet de route utilisable sans l'application et sans accès réseau, avec les informations pratiques, coordonnées GPS, trajets, réservations, budget et lieux optionnels en annexe ;
- **Trajets PDF avec cartes**, également disponible dans l'onglet **Trajets**, exporte uniquement les déplacements, avec une page A4 paysage par segment : jour et horaires lorsqu'ils sont définis, départ A, arrivée B, coordonnées GPS, distance, durée et carte intégrée ;
- **Plans des étapes PDF**, également accessible depuis **Vue globale** et **Trajets**, regroupe tous les trajets d'une grande étape sur une même carte A4 paysage, même si l'étape couvre plusieurs jours. Les parcours sont colorés par jour et les lieux sont numérotés, avec les hôtels en vert. La légende donne les noms des lieux et l'ordre des parcours. Elle se poursuit sur des pages supplémentaires si nécessaire, sans retirer de trajet du plan.

Le plan d'étape utilise les rattachements des sous-étapes et les dates pour distinguer les passages répétés au même lieu. Les retours à l'hôtel sont rattachés à l'étape visitée ; les liaisons entre grandes étapes appartiennent à l'étape d'arrivée. Chaque trajet est compté une fois, y compris les allers-retours répétés. Les étapes sans déplacement montrent leurs lieux connus. Un trajet non rattachable est conservé dans une section dédiée. Comme pour l'export par segment, les lieux optionnels et visites non planifiées ne sont pas ajoutés aux parcours du planning.

L'export des trajets suit les déplacements du Planning, y compris les départs et retours aux hôtels. Sans dates de planning, il reprend les segments dans l'ordre de l'itinéraire. Les transports réservés sont représentés par une liaison indicative, sans les assimiler à un trajet en voiture. Un trajet sans coordonnées reste présent avec la mention « Carte indisponible ».

Les fichiers sont produits directement par le navigateur. **Planning PDF** et **Carnet complet PDF** n'utilisent aucun service externe. Pour les deux exports avec cartes, une connexion permet de charger les fonds OpenStreetMap et les tracés routiers OSRM à partir des coordonnées des segments ; les cartes sont ensuite intégrées dans le fichier et restent lisibles hors ligne. Une progression accompagne leur préparation. Les cartes et tuiles identiques sont réutilisées pendant l'export. Si un service est indisponible, le PDF indique explicitement le fond manquant ou partiel et les liaisons à vol d'oiseau utilisées en remplacement du tracé routier.

## Vérification

```bash
npm run check
npm run check:gps
npm test
```
