const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../comparison-store');
const { createWeatherStore } = require('../weather-store');

test('les routes de comparaison enregistrent puis chargent les circuits et renvoient les erreurs en JSON', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-comparison-api-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const trips = ['alpha', 'beta'].map(id => ({ id, name: id, file: path.join(directory, `${id}.yaml`) }));
    for (const trip of trips) fs.writeFileSync(trip.file, `itinerary: [a]\nplaces:\n  a: {name: ${trip.id}, lat: 1, lng: 2}\n`);
    fs.writeFileSync(path.join(directory, 'trips.json'), JSON.stringify({ trips, active: 'alpha' }));
    const metadataFile = path.join(directory, 'trip-comparisons.json');

    // Run the real API with isolated stores, then exercise the deployed flow adapter.
    const apiModule = { exports: {} };
    const scopedRequire = name => {
        if (name === '../comparison-store') return { createStore: () => createStore({ tripsDir: directory }) };
        if (name === '../weather-store.js') return { createWeatherStore: () => createWeatherStore({ tripsDir: directory }) };
        throw Error(`Unexpected dependency: ${name}`);
    };
    new Function('require', 'module', fs.readFileSync(path.join(__dirname, '../api/comparison.js'), 'utf8'))(scopedRequire, apiModule);
    const flows = require('./helpers/flows.cjs');
    const routes = flows.filter(node => node.type === 'http in' && node.url === '/trip_planner/api/comparison');
    assert.deepEqual(routes.map(node => node.method).sort(), ['get', 'put']);
    const handler = flows.find(node => node.id === routes[0].wires[0][0]);
    assert.equal(routes[1].wires[0][0], handler.id);
    assert.equal(flows.find(node => node.id === handler.wires[0][0]).type, 'http response');
    const context = { get: key => key === 'comparisonApi' ? apiModule.exports : undefined };
    const request = (method, payload, query = {}) => new Function('msg', 'context', handler.func)({ req: { method, query }, payload }, context);

    const initial = request('GET');
    assert.equal(initial.statusCode, 200);
    assert.equal(initial.payload.trips.length, 2);
    const saved = request('PUT', {
        groups: [{ id: 'test', name: 'Deux circuits', tripIds: ['alpha', 'beta'] }],
        offers: { alpha: { price: 1500, currency: 'eur' } }
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(JSON.parse(fs.readFileSync(metadataFile, 'utf8')).groups[0].name, 'Deux circuits');
    const loaded = request('GET', undefined, { ids: 'alpha,beta' });
    assert.equal(loaded.statusCode, 200);
    assert.equal(loaded.headers['Cache-Control'], 'no-store');
    assert.match(loaded.headers['Content-Type'], /application\/json/);
    assert.deepEqual(loaded.payload.snapshots.map(item => item.id), ['alpha', 'beta']);
    assert.deepEqual(loaded.payload.snapshots[0].document.weather, { stages: {} });
    assert.equal(loaded.payload.offers.alpha.price, 1500);
    assert.equal(loaded.payload.offers.alpha.currency, 'EUR');

    fs.writeFileSync(trips[0].file, 'itinerary: [');
    const broken = request('GET', undefined, { ids: 'alpha,beta' });
    assert.equal(broken.statusCode, 500);
    assert.match(broken.payload.error, /Lecture des circuits impossible/);
    fs.unlinkSync(path.join(directory, 'trips.json'));
    const failedSave = request('PUT', { groups: [], offers: {} });
    assert.equal(failedSave.statusCode, 500);
    assert.match(failedSave.payload.error, /Enregistrement de la comparaison impossible/);
});
