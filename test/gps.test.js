const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGpx, MAX_GPX_BYTES } = require('../gpx-import');
const Gps = require('../src/gps-comparison');

const sample = `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" version="1.1"><trk><name>Promenade &amp; lac</name><trkseg>
<trkpt lat="46" lon="6"><ele>400</ele><time>2026-09-10T08:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>110</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
<trkpt lat="46.001" lon="6"><ele>405</ele><time>2026-09-10T08:01:00Z</time></trkpt></trkseg>
<trkseg><trkpt lat="47" lon="7"><time>2026-09-10T09:00:00Z</time></trkpt><trkpt lat="47.001" lon="7"><time>2026-09-10T09:01:00Z</time></trkpt></trkseg></trk></gpx>`;

test('importe un GPX Garmin avec extensions, altitude, horaires UTC et interruptions', () => {
    const track = parseGpx(sample);
    assert.equal(track.name, 'Promenade & lac');
    assert.equal(track.segments.length, 2);
    assert.equal(track.pointCount, 4);
    assert.equal(track.segments[0][0][3], 400);
    assert.equal(track.segments[0][0][2], Date.parse('2026-09-10T08:00:00Z'));
    const stats = Gps.trackStats(track);
    assert.ok(stats.km > .22 && stats.km < .23, 'aucune liaison artificielle entre les segments');
    assert.equal(stats.elapsedMinutes, 61);
    assert.equal(stats.movingMinutes, 2);
});

test('accepte les espaces de noms préfixés et les GPX sans horaires', () => {
    const track = parseGpx('<g:gpx xmlns:g="http://www.topografix.com/GPX/1/0"><g:trk><g:trkseg><g:trkpt lat="0" lon="0"/><g:trkpt lat="0.001" lon="0"/></g:trkseg></g:trk></g:gpx>');
    assert.equal(track.pointCount, 2);
    assert.equal(Gps.trackStats(track).movingMinutes, null);
    assert.equal(Gps.trackStats(track).elapsedMinutes, null);
    assert.match(track.warnings[0], /sans horaire/);
    const route = parseGpx('<gpx><rte><rtept lat="0" lon="0"/><rtept lat="0" lon="0.01"/></rte></gpx>');
    assert.ok(route.warnings.some(item => item.includes('pas une activité')));
});

test('refuse XML invalide, DTD, coordonnées erronées et fichiers vides ou surdimensionnés', () => {
    for (const xml of ['', '<gpx><trk></gpx>', '<html/>', '<!DOCTYPE gpx [<!ENTITY a "x">]><gpx/>', '<gpx><trk><trkseg><trkpt lat="91" lon="0"/></trkseg></trk></gpx>', '<gpx><wpt lat="0" lon="0"/></gpx>']) assert.throws(() => parseGpx(xml));
    assert.throws(() => parseGpx(' '.repeat(MAX_GPX_BYTES) + '<gpx/>'), /20 Mo/);
    const invalidTime = parseGpx(sample.replace('2026-09-10T08:00:00Z', 'not-a-date'));
    assert.equal(invalidTime.segments[0][0][2], null);
    assert.ok(invalidTime.warnings.some(item => item.includes('invalide')));
});

test('distingue pauses, temps manquants et interruptions des temps de déplacement', () => {
    const t = Date.parse('2026-09-10T08:00:00Z');
    const stats = Gps.trackStats({ segments: [[[46, 6, t], [46.001, 6, t + 60000], [46.001, 6, t + 120000], [46.002, 6, t + 720000]]] });
    assert.equal(stats.elapsedMinutes, 12);
    assert.equal(stats.movingMinutes, 1);
    assert.equal(stats.gaps, 1);
});

test('compare distances, proximité et écarts au tracé sans transformer les gaps en visites', () => {
    const stage = { segments: [{ fromId: 'a', toId: 'b', date: '2026-09-10', geometry: [[6, 46], [6, 46.01]], geometrySource: 'road', km: 1.2, minutes: 20 }], stops: [
        { id: 'a', title: 'Départ', lat: 46, lng: 6 }, { id: 'b', title: 'Arrivée', lat: 46.01, lng: 6 }, { id: 'c', title: 'Détour', lat: 46, lng: 6.01 }
    ] };
    const t = Date.parse('2026-09-10T08:00:00Z');
    const track = { segments: [[[46, 6, t], [46.0005, 6, t + 60000]], [[46, 6.01, t + 120000], [46.0005, 6.01, t + 180000]]] };
    const result = Gps.compare(stage, [track]);
    assert.equal(result.plannedKm, 1.2);
    assert.ok(result.actualKm > .11 && result.actualKm < .12);
    assert.ok(result.offRouteKm > .05 && result.offRouteKm < .06);
    assert.deepEqual(result.stops.map(stop => stop.observed), [true, false, true]);
    assert.equal(Gps.compare({ ...stage, segments: [{ ...stage.segments[0], geometrySource: 'indicative' }] }, [track]).offRouteKm, null);
    const gap = { segments: [[[45, 6, t]], [[47, 6, t + 3600000]]] };
    assert.equal(Gps.compare(stage, [gap]).stops[0].observed, false);
    assert.equal(Gps.compare(stage, []).actualKm, null);
    assert.equal(Gps.compare(stage, [track, track]).overlap, true);
});

test('le filtre journalier conserve les séparations et exclut les points sans date', () => {
    const a = new Date(2026, 8, 10, 10).getTime(), b = new Date(2026, 8, 11, 10).getTime();
    const track = { segments: [[[46, 6, a], [46.001, 6, null], [46.002, 6, a + 60000]], [[47, 7, b], [47.001, 7, b + 60000]]] };
    const filtered = Gps.filterDay(track, '2026-09-10');
    assert.equal(filtered.segments.length, 2);
    assert.equal(Gps.trackStats(filtered).km, 0);
    assert.equal(Gps.filterDay(track, '').segments, track.segments);
});

test('compare une randonnée aux monuments des autres jours et déduplique les lieux du voyage', () => {
    const reference = { stages: [
        { title: 'Premier jour', stops: [{ id: 'shared', title: 'Place', lat: 46, lng: 6 }], segments: [{ date: '2026-09-10', fromId: 'shared', toId: 'shared', geometry: [[6, 46], [6.01, 46]], geometrySource: 'road', km: 1, minutes: 10 }] },
        { title: 'Troisième jour', stops: [{ id: 'shared', title: 'Place', lat: 46, lng: 6 }, { id: 'future', title: 'Monument prévu plus tard', lat: 46.002, lng: 6 }], segments: [{ date: '2026-09-12', fromId: 'shared', toId: 'future', geometry: [[6, 46], [6, 46.002]], geometrySource: 'road', km: 2, minutes: 20 }] }
    ] };
    const before = JSON.stringify(reference);
    const trip = Gps.wholeTrip(reference);
    const time = new Date(2026, 8, 10, 10).getTime();
    const track = { id: 'walk', segments: [[[46.002, 6, time], [46.0021, 6, time + 60000]]] };
    const result = Gps.compare(trip, [track], { day: '2026-09-10', threshold: 50 });
    assert.equal(result.plannedKm, 3);
    assert.equal(result.stops.length, 2);
    assert.deepEqual(result.stops[0].stageTitles, ['Premier jour', 'Troisième jour']);
    assert.equal(result.stops.find(stop => stop.id === 'future').observed, true);
    assert.equal(result.stops.find(stop => stop.id === 'future').distanceMeters, 0);
    assert.equal(JSON.stringify(reference), before);
});

module.exports = { sample };
