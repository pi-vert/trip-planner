'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const MAX_YAML_BYTES = 1024 * 1024;
const isRecord = value => Object.prototype.toString.call(value) === '[object Object]';

function fail(message, statusCode = 400) {
    throw Object.assign(new Error(message), { statusCode });
}

function validateYaml(content) {
    if (typeof content !== 'string' || !content.trim()) fail('Le fichier YAML est vide.');
    if (Buffer.byteLength(content, 'utf8') > MAX_YAML_BYTES) fail('Le fichier dépasse la limite de 1 Mo.', 413);
    let document;
    try {
        document = yaml.load(content);
    } catch (error) {
        const line = error.mark ? ` (ligne ${error.mark.line + 1})` : '';
        fail(`YAML invalide${line} : ${error.reason || error.message}`);
    }
    if (!isRecord(document) || !Array.isArray(document.itinerary) || !isRecord(document.places)) {
        fail('Le voyage doit contenir une liste « itinerary » et un objet « places ».');
    }
    // Reject cycles and unsafe keys before these objects reach the existing state controller.
    const ancestors = new Set();
    let visited = 0;
    function inspect(value, depth = 0) {
        if (++visited > 50000 || depth > 50) fail('Le document YAML est trop complexe.');
        if (!value || typeof value !== 'object') return;
        if (ancestors.has(value)) fail('Les références YAML circulaires ne sont pas acceptées.');
        ancestors.add(value);
        for (const [key, child] of Object.entries(value)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) fail(`Clé YAML non acceptée : ${key}.`);
            inspect(child, depth + 1);
        }
        ancestors.delete(value);
    }
    inspect(document);
    for (const [id, place] of Object.entries(document.places)) {
        if (!id || !isRecord(place)) fail('Chaque lieu de « places » doit être un objet avec un identifiant.');
        for (const [key, limit] of [['lat', 90], ['lng', 180]]) {
            if (place[key] != null && (!Number.isFinite(Number(place[key])) || Math.abs(Number(place[key])) > limit)) {
                fail(`Coordonnée « ${key} » invalide pour le lieu « ${id} ».`);
            }
        }
    }
    if (document.itinerary.some(id => typeof id !== 'string' || !Object.hasOwn(document.places, id))) {
        fail('Chaque entrée de « itinerary » doit désigner un lieu existant dans « places ».');
    }
    for (const key of ['planning', 'edges', 'view']) {
        if (document[key] != null && !isRecord(document[key])) fail(`« ${key} » doit être un objet.`);
    }
    if (document.planning?.reservations != null && !Array.isArray(document.planning.reservations)) {
        fail('« planning.reservations » doit être une liste.');
    }
    return document;
}

function createYamlStore({ tripsDir = '/home/pi/trips' } = {}) {
    function registry(value) {
        return value || JSON.parse(fs.readFileSync(path.join(tripsDir, 'trips.json'), 'utf8'));
    }

    function importFile(input, currentRegistry) {
        const filename = input?.filename;
        if (typeof filename !== 'string' || !/\.ya?ml$/i.test(filename) || /[/\\\x00-\x1f]/.test(filename)) {
            fail('Choisissez un fichier .yaml ou .yml.');
        }
        validateYaml(input.content);
        const current = registry(currentRegistry);
        const base = filename.replace(/\.ya?ml$/i, '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
            .toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 60) || 'voyage';
        fs.mkdirSync(tripsDir, { recursive: true });
        const used = new Set([
            'default', 'trip-planner',
            ...(current.trips || []).map(trip => trip.id), ...(current.ignored || []),
            ...fs.readdirSync(tripsDir).map(name => name.replace(/\.ya?ml$/i, '').toLowerCase())
        ]);
        let suffix = 1;
        while (true) {
            const id = suffix === 1 ? base : `${base}-${suffix}`;
            suffix += 1;
            if (used.has(id)) continue;
            const savedName = `${id}.yaml`;
            const destination = path.join(tripsDir, savedName);
            let fd;
            try {
                fd = fs.openSync(destination, 'wx', 0o600);
                fs.writeFileSync(fd, input.content, 'utf8');
                return { id, filename: savedName };
            } catch (error) {
                if (error.code === 'EEXIST' && fd === undefined) continue;
                if (fd !== undefined) fs.unlinkSync(destination);
                throw error;
            } finally {
                if (fd !== undefined) fs.closeSync(fd);
            }
        }
    }

    function exportFile(id, currentRegistry) {
        const trip = registry(currentRegistry).trips?.find(item => item.id === id);
        if (!trip?.file) fail('Voyage introuvable.', 404);
        let file;
        try {
            file = fs.realpathSync(trip.file);
        } catch (error) {
            if (error.code === 'ENOENT') fail('Le fichier YAML de ce voyage est introuvable.', 404);
            throw error;
        }
        if (path.dirname(file) !== fs.realpathSync(tripsDir) || !/\.ya?ml$/i.test(file)) {
            fail('Le fichier doit être un YAML du dossier des voyages.', 400);
        }
        return { filename: path.basename(file), content: fs.readFileSync(file) };
    }

    return { importFile, exportFile };
}

module.exports = { createYamlStore, validateYaml, MAX_YAML_BYTES };
