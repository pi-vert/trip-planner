'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseGpx } = require('./gpx-import');
const yaml = require('js-yaml');
const { canComplete } = require('./src/visit-progress');
const { ALL_STAGES } = require('./src/gps-comparison');

function failure(message, statusCode = 400) { const error = new Error(message); error.statusCode = statusCode; throw error; }
function text(value, max = 160) { return String(value || '').trim().slice(0, max); }
function metric(value) { return value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null; }
function point(value) {
    if (!Array.isArray(value) || value.length !== 2 || value.some(v => typeof v !== 'number' || !Number.isFinite(v)) || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) failure('Coordonnées de référence invalides.');
    return value;
}
function normalizeReference(input) {
    if (!Array.isArray(input?.stages) || !input.stages.length || input.stages.length > 500) failure('La référence doit contenir entre 1 et 500 étapes.');
    let points = 0, segments = 0;
    const keys = new Set();
    const stages = input.stages.map(stage => {
        const key = text(stage.key, 200);
        if (!key || keys.has(key)) failure('Identifiant d’étape absent ou répété.');
        keys.add(key);
        const routes = (Array.isArray(stage.segments) ? stage.segments : []).map(route => {
            if (++segments > 2000) failure('La référence dépasse 2 000 trajets.');
            const geometry = (Array.isArray(route.geometry) ? route.geometry : []).map(point);
            points += geometry.length;
            if (points > 100000) failure('La référence dépasse 100 000 points cartographiques.');
            return { fromId: text(route.fromId, 200), toId: text(route.toId, 200), title: text(route.title), date: text(route.date, 10),
                start: text(route.start, 40), end: text(route.end, 40), km: metric(route.km), minutes: metric(route.minutes),
                estimated: Boolean(route.estimated), fixed: Boolean(route.fixed), geometry,
                geometrySource: route.geometrySource === 'road' && geometry.length >= 2 ? 'road' : 'indicative' };
        });
        const stops = (Array.isArray(stage.stops) ? stage.stops : []).map(stop => {
            const position = stop.lat == null || stop.lng == null ? null : point([stop.lng, stop.lat]);
            return { id: text(stop.id, 200), title: text(stop.title), hotel: Boolean(stop.hotel), lat: position?.[1] ?? null, lng: position?.[0] ?? null };
        });
        if (stops.length > 2000) failure('Trop de lieux dans une étape.');
        return { key, id: text(stage.id, 200), title: text(stage.title), arrivalDate: text(stage.arrivalDate, 10), departureDate: text(stage.departureDate, 10), segments: routes, stops };
    });
    return { id: crypto.randomUUID(), label: text(input.label) || 'Prévu avant départ', capturedAt: new Date().toISOString(), stages };
}

function createRecordingsStore(options = {}) {
    const tripsDir = options.tripsDir || '/home/pi/trips';
    const directory = path.join(tripsDir, 'recordings');
    function fileFor(tripId) {
        if (typeof tripId !== 'string' || !tripId) failure('Voyage requis.');
        const registry = JSON.parse(fs.readFileSync(path.join(tripsDir, 'trips.json'), 'utf8'));
        if (!registry.trips?.some(trip => trip.id === tripId)) failure('Voyage inconnu.', 404);
        return path.join(directory, `${crypto.createHash('sha256').update(tripId).digest('hex')}.json`);
    }
    function load(tripId) {
        const filename = fileFor(tripId);
        try { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return { version: 1, references: [], tracks: [] }; throw error; }
    }
    function write(tripId, data) {
        const filename = fileFor(tripId);
        fs.mkdirSync(directory, { recursive: true });
        const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
        try { fs.writeFileSync(temporary, JSON.stringify(data) + '\n', 'utf8'); fs.renameSync(temporary, filename); }
        finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    function assignment(data, referenceId, stageKey) {
        const reference = data.references.find(item => item.id === referenceId);
        if (!reference || (stageKey !== ALL_STAGES && !reference.stages.some(stage => stage.key === stageKey))) failure('Choisissez une étape de la référence enregistrée.');
        return { referenceId: reference.id, stageKey };
    }
    function addReference(tripId, input) {
        const data = load(tripId);
        const reference = normalizeReference(input);
        data.references.push(reference);
        write(tripId, data);
        return reference;
    }
    function importTrack(tripId, input) {
        const data = load(tripId);
        const target = assignment(data, input.referenceId, input.stageKey);
        if (typeof input.content !== 'string') failure('Contenu GPX requis.');
        const hash = crypto.createHash('sha256').update(input.content).digest('hex');
        const existing = data.tracks.find(track => track.hash === hash);
        if (existing) return { track: existing, duplicate: true };
        let parsed;
        try { parsed = parseGpx(input.content); }
        catch (error) { failure(`GPX invalide : ${error.message}`); }
        const track = { ...parsed, ...target, id: crypto.randomUUID(), hash, filename: text(input.filename, 240), importedAt: new Date().toISOString() };
        track.name ||= track.filename || 'Parcours Garmin';
        data.tracks.push(track);
        write(tripId, data);
        return { track, duplicate: false };
    }
    function moveTrack(tripId, input) {
        const data = load(tripId), target = assignment(data, input.referenceId, input.stageKey);
        const track = data.tracks.find(item => item.id === input.trackId);
        if (!track) failure('Trace inconnue.', 404);
        Object.assign(track, target);
        write(tripId, data);
        return track;
    }
    function deleteTrack(tripId, trackId) {
        const data = load(tripId);
        if (!data.tracks.some(track => track.id === trackId)) failure('Trace inconnue.', 404);
        data.tracks = data.tracks.filter(track => track.id !== trackId);
        write(tripId, data);
        return { deleted: trackId };
    }
    function setCompleted(tripId, input) {
        const data = load(tripId);
        const registry = JSON.parse(fs.readFileSync(path.join(tripsDir, 'trips.json'), 'utf8'));
        const trip = registry.trips.find(item => item.id === tripId);
        if (!trip?.file) failure('Fichier du voyage introuvable.');
        const file = fs.realpathSync(trip.file);
        if (!file.startsWith(fs.realpathSync(tripsDir) + path.sep) || !/\.ya?ml$/i.test(file)) failure('Fichier du voyage invalide.');
        const document = yaml.load(fs.readFileSync(file, 'utf8')) || {};
        if (!Array.isArray(input.placeIds) || !input.placeIds.length || input.placeIds.length > 2000 || typeof input.completed !== 'boolean') failure('Lieux et statut Réalisé requis.');
        const completedPlaces = data.completedPlaces || {};
        const changed = [], skipped = [];
        for (const id of [...new Set(input.placeIds)]) {
            if (typeof id !== 'string' || !Object.hasOwn(document.places || {}, id) || (input.completed && !canComplete(id, document))) { skipped.push(id); continue; }
            if (input.completed) {
                if (!Object.hasOwn(completedPlaces, id)) Object.defineProperty(completedPlaces, id, { enumerable: true, configurable: true, writable: true, value: {
                    markedAt: new Date().toISOString(), source: input.source === 'gps' ? 'gps' : 'manual',
                    referenceId: text(input.referenceId, 80), trackIds: (Array.isArray(input.trackIds) ? input.trackIds : []).filter(trackId => data.tracks.some(track => track.id === trackId)).slice(0, 100)
                } });
            } else delete completedPlaces[id];
            changed.push(id);
        }
        data.completedPlaces = completedPlaces;
        write(tripId, data);
        return { completedPlaces, changed, skipped };
    }
    return { load, addReference, importTrack, moveTrack, deleteTrack, setCompleted };
}

module.exports = { createRecordingsStore, normalizeReference };
