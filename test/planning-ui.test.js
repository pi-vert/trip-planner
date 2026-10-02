const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildPlan } = require('../src/planning.js');

function loadUi(state) {
    const wrap = { innerHTML: '', hidden: true };
    const calls = [];
    const placeEditor = { open: false };
    const context = vm.createContext({
        state,
        CSS: { escape: value => String(value) },
        $: selector => selector === '#dailyRoutes' ? wrap : null,
        escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
        document: {
            querySelector: selector => selector.endsWith('.place-editor') ? placeEditor : ({ click: () => calls.push(selector) }),
            querySelectorAll: () => [{ classList: { remove: value => calls.push(`remove:${value}`) } }]
        },
        renderPlaces: () => calls.push('renderPlaces'),
        attachDnD: () => calls.push('attachDnD'),
        focusPlace: id => calls.push(`focus:${id}`)
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/planning-ui.js'), 'utf8'), context);
    return { context, wrap, calls, placeEditor };
}

test('les parcours détaillés réutilisent la même fiche hôtel au départ et au retour', () => {
    const state = {
        itinerary: ['hotel', 'visit'],
        places: { hotel: { name: 'Hôtel <Lac>', lat: 46, lng: 6 }, visit: { name: 'Musée', lat: 46.1, lng: 6.1, durationH: 2 } },
        planning: { startDate: '2026-09-10', endDate: '2026-09-10', reservations: [
            { id: 'stay', title: 'Hôtel <Lac>', kind: 'lodging', placeId: 'hotel', start: '2026-09-09T16:00', end: '2026-09-11T10:00' }
        ] }
    };
    const before = JSON.stringify(state);
    const { context, wrap, calls, placeEditor } = loadUi(state);
    context.renderDailyRoutes(buildPlan(state));
    assert.equal(wrap.hidden, false);
    assert.match(wrap.innerHTML, /Départ/);
    assert.match(wrap.innerHTML, /Nuit/);
    assert.match(wrap.innerHTML, /Hôtel &lt;Lac&gt;/);
    const links = [...wrap.innerHTML.matchAll(/data-place-definition="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(links, ['hotel', 'visit', 'hotel']);
    assert.equal(JSON.stringify(state), before, 'les références ne dupliquent aucun lieu ni aucune réservation');

    wrap.onclick({ target: { closest: selector => selector === '[data-place-definition]' ? { dataset: { placeDefinition: 'hotel' } } : null } });
    assert.deepEqual(calls, ['.tab[data-page="itinerary"]', 'remove:on', 'renderPlaces', 'attachDnD', 'focus:hotel']);
    assert.equal(placeEditor.open, true, 'le formulaire replié du lieu devient accessible');
    context.renderDailyRoutes(null);
    assert.equal(wrap.hidden, true);
    assert.equal(wrap.innerHTML, '');
});

test('un hôtel sans fiche ouvre sa réservation depuis le parcours détaillé', () => {
    const { context, wrap, calls } = loadUi({ places: {} });
    context.editFixedDate = id => calls.push(`edit:${id}`);
    context.renderDailyRoutes({ days: [{ date: '2026-09-10', morningLodging: null, lodging: { title: 'Hôtel à localiser', reservationId: 'stay' }, events: [] }] });
    assert.match(wrap.innerHTML, /data-reservation-definition="stay"/);
    wrap.onclick({ target: { closest: selector => selector === '[data-reservation-definition]' ? { dataset: { reservationDefinition: 'stay' } } : null } });
    assert.deepEqual(calls, ['.tab[data-page="planning"]', 'edit:stay']);
});

test('l’export des trajets garde un instantané du voyage et bloque les doubles clics pendant le chargement', async () => {
    const state = { places: { a: { name: 'Premier voyage' } }, itinerary: ['a', 'b'], edges: {}, planning: {} };
    const { context } = loadUi(state);
    const button = { disabled: false }, status = { hidden: true, textContent: '' };
    context.document.querySelectorAll = selector => selector.includes('data-export-routes-pdf') ? [button] : [status];
    context.planningFromControls = () => ({});
    context.tripItineraryFromStart = () => state.itinerary;
    context.TRIPS = [{ id: 'trip', name: 'Premier voyage' }];
    context.ACTIVE_TRIP = 'trip';
    context.showToast = () => {};
    let finishMaps, calls = 0, downloaded;
    context.TripPdfExport = {
        collectRouteSegments: () => [{ fromId: 'a', toId: 'b' }],
        downloadRoutesPdf: input => { downloaded = input; return 'trajets.pdf'; }
    };
    context.TripRouteMaps = { prepareMaps: async (segments, places, options) => {
        calls++;
        assert.equal(places.a.name, 'Premier voyage');
        options.onProgress(1, 1);
        return new Promise(resolve => { finishMaps = () => resolve([{ ...segments[0], map: { complete: true } }]); });
    } };
    const exportPromise = context.exportRoutesPdf();
    assert.equal(button.disabled, true);
    assert.equal(status.hidden, false);
    await context.exportRoutesPdf();
    assert.equal(calls, 1);
    state.places.a.name = 'Voyage modifié pendant le chargement';
    context.TRIPS[0].name = 'Autre nom';
    finishMaps();
    await exportPromise;
    assert.equal(downloaded.tripName, 'Premier voyage');
    assert.equal(downloaded.places.a.name, 'Premier voyage');
    assert.equal(button.disabled, false);
    assert.match(status.textContent, /1 trajet\(s\) exporté/);
});
