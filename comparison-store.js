'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const DEFAULT_TRIPS_DIR = '/home/pi/trips';

function text(value, max) {
    return String(value || '').trim().slice(0, max);
}

function list(value) {
    const values = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
    return [...new Set(values.map(item => text(item, 300)).filter(Boolean))].slice(0, 100);
}

function normalizeOffer(value) {
    const offer = value && typeof value === 'object' ? value : {};
    const currency = text(offer.currency, 3).toUpperCase();
    const rating = Math.max(0, Math.min(6, Number(offer.rating) || 0));
    return {
        provider: text(offer.provider, 160),
        price: Math.max(0, Number(offer.price) || 0),
        currency: /^[A-Z]{3}$/.test(currency) ? currency : 'CHF',
        flightIncluded: offer.flightIncluded === true ? true : offer.flightIncluded === false ? false : null,
        flightPrice: Math.max(0, Number(offer.flightPrice) || 0),
        url: text(offer.url, 1000),
        included: list(offer.included),
        excluded: list(offer.excluded),
        cancellation: text(offer.cancellation, 1000),
        rating,
        notes: text(offer.notes, 4000)
    };
}

function normalizeMetadata(value, validIds) {
    const input = value && typeof value === 'object' ? value : {};
    const groups = [];
    const usedGroupIds = new Set();
    for (const item of Array.isArray(input.groups) ? input.groups : []) {
        const id = text(item?.id, 80).replace(/[^a-zA-Z0-9_-]/g, '');
        if (!id || usedGroupIds.has(id)) continue;
        const tripIds = [...new Set((Array.isArray(item.tripIds) ? item.tripIds : []).map(value => text(value, 80)).filter(value => validIds.has(value)))];
        groups.push({ id, name: text(item?.name, 160) || 'Comparaison', tripIds });
        usedGroupIds.add(id);
    }
    const offers = {};
    for (const [id, offer] of Object.entries(input.offers || {})) {
        if (validIds.has(id)) offers[id] = normalizeOffer(offer);
    }
    return { groups, offers };
}

function createStore(options = {}) {
    const tripsDir = options.tripsDir || DEFAULT_TRIPS_DIR;
    const registryFile = options.registryFile || path.join(tripsDir, 'trips.json');
    const metadataFile = options.metadataFile || path.join(tripsDir, 'trip-comparisons.json');

    function registry() {
        const parsed = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
        const trips = (Array.isArray(parsed.trips) ? parsed.trips : []).filter(item => item && item.id && item.file).map(item => ({
            id: text(item.id, 80),
            name: text(item.name || item.id, 160),
            file: path.resolve(String(item.file))
        }));
        return { trips, validIds: new Set(trips.map(item => item.id)) };
    }

    function metadata(validIds) {
        try {
            return normalizeMetadata(JSON.parse(fs.readFileSync(metadataFile, 'utf8')), validIds);
        } catch (error) {
            if (error.code === 'ENOENT') return { groups: [], offers: {} };
            throw error;
        }
    }

    function load(ids = []) {
        const current = registry();
        const data = metadata(current.validIds);
        const requested = [...new Set(ids.map(id => text(id, 80)))].filter(id => current.validIds.has(id)).slice(0, 20);
        const snapshots = [];
        for (const id of requested) {
            const trip = current.trips.find(item => item.id === id);
            if (!trip.file.startsWith(path.resolve(tripsDir) + path.sep) || !/\.ya?ml$/i.test(trip.file)) continue;
            const document = yaml.load(fs.readFileSync(trip.file, 'utf8')) || {};
            snapshots.push({ id: trip.id, name: trip.name, document });
        }
        return {
            groups: data.groups,
            offers: data.offers,
            trips: current.trips.map(({ id, name }) => ({ id, name })),
            snapshots
        };
    }

    function save(value) {
        const current = registry();
        const data = normalizeMetadata(value, current.validIds);
        fs.mkdirSync(path.dirname(metadataFile), { recursive: true });
        const temporary = `${metadataFile}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', 'utf8');
        fs.renameSync(temporary, metadataFile);
        return data;
    }

    return { load, save };
}

module.exports = { createStore, normalizeMetadata, normalizeOffer };
