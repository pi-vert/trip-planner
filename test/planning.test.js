const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan, normalizePlanning } = require('../src/planning.js');
const { buildOutline } = require('../src/trip-structure.js');
const { remainingItinerary } = require('../src/planning.js');

const places = {
    museum: { name: 'Musée', lat: 46.2, lng: 6.1, durationH: 2, closedDays: [] },
    restaurant: { name: 'Restaurant', lat: 46.21, lng: 6.11, durationH: 1, closedDays: [] },
    park: { name: 'Parc', lat: 46.22, lng: 6.12, durationH: 2, closedDays: [] }
};

test('retire les visites réalisées et leurs réservations du planning restant sans effacer les lieux', () => {
    const input = {
        itinerary: ['home', 'seen', 'new', 'hotel', 'home'],
        places: {
            home: { name: 'Départ', lat: 46, lng: 6, durationH: 0 },
            seen: { name: 'Monument réalisé', lat: 46.001, lng: 6, completed: true, durationH: 10 },
            new: { name: 'Nouvelle visite', lat: 46.002, lng: 6, durationH: 1 },
            hotel: { name: 'Hôtel', lat: 46.003, lng: 6, durationH: 0 }
        },
        planning: { startDate: '2026-09-11', endDate: '2026-09-12', reservations: [
            { id: 'seen-booking', title: 'Visite prévue avant la randonnée', kind: 'activity', placeId: 'seen', start: '2026-09-11T14:00', end: '2026-09-11T18:00' },
            { id: 'stay', title: 'Hôtel', kind: 'lodging', placeId: 'hotel', start: '2026-09-11T20:00', end: '2026-09-12T10:00' }
        ] }
    };
    const before = JSON.stringify(input);
    const result = buildPlan(input);
    assert.deepEqual(remainingItinerary(input), ['home', 'new', 'hotel', 'home']);
    assert.ok(!result.events.some(event => event.placeId === 'seen' || event.fromId === 'seen'));
    assert.ok(result.events.some(event => event.kind === 'activity' && event.placeId === 'new'));
    assert.equal(result.days[0].lodging.placeId, 'hotel');
    assert.equal(JSON.stringify(input), before);
    input.places.seen.completed = false;
    const restored = buildPlan(input);
    assert.ok(restored.events.some(event => event.id === 'seen-booking'));
});

test('normalise les trois repas aux horaires demandés', () => {
    const planning = normalizePlanning({});
    assert.equal(planning.meals.breakfast.at, '07:00');
    assert.equal(planning.meals.lunch.at, '12:00');
    assert.equal(planning.meals.dinner.at, '19:00');
});

test('normalise un créneau relatif à une étape', () => {
    const planning = normalizePlanning({ reservations: [{ id: 'slot', stageId: 'city', dateMode: 'stage', relativeDay: 'departure', startTime: '09:30', endTime: '11:00' }] });
    assert.equal(planning.reservations[0].dateMode, 'stage');
    assert.equal(planning.reservations[0].stageId, 'city');
    assert.equal(planning.reservations[0].relativeDay, 'departure');
    assert.equal(planning.reservations[0].startTime, '09:30');
    assert.equal(planning.reservations[0].start, '');
});

test('conserve une réservation fixe et place les activités autour', () => {
    const result = buildPlan({
        itinerary: ['museum', 'restaurant', 'park'], places, edges: {},
        planning: {
            startDate: '2026-09-10', endDate: '2026-09-10',
            reservations: [{
                id: 'lunch-booking', title: 'Chez Marcel', kind: 'meal', meal: 'lunch',
                placeId: 'restaurant', start: '2026-09-10T12:30', end: '2026-09-10T13:30'
            }]
        }
    });
    const meal = result.events.find(event => event.id === 'lunch-booking');
    assert.equal(meal.title, 'Chez Marcel');
    assert.equal(meal.start.getHours(), 12);
    assert.equal(meal.start.getMinutes(), 30);
    assert.equal(result.events.filter(event => event.kind === 'activity' && event.placeId === 'restaurant').length, 0);
    assert.ok(result.events.some(event => event.kind === 'activity' && event.placeId === 'museum'));
});

test('présente chaque jour avec les trois repas même sans réservation', () => {
    const result = buildPlan({ itinerary: [], places: {}, edges: {}, planning: { startDate: '2026-09-10', endDate: '2026-09-11' } });
    assert.equal(result.days.length, 2);
    for (const day of result.days) {
        const meals = day.events.filter(event => event.kind === 'meal');
        assert.equal(meals.length, 3);
        assert.ok(meals.every(event => event.title === 'À compléter'));
    }
});

test('signale les contraintes hors du séjour et les activités non planifiées', () => {
    const result = buildPlan({
        itinerary: ['museum'],
        places: { museum: { ...places.museum, durationH: 40 } },
        edges: {},
        planning: {
            startDate: '2026-09-10', endDate: '2026-09-10',
            reservations: [{ id: 'outside', title: 'Vol', kind: 'travel', start: '2026-09-12T10:00', end: '2026-09-12T12:00' }]
        }
    });
    assert.ok(result.conflicts.some(message => message.includes('hors des dates')));
    assert.equal(result.unscheduled.length, 1);
});

test('associe un hôtel à toutes les nuits réservées sans bloquer les journées', () => {
    const result = buildPlan({
        itinerary: ['museum'], places, edges: {},
        planning: {
            startDate: '2026-09-10', endDate: '2026-09-12',
            reservations: [{ id: 'hotel', title: 'Hôtel du Lac', kind: 'lodging', start: '2026-09-10T16:00', end: '2026-09-12T10:00' }]
        }
    });
    assert.equal(result.days[0].lodging.title, 'Hôtel du Lac');
    assert.equal(result.days[1].lodging.title, 'Hôtel du Lac');
    assert.equal(result.days[2].lodging, null);
    assert.ok(result.events.some(event => event.title === 'Arrivée : Hôtel du Lac'));
    assert.ok(result.events.some(event => event.title === 'Départ : Hôtel du Lac'));
});

test('utilise deux heures par défaut et conserve le domicile aux extrémités', () => {
    const result = buildPlan({
        itinerary: ['home', 'visit', 'home'],
        places: {
            home: { name: 'Domicile', lat: 46.5, lng: 6.6, durationH: 0 },
            visit: { name: 'Visite sans durée', lat: 46.6, lng: 6.7 }
        },
        edges: {
            'home|visit': { realMin: 30, realKm: 20 },
            'visit|home': { realMin: 30, realKm: 20 }
        },
        planning: { startDate: '2026-09-10', endDate: '2026-09-10' }
    });
    const activities = result.events.filter(event => event.kind === 'activity');
    const travels = result.events.filter(event => event.kind === 'travel');
    assert.deepEqual(activities.map(event => event.placeId), ['visit']);
    assert.equal((activities[0].end - activities[0].start) / 60000, 120);
    assert.deepEqual(travels.map(event => (event.end - event.start) / 60000), [30, 30]);
    assert.ok(result.events.filter(event => event.kind === 'meal').every(event => (event.end - event.start) / 60000 === 60));
});

test('ignore une date fixe associée à un lieu optionnel', () => {
    const result = buildPlan({
        itinerary: ['museum'],
        places: { ...places, optional: { name: 'Excursion optionnelle', lat: 46.3, lng: 6.3, durationH: 2 } },
        edges: {},
        planning: {
            startDate: '2026-09-10', endDate: '2026-09-10',
            reservations: [{ id: 'optional-date', title: 'Excursion réservée', kind: 'activity', placeId: 'optional', start: '2026-09-10T14:00', end: '2026-09-10T16:00' }]
        }
    });
    assert.ok(!result.events.some(event => event.placeId === 'optional'));
    assert.ok(result.events.some(event => event.placeId === 'museum'));
});

test('planifie les sous-étapes dans les dates de leur étape principale', () => {
    const stagedPlaces = {
        city1: { name: 'Ville 1', lat: 46.2, lng: 6.1, durationH: 1, stageType: 'main', arrivalDate: '2026-09-10', departureDate: '2026-09-10' },
        visit1: { name: 'Visite 1', lat: 46.201, lng: 6.101, durationH: 1, stageType: 'detail', parentStageId: 'city1' },
        city2: { name: 'Ville 2', lat: 46.21, lng: 6.11, durationH: 1, stageType: 'main', arrivalDate: '2026-09-11', departureDate: '2026-09-11' },
        visit2: { name: 'Visite 2', lat: 46.211, lng: 6.111, durationH: 1, stageType: 'detail', parentStageId: 'city2' }
    };
    const input = {
        itinerary: ['city1', 'visit1', 'city2', 'visit2'],
        places: stagedPlaces,
        edges: {},
        planning: { startDate: '2026-09-10', endDate: '2026-09-11' }
    };
    const result = buildPlan({ ...input, structure: buildOutline(input) });
    const visit1 = result.events.find(event => event.kind === 'activity' && event.placeId === 'visit1');
    const visit2 = result.events.find(event => event.kind === 'activity' && event.placeId === 'visit2');
    assert.equal(visit1.start.getDate(), 10);
    assert.equal(visit2.start.getDate(), 11);
});

test('respecte les heures d’arrivée et de départ de l’étape principale', () => {
    const stagedPlaces = {
        city: { name: 'Ville', lat: 46.2, lng: 6.1, durationH: 1, stageType: 'main', arrivalDate: '2026-09-10', arrivalTime: '14:00', departureDate: '2026-09-10', departureTime: '17:00' },
        visit: { name: 'Visite', lat: 46.201, lng: 6.101, durationH: 1, stageType: 'detail', parentStageId: 'city' }
    };
    const input = {
        itinerary: ['city', 'visit'], places: stagedPlaces, edges: {},
        planning: { startDate: '2026-09-10', endDate: '2026-09-10' }
    };
    const result = buildPlan({ ...input, structure: buildOutline(input) });
    const activities = result.events.filter(event => event.kind === 'activity');
    assert.ok(activities.length >= 2);
    assert.ok(activities.every(event => event.start.getHours() >= 14));
    assert.ok(activities.every(event => event.end.getHours() <= 17));
});

test('résout un créneau relatif avec la date de l’étape principale', () => {
    const stagedPlaces = {
        city: { name: 'Ville', lat: 46.2, lng: 6.1, durationH: 1, stageType: 'main', arrivalDate: '2026-09-10', departureDate: '2026-09-11' },
        museum: { name: 'Musée', lat: 46.201, lng: 6.101, durationH: 1, stageType: 'detail', parentStageId: 'city' }
    };
    const input = {
        itinerary: ['city', 'museum'], places: stagedPlaces, edges: {},
        planning: {
            startDate: '2026-09-10', endDate: '2026-09-11',
            reservations: [{ id: 'museum-slot', title: 'Visite guidée', kind: 'activity', placeId: 'museum', placeIds: ['museum'], dateMode: 'stage', relativeDay: 'arrival', startTime: '15:00', endTime: '16:00' }]
        }
    };
    const result = buildPlan({ ...input, structure: buildOutline(input) });
    const event = result.events.find(item => item.id === 'museum-slot');
    assert.equal(event.start.getDate(), 10);
    assert.equal(event.start.getHours(), 15);
    assert.equal(event.dateMode, 'stage');
});

test('résout un créneau relatif avec son étape cible plutôt qu’avec celle du lieu', () => {
    const stagedPlaces = {
        city: { name: 'Ville', lat: 46.2, lng: 6.1, durationH: 1, stageType: 'main', arrivalDate: '2026-09-10', departureDate: '2026-09-11' },
        restaurant: { name: 'Restaurant', lat: 46.201, lng: 6.101, durationH: 1, stageType: 'detail', parentStageId: 'city' },
        coast: { name: 'Côte', lat: 46.4, lng: 6.3, durationH: 1, stageType: 'main', arrivalDate: '2026-09-11', departureDate: '2026-09-12' }
    };
    const input = {
        itinerary: ['city', 'restaurant', 'coast'], places: stagedPlaces, edges: {},
        planning: {
            startDate: '2026-09-10', endDate: '2026-09-12',
            reservations: [{ id: 'coast-lunch', title: 'Restaurant', kind: 'meal', meal: 'lunch', placeId: 'restaurant', placeIds: ['restaurant'], stageId: 'coast', dateMode: 'stage', startTime: '12:00', endTime: '13:00' }]
        }
    };
    const result = buildPlan({ ...input, structure: buildOutline(input) });
    const event = result.events.find(item => item.id === 'coast-lunch');
    assert.equal(event.start.getDate(), 11);
});

test('résout un créneau groupé depuis le premier lieu encore actif', () => {
    const stagedPlaces = {
        city: { name: 'Ville', lat: 46.2, lng: 6.1, durationH: 1, stageType: 'main', arrivalDate: '2026-09-10', departureDate: '2026-09-10' },
        museum: { name: 'Musée', lat: 46.201, lng: 6.101, durationH: 1, stageType: 'detail', parentStageId: 'city' },
        optional: { name: 'Option', lat: 46.3, lng: 6.2, durationH: 1 }
    };
    const input = {
        itinerary: ['city', 'museum'], places: stagedPlaces, edges: {},
        planning: {
            startDate: '2026-09-10', endDate: '2026-09-10',
            reservations: [{ id: 'group-slot', title: 'Visite', kind: 'activity', placeId: 'optional', placeIds: ['optional', 'museum'], dateMode: 'stage', startTime: '15:00', endTime: '16:00' }]
        }
    };
    const result = buildPlan({ ...input, structure: buildOutline(input) });
    assert.ok(result.events.some(item => item.id === 'group-slot'));
});

test('signale un créneau relatif ambigu sur une étape répétée', () => {
    const loopPlaces = {
        home: { name: 'Maison', lat: 46.2, lng: 6.1, durationH: 0, stageType: 'main' },
        city: { name: 'Ville', lat: 46.4, lng: 6.3, durationH: 1, stageType: 'main' }
    };
    const input = {
        itinerary: ['home', 'city', 'home'], places: loopPlaces, edges: {},
        planning: {
            startDate: '2026-09-10', endDate: '2026-09-12',
            reservations: [{ id: 'home-slot', title: 'Remise des clés', kind: 'other', placeId: 'home', placeIds: ['home'], dateMode: 'stage', startTime: '18:00', endTime: '19:00' }]
        }
    };
    const result = buildPlan({ ...input, structure: buildOutline(input) });
    assert.ok(result.conflicts.some(message => message.includes('ambigu')));
    assert.ok(!result.events.some(item => item.id === 'home-slot'));
});

test('regroupe plusieurs lieux dans une même date fixe sans les planifier deux fois', () => {
    const groupedPlaces = {
        market: { name: 'Marché', lat: 46.2, lng: 6.1, durationH: 1 },
        centre: { name: 'Centre-ville', lat: 46.21, lng: 6.11, durationH: 1 },
        museum: { name: 'Musée', lat: 46.22, lng: 6.12, durationH: 1 }
    };
    const result = buildPlan({
        itinerary: ['market', 'centre', 'museum'], places: groupedPlaces, edges: {},
        planning: {
            startDate: '2026-09-10', endDate: '2026-09-10',
            reservations: [{ id: 'city', title: 'Visite de la ville', kind: 'activity', placeIds: ['market', 'centre'], start: '2026-09-10T14:00', end: '2026-09-10T18:00' }]
        }
    });
    const fixed = result.events.find(event => event.id === 'city');
    assert.deepEqual(fixed.placeIds, ['market', 'centre']);
    assert.equal(fixed.placeId, 'market');
    assert.equal(fixed.endPlaceId, 'centre');
    assert.equal(fixed.fixedType, 'activity');
    assert.ok(!result.events.some(event => event.kind === 'activity' && !event.fixed && ['market', 'centre'].includes(event.placeId)));
});

function hotelTrip(reservations, overrides = {}) {
    const hotelPlaces = {
        home: { name: 'Domicile', lat: 46, lng: 6 },
        hotel: { name: 'Hôtel du Lac', lat: 46.1, lng: 6.1 },
        hotel2: { name: 'Hôtel du Parc', lat: 46.2, lng: 6.2 },
        visit: { name: 'Longue visite', lat: 46.3, lng: 6.3, durationH: 30 }
    };
    const edges = {};
    for (const from of Object.keys(hotelPlaces)) {
        for (const to of Object.keys(hotelPlaces)) {
            if (from !== to) edges[`${from}|${to}`] = { realMin: 20, realKm: 15 };
        }
    }
    return buildPlan({ itinerary: ['home', 'hotel', 'hotel2', 'visit', 'home'], places: hotelPlaces, edges,
        planning: { startDate: '2026-09-10', endDate: '2026-09-12', reservations, ...overrides } });
}

test('revient chaque soir à l’hôtel et repart de cet hôtel pour une visite poursuivie le lendemain', () => {
    const result = hotelTrip([
        { id: 'stay', title: 'Hôtel du Lac', kind: 'lodging', placeId: 'hotel', start: '2026-09-10T16:00', end: '2026-09-12T10:00' }
    ]);
    assert.equal(result.days[0].morningLodging, null);
    assert.equal(result.days[1].morningLodging.placeId, 'hotel');
    assert.equal(result.days[2].morningLodging.placeId, 'hotel');
    assert.equal(result.days[2].lodging, null);
    for (const [index, day] of result.days.entries()) {
        const travels = day.events.filter(event => event.kind === 'travel');
        assert.equal(travels[0].fromId, index === 0 ? 'home' : 'hotel');
        assert.equal(travels.at(-1).placeId, index === 2 ? 'home' : 'hotel');
        assert.ok(travels.every(event => (event.end - event.start) / 60000 === 20));
        for (let i = 1; i < day.events.length; i++) assert.ok(day.events[i].start >= day.events[i - 1].end, 'aucun chevauchement des trajets, visites et repas');
    }
    const middleDay = result.days[1];
    assert.equal(middleDay.events.find(event => event.kind === 'travel').placeId, 'visit');
    assert.ok(middleDay.events.some(event => event.placeId === 'visit' && event.continued));
    assert.deepEqual(middleDay.events.filter(event => event.boundary).map(event => [event.boundary, event.placeId, event.reservationId]), [
        ['start', 'hotel', 'stay'], ['end', 'hotel', 'stay']
    ]);
});

test('change d’hôtel : départ de l’ancien et arrivée au nouveau le même jour', () => {
    const result = hotelTrip([
        { id: 'stay1', title: 'Hôtel du Lac', kind: 'lodging', placeId: 'hotel', start: '2026-09-10T16:00', end: '2026-09-11T10:00' },
        { id: 'stay2', title: 'Hôtel du Parc', kind: 'lodging', placeId: 'hotel2', start: '2026-09-11T16:00', end: '2026-09-12T10:00' }
    ]);
    const day = result.days[1];
    assert.equal(day.morningLodging.placeId, 'hotel');
    assert.equal(day.lodging.placeId, 'hotel2');
    const travels = day.events.filter(event => event.kind === 'travel');
    assert.equal(travels[0].fromId, 'hotel');
    assert.equal(travels.at(-1).placeId, 'hotel2');
    assert.equal(result.days[2].events.find(event => event.kind === 'travel').fromId, 'hotel2');
    assert.ok(!result.events.some(event => event.kind === 'activity' && ['hotel', 'hotel2'].includes(event.placeId)));
});

test('utilise aussi un hôtel réservé avant et après la plage du planning', () => {
    const result = hotelTrip([
        { id: 'stay', title: 'Hôtel du Lac', kind: 'lodging', placeId: 'hotel', start: '2026-09-09T16:00', end: '2026-09-13T10:00' }
    ]);
    assert.ok(!result.conflicts.some(message => message.includes('hors des dates')));
    for (const day of result.days) {
        const travels = day.events.filter(event => event.kind === 'travel');
        assert.equal(travels[0].fromId, 'hotel');
        assert.equal(travels.at(-1).placeId, 'hotel');
    }
});

test('les hébergements relatifs encadrent toutes les journées de leur étape', () => {
    const input = {
        itinerary: ['city', 'hotel', 'visit'],
        places: {
            city: { name: 'Ville', lat: 46, lng: 6, stageType: 'main', arrivalDate: '2026-09-10', departureDate: '2026-09-12', durationH: 1 },
            hotel: { name: 'Hôtel', lat: 46.1, lng: 6.1, stageType: 'detail', parentStageId: 'city' },
            visit: { name: 'Visite', lat: 46.2, lng: 6.2, durationH: 25, stageType: 'detail', parentStageId: 'city' }
        },
        planning: { startDate: '2026-09-10', endDate: '2026-09-12', reservations: [
            { id: 'relative-stay', title: 'Hôtel', kind: 'lodging', placeId: 'hotel', dateMode: 'stage', startTime: '16:00', endTime: '10:00' }
        ] }
    };
    const result = buildPlan({ ...input, structure: buildOutline(input) });
    const middleDay = result.days[1];
    assert.equal(middleDay.morningLodging.placeId, 'hotel');
    assert.equal(middleDay.lodging.placeId, 'hotel');
    const travels = middleDay.events.filter(event => event.kind === 'travel');
    assert.equal(travels[0].fromId, 'hotel');
    assert.equal(travels.at(-1).placeId, 'hotel');
    assert.ok(travels.every(event => event.estimated));
});

test('signale un retour à l’hôtel impossible sans inventer de trajet', () => {
    const result = buildPlan({ itinerary: ['hotel', 'restaurant'], places: {
        hotel: { name: 'Hôtel', lat: 46, lng: 6 }, restaurant: { name: 'Restaurant', lat: 47, lng: 7 }
    }, edges: { 'hotel|restaurant': { realMin: 60 }, 'restaurant|hotel': { realMin: 60 } }, planning: {
        startDate: '2026-09-10', endDate: '2026-09-10', reservations: [
            { id: 'stay', title: 'Hôtel', kind: 'lodging', placeId: 'hotel', start: '2026-09-09T16:00', end: '2026-09-11T10:00' },
            { id: 'dinner', title: 'Dîner tardif', kind: 'meal', meal: 'dinner', placeId: 'restaurant', start: '2026-09-10T21:00', end: '2026-09-10T22:00' }
        ]
    } });
    assert.ok(result.conflicts.some(message => message.includes('Temps de trajet insuffisant') && message.includes('Retour à l’hôtel')));
    assert.ok(!result.events.some(event => event.kind === 'travel' && event.placeId === 'hotel'));
});
