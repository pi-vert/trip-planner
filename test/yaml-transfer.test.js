const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createYamlStore, validateYaml, MAX_YAML_BYTES } = require('../yaml-transfer');

const sample = `# Voyage avec accents et données facultatives
itinerary: [lac]
startPlaceId: lac
places:
  lac:
    name: Genève — lac
    lat: 46.2
    lng: 6.1
    duration_h: 2
    stageType: main
    arrivalDate: '2026-09-20'
    ratings: { Eric: 5 }
  option:
    name: Musée
    budget: 20
    budgetCurrency: EUR
planning:
  reservations:
    - { id: visite, placeIds: [lac], dateMode: stage, startTime: '10:00' }
notes: Prévoir les billets.
budgetCurrencies: [EUR, CHF]
people: 3
edges: {}
customField: À conserver
`;

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-yaml-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const tripsDir = path.join(root, 'trips');
    fs.mkdirSync(tripsDir);
    const registry = { trips: [], ignored: [] };
    fs.writeFileSync(path.join(tripsDir, 'trips.json'), JSON.stringify(registry));
    return { root, tripsDir, registry, store: createYamlStore({ tripsDir }) };
}

test('import puis export préservent exactement le YAML, ses commentaires, options et planning', t => {
    const { tripsDir, registry, store } = fixture(t);
    const imported = store.importFile({ filename: 'Été au lac.YML', content: sample });
    assert.equal(imported.filename, 'ete-au-lac.yaml');
    registry.trips.push({ id: imported.id, file: path.join(tripsDir, imported.filename) });
    const exported = store.exportFile(imported.id, registry);
    assert.equal(exported.filename, imported.filename);
    assert.equal(exported.content.toString('utf8'), sample);
    const second = store.importFile({ filename: exported.filename, content: exported.content.toString() }, registry);
    assert.equal(second.filename, 'ete-au-lac-2.yaml');
    assert.equal(fs.readFileSync(path.join(tripsDir, imported.filename), 'utf8'), sample);
});

test('les collisions YAML/YML, voyages ignorés et identifiants réservés créent de nouveaux fichiers', t => {
    const { tripsDir, registry, store } = fixture(t);
    fs.writeFileSync(path.join(tripsDir, 'lac.YML'), 'original');
    registry.ignored.push('lac-2');
    registry.trips.push({ id: 'lac-3', file: path.join(tripsDir, 'missing.yaml') });
    assert.equal(store.importFile({ filename: 'lac.yaml', content: sample }, registry).id, 'lac-4');
    assert.equal(fs.readFileSync(path.join(tripsDir, 'lac.YML'), 'utf8'), 'original');
    assert.equal(store.importFile({ filename: 'default.yaml', content: sample }, registry).id, 'default-2');
    assert.equal(store.importFile({ filename: 'trip-planner.yaml', content: sample }, registry).id, 'trip-planner-2');
});

test('un document invalide ne crée aucun fichier et indique la cause', t => {
    const { tripsDir, store } = fixture(t);
    const invalid = [
        ['', /vide/],
        ['itinerary: [', /ligne/],
        ['- voyage', /itinerary/],
        ['itinerary: []\nplaces: 2026-09-20', /places/],
        ['itinerary: [absent]\nplaces: {}', /lieu existant/],
        ['itinerary: []\nplaces: { lac: null }', /Chaque lieu/],
        ['itinerary: []\nplaces: { lac: {lat: 100} }', /Coordonnée/],
        ['itinerary: []\nplaces: {}\nplanning: []', /planning/],
        ['itinerary: []\nplaces: {}\nplanning: { reservations: {} }', /reservations/],
        ['itinerary: []\nplaces: {}\n__proto__: { polluted: yes }', /Clé YAML/],
        ['itinerary: []\nplaces: {}\nloop: &loop { self: *loop }', /circulaires/],
        ['itinerary: []\nplaces: {}\n---\nitinerary: []\nplaces: {}', /YAML invalide/],
        ['#' + 'a'.repeat(MAX_YAML_BYTES), /limite/]
    ];
    for (const [content, expected] of invalid) {
        assert.throws(() => store.importFile({ filename: 'invalid.yaml', content }), expected);
    }
    for (const filename of ['../escape.yaml', 'a\\escape.yml', 'voyage.txt', 'a\n.yaml']) {
        assert.throws(() => store.importFile({ filename, content: sample }), /fichier/);
    }
    assert.deepEqual(fs.readdirSync(tripsDir), ['trips.json']);
    assert.equal({}.polluted, undefined);
    assert.deepEqual(validateYaml('itinerary: []\nplaces: {}'), { itinerary: [], places: {} });
});

test('export refuse les voyages absents et les fichiers en dehors du dossier, y compris les liens', t => {
    const { root, tripsDir, registry, store } = fixture(t);
    const outside = path.join(root, 'outside.yaml');
    fs.writeFileSync(outside, sample);
    fs.symlinkSync(outside, path.join(tripsDir, 'link.yaml'));
    registry.trips.push(
        { id: 'outside', file: outside },
        { id: 'link', file: path.join(tripsDir, 'link.yaml') },
        { id: 'json', file: path.join(tripsDir, 'trips.json') },
        { id: 'missing', file: path.join(tripsDir, 'missing.yaml') }
    );
    for (const id of ['outside', 'link', 'json']) {
        assert.throws(() => store.exportFile(id, registry), /dossier des voyages/);
    }
    for (const id of ['missing', '../outside', null]) {
        assert.throws(() => store.exportFile(id, registry), error => error.statusCode === 404);
    }
});

test('les routes HTTP importent, actualisent le Trip Manager et exportent le même fichier', t => {
    const { tripsDir, registry, store } = fixture(t);
    const flows = require('./helpers/flows.cjs');
    const handler = flows.find(node => node.id === '7af26dcb93e00103');
    const values = new Map([['tripRegistry', registry], ['loadedOnce', true]]);
    const flow = { get: key => values.get(key), set: (key, value) => values.set(key, value) };
    const context = { get: () => ({ createYamlStore: () => store }) };
    const node = { warn(error) { throw Error(error); } };
    const request = msg => new Function('msg', 'flow', 'context', 'node', handler.func)(msg, flow, context, node);
    const [response, refresh] = request({ req: { method: 'POST' }, payload: { filename: 'circuit.yml', content: sample } });
    assert.equal(response.statusCode, 201);
    assert.equal(response.payload.filename, 'circuit.yaml');
    assert.equal(refresh.payload.action, 'listTrips');

    const manager = flows.find(item => item.id === 'b6b012cf351f1918');
    const [write, ui] = new Function('msg', 'flow', 'fs', manager.func.replaceAll('/home/pi/trips', tripsDir))(refresh, flow, fs);
    assert.ok(ui.payload.trips.some(trip => trip.id === 'circuit'));
    assert.equal(ui._needReload, false);
    fs.writeFileSync(write.filename, write.payload);

    const [download] = request({ req: { method: 'GET', query: { id: 'circuit' } } });
    assert.equal(download.statusCode, 200);
    assert.equal(download.payload.toString(), sample);
    assert.match(download.headers['Content-Disposition'], /filename\*=UTF-8''circuit.yaml/);
    assert.equal(download.headers['Cache-Control'], 'no-store');
    const [bad, noRefresh] = request({ req: { method: 'POST' }, payload: { filename: 'bad.yml', content: 'hello' } });
    assert.equal(bad.statusCode, 400);
    assert.match(bad.payload.error, /itinerary/);
    assert.equal(noRefresh, null);
});
