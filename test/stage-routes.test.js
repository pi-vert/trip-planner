const test = require('node:test');
const assert = require('node:assert/strict');
const { collectStageRoutes, createStageRoutesPdf } = require('../src/pdf-export.js');
const { buildOutline } = require('../src/trip-structure.js');

function stagedTrip() {
    const input = {
        itinerary: ['city', 'hotel', 'visit', 'coast', 'hotel2', 'beach'],
        places: {
            city: { name: 'Ville', stageType: 'main', arrivalDate: '2026-09-10', departureDate: '2026-09-12' },
            hotel: { name: 'Hôtel du Lac', stageType: 'detail', parentStageId: 'city', tags: ['hôtel'] },
            visit: { name: 'Musée', stageType: 'detail', parentStageId: 'city' },
            coast: { name: 'Côte', stageType: 'main', arrivalDate: '2026-09-12', departureDate: '2026-09-14' },
            hotel2: { name: 'Hôtel de la Côte', stageType: 'detail', parentStageId: 'coast', tags: ['hôtel'] },
            beach: { name: 'Plage', stageType: 'detail', parentStageId: 'coast' }
        },
        planning: { startDate: '2026-09-10', endDate: '2026-09-14' }
    };
    input.structure = buildOutline(input);
    return input;
}

test('regroupe plusieurs journées et leurs allers-retours à l’hôtel sur la même étape', () => {
    const input = stagedTrip();
    const segments = [
        { date: '2026-09-10', fromId: 'hotel', toId: 'visit' },
        { date: '2026-09-10', fromId: 'visit', toId: 'hotel' },
        { date: '2026-09-11', fromId: 'hotel', toId: 'visit' },
        { date: '2026-09-11', fromId: 'visit', toId: 'hotel' },
        { date: '2026-09-12', fromId: 'visit', toId: 'hotel2' },
        { date: '2026-09-12', fromId: 'hotel2', toId: 'beach' },
        { date: '2026-09-12', fromId: 'beach', toId: 'hotel2' }
    ];
    const groups = collectStageRoutes({ ...input, segments });
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0].segments, segments.slice(0, 4));
    assert.deepEqual(groups[1].segments, segments.slice(4));
    assert.deepEqual(groups[0].stops.map(stop => [stop.id, stop.number, stop.hotel]), [['hotel', 1, true], ['visit', 2, false]]);
    assert.equal(groups.reduce((total, group) => total + group.segments.length, 0), segments.length);
});

test('un hôtel partagé reste sur le plan de l’étape visitée malgré son rattachement initial', () => {
    const input = stagedTrip();
    const segments = [
        { date: '2026-09-13', fromId: 'hotel', toId: 'beach' },
        { date: '2026-09-13', fromId: 'beach', toId: 'hotel' }
    ];
    input.result = { days: [{ date: '2026-09-13', morningLodging: { placeId: 'hotel' } }] };
    const groups = collectStageRoutes({ ...input, segments });
    assert.equal(groups[0].segments.length, 0);
    assert.deepEqual(groups[1].segments, segments);
});

test('distingue les passages répétés au même lieu, avec et sans dates', () => {
    const input = {
        itinerary: ['home', 'visit', 'city', 'home'],
        places: { home: { name: 'Maison', stageType: 'main' }, visit: { name: 'Visite', stageType: 'detail', parentStageId: 'home' }, city: { name: 'Ville', stageType: 'main' } },
        planning: { startDate: '2026-09-10', endDate: '2026-09-12' }
    };
    input.structure = buildOutline(input);
    const dated = collectStageRoutes({ ...input, segments: [
        { date: '2026-09-10', fromId: 'home', toId: 'visit' },
        { date: '2026-09-12', fromId: 'city', toId: 'home' }
    ] });
    assert.equal(dated.length, 3);
    assert.equal(dated[0].segments.length, 1);
    assert.equal(dated[2].segments.length, 1);
    input.planning = {};
    input.structure = buildOutline(input);
    const undated = collectStageRoutes(input);
    assert.equal(undated[0].segments[0].toId, 'visit');
    assert.equal(undated[1].segments[0].toId, 'city');
    assert.equal(undated[2].segments[0].toId, 'home');
});

test('conserve les étapes sans trajet et les trajets non rattachables', () => {
    const input = stagedTrip();
    const groups = collectStageRoutes({ ...input, segments: [{ fromId: 'missing', toId: 'unknown' }] });
    assert.equal(groups.length, 3);
    assert.equal(groups[0].segments.length, 0);
    assert.equal(groups[0].stops[0].id, 'city');
    assert.equal(groups[2].title, 'Trajets non rattachés à une étape');
    assert.equal(groups[2].segments.length, 1);
});

test('le PDF réunit tous les trajets sur une seule carte et poursuit une légende longue sans la tronquer', () => {
    const stages = collectStageRoutes({ ...stagedTrip(), segments: [
        { date: '2026-09-10', fromId: 'hotel', toId: 'visit', km: 10, minutes: 20 },
        { date: '2026-09-11', fromId: 'visit', toId: 'hotel', km: 10, minutes: 20 }
    ] });
    const image = { width: 1200, height: 800, bytes: new Uint8Array([255, 216, 255, 217]) };
    for (const stage of stages) stage.map = { image, caption: 'Carte complète', attribution: '© OpenStreetMap contributors' };
    let binary = Buffer.from(createStageRoutesPdf({ tripName: 'Voyage', stages })).toString('latin1');
    assert.equal((binary.match(/\/Type \/Page\b/g) || []).length, 2);
    assert.equal((binary.match(/\/Subtype \/Image/g) || []).length, 2);
    assert.match(binary, /PLAN COMPLET/);
    assert.match(binary, /2 trajet\\\(s\\\).*20 km/);
    assert.match(binary, /Hôtel du Lac/);
    assert.match(binary, /Aucun déplacement planifié/);
    stages[0].stops = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, number: i + 1, title: `Repère intégral ${i + 1}` }));
    binary = Buffer.from(createStageRoutesPdf({ stages: [stages[0]] })).toString('latin1');
    assert.ok((binary.match(/\/Type \/Page\b/g) || []).length > 1);
    assert.equal((binary.match(/\/Subtype \/Image/g) || []).length, 1);
    assert.match(binary, /Repère intégral 50/);
    assert.match(binary, /suite page suivante/);
});
