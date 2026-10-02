const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const flows = require('./helpers/flows.cjs');
const nodeById = id => flows.find(node => node.id === id);

function runFunctionNode(id, msg, store = new Map()) {
    const definition = nodeById(id);
    const flow = { get: key => store.get(key), set: (key, value) => store.set(key, value) };
    const node = { status() {}, warn(error) { throw error; } };
    return new Function('msg', 'flow', 'node', definition.func)(msg, flow, node);
}

test('le flux actif passe par les nœuds de planning', () => {
    assert.ok(nodeById('b00f95e12c6f33e5').wires[0].includes('a91f6c2d8e4b7303'));
    assert.deepEqual(nodeById('4049043285ef6e63').wires[0], ['a91f6c2d8e4b7301']);
    assert.deepEqual(nodeById('1ca347c774e927ca').wires[0], ['a91f6c2d8e4b7302']);
    const autosave = nodeById('1a3088d4aed38557');
    assert.ok(autosave.rules.some(rule => rule.v === 'setPeople'));
    assert.ok(autosave.rules.some(rule => rule.v === 'setBudgetCurrencies'));
    assert.ok(autosave.rules.some(rule => rule.v === 'setTripNotes'));
    assert.equal(autosave.outputs, 10);
});

test('le registre des voyages est restauré au démarrage', () => {
    const loader = nodeById('a91f6c2d8e4b7304');
    assert.equal(loader.type, 'function');
    assert.match(loader.initialize, /readFileSync\('\/home\/pi\/trips\/trips\.json'/);
    assert.match(loader.initialize, /flow\.set\('tripRegistry', registry\)/);
});

test('charge, modifie et sérialise un planning avec ses réservations', () => {
    const store = new Map();
    const initialPlanning = {
        startDate: '2026-09-10', endDate: '2026-09-12',
        reservations: [{ id: 'hotel', title: 'Hôtel du Lac', kind: 'lodging', start: '2026-09-10T16:00', end: '2026-09-12T10:00' }]
    };
    const loaded = runFunctionNode('a91f6c2d8e4b7301', {
        payload: {
            people: 5,
            budgetCurrencies: ['EUR', 'CHF'],
            startPlaceId: 'lake',
            notes: 'Prévoir les passeports.',
            itinerary: ['lake'],
            places: { lake: { name: 'Lac', lat: 46.2, lng: 6.1, duration_h: 2, budget: 120, budgetFree: true, budgetCurrency: 'eur', budgetScope: 'group', slot: 'morning', stageType: 'main', arrivalDate: '2026-09-10', arrivalTime: '08:30', departureDate: '2026-09-12', departureTime: '18:00', relativePeriod: ' j1-j3 ' }, town: { name: 'Centre-ville', lat: 46.21, lng: 6.11, duration_h: 1, budget: 15, stageType: 'detail', parentStageId: 'lake' } },
            planning: initialPlanning
        }
    }, store);
    assert.equal(loaded.payload.state.planning.reservations[0].title, 'Hôtel du Lac');
    assert.equal(loaded.payload.state.people, 5);
    assert.deepEqual(loaded.payload.state.budgetCurrencies, ['EUR', 'CHF']);
    assert.equal(loaded.payload.state.places.lake.slot, 'morning');
    assert.equal(loaded.payload.state.places.lake.arrivalTime, '08:30');
    assert.equal(loaded.payload.state.places.lake.departureTime, '18:00');
    assert.equal(loaded.payload.state.places.lake.relativePeriod, 'J1-J3');
    assert.equal(loaded.payload.state.startPlaceId, 'lake');
    assert.equal(loaded.payload.state.notes, 'Prévoir les passeports.');
    assert.equal(loaded.payload.state.places.town.parentStageId, 'lake');
    assert.equal(loaded.payload.state.places.lake.budgetCurrency, 'EUR');
    assert.equal(loaded.payload.state.places.lake.budgetScope, 'group');
    assert.equal(loaded.payload.state.places.lake.budgetFree, true);
    assert.equal(loaded.payload.state.places.town.budgetCurrency, 'EUR');
    assert.equal(loaded.payload.state.places.town.budgetScope, 'individual');
    assert.equal(loaded.payload.state.places.town.budgetFree, false);

    const updated = runFunctionNode('a91f6c2d8e4b7303', {
        payload: {
            action: 'setPlanning',
            data: {
                ...initialPlanning,
                reservations: [{ ...initialPlanning.reservations[0], placeId: 'lake', placeIds: ['lake', 'town'], stageId: 'lake', dateMode: 'stage', relativeDay: 'arrival', startTime: '18:00', endTime: '09:00' }],
                meals: {
                    breakfast: { at: '07:00', durationMin: 45 },
                    lunch: { at: '12:00', durationMin: 60 },
                    dinner: { at: '19:00', durationMin: 75 }
                }
            }
        }
    }, store);
    assert.equal(updated[0].payload.state.planning.meals.dinner.at, '19:00');
    assert.equal(updated[0].payload.state.planning.reservations[0].kind, 'lodging');
    assert.deepEqual(updated[0].payload.state.planning.reservations[0].placeIds, ['lake', 'town']);
    assert.equal(updated[0].payload.state.planning.reservations[0].dateMode, 'stage');
    assert.equal(updated[0].payload.state.planning.reservations[0].startTime, '18:00');
    assert.equal(updated[0].payload.state.planning.reservations[0].stageId, 'lake');

    const saved = runFunctionNode('a91f6c2d8e4b7302', { payload: {} }, store);
    assert.equal(saved.payload.planning.reservations[0].id, 'hotel');
    assert.equal(saved.payload.people, 5);
    assert.deepEqual(saved.payload.budgetCurrencies, ['EUR', 'CHF']);
    assert.deepEqual(saved.payload.planning.reservations[0].placeIds, ['lake', 'town']);
    assert.equal(saved.payload.planning.reservations[0].relativeDay, 'arrival');
    assert.equal(saved.payload.planning.reservations[0].stageId, 'lake');
    assert.equal(saved.payload.places.lake.slot, 'morning');
    assert.equal(saved.payload.places.lake.stageType, 'main');
    assert.equal(saved.payload.places.lake.arrivalDate, '2026-09-10');
    assert.equal(saved.payload.places.lake.arrivalTime, '08:30');
    assert.equal(saved.payload.places.lake.departureTime, '18:00');
    assert.equal(saved.payload.places.lake.relativePeriod, 'J1-J3');
    assert.equal(saved.payload.startPlaceId, 'lake');
    assert.equal(saved.payload.notes, 'Prévoir les passeports.');
    assert.equal(saved.payload.places.town.stageType, 'detail');
    assert.equal(saved.payload.places.town.parentStageId, 'lake');
    assert.equal(saved.payload.places.lake.budgetCurrency, 'EUR');
    assert.equal(saved.payload.places.lake.budgetScope, 'group');
    assert.equal(saved.payload.places.lake.budgetFree, true);
    assert.equal(saved.payload.places.town.budgetCurrency, 'EUR');
    assert.equal(saved.payload.places.town.budgetScope, 'individual');
    assert.equal(saved.payload.places.town.budgetFree, false);
});

test('le contrôleur normalise les informations de budget', () => {
    const store = new Map();
    const added = runFunctionNode('96717b0cf0275851', {
        payload: { action: 'addPlace', data: { name: 'Hôtel', budget: 200, budgetFree: true, budgetCurrency: 'eur', budgetScope: 'group' } }
    }, store);
    const id = added.payload.state.itinerary[0];
    assert.equal(added.payload.state.places[id].budgetCurrency, 'EUR');
    assert.equal(added.payload.state.places[id].budgetScope, 'group');
    assert.equal(added.payload.state.places[id].budgetFree, true);

    const updated = runFunctionNode('96717b0cf0275851', {
        payload: { action: 'updatePlace', data: { id, patch: { budget: -5, budgetFree: false, budgetCurrency: 'bad currency', budgetScope: 'other' } } }
    }, store);
    assert.equal(updated.payload.state.places[id].budget, 0);
    assert.equal(updated.payload.state.places[id].budgetCurrency, 'CHF');
    assert.equal(updated.payload.state.places[id].budgetScope, 'individual');
    assert.equal(updated.payload.state.places[id].budgetFree, false);
});

test('le contrôleur sauvegarde le nombre de participants', () => {
    const store = new Map();
    runFunctionNode('96717b0cf0275851', {
        payload: { action: 'setPeople', data: { people: 7 } }
    }, store);
    const result = runFunctionNode('a91f6c2d8e4b7302', { payload: {} }, store);

    assert.equal(result.payload.people, 7);
});

test('le contrôleur conserve le point de départ et normalise le repère relatif', () => {
    const store = new Map();
    const first = runFunctionNode('96717b0cf0275851', {
        payload: { action: 'addPlace', data: { name: 'Aéroport' } }
    }, store);
    const firstId = first.payload.state.itinerary[0];
    const second = runFunctionNode('96717b0cf0275851', {
        payload: { action: 'addPlace', data: { name: 'Hôtel' } }
    }, store);
    const secondId = second.payload.state.itinerary[1];

    runFunctionNode('96717b0cf0275851', {
        payload: { action: 'updatePlace', data: { id: secondId, patch: { relativePeriod: ' j3-j6 ' } } }
    }, store);
    const updated = runFunctionNode('96717b0cf0275851', {
        payload: { action: 'reorder', data: { itinerary: [firstId, secondId], startPlaceId: secondId } }
    }, store);
    assert.equal(updated.payload.state.startPlaceId, secondId);
    assert.equal(updated.payload.state.places[secondId].relativePeriod, 'J3-J6');

    runFunctionNode('96717b0cf0275851', {
        payload: { action: 'setTripNotes', data: { notes: 'Réserver une voiture.' } }
    }, store);
    const saved = runFunctionNode('a91f6c2d8e4b7302', { payload: {} }, store);
    assert.equal(saved.payload.startPlaceId, secondId);
    assert.equal(saved.payload.places[secondId].relativePeriod, 'J3-J6');
    assert.equal(saved.payload.notes, 'Réserver une voiture.');
});

test('la première devise du voyage devient la devise par défaut', () => {
    const store = new Map();
    runFunctionNode('96717b0cf0275851', {
        payload: { action: 'setBudgetCurrencies', data: { currencies: ['EUR', 'USD'] } }
    }, store);
    const added = runFunctionNode('96717b0cf0275851', {
        payload: { action: 'addPlace', data: { name: 'Visite', budget: 20 } }
    }, store);
    const id = added.payload.state.itinerary[0];

    assert.deepEqual(added.payload.state.budgetCurrencies, ['EUR', 'USD']);
    assert.equal(added.payload.state.places[id].budgetCurrency, 'EUR');

    const migrated = runFunctionNode('96717b0cf0275851', {
        payload: { action: 'setBudgetCurrencies', data: { currencies: ['USD'] } }
    }, store);
    assert.deepEqual(migrated.payload.state.budgetCurrencies, ['USD']);
    assert.equal(migrated.payload.state.places[id].budgetCurrency, 'USD');
});

test('l’interface expose l’onglet planning et les trois repas par défaut', () => {
    const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
    const index = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8');
    const planningUi = fs.readFileSync(path.join(__dirname, '../src/planning-ui.js'), 'utf8');
    assert.match(html, /data-page="planning"/);
    assert.match(html, /data-page="segments"[^>]*>Trajets</);
    assert.match(html, /data-page="add"[^>]*aria-label="Ajouter une étape"[^>]*>＋<\/button>/);
    assert.ok(html.indexOf('data-page="add"') > html.indexOf('data-page="settings"'));
    assert.ok(html.indexOf('planning-ui.js') < html.indexOf('index.js'));
    assert.ok(html.indexOf('route-optimizer.js') < html.indexOf('index.js'));
    assert.ok(html.indexOf('trip-structure.js') < html.indexOf('index.js'));
    assert.ok(html.indexOf('trip-comparison.js') < html.indexOf('comparison-ui.js'));
    assert.ok(html.indexOf('weather.js') < html.indexOf('trip-comparison.js'));
    assert.ok(html.indexOf('weather-ui.js') < html.indexOf('comparison-ui.js'));
    assert.ok(html.indexOf('comparison-ui.js') < html.indexOf('index.js'));
    assert.ok(html.indexOf('wikimedia-images.js') < html.indexOf('index.js'));
    assert.match(html, /id="cardOutline"/);
    assert.match(html, /id="tripNotes"/);
    assert.match(index, /send\('setTripNotes', \{ notes: state\.notes \}\)/);
    assert.match(html, /id="tripCurrenciesList"/);
    assert.match(html, /id="tripCurrencyAdd"/);
    assert.match(html, /La première devise est utilisée par défaut/);
    assert.match(index, /class="budget-amount"/);
    assert.match(index, /class="budget-currency"/);
    assert.match(index, /class="budget-scope"/);
    assert.match(index, /class="budget-free"/);
    assert.match(index, /entry\.free \? 'hidden' : ''/);
    assert.match(index, /send\('setPeople', \{ people \}\)/);
    assert.match(index, /send\('setBudgetCurrencies', \{ currencies \}\)/);
    assert.match(index, /data-currency-remove/);
    assert.match(index, /data-currency-default/);
    assert.match(css, /\.budget-item \[hidden\] \{\s*display: none;/);
    assert.doesNotMatch(index, /<div style="flex:2"><b>Total<\/b><\/div>/);
    assert.match(html, />Vue globale</);
    assert.match(html, />Itinéraire détaillé</);
    assert.match(html, /id="breakfastAt"[^>]+value="07:00"/);
    assert.match(html, /id="lunchAt"[^>]+value="12:00"/);
    assert.match(html, /id="dinnerAt"[^>]+value="19:00"/);
    assert.match(html, />Recalculer le planning</);
    assert.match(html, /id="exportPlanningOnlyPdf"[^>]*>Planning PDF</);
    assert.match(html, /id="exportPlanPdf"[^>]*>Carnet complet PDF</);
    assert.equal((html.match(/data-export-routes-pdf class=/g) || []).length, 2);
    assert.equal((html.match(/data-export-stage-routes-pdf class=/g) || []).length, 3);
    assert.match(index, /button\.onclick = exportStageRoutesPdf/);
    assert.ok(html.indexOf('route-maps.js') < html.indexOf('planning-ui.js'));
    assert.match(index, /button\.onclick = exportRoutesPdf/);
    assert.match(html, /id="fixedPlaces"/);
    assert.match(html, /id="fixedDateMode"/);
    assert.match(html, /Relative à l’étape/);
    assert.ok(html.indexOf('pdf-export.js') < html.indexOf('planning-ui.js'));
    for (const name of ['saveFixedDate', 'resetFixedForm', 'toggleFixedMealField', 'shiftPlanningDate', 'renderPlanningControls']) {
        assert.match(planningUi, new RegExp(`function ${name}\\(`));
    }
    assert.match(planningUi, /function generatePlan\(/);
    assert.match(planningUi, /function exportPlanningPdf\(/);
    assert.match(planningUi, /function exportPlanningOnlyPdf\(/);
    assert.match(index, /exportPlanPdf.*exportPlanningPdf/);
    assert.match(index, /exportPlanningOnlyPdf.*exportPlanningOnlyPdf/);
    assert.doesNotMatch(index, /function generatePlan\(/);
    assert.match(planningUi, /function placeFixedDatesMarkup\(placeId, placeName\)/);
    assert.match(planningUi, /function bindPlaceFixedDateControls\(placeElement, placeId\)/);
    assert.match(planningUi, /typeFromFirstTag\(place\.tags \|\| \[\]\)\.glyph/);
    assert.match(planningUi, /function formatEventDuration\(event\)/);
    assert.match(planningUi, /planning-event__duration/);
    assert.match(planningUi, /placeIds,/);
    assert.match(planningUi, /function reservationPlaceIds\(reservation\)/);
    assert.match(planningUi, /function toggleFixedDateMode\(/);
    assert.match(planningUi, /function reservationTimingLabel\(/);
    assert.match(index, /placeFixedDatesMarkup\(id, p\.name\)/);
    assert.match(index, /bindPlaceFixedDateControls\(item, id\)/);
    assert.doesNotMatch(html, /id="dockMap"/);
    assert.match(css, /body\[data-page="planning"\] #cardSegments/);
    assert.match(css, /body\[data-page="planning"\] #cardBudget/);
    assert.match(css, /body\[data-page="planning"\] \.col-right/);
    assert.match(css, /body\[data-page="segments"\] \.col-right/);
    assert.match(css, /#mapContainer \{[\s\S]*?position: fixed;[\s\S]*?width: 50%;/);
    assert.match(html, /id="btnOptimizeRoute"/);
    assert.match(index, /TripRouteOptimizer\.optimizeRoundTrip\(table\.durations\)/);
    assert.match(index, /data-route-apply/);
    assert.match(index, /\[\.\.\.originalIds, originalIds\[0\]\]/);
    assert.match(html, /data-page="candidates"[^>]*>Options</);
    const menuOrder = ['overview', 'itinerary', 'planning', 'segments', 'recordings', 'budget', 'weather', 'compare', 'map', 'candidates', 'settings'];
    for (let i = 1; i < menuOrder.length; i += 1) {
        assert.ok(html.indexOf(`data-page="${menuOrder[i]}"`) > html.indexOf(`data-page="${menuOrder[i - 1]}"`));
    }
    assert.match(html, /id="gpsFiles"[^>]*multiple/);
    assert.match(html, /Figer le prévu actuel/);
    assert.ok(html.indexOf('gps-comparison.js') < html.indexOf('recordings-ui.js'));
    assert.ok(html.indexOf('recordings-ui.js') < html.indexOf('index.js'));
    assert.match(index, /initRecordingsUi\(\)/);
    assert.match(html, /id="candidateSelectAll"/);
    assert.match(html, /id="candidateCreateTrip"/);
    assert.match(html, /data-page="compare"[^>]*>Comparer</);
    assert.match(html, /id="cardCompare"/);
    assert.match(html, /id="comparisonTrips"/);
    assert.match(fs.readFileSync(path.join(__dirname, '../src/comparison-ui.js'), 'utf8'), /class="offer-flight-status"/);
    assert.match(fs.readFileSync(path.join(__dirname, '../src/comparison-ui.js'), 'utf8'), /Total forfait \+ vol/);
    assert.match(index, /'compare'/);
    assert.match(html, /data-page="weather"[^>]*>Météo</);
    assert.match(html, /id="cardWeather"/);
    assert.match(html, /id="weatherFillClimate"/);
    assert.match(html, /id="weatherFillStay"/);
    assert.match(index, /stageWeatherBadge\(stage\.id, stage\.arrivalDate\)/);
    assert.match(css, /body\[data-page="weather"\] #cardWeather/);
    assert.match(html, /id="btnFindImage"/);
    assert.match(html, /id="btnFillImages"/);
    assert.match(index, /TripWikimediaImages\.findImage/);
    assert.match(index, /function fillMissingImages\(/);
    assert.match(index, /function beginCandidateTripCreation\(\)/);
    assert.match(index, /function continueCandidateImport\(\)/);
    assert.match(index, /SELECTED_CANDIDATE_IDS/);
    assert.match(index, /send\('createTrip', \{ name: name\.trim\(\) \}\)/);
    assert.match(index, /stageType: '',[\s\S]*?parentStageId: ''/);
    assert.match(index, /function markPlaceOptional\(id\)/);
    assert.match(index, /className = `item optional-place/);
    assert.match(html, /id="gpsTrackSelect"/);
    assert.match(html, /id="gpsMarkCompleted"/);
    assert.match(html, /id="gpsReplanRemaining"/);
    assert.match(index, /completed-toggle/);
    assert.match(index, /applyVisitProgress\(\); loadVisitProgress\(\)/);
    assert.match(index, /state\.itinerary\.filter\(placeId => placeId !== id\)/);
    assert.match(index, /function renderTripOutline\(\)/);
    assert.match(index, /function setTripStartPlace\(id\)/);
    assert.match(index, /data-start-place/);
    assert.match(index, /data-stage-relative/);
    assert.match(index, /normalizeRelativePeriod\(input\.value\)/);
    assert.match(index, /class=\"stageType\"/);
    assert.match(index, /class=\"parentStage\"/);
    assert.match(index, /class=\"placeName\" type=\"text\"/);
    assert.match(index, /send\('updatePlace', \{ id, patch: \{ name \} \}\)/);
    assert.match(css, /\.place-name-editor \.placeName/);
    assert.match(index, /data-stage-name/);
    assert.match(index, /data-stage-date/);
    assert.match(index, /class=\"stageArrivalTime\" type=\"time\"/);
    assert.match(index, /class=\"stageDepartureTime\" type=\"time\"/);
    assert.match(index, /TripStructure\.stagePeriodLabel\(stage\)/);
    assert.match(index, /class=\"outline-stage__period\"/);
    assert.match(index, /weekday: 'long'/);
    assert.match(index, /class=\"outline-stage__weekday\"/);
    assert.match(index, /data-drag-type=\"detail\"/);
    assert.match(index, /data-drag-type=\"constraint\"/);
    assert.match(index, /function moveOutlineConstraint\(/);
    assert.match(index, /data-drop-kind=\"lodging\"/);
    assert.match(index, /data-drop-kind=\"morning\"/);
    assert.match(index, /data-drop-kind=\"lunch\"/);
    assert.match(index, /data-drop-kind=\"afternoon\"/);
    assert.match(index, /data-drop-kind=\"dinner\"/);
    assert.match(index, /data-drop-kind=\"evening\"/);
    assert.match(index, /class=\"outline-stage__assignments\">\s*<div[^>]*data-drop-kind=\"morning\"[^>]*><strong>Matin<\/strong>[\s\S]*?<div[^>]*data-drop-kind=\"lunch\"[^>]*><strong>Déjeuner<\/strong>[\s\S]*?<div[^>]*data-drop-kind=\"afternoon\"[^>]*><strong>Après-Midi<\/strong>[\s\S]*?<div[^>]*data-drop-kind=\"dinner\"[^>]*><strong>Dîner<\/strong>[\s\S]*?<div[^>]*data-drop-kind=\"evening\"[^>]*><strong>Soir<\/strong>[\s\S]*?<div[^>]*data-drop-kind=\"lodging\"[^>]*><strong>Hébergement<\/strong>/);
    assert.match(css, /\.outline-stage__assignments \{[\s\S]*?grid-template-columns: repeat\(6, minmax\(0, 1fr\)\);/);
    assert.match(index, /function assignPlaceToOutlineSection\(/);
    assert.match(index, /outlineSectionTag\(section\)/);
    assert.match(index, /function removeOutlineConstraint\(/);
    assert.match(index, /function duplicateOutlineConstraint\(/);
    assert.match(index, /data-duplicate-constraint=/);
    assert.match(index, /duplicateOutlineConstraint\(button\.dataset\.duplicateConstraint\)/);
    assert.match(index, /data-remove-constraint=/);
    assert.match(index, /stage\.detailIds\.filter\(id => !assignedPlaceIds\.has\(id\)\)/);
    assert.match(index, /detailsBySection\[outlineDetailSection\(state\.places\[id\]\)\]\.push\(id\)/);
    assert.match(index, /const patch = \{ stageType: 'detail', parentStageId: stageId, \.\.\.\(activitySlot \? \{ slot: activitySlot \} : \{\}\) \};/);
    assert.match(index, /reservation\.id !== reservationId/);
    assert.match(index, /stageId \};/);
    assert.match(index, /function outlineConstraintStageId\(/);
    assert.match(index, /class="night-table"/);
    assert.match(index, /<h3>Chaque jour<\/h3>/);
    assert.match(index, /TripStructure\.chronologicalStages\(outline\.stages\)/);
    assert.match(index, /TripStructure\.tripDays\(state\.planning\)/);
    assert.match(index, /TripStructure\.stagesForDate\(chronologicalStages, day\.date\)/);
    assert.match(index, /<th>Date<\/th><th>Déjeuner<\/th><th>Dîner<\/th><th>Hébergement<\/th>/);
    assert.match(index, /cellMarkup\(meals\('lunch'\)/);
    assert.match(index, /cellMarkup\(meals\('dinner'\)/);
    assert.match(index, /class="outline-missing">Déposez un lieu de restaurant ici/);
});
