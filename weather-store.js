'use strict';

const fs = require('node:fs');
const path = require('node:path');
const TripWeather = require('./src/weather.js');

const DEFAULT_TRIPS_DIR = '/home/pi/trips';

function safeTripId(value) {
    const id = String(value || '').trim();
    return /^[a-zA-Z0-9_-]{1,80}$/.test(id) ? id : '';
}

function createWeatherStore(options = {}) {
    const tripsDir = options.tripsDir || DEFAULT_TRIPS_DIR;
    const registryFile = options.registryFile || path.join(tripsDir, 'trips.json');
    const weatherFile = options.weatherFile || path.join(tripsDir, 'trip-weather.json');

    function validIds() {
        const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
        return new Set((Array.isArray(registry.trips) ? registry.trips : []).map(item => safeTripId(item?.id)).filter(Boolean));
    }

    function all() {
        try {
            const parsed = JSON.parse(fs.readFileSync(weatherFile, 'utf8'));
            return parsed && typeof parsed === 'object' && parsed.trips && typeof parsed.trips === 'object' ? parsed : { trips: {} };
        } catch (error) {
            if (error.code === 'ENOENT') return { trips: {} };
            throw error;
        }
    }

    function load(tripId) {
        const id = safeTripId(tripId);
        if (!id || !validIds().has(id)) return { stages: {} };
        return TripWeather.normalizeTripWeather(all().trips[id]);
    }

    function loadMany(ids) {
        const allowed = validIds(), data = all(), result = {};
        for (const value of Array.isArray(ids) ? ids : []) {
            const id = safeTripId(value);
            if (id && allowed.has(id)) result[id] = TripWeather.normalizeTripWeather(data.trips[id]);
        }
        return result;
    }

    function save(tripId, value) {
        const id = safeTripId(tripId);
        if (!id || !validIds().has(id)) throw new Error('Voyage inconnu.');
        const data = all();
        data.trips[id] = TripWeather.normalizeTripWeather(value);
        fs.mkdirSync(path.dirname(weatherFile), { recursive: true });
        const temporary = `${weatherFile}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', 'utf8');
        fs.renameSync(temporary, weatherFile);
        return data.trips[id];
    }

    function saveStage(tripId, stageId, value) {
        const id = String(stageId || '').trim();
        if (!/^[\w.-]{1,120}$/.test(id)) throw new Error('Étape invalide.');
        const trip = load(tripId);
        trip.stages[id] = { ...(trip.stages[id] || {}), ...(value && typeof value === 'object' ? value : {}) };
        return save(tripId, trip).stages[id];
    }

    return { load, loadMany, save, saveStage };
}

module.exports = { createWeatherStore, safeTripId };
