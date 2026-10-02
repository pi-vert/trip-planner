const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, normalizeMode } = require('../src/experience.js');

test('le guide accepte un voyage sans dates et distingue visites, options et lieux réalisés', () => {
    const state = Object.freeze({
        places: { home: {}, museum: { completed: true }, option: { completed: true } },
        itinerary: ['home', 'museum', 'home', 'deleted'],
        planning: { reservations: [{ kind: 'lodging' }] }
    });
    assert.deepEqual(summarize(state), { places: 3, visits: 2, candidates: 1, dated: false, reservations: 1, completed: 1 });
    assert.deepEqual(state.itinerary, ['home', 'museum', 'home', 'deleted']);
});

test('le guide gère le voyage vide et ne considère pas une seule borne comme un calendrier complet', () => {
    assert.equal(summarize().visits, 0);
    assert.equal(summarize({ planning: { startDate: '2026-10-02' } }).dated, false);
    assert.equal(summarize({ planning: { startDate: '2026-10-02', endDate: '2026-10-05' } }).dated, true);
    assert.equal(normalizeMode('obsolete'), 'prepare');
});
