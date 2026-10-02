const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../comparison-store.js');

test('enregistre les groupes et charge uniquement les YAML demandés', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-comparison-'));
    try {
        const registryFile = path.join(directory, 'trips.json');
        const metadataFile = path.join(directory, 'trip-comparisons.json');
        fs.writeFileSync(path.join(directory, 'alpha.yaml'), 'itinerary: [a]\nplaces:\n  a: {name: Alpha, lat: 1, lng: 2}\n');
        fs.writeFileSync(path.join(directory, 'beta.yaml'), 'itinerary: [b]\nplaces:\n  b: {name: Beta, lat: 3, lng: 4}\n');
        fs.writeFileSync(registryFile, JSON.stringify({ trips: [
            { id: 'alpha', name: 'Circuit Alpha', file: path.join(directory, 'alpha.yaml') },
            { id: 'beta', name: 'Circuit Beta', file: path.join(directory, 'beta.yaml') }
        ] }));
        const store = createStore({ tripsDir: directory, registryFile, metadataFile });

        const saved = store.save({
            groups: [{ id: 'japon-2027', name: 'Japon 2027', tripIds: ['alpha', 'beta', 'unknown'] }],
            offers: { alpha: { provider: 'Agence A', price: 2500, currency: 'eur', flightIncluded: false, flightPrice: 620, included: 'Hôtel' }, unknown: { provider: 'Non' } }
        });
        const loaded = store.load(['beta', 'unknown']);

        assert.deepEqual(saved.groups[0].tripIds, ['alpha', 'beta']);
        assert.equal(saved.offers.alpha.currency, 'EUR');
        assert.equal(saved.offers.alpha.flightIncluded, false);
        assert.equal(saved.offers.alpha.flightPrice, 620);
        assert.deepEqual(saved.offers.alpha.included, ['Hôtel']);
        assert.equal(loaded.snapshots.length, 1);
        assert.equal(loaded.snapshots[0].document.places.b.name, 'Beta');
        assert.equal(loaded.offers.unknown, undefined);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
