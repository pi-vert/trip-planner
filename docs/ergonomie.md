# Parcours et usage des YAML

## Audit du 2 octobre 2026

Analyse en lecture seule des **20 voyages du registre actif**, soit **268 lieux**. Les sauvegardes `.save`, `.old` et les voyages ignorés ne sont pas inclus. Les valeurs vides, tableaux vides, objets vides, zéros et booléens faux ne sont pas comptés comme renseignés. Pour les coordonnées, tous les lieux de cet échantillon ont des valeurs non nulles.

Ce relevé mesure le contenu enregistré, pas la fréquence d’utilisation de l’interface. Les imports peuvent remplir des champs et l’application sérialise des valeurs par défaut. Par exemple, la durée existe pour tous les lieux, mais seulement 152 ont une valeur différente des 2 heures proposées.

| Information | Lieux renseignés / 268 | Voyages concernés / 20 |
| --- | ---: | ---: |
| Nom et coordonnées | 268 | 20 |
| Durée différente de 2 h | 152 | 14 |
| Description | 163 | 14 |
| Catégories (tags) | 148 | 11 |
| Budget non nul | 94 | 9 |
| Notes / votes | 79 | 9 |
| Niveau étape / sous-étape explicite | 119 | 9 |
| Rattachement à une étape | 83 | 8 |
| Photo / URL d’image non vide | 152 | 7 |
| Lien d’information | 80 | 6 |
| Moment préféré | 56 | 6 |
| Dates d’arrivée / départ propres aux étapes | 42 / 44 | 4 |
| Repères J1 / J3-J6… | 9 | 2 |
| Jours de fermeture | 2 | 1 |
| Heures d’arrivée / départ propres aux étapes | 0 | 0 |
| Groupes d’alternatives | 0 | 0 |

5 voyages ont des dates de séjour, 5 contiennent des réservations, 3 conservent des lieux optionnels. 4 voyages personnalisent le rythme des journées ou des repas. Les champs récemment ajoutés ou encore vides restent utiles : ils sont proposés à la demande, pas supprimés.

Rejouer l’audit :

```sh
node scripts/analyze-yaml-usage.cjs /home/pi/trips
```

## Décisions d’interface

- **Préparer** : quatre entrées principales — Étapes, Lieux, Séjour (dates et réservations), Budget. Un guide non bloquant propose de choisir les lieux, les organiser puis préciser le séjour. Dates facultatives ; aucun formulaire obligatoire de « finalisation ».
- **En voyage** : Mon voyage, Jour par jour, Carte, Suivi GPS. Le carnet présente les étapes, photos, visites, hébergements et repas, avec accès direct à la carte et à la modification de chaque lieu.
- **Un même voyage** : le mode est une préférence locale d’affichage. Il ne copie, ne fige ni ne transforme le YAML. Le bouton « Modifier le voyage » et les boutons « Modifier » ramènent aux outils de préparation ; la consultation reflète ensuite les changements.
- **Outils** : météo, comparaison, trajets, lieux optionnels et réglages restent disponibles dans les deux modes. Les liens directs `#page=…` continuent de fonctionner.
- **Saisie progressive** : recherche, nom, description, durée, budget et catégories au premier plan. Coordonnées manuelles, contraintes, photos, rattachement et dates détaillées se déplient au besoin. Les informations existantes sont conservées dans les champs repliés.
- **Fiches compactes** : aperçu des lieux et formulaire « Modifier les informations ». Les sections ouvertes restent ouvertes après une synchronisation du même voyage.
- **Planning** : dates accessibles, rythme avancé replié, formulaire de réservation ouvert à la demande et automatiquement lors d’une modification ; exports regroupés.
- **Mobile** : le carnet apparaît avant la carte ; la carte dispose de son écran dédié. La barre principale expose quatre destinations et un menu Outils.
- **Gestion** : renommage, suppression et échanges YAML regroupés sous « Gérer ». L’identité utilisée pour les votes est dans Réglages.
