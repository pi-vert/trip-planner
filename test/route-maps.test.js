const test = require('node:test');
const assert = require('node:assert/strict');
const { coordinates, mapViewport, prepareMaps, prepareStageMaps, captureReference } = require('../src/route-maps.js');

function fakeCanvas() {
    const context = Object.fromEntries(['fillRect', 'drawImage', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'setLineDash', 'arc', 'fill', 'fillText'].map(name => [name, () => {}]));
    return { getContext: () => context, toDataURL: () => 'data:image/jpeg;base64,/9j/2Q==' };
}

const places = { a: { lat: 46.2, lng: 6.1 }, b: { lat: 46.3, lng: 6.2 } };
const segment = { fromId: 'a', toId: 'b', fixed: false };

test('cadre toute la route et franchit correctement le méridien de changement de date', () => {
    for (const points of [ [[6.1, 46.2], [6.6, 46.25], [6.2, 46.3]], [[179.8, 20], [-179.8, 20.1]], [[6, 46], [6, 46]] ]) {
        const view = mapViewport(points);
        for (const point of points) {
            const pixel = view.pixel(point);
            assert.ok(pixel.x >= 40 && pixel.x <= 1160);
            assert.ok(pixel.y >= 40 && pixel.y <= 450);
        }
        assert.ok(view.zoom >= 1 && view.zoom <= 16);
    }
    assert.equal(coordinates({ lat: null, lng: 6 }), null);
    assert.equal(coordinates({ lat: '', lng: 6 }), null);
    assert.equal(coordinates({ lat: 91, lng: 6 }), null);
    assert.deepEqual(coordinates({ lat: 0, lng: 0 }), [0, 0]);
});

test('prépare une carte routière intégrée, réutilise les tuiles et la carte des trajets répétés', async () => {
    const requests = [], tiles = [], progress = [];
    const prepared = await prepareMaps([segment, { ...segment, date: '2026-09-11' }], places, {
        fetch: async url => { requests.push(url); return { ok: true, json: async () => ({ routes: [{ geometry: { coordinates: [[6.1, 46.2], [6.15, 46.3], [6.2, 46.3]] } }] }) }; },
        loadTile: async url => { tiles.push(url); return {}; }, createCanvas: fakeCanvas,
        onProgress: (...args) => progress.push(args)
    });
    assert.equal(requests.length, 1);
    assert.ok(requests[0].includes('6.1,46.2;6.2,46.3'));
    assert.ok(tiles.length > 1);
    assert.equal(tiles.length, new Set(tiles).size);
    assert.equal(prepared[0].map, prepared[1].map);
    assert.ok(prepared[0].map.complete);
    assert.deepEqual(Array.from(prepared[0].map.image.bytes), [255, 216, 255, 217]);
    assert.match(prepared[0].map.caption, /Tracé routier OSRM/);
    assert.deepEqual(progress, [[1, 2], [2, 2]]);
});

test('conserve un document exportable si les services de carte et de routage échouent', async () => {
    let attempts = 0;
    const prepared = await prepareMaps([segment, { fromId: 'unknown', toId: 'b' }], places, {
        fetch: async () => { attempts++; throw new Error('hors ligne'); },
        loadTile: async () => { throw new Error('hors ligne'); }, createCanvas: fakeCanvas
    });
    assert.equal(attempts, 2);
    assert.ok(prepared[0].map.image.bytes.length);
    assert.equal(prepared[0].map.complete, false);
    assert.match(prepared[0].map.caption, /vol d’oiseau/);
    assert.match(prepared[0].map.caption, /Fond cartographique indisponible/);
    assert.equal(prepared[1].map.image, undefined);
    assert.match(prepared[1].map.caption, /coordonnées à compléter/);
});

test('un transport réservé ne déclenche pas de routage automobile', async () => {
    const prepared = await prepareMaps([{ ...segment, fixed: true }], places, {
        fetch: async () => { assert.fail('un train ou vol ne doit pas utiliser le réseau routier'); },
        loadTile: async () => ({}), createCanvas: fakeCanvas
    });
    assert.match(prepared[0].map.caption, /Transport réservé · liaison indicative/);
    assert.equal(prepared[0].map.complete, true);
});

test('une carte d’étape contient plusieurs parcours distincts et réutilise les tracés répétés', async () => {
    const requests = [], drawnPaths = [], labels = [];
    const stagePlaces = { ...places, c: { lat: 46.5, lng: 6.5 }, d: { lat: 46.6, lng: 6.6 } };
    const stages = [{ title: 'Étape complète', stops: Object.keys(stagePlaces).map((id, i) => ({ id, number: i + 1, hotel: id === 'a' })), segments: [
        { fromId: 'a', toId: 'b', date: '2026-09-10' },
        { fromId: 'c', toId: 'd', date: '2026-09-11' },
        { fromId: 'a', toId: 'b', date: '2026-09-12' },
        { fromId: 'd', toId: 'missing', date: '2026-09-12' }
    ] }];
    const maps = await prepareStageMaps(stages, stagePlaces, {
        fetch: async url => {
            requests.push(url);
            const coords = url.split('/').at(-1).split('?')[0].split(';').map(pair => pair.split(',').map(Number));
            return { ok: true, json: async () => ({ routes: [{ geometry: { coordinates: coords } }] }) };
        }, loadTile: async () => ({}),
        createCanvas: () => {
            const canvas = fakeCanvas(), ctx = canvas.getContext();
            let path = [];
            ctx.beginPath = () => { path = []; };
            ctx.moveTo = (x, y) => path.push([x, y]);
            ctx.lineTo = (x, y) => path.push([x, y]);
            ctx.stroke = () => { if (path.length) drawnPaths.push(path.slice()); };
            ctx.fillText = label => labels.push(label);
            return canvas;
        }
    });
    assert.equal(requests.length, 2);
    assert.equal(maps.length, 1);
    assert.equal(maps[0].segments.length, 4);
    assert.equal(maps[0].routeDays.length, 3);
    assert.equal(new Set(maps[0].segments.map(item => item.color)).size, 3);
    assert.equal(drawnPaths.length, 6);
    assert.ok(drawnPaths.every(path => path.length === 2), 'aucune liaison fictive entre deux parcours distincts');
    assert.ok(drawnPaths.flat().every(([x, y]) => x >= 40 && x <= 1160 && y >= 40 && y <= 760));
    assert.deepEqual(labels, ['1', '2', '3', '4']);
    assert.match(maps[0].map.caption, /1 trajet\(s\) non cartographié/);
    assert.equal(maps[0].map.complete, false);
    assert.equal(maps[0].map.image.height, 800);
});

test('une étape sans trajet montre son lieu et une étape sans GPS reste exportable', async () => {
    const maps = await prepareStageMaps([
        { stops: [{ id: 'a', number: 1 }], segments: [] },
        { stops: [{ id: 'missing', number: 1 }], segments: [] }
    ], places, { fetch: async () => assert.fail('aucun routage nécessaire'), loadTile: async () => ({}), createCanvas: fakeCanvas });
    assert.ok(maps[0].map.image.bytes.length);
    assert.equal(maps[1].map.image, undefined);
    assert.equal(maps[1].stops[0].missingCoordinates, true);
});

test('fige les lieux et les tracés, réutilise le routage et signale les références indicatives', async () => {
    const source = { ...places, a: { ...places.a, name: 'Hôtel avant départ' } };
    const stage = { key: 'city:0', title: 'Ville', stops: [{ id: 'a', title: source.a.name }], segments: [segment, segment, { fromId: 'b', toId: 'a', fixed: true }] };
    let calls = 0;
    const captured = await captureReference([stage], source, { fetch: async () => {
        calls++; return { ok: true, json: async () => ({ routes: [{ geometry: { coordinates: [[6.1, 46.2], [6.15, 46.25], [6.2, 46.3]] } }] }) };
    } });
    assert.equal(calls, 1);
    source.a.lat = 0;
    source.a.name = 'Modifié';
    assert.equal(captured[0].stops[0].lat, 46.2);
    assert.equal(captured[0].stops[0].title, 'Hôtel avant départ');
    assert.equal(captured[0].segments[0].geometrySource, 'road');
    assert.equal(captured[0].segments[2].geometrySource, 'indicative');
    assert.equal(captured[0].segments[0].geometry.length, 3);
    const offline = await captureReference([stage], places, { fetch: async () => { throw Error('hors ligne'); } });
    assert.equal(offline[0].segments[0].geometrySource, 'indicative');
});
