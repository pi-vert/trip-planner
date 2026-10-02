const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRecordingsStore } = require('../recordings-store');
const { createApi } = require('../api/recordings');
const { canComplete } = require('../src/visit-progress');
const { ALL_STAGES } = require('../src/gps-comparison');

const gpx = '<gpx><trk><name>Essai</name><trkseg><trkpt lat="46" lon="6"><time>2026-09-10T08:00:00Z</time></trkpt><trkpt lat="46.001" lon="6"><time>2026-09-10T08:01:00Z</time></trkpt></trkseg></trk></gpx>';
const reference = () => ({ label: 'Avant départ', stages: [{ key: 'city:0', id: 'city', title: 'Ville', stops: [{ id: 'a', title: 'Hôtel', lat: 46, lng: 6 }], segments: [{ fromId: 'a', toId: 'b', geometry: [[6, 46], [6, 46.01]], geometrySource: 'road', km: 1, minutes: 15 }] }, { key: 'city:1', title: 'Retour', stops: [], segments: [] }] });

function setup(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-recordings-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.writeFileSync(path.join(directory, 'trips.json'), JSON.stringify({ trips: [{ id: 'alpha' }, { id: 'beta' }] }));
    return { directory, store: createRecordingsStore({ tripsDir: directory }) };
}

test('enregistre plusieurs références immuables et plusieurs GPX, avec déduplication et réaffectation', t => {
    const { store, directory } = setup(t);
    const source = reference(), first = store.addReference('alpha', source);
    source.stages[0].title = 'Modifié ensuite';
    const second = store.addReference('alpha', source);
    const input = { referenceId: first.id, stageKey: 'city:0', filename: 'garmin.gpx', content: gpx };
    const saved = store.importTrack('alpha', input);
    const another = store.importTrack('alpha', { ...input, filename: 'jour2.gpx', content: gpx.replaceAll('09-10', '09-11') });
    assert.equal(store.importTrack('alpha', { ...input, stageKey: 'city:1' }).duplicate, true);
    assert.equal(store.load('alpha').tracks.length, 2);
    assert.equal(store.load('beta').tracks.length, 0);
    assert.equal(store.load('alpha').references[0].stages[0].title, 'Ville');
    assert.equal(store.load('alpha').references[1].stages[0].title, 'Modifié ensuite');
    const reloaded = createRecordingsStore({ tripsDir: directory });
    assert.equal(reloaded.load('alpha').tracks[0].segments[0].length, 2);
    reloaded.moveTrack('alpha', { trackId: saved.track.id, referenceId: second.id, stageKey: 'city:1' });
    assert.equal(reloaded.load('alpha').tracks[0].referenceId, second.id);
    reloaded.deleteTrack('alpha', another.track.id);
    assert.equal(reloaded.load('alpha').tracks.length, 1);
    assert.equal(reloaded.load('alpha').references.length, 2);
    assert.equal(fs.readdirSync(path.join(directory, 'recordings')).length, 1);
});

test('ne modifie aucune donnée pour un GPX invalide, un voyage absent ou une affectation invalide', t => {
    const { store } = setup(t);
    const saved = store.addReference('alpha', reference());
    const before = JSON.stringify(store.load('alpha'));
    assert.throws(() => store.load('../alpha'), /inconnu/);
    assert.throws(() => store.importTrack('alpha', { referenceId: saved.id, stageKey: 'none', content: gpx }), /étape/);
    assert.throws(() => store.importTrack('alpha', { referenceId: saved.id, stageKey: 'city:0', content: '<gpx>' }), /GPX invalide/);
    assert.throws(() => store.addReference('alpha', { stages: [{ key: 'a', segments: [{ geometry: [[999, 1]] }] }] }), /Coordonnées/);
    assert.equal(JSON.stringify(store.load('alpha')), before);
});

test('importe et conserve un GPX de plus de 5 Mo avec ses 40 000 points', t => {
    const { store, directory } = setup(t);
    const ref = store.addReference('alpha', reference());
    const point = '<trkpt lat="46.2" lon="6.1"><ele>400</ele><time>2026-09-10T08:00:00Z</time><extensions><TrackPointExtension><hr>110</hr></TrackPointExtension></extensions></trkpt>';
    const content = `<gpx><trk><name>Longue activité Garmin</name><trkseg>${point.repeat(40000)}</trkseg></trk></gpx>`;
    assert.ok(Buffer.byteLength(content) > 5 * 1024 * 1024);
    const imported = store.importTrack('alpha', { referenceId: ref.id, stageKey: 'city:0', filename: 'longue-activite.gpx', content });
    assert.equal(imported.track.pointCount, 40000);
    assert.equal(imported.track.segments[0].length, 40000);
    const reloaded = createRecordingsStore({ tripsDir: directory }).load('alpha');
    assert.equal(reloaded.tracks[0].pointCount, 40000);
    assert.equal(reloaded.tracks[0].segments[0].length, 40000);
});

test('les routes Node-RED exposent la sauvegarde, l’import et la suppression avec erreurs JSON', t => {
    const { store } = setup(t), api = createApi(store);
    const flows = require('./helpers/flows.cjs');
    const routes = flows.filter(node => node.type === 'http in' && node.url === '/trip_planner/api/recordings');
    assert.deepEqual(routes.map(route => route.method).sort(), ['delete', 'get', 'post', 'put']);
    const handler = flows.find(node => node.id === routes[0].wires[0][0]);
    const request = (method, payload, query = {}) => new Function('msg', 'context', handler.func)({ req: { method, query }, payload }, { get: () => api });
    const ref = request('POST', { tripId: 'alpha', action: 'reference', reference: reference() });
    assert.equal(ref.statusCode, 200);
    const imported = request('POST', { tripId: 'alpha', action: 'import', referenceId: ref.payload.id, stageKey: 'city:0', content: gpx });
    assert.equal(imported.statusCode, 200);
    const loaded = request('GET', null, { tripId: 'alpha' });
    assert.equal(loaded.payload.tracks.length, 1);
    assert.equal(loaded.headers['Cache-Control'], 'no-store');
    assert.equal(request('DELETE', null, { tripId: 'alpha', trackId: imported.payload.track.id }).statusCode, 200);
    assert.equal(request('GET', null, { tripId: 'unknown' }).statusCode, 404);
    assert.equal(request('POST', { tripId: 'alpha', action: 'bad' }).statusCode, 400);
});

test('accepte une randonnée affectée au voyage entier sans dupliquer les enregistrements', t => {
    const { store } = setup(t);
    const ref = store.addReference('alpha', reference());
    const imported = store.importTrack('alpha', { referenceId: ref.id, stageKey: ALL_STAGES, content: gpx });
    assert.equal(imported.track.stageKey, ALL_STAGES);
    store.moveTrack('alpha', { trackId: imported.track.id, referenceId: ref.id, stageKey: 'city:0' });
    assert.equal(store.load('alpha').tracks.length, 1);
});

test('conserve et annule les statuts réalisés sans modifier le voyage ni la référence figée', t => {
    const { store, directory } = setup(t);
    const file = path.join(directory, 'alpha.yaml');
    const yaml = 'itinerary: [home, monument, future, hotel, city, child]\nplaces:\n  home: {name: Départ, lat: 46, lng: 6}\n  monument: {name: Monument, lat: 46.001, lng: 6}\n  future: {name: Visite future, lat: 46.002, lng: 6}\n  hotel: {name: Hôtel, lat: 46.003, lng: 6, tags: [hôtel]}\n  city: {name: Ville, stageType: main}\n  child: {name: Musée, stageType: detail, parentStageId: city}\n';
    fs.writeFileSync(file, yaml);
    fs.writeFileSync(path.join(directory, 'trips.json'), JSON.stringify({ trips: [{ id: 'alpha', file }, { id: 'beta' }] }));
    const ref = store.addReference('alpha', reference());
    const imported = store.importTrack('alpha', { referenceId: ref.id, stageKey: 'city:0', content: gpx });
    const result = store.setCompleted('alpha', { placeIds: ['monument', 'future', 'hotel', 'home', 'city', 'missing'], completed: true, source: 'gps', referenceId: ref.id, trackIds: [imported.track.id] });
    assert.deepEqual(result.changed, ['monument', 'future']);
    assert.deepEqual(result.skipped, ['hotel', 'home', 'city', 'missing']);
    const reloaded = createRecordingsStore({ tripsDir: directory }).load('alpha');
    assert.equal(reloaded.completedPlaces.monument.source, 'gps');
    assert.deepEqual(reloaded.completedPlaces.future.trackIds, [imported.track.id]);
    assert.deepEqual(reloaded.references[0], ref);
    assert.equal(fs.readFileSync(file, 'utf8'), yaml);
    const restored = store.setCompleted('alpha', { placeIds: ['monument'], completed: false });
    assert.ok(!Object.hasOwn(restored.completedPlaces, 'monument'));
    assert.ok(Object.hasOwn(restored.completedPlaces, 'future'));
    assert.equal(store.load('beta').completedPlaces, undefined);
    const api = createApi(store);
    let metadata;
    api.get({ query: { tripId: 'alpha', progress: '1' } }, { set() { return this; }, json(value) { metadata = value; } });
    assert.ok(metadata.completedPlaces.future);
    assert.equal(metadata.tracks, undefined);
    assert.equal(canComplete('hotel', require('js-yaml').load(yaml)), false);
});
