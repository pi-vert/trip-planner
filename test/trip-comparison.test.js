const test = require('node:test');
const assert = require('node:assert/strict');
const { metrics, normalizeDocument, placeKey, sharedPlaceKeys } = require('../src/trip-comparison.js');

const first = {
    itinerary: ['home', 'museum', 'home'],
    places: {
        home: { name: 'Genève', lat: 46.2, lng: 6.1, duration_h: 1, budget: 0 },
        museum: { name: 'Musée du Lac', lat: 46.3, lng: 6.2, duration_h: 2, budget: 25, budgetCurrency: 'EUR', ratings: { Eric: 5 } },
        optional: { name: 'Plage', lat: 46.4, lng: 6.3, duration_h: 2 }
    },
    edges: {
        'home|museum': { realKm: 20, realMin: 30 },
        'museum|home': { realKm: 22, realMin: 35 }
    },
    planning: { startDate: '2027-04-01', endDate: '2027-04-03', reservations: [{ id: 'hotel' }] },
    weather: { stages: { home: { climate: { monthly: [{ month: 4, tempMeanC: 20, humidityPct: 65, precipitationMm: 40, rainyDays: 5 }] }, stay: { source: 'climate', startDate: '2027-04-01', endDate: '2027-04-03', daily: [
        { date: '2027-04-01', tempMinC: 8, tempMaxC: 18, humidityPct: 70, precipitationMm: 1, source: 'climate' },
        { date: '2027-04-02', tempMinC: 9, tempMaxC: 19, humidityPct: 72, precipitationMm: 0, source: 'climate' },
        { date: '2027-04-03', tempMinC: 10, tempMaxC: 20, humidityPct: 74, precipitationMm: 2, source: 'climate' }
    ] } } } },
    people: 2
};

test('normalise et calcule les indicateurs comparables d’un circuit', () => {
    const state = normalizeDocument(first);
    const result = metrics(first, { price: 1500, currency: 'EUR', flightIncluded: false, flightPrice: 450, rating: 5 });

    assert.equal(state.places.museum.durationH, 2);
    assert.equal(result.days, 3);
    assert.equal(result.visits, 3);
    assert.equal(result.uniquePlaces.length, 2);
    assert.equal(result.optionalPlaces, 1);
    assert.equal(result.routeKm, 42);
    assert.equal(result.routeMin, 65);
    assert.equal(result.nativeTotals.EUR, 50);
    assert.equal(result.reservationCount, 1);
    assert.equal(result.averageRating, 5);
    assert.equal(result.offerPrice, 1500);
    assert.equal(result.flightIncluded, false);
    assert.equal(result.flightPrice, 450);
    assert.equal(result.offerTotal, 1950);
    assert.equal(result.weather.coverageDays, 3);
    assert.equal(result.weather.tempMinC, 9);
    assert.equal(result.weather.precipitationMm, 3);
    assert.equal(result.climate.coverageStages, 1);
});

test('ne double pas le prix du vol lorsqu’il est inclus dans le forfait', () => {
    const result = metrics(first, { price: 1500, currency: 'EUR', flightIncluded: true, flightPrice: 450 });

    assert.equal(result.offerTotal, 1500);
});

test('identifie les lieux communs malgré les accents et de faibles écarts de coordonnées', () => {
    const second = metrics({
        itinerary: ['lake', 'town'],
        places: {
            lake: { name: 'Musee du Lac', lat: 46.301, lng: 6.201 },
            town: { name: 'Annecy', lat: 45.9, lng: 6.13 }
        }
    });
    const firstMetrics = metrics(first);
    const shared = sharedPlaceKeys([{ metrics: firstMetrics }, { metrics: second }]);

    assert.equal(shared.has(placeKey(first.places.museum)), true);
    assert.equal(shared.has(placeKey(second.state.places.town)), false);
});
