const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOutline, chronologicalStages, effectiveAssignments, normalizeRelativePeriod, relativeDayCount, relativePeriodLabel, stagePeriodLabel, stagesForDate, tripDays, tripNights } = require('../src/trip-structure.js');

const places = {
    geneva: { name: 'Genève', lat: 46.2044, lng: 6.1432 },
    museum: { name: 'Musée', lat: 46.205, lng: 6.145 },
    annecy: { name: 'Annecy', lat: 45.8992, lng: 6.1294, tags: ['hébergement'] },
    lake: { name: 'Lac', lat: 45.9, lng: 6.13 }
};

test('suggère des sous-étapes dans une même zone géographique', () => {
    const assignments = effectiveAssignments(['geneva', 'museum', 'annecy', 'lake'], places);
    assert.equal(assignments.geneva.stageType, 'main');
    assert.deepEqual(assignments.museum, { stageType: 'detail', parentStageId: 'geneva' });
    assert.equal(assignments.annecy.stageType, 'main');
    assert.deepEqual(assignments.lake, { stageType: 'detail', parentStageId: 'annecy' });
});

test('respecte les niveaux et rattachements saisis', () => {
    const configured = {
        ...places,
        museum: { ...places.museum, stageType: 'main' },
        annecy: { ...places.annecy, stageType: 'detail', parentStageId: 'museum' }
    };
    const assignments = effectiveAssignments(['geneva', 'museum', 'annecy', 'lake'], configured);
    assert.equal(assignments.museum.stageType, 'main');
    assert.deepEqual(assignments.annecy, { stageType: 'detail', parentStageId: 'museum' });
});

test('répartit les étapes sur la durée totale et recense chaque nuit', () => {
    const outline = buildOutline({
        itinerary: ['geneva', 'museum', 'annecy', 'lake'], places,
        planning: {
            startDate: '2026-09-10', endDate: '2026-09-13',
            reservations: [{ id: 'hotel', title: 'Hôtel du Lac', kind: 'lodging', start: '2026-09-10T16:00', end: '2026-09-13T10:00' }]
        }
    });
    assert.deepEqual(outline.mainIds, ['geneva', 'annecy']);
    assert.deepEqual(outline.stages.map(stage => [stage.arrivalDate, stage.departureDate]), [
        ['2026-09-10', '2026-09-12'], ['2026-09-12', '2026-09-13']
    ]);
    assert.equal(outline.nights.length, 3);
    assert.ok(outline.nights.every(night => night.lodging[0].title === 'Hôtel du Lac'));
});

test('conserve le retour au point de départ dans la trame globale', () => {
    const outline = buildOutline({ itinerary: ['geneva', 'annecy', 'geneva'], places, planning: { startDate: '2026-09-10', endDate: '2026-09-12' } });
    assert.deepEqual(outline.mainIds, ['geneva', 'annecy', 'geneva']);
    assert.equal(outline.stages[2].id, 'geneva');
    assert.deepEqual(outline.stages[2].detailIds, []);
});

test('ordonne les étapes par dates puis conserve leur ordre en cas d’égalité', () => {
    const stages = chronologicalStages([
        { id: 'sans-date', arrivalDate: '', departureDate: '' },
        { id: 'tard', arrivalDate: '2026-09-12', departureDate: '2026-09-14' },
        { id: 'tot', arrivalDate: '2026-09-10', departureDate: '2026-09-12' },
        { id: 'tot-bis', arrivalDate: '2026-09-10', departureDate: '2026-09-13' }
    ]);
    assert.deepEqual(stages.map(stage => stage.id), ['tot', 'tot-bis', 'tard', 'sans-date']);
});

test('ordonne plusieurs étapes d’une même journée selon leur heure d’arrivée', () => {
    const stages = chronologicalStages([
        { id: 'soir', arrivalDate: '2026-09-10', arrivalTime: '18:00', departureDate: '2026-09-10', departureTime: '21:00' },
        { id: 'matin', arrivalDate: '2026-09-10', arrivalTime: '08:00', departureDate: '2026-09-10', departureTime: '11:00' },
        { id: 'apres-midi', arrivalDate: '2026-09-10', arrivalTime: '13:30', departureDate: '2026-09-10', departureTime: '17:00' }
    ]);
    assert.deepEqual(stages.map(stage => stage.id), ['matin', 'apres-midi', 'soir']);
});

test('normalise et ordonne les repères relatifs sans dates fixes', () => {
    assert.equal(normalizeRelativePeriod(' j3-j6 '), 'J3-J6');
    assert.equal(normalizeRelativePeriod('j2a'), 'J2A');
    assert.equal(normalizeRelativePeriod('J6-J3'), '');
    assert.equal(relativePeriodLabel('J2M'), 'Jour 2 · matin');
    assert.equal(relativePeriodLabel('J3-J6'), 'Jour 3 → jour 6');
    const stages = chronologicalStages([
        { id: 'soir', relativePeriod: 'J2S' },
        { id: 'plusieurs-jours', relativePeriod: 'J3-J6' },
        { id: 'matin', relativePeriod: 'J2M' }
    ]);
    assert.deepEqual(stages.map(stage => stage.id), ['matin', 'soir', 'plusieurs-jours']);
    assert.equal(relativeDayCount(stages), 6);
});

test('retrouve les étapes qui occupent une journée, y compris sur leurs bornes', () => {
    const stages = [
        { id: 'sejour', arrivalDate: '2026-09-10', departureDate: '2026-09-11' },
        { id: 'journee', arrivalDate: '2026-09-11', departureDate: '2026-09-11' }
    ];
    assert.deepEqual(stagesForDate(stages, '2026-09-11').map(stage => stage.id), ['sejour', 'journee']);
    assert.deepEqual(stagesForDate(stages, '2026-09-12'), []);
});

test('recense tous les jours du séjour, y compris le dernier', () => {
    assert.deepEqual(tripDays({ startDate: '2026-09-10', endDate: '2026-09-12' }), [
        { date: '2026-09-10' },
        { date: '2026-09-11' },
        { date: '2026-09-12' }
    ]);
});

test('déduit la période affichée à partir des heures de l’étape', () => {
    const stage = (arrivalTime, departureTime, departureDate = '2026-09-10') => ({
        arrivalDate: '2026-09-10', arrivalTime, departureDate, departureTime
    });
    assert.equal(stagePeriodLabel(stage('08:00', '11:00')), 'Matin');
    assert.equal(stagePeriodLabel(stage('13:00', '17:00')), 'Après-midi');
    assert.equal(stagePeriodLabel(stage('18:00', '22:00')), 'Soir');
    assert.equal(stagePeriodLabel(stage('08:00', '18:00')), 'Journée complète');
    assert.equal(stagePeriodLabel(stage('18:00', '09:00', '2026-09-11')), 'Journée complète');
});

test('rattache un hébergement à toutes les étapes couvertes par ses nuits', () => {
    const outline = buildOutline({
        itinerary: ['geneva', 'museum', 'annecy', 'lake'], places,
        planning: {
            startDate: '2026-09-10', endDate: '2026-09-13',
            reservations: [{ id: 'hotel', title: 'Hôtel central', kind: 'lodging', placeId: 'museum', placeIds: ['museum'], start: '2026-09-10T16:00', end: '2026-09-13T10:00' }]
        }
    });
    assert.deepEqual(outline.stages[0].lodgings.map(item => item.id), ['hotel']);
    assert.deepEqual(outline.stages[1].lodgings.map(item => item.id), ['hotel']);
});

test('affiche un hébergement de deux nuits sur deux étapes journalières', () => {
    const configuredPlaces = {
        geneva: { ...places.geneva, stageType: 'main', arrivalDate: '2026-09-10', departureDate: '2026-09-10' },
        annecy: { ...places.annecy, stageType: 'main', arrivalDate: '2026-09-11', departureDate: '2026-09-11' }
    };
    const outline = buildOutline({
        itinerary: ['geneva', 'annecy'], places: configuredPlaces,
        planning: {
            startDate: '2026-09-10', endDate: '2026-09-12',
            reservations: [{ id: 'hotel', title: 'Hôtel central', kind: 'lodging', placeId: 'geneva', stageId: 'geneva', start: '2026-09-10T16:00', end: '2026-09-12T10:00' }]
        }
    });
    assert.deepEqual(outline.stages.map(stage => stage.lodgings.map(item => item.id)), [['hotel'], ['hotel']]);
});

test('résout les nuits d’un hébergement relatif à l’étape', () => {
    const configuredPlaces = {
        ...places,
        geneva: { ...places.geneva, stageType: 'main', arrivalDate: '2026-09-10', departureDate: '2026-09-12' },
        museum: { ...places.museum, stageType: 'detail', parentStageId: 'geneva' }
    };
    const outline = buildOutline({
        itinerary: ['geneva', 'museum'], places: configuredPlaces,
        planning: {
            startDate: '2026-09-10', endDate: '2026-09-12',
            reservations: [{ id: 'hotel-slot', title: 'Hôtel', kind: 'lodging', placeId: 'geneva', placeIds: ['geneva'], dateMode: 'stage', startTime: '18:00', endTime: '09:00' }]
        }
    });
    assert.equal(outline.nights[0].lodging[0].id, 'hotel-slot');
    assert.equal(outline.nights[1].lodging[0].id, 'hotel-slot');
});

test('classe les restaurants associés dans les sections déjeuner et dîner', () => {
    const outline = buildOutline({
        itinerary: ['geneva', 'museum'], places,
        planning: {
            startDate: '2026-09-10', endDate: '2026-09-11',
            reservations: [
                { id: 'lunch', title: 'Bistrot', kind: 'meal', meal: 'lunch', placeId: 'museum', placeIds: ['museum'], dateMode: 'stage', startTime: '12:00', endTime: '13:00' },
                { id: 'dinner', title: 'Brasserie', kind: 'meal', meal: 'dinner', placeId: 'museum', placeIds: ['museum'], dateMode: 'stage', startTime: '19:00', endTime: '20:00' }
            ]
        }
    });
    assert.deepEqual(outline.stages[0].meals.lunch.map(item => item.id), ['lunch']);
    assert.deepEqual(outline.stages[0].meals.dinner.map(item => item.id), ['dinner']);
});

test('réutilise un même lieu dans plusieurs étapes et catégories', () => {
    const configuredPlaces = {
        geneva: { ...places.geneva, stageType: 'main', arrivalDate: '2026-09-10', departureDate: '2026-09-11' },
        museum: { ...places.museum, stageType: 'detail', parentStageId: 'geneva' },
        annecy: { ...places.annecy, stageType: 'main', arrivalDate: '2026-09-11', departureDate: '2026-09-12' }
    };
    const outline = buildOutline({
        itinerary: ['geneva', 'museum', 'annecy'], places: configuredPlaces,
        planning: {
            startDate: '2026-09-10', endDate: '2026-09-12',
            reservations: [
                { id: 'geneva-lunch', title: 'Bistrot', kind: 'meal', meal: 'lunch', placeId: 'museum', stageId: 'geneva', dateMode: 'stage', startTime: '12:00', endTime: '13:00' },
                { id: 'annecy-lunch', title: 'Bistrot', kind: 'meal', meal: 'lunch', placeId: 'museum', stageId: 'annecy', dateMode: 'stage', startTime: '12:00', endTime: '13:00' },
                { id: 'annecy-dinner', title: 'Bistrot', kind: 'meal', meal: 'dinner', placeId: 'museum', stageId: 'annecy', dateMode: 'stage', startTime: '19:00', endTime: '20:00' },
                { id: 'annecy-hotel', title: 'Bistrot', kind: 'lodging', placeId: 'museum', stageId: 'annecy', dateMode: 'stage', startTime: '18:00', endTime: '09:00' }
            ]
        }
    });
    assert.deepEqual(outline.stages[0].meals.lunch.map(item => item.id), ['geneva-lunch']);
    assert.deepEqual(outline.stages[1].meals.lunch.map(item => item.id), ['annecy-lunch']);
    assert.deepEqual(outline.stages[1].meals.dinner.map(item => item.id), ['annecy-dinner']);
    assert.deepEqual(outline.stages[1].lodgings.map(item => item.id), ['annecy-hotel']);
});

test('signale implicitement les nuits sans hébergement', () => {
    const nights = tripNights({ startDate: '2026-09-10', endDate: '2026-09-12', reservations: [] });
    assert.deepEqual(nights, [
        { date: '2026-09-10', lodging: [] },
        { date: '2026-09-11', lodging: [] }
    ]);
});
