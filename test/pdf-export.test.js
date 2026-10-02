const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan } = require('../src/planning.js');
const { createTripPdf, createPlanningPdf, createRoutesPdf, collectRouteSegments, toPdfText, wrapText } = require('../src/pdf-export.js');

test('génère un PDF autonome avec planning, réservations et fiches pratiques', () => {
    const places = {
        home: { id: 'home', name: 'Domicile', lat: 46.2, lng: 6.1, durationH: 0, budget: 0, desc: 'Point de départ', tags: ['hébergement'], closedDays: [], ratings: {} },
        museum: { id: 'museum', name: 'Musée du Lac', lat: 46.3, lng: 6.2, durationH: 2, budget: 50, budgetCurrency: 'EUR', budgetScope: 'group', desc: 'Billet à présenter à l’entrée', tags: ['culture'], closedDays: [1], ratings: { Eric: 5 }, url: 'https://example.test/musee' },
        optional: { id: 'optional', name: 'Belvédère optionnel', lat: 46.4, lng: 6.3, durationH: 1, budget: 80, budgetFree: true, desc: 'Alternative par beau temps' }
    };
    const planning = {
        startDate: '2026-09-10', endDate: '2026-09-10', startTime: '07:00', dayStart: '07:00', dayEnd: '22:00', speedKmh: 60,
        reservations: [
            { id: 'city', title: 'Visite de la ville', kind: 'activity', placeId: 'home', placeIds: ['home', 'museum'], start: '2026-09-10T14:00', end: '2026-09-10T16:00', notes: 'Marché puis centre-ville' },
            { id: 'hotel', title: 'Hôtel Central', kind: 'lodging', placeId: 'home', start: '2026-09-10T18:00', end: '2026-09-11T09:00', notes: 'Référence ABC123' }
        ]
    };
    const itinerary = ['home', 'museum'];
    const edges = { 'home|museum': { realKm: 18.5, realMin: 30 } };
    const result = buildPlan({ itinerary, places, edges, planning });
    const bytes = createTripPdf({ tripName: 'Séjour test', planning: result.planning, result, itinerary, places, edges, people: 2, generatedAt: '2026-08-27T10:00:00' });
    const binary = Buffer.from(bytes).toString('latin1');

    assert.match(binary, /^%PDF-1\.4/);
    assert.match(binary, /CARNET DE ROUTE HORS LIGNE/);
    assert.match(binary, /JOUR 01/);
    assert.match(binary, /Hôtel Central/);
    assert.match(binary, /ABC123/);
    assert.match(binary, /Musée du Lac/);
    assert.match(binary, /50[.,]00 EUR pour 2 personne/);
    assert.match(binary, /Étapes du créneau/);
    assert.match(binary, /Marché puis centre-ville/);
    assert.match(binary, /Belvédère optionnel/);
    assert.match(binary, /Budget : Gratuit/);
    assert.match(binary, /18\.5 km/);
    assert.ok((binary.match(/\/Type \/Page\b/g) || []).length >= 4);
    assert.match(binary, /%%EOF$/);
});

test('génère un second PDF limité au planning affiché', () => {
    const places = {
        market: { name: 'Marché', lat: 46.2, lng: 6.1, durationH: 1 },
        centre: { name: 'Centre-ville', lat: 46.21, lng: 6.11, durationH: 1 }
    };
    const planning = {
        startDate: '2026-09-10', endDate: '2026-09-10',
        reservations: [{ id: 'city', title: 'Visite de la ville', kind: 'activity', placeIds: ['market', 'centre'], start: '2026-09-10T14:00', end: '2026-09-10T18:00', notes: 'Marché puis vieille ville' }]
    };
    const itinerary = ['market', 'centre'];
    const result = buildPlan({ itinerary, places, planning });
    const binary = Buffer.from(createPlanningPdf({ tripName: 'Ville', planning: result.planning, result, places, generatedAt: '2026-08-27T10:00:00' })).toString('latin1');

    assert.match(binary, /^%PDF-1\.4/);
    assert.match(binary, /\/MediaBox \[0 0 841\.89 595\.28\]/);
    assert.match(binary, /PLANNING DU VOYAGE/);
    assert.doesNotMatch(binary, /CARNET DE ROUTE/);
    assert.match(binary, /JOUR 01/);
    for (const hour of ['07:00', '09:00', '12:00', '14:00', '16:00', '19:00', '22:00']) assert.match(binary, new RegExp(hour));
    assert.match(binary, /Visite \/ activité : Visite de la/);
    assert.match(binary, /ville \[FIXE\]/);
    assert.match(binary, /Marché puis vieille ville/);
    assert.doesNotMatch(binary, /SEGMENTS DE L/);
    assert.doesNotMatch(binary, /FICHES DÉTAILLÉES/);
    assert.match(binary, /%%EOF$/);
});

test('encode les accents français et replie les textes longs', () => {
    const encoded = toPdfText('Déjeuner à l’hôtel');
    assert.equal(encoded.replace(String.fromCharCode(0x92), '’'), 'Déjeuner à l’hôtel');
    assert.equal(toPdfText('Départ → arrivée'), 'Départ > arrivée');
    assert.equal(toPdfText('Trajet 🚆'), 'Trajet ?');
    const lines = wrapText('Une description suffisamment longue pour être répartie proprement', 80, 10);
    assert.ok(lines.length > 1);
    assert.equal(lines.join(' '), 'Une description suffisamment longue pour être répartie proprement');
});

test('exporte uniquement les déplacements planifiés, y compris les allers-retours à l’hôtel', () => {
    const input = {
        itinerary: ['hotel', 'museum'],
        places: { hotel: { name: 'Hôtel du Lac', lat: 46.2, lng: 6.1 }, museum: { name: 'Musée', lat: 46.3, lng: 6.2, durationH: 24, desc: 'Description privée à exclure', budget: 123 } },
        planning: { startDate: '2026-09-10', endDate: '2026-09-11', reservations: [
            { id: 'stay', title: 'Hôtel du Lac', kind: 'lodging', placeId: 'hotel', start: '2026-09-09T16:00', end: '2026-09-12T10:00' }
        ] }
    };
    input.result = buildPlan(input);
    const segments = collectRouteSegments(input);
    assert.deepEqual(segments.map(segment => [segment.date, segment.fromId, segment.toId]), [
        ['2026-09-10', 'hotel', 'museum'], ['2026-09-10', 'museum', 'hotel'],
        ['2026-09-11', 'hotel', 'museum'], ['2026-09-11', 'museum', 'hotel']
    ]);
    const binary = Buffer.from(createRoutesPdf({ ...input, segments })).toString('latin1');
    assert.equal((binary.match(/\/Type \/Page\b/g) || []).length, 4);
    assert.match(binary, /\/MediaBox \[0 0 841\.89 595\.28\]/);
    assert.match(binary, /Hôtel du Lac/);
    assert.match(binary, /TRAJET 4\/4/);
    assert.doesNotMatch(binary, /Description privée|Budget|Petit déjeuner|FICHES DÉTAILLÉES/);
});

test('reprend les segments sans dates, conserve les lieux incomplets et les transports réservés', () => {
    const segments = collectRouteSegments({ itinerary: ['a', 'a', 'b', 'missing'], places: { a: { name: 'A', lat: 46, lng: 6 }, b: { name: 'B', lat: 47, lng: 7 } }, edges: { 'a|b': { realKm: 170, realMin: 120 } } });
    assert.equal(segments.length, 2);
    assert.equal(segments[0].minutes, 120);
    assert.equal(segments[0].estimated, false);
    assert.equal(segments[1].toId, 'missing');
    assert.equal(segments[1].km, null);
    const fixed = collectRouteSegments({ result: { days: [{ date: '2026-09-10', events: [
        { kind: 'travel', fixed: true, title: 'Train', placeIds: ['a', 'b'], placeId: 'a', endPlaceId: 'b', start: new Date('2026-09-10T10:00'), end: new Date('2026-09-10T12:00') }
    ] }] } });
    assert.deepEqual([fixed[0].fromId, fixed[0].toId, fixed[0].fixed, fixed[0].minutes], ['a', 'b', true, 120]);
    assert.deepEqual(collectRouteSegments({ itinerary: ['a', 'b'], result: { days: [{ date: '2026-09-10', events: [] }] } }), []);
    assert.throws(() => createRoutesPdf({ segments: [] }), /Aucun trajet/);
});

test('intègre les images JPEG, réutilise les cartes identiques et conserve des offsets PDF exacts', () => {
    const image = { width: 1200, height: 490, bytes: new Uint8Array([255, 216, 0, 10, 13, 255, 217]) };
    const map = { image, caption: 'Tracé routier OSRM', attribution: '© OpenStreetMap contributors' };
    const segments = [1, 2].map(index => ({ title: `Liaison ${index}`, fromId: 'a', toId: 'b', km: 10, minutes: 20, map }));
    const binary = Buffer.from(createRoutesPdf({ segments, places: {}, tripName: 'Cartes' })).toString('latin1');
    assert.equal((binary.match(/\/Subtype \/Image/g) || []).length, 1);
    assert.equal((binary.match(/\/Im1 Do/g) || []).length, 2);
    assert.match(binary, /\/Filter \/DCTDecode \/Length 7/);
    assert.match(binary, /OpenStreetMap contributors/);
    const xref = Number(/startxref\n(\d+)/.exec(binary)[1]);
    assert.equal(binary.slice(xref, xref + 4), 'xref');
    const entries = binary.slice(xref).split('\n');
    const count = Number(entries[1].split(' ')[1]);
    for (let id = 1; id < count; id++) {
        const offset = Number(entries[id + 2].slice(0, 10));
        assert.ok(binary.slice(offset).startsWith(`${id} 0 obj\n`));
    }
});
