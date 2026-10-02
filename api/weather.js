'use strict';

const { createWeatherStore } = require('../weather-store.js');
const TripWeather = require('../src/weather.js');

const store = createWeatherStore();
const DAILY = 'weather_code,temperature_2m_max,temperature_2m_mean,temperature_2m_min,relative_humidity_2m_mean,precipitation_sum,rain_sum,snowfall_sum,sunshine_duration';

function coordinate(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) throw new Error('Coordonnées invalides.');
    return number;
}

function date(value) {
    const text = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new Error('Date invalide.');
    return text;
}

async function fetchJson(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
        const error = new Error(payload.reason || `Service météo indisponible (${response.status}).`);
        error.status = response.status === 429 ? 429 : 502;
        throw error;
    }
    return payload;
}

function baseParams(query) {
    return new URLSearchParams({
        latitude: String(coordinate(query.lat, -90, 90)),
        longitude: String(coordinate(query.lng, -180, 180)),
        timezone: 'auto'
    });
}

async function climate(query) {
    const now = new Date();
    const lastYear = now.getUTCFullYear() - 1;
    const firstYear = lastYear - 9;
    const params = baseParams(query);
    params.set('start_date', `${firstYear}-01-01`);
    params.set('end_date', `${lastYear}-12-31`);
    params.set('daily', DAILY);
    params.set('models', 'era5');
    const payload = await fetchJson(`https://archive-api.open-meteo.com/v1/archive?${params}`);
    return { ...TripWeather.climateFromDaily(payload, `${firstYear}-${lastYear}`), fetchedAt: new Date().toISOString() };
}

async function stay(query) {
    const startDate = date(query.startDate), endDate = date(query.endDate);
    const days = TripWeather.dateRange(startDate, endDate);
    if (!days.length || days.length > 120) throw new Error('La période météo doit contenir entre 1 et 120 jours.');
    const today = new Date().toISOString().slice(0, 10);
    const forecastEnd = new Date(Date.parse(`${today}T00:00:00Z`) + 15 * 86400000).toISOString().slice(0, 10);
    const recentStart = new Date(Date.parse(`${today}T00:00:00Z`) - 5 * 86400000).toISOString().slice(0, 10);
    const useForecast = startDate >= recentStart && endDate <= forecastEnd;
    if (!useForecast && endDate >= today) {
        const error = new Error('Prévisions non disponibles au-delà de 16 jours.');
        error.status = 422;
        throw error;
    }
    const params = baseParams(query);
    params.set('start_date', startDate);
    params.set('end_date', endDate);
    params.set('daily', useForecast ? `${DAILY},precipitation_probability_max` : DAILY);
    if (!useForecast) params.set('models', 'era5');
    const endpoint = useForecast ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
    const source = useForecast ? 'forecast' : 'archive';
    const payload = await fetchJson(`${endpoint}?${params}`);
    return { source, fetchedAt: new Date().toISOString(), startDate, endDate, daily: TripWeather.dailyFromApi(payload, source) };
}

function stageData(input, resultKey, result) {
    return {
        name: String(input.name || '').slice(0, 160),
        lat: coordinate(input.lat, -90, 90),
        lng: coordinate(input.lng, -180, 180),
        [resultKey]: result
    };
}

module.exports = {
    path: '/api/weather',

    async get(req, res) {
        try {
            res.set('Cache-Control', 'no-store');
            return res.json(store.load(req.query.tripId));
        } catch (error) {
            res.status(error.status || 400).json({ error: error.message });
        }
    },

    async post(req, res) {
        try {
            const input = req.body && typeof req.body === 'object' ? req.body : {};
            let result, resultKey;
            if (input.mode === 'climate') {
                resultKey = 'climate';
                result = await climate(input);
            } else if (input.mode === 'stay') {
                resultKey = 'stay';
                result = await stay(input);
            } else {
                return res.status(400).json({ error: 'Type de requête météo inconnu.' });
            }
            const stage = store.saveStage(input.tripId, input.stageId, stageData(input, resultKey, result));
            return res.json({ data: result, stage });
        } catch (error) {
            return res.status(error.status || 400).json({ error: error.message });
        }
    },

    put(req, res) {
        try {
            if (req.body?.stageId) {
                return res.json(store.saveStage(req.body.tripId, req.body.stageId, req.body.data));
            }
            res.json(store.save(req.body?.tripId, req.body?.data));
        } catch (error) {
            res.status(400).json({ error: `Enregistrement météo impossible : ${error.message}` });
        }
    }
};
