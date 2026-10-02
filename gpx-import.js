'use strict';

const { SaxesParser } = require('saxes');
const MAX_GPX_BYTES = 20 * 1024 * 1024;
const MAX_POINTS = 100000;

function parseGpx(xml) {
    if (typeof xml !== 'string' || !xml.trim()) throw new Error('Fichier GPX vide.');
    if (Buffer.byteLength(xml, 'utf8') > MAX_GPX_BYTES) throw new Error('Le fichier GPX dépasse 20 Mo.');
    const parser = new SaxesParser({ xmlns: true });
    const stack = [], tracks = [], routes = [];
    let rootNamespace = '', rootSeen = false, segment = null, point = null, count = 0, name = '', text = '';
    let missingTimes = 0, invalidTimes = 0;
    parser.on('doctype', () => { throw new Error('Les déclarations DTD ne sont pas acceptées dans un GPX.'); });
    parser.on('opentag', tag => {
        if (!rootSeen) {
            rootSeen = true;
            if (tag.local !== 'gpx' || !['', 'http://www.topografix.com/GPX/1/0', 'http://www.topografix.com/GPX/1/1'].includes(tag.uri)) throw new Error('Ce fichier n’est pas un document GPX.');
            rootNamespace = tag.uri;
        }
        const parent = stack.at(-1);
        const local = tag.uri === rootNamespace ? tag.local : '';
        stack.push(local);
        text = '';
        if ((local === 'trkseg' && parent === 'trk') || (local === 'rte' && parent === 'gpx')) segment = [];
        if ((local === 'trkpt' && parent === 'trkseg') || (local === 'rtept' && parent === 'rte')) {
            if (++count > MAX_POINTS) throw new Error('Le GPX dépasse 100 000 points.');
            const latText = tag.attributes.lat?.value, lngText = tag.attributes.lon?.value;
            const lat = Number(latText), lng = Number(lngText);
            if (latText == null || lngText == null || !latText.trim() || !lngText.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error(`Coordonnées invalides au point ${count}.`);
            point = [lat, lng, null, null];
        }
    });
    parser.on('text', value => { text += value; });
    parser.on('cdata', value => { text += value; });
    parser.on('closetag', () => {
        const local = stack.pop(), parent = stack.at(-1);
        if (local === 'name' && ['trk', 'rte'].includes(parent) && !name) name = text.trim().slice(0, 160);
        if (point && ['trkpt', 'rtept'].includes(parent)) {
            if (local === 'time') {
                const value = text.trim();
                const time = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
                if (Number.isFinite(time)) point[2] = time;
                else invalidTimes++;
            }
            if (local === 'ele' && text.trim() && Number.isFinite(Number(text))) point[3] = Number(text);
        }
        if (['trkpt', 'rtept'].includes(local) && point) {
            if (point[2] === null) missingTimes++;
            segment?.push(point);
            point = null;
        }
        if (local === 'trkseg' || local === 'rte') {
            if (segment?.length) (local === 'trkseg' ? tracks : routes).push(segment);
            segment = null;
        }
        text = '';
    });
    parser.write(xml).close();
    const segments = tracks.length ? tracks : routes;
    if (!segments.some(points => points.length >= 2)) throw new Error('Aucune trace GPS exploitable : il faut au moins deux points dans un segment.');
    const warnings = [];
    if (missingTimes) warnings.push(`${missingTimes} point(s) sans horaire exploitable : les durées peuvent être incomplètes.`);
    if (invalidTimes) warnings.push(`${invalidTimes} horodatage(s) invalide(s) ignoré(s).`);
    if (!tracks.length) warnings.push('Le GPX contient un itinéraire (rte), pas une activité enregistrée (trk).');
    return { name, segments, warnings, pointCount: segments.reduce((total, points) => total + points.length, 0) };
}

module.exports = { parseGpx, MAX_GPX_BYTES, MAX_POINTS };
