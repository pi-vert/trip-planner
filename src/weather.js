(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.TripWeather = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
    const DAY_MS = 86400000;

    function finite(value) {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function round(value, precision = 1) {
        const number = finite(value);
        if (number === null) return null;
        const factor = 10 ** precision;
        return Math.round(number * factor) / factor;
    }

    function isoDate(value) {
        const text = String(value || '');
        return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
    }

    function dateRange(startDate, endDate) {
        const start = isoDate(startDate), end = isoDate(endDate);
        if (!start || !end || end < start) return [];
        const dates = [];
        for (let value = Date.parse(`${start}T00:00:00Z`); value <= Date.parse(`${end}T00:00:00Z`); value += DAY_MS) {
            dates.push(new Date(value).toISOString().slice(0, 10));
        }
        return dates;
    }

    function valueAt(daily, key, index) {
        return finite(Array.isArray(daily?.[key]) ? daily[key][index] : null);
    }

    function dailyFromApi(payload, source = 'forecast') {
        const daily = payload?.daily || {};
        return (Array.isArray(daily.time) ? daily.time : []).map((date, index) => ({
            date: isoDate(date),
            weatherCode: valueAt(daily, 'weather_code', index),
            tempMinC: round(valueAt(daily, 'temperature_2m_min', index)),
            tempMeanC: round(valueAt(daily, 'temperature_2m_mean', index)),
            tempMaxC: round(valueAt(daily, 'temperature_2m_max', index)),
            humidityPct: round(valueAt(daily, 'relative_humidity_2m_mean', index), 0),
            precipitationMm: round(valueAt(daily, 'precipitation_sum', index)),
            rainMm: round(valueAt(daily, 'rain_sum', index)),
            snowfallCm: round(valueAt(daily, 'snowfall_sum', index)),
            precipitationProbabilityPct: round(valueAt(daily, 'precipitation_probability_max', index), 0),
            sunshineHours: valueAt(daily, 'sunshine_duration', index) === null ? null : round(valueAt(daily, 'sunshine_duration', index) / 3600),
            source
        })).filter(item => item.date);
    }

    function average(values) {
        const numbers = values.map(finite).filter(value => value !== null);
        return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
    }

    function sum(values) {
        return values.map(finite).filter(value => value !== null).reduce((total, value) => total + value, 0);
    }

    function climateFromDaily(payload, period = '') {
        const days = dailyFromApi(payload, 'climate');
        const years = new Set(days.map(item => item.date.slice(0, 4))).size || 1;
        const monthly = Array.from({ length: 12 }, (_, index) => {
            const values = days.filter(item => Number(item.date.slice(5, 7)) === index + 1);
            return {
                month: index + 1,
                tempMinC: round(average(values.map(item => item.tempMinC))),
                tempMeanC: round(average(values.map(item => item.tempMeanC))),
                tempMaxC: round(average(values.map(item => item.tempMaxC))),
                humidityPct: round(average(values.map(item => item.humidityPct)), 0),
                precipitationMm: round(sum(values.map(item => item.precipitationMm)) / years),
                rainyDays: round(values.filter(item => (item.precipitationMm || 0) >= 1).length / years),
                snowfallCm: round(sum(values.map(item => item.snowfallCm)) / years),
                sunshineHours: round(sum(values.map(item => item.sunshineHours)) / years)
            };
        });
        return { source: 'open-meteo', period, monthly };
    }

    function normalizeMonth(value, fallbackMonth) {
        const item = value && typeof value === 'object' ? value : {};
        return {
            month: Math.max(1, Math.min(12, Number(item.month) || fallbackMonth)),
            tempMinC: round(item.tempMinC),
            tempMeanC: round(item.tempMeanC),
            tempMaxC: round(item.tempMaxC),
            humidityPct: round(item.humidityPct, 0),
            precipitationMm: round(item.precipitationMm),
            rainyDays: round(item.rainyDays),
            snowfallCm: round(item.snowfallCm),
            sunshineHours: round(item.sunshineHours)
        };
    }

    function normalizeDay(value) {
        const item = value && typeof value === 'object' ? value : {};
        return {
            date: isoDate(item.date),
            weatherCode: finite(item.weatherCode),
            tempMinC: round(item.tempMinC),
            tempMeanC: round(item.tempMeanC),
            tempMaxC: round(item.tempMaxC),
            humidityPct: round(item.humidityPct, 0),
            precipitationMm: round(item.precipitationMm),
            rainMm: round(item.rainMm),
            snowfallCm: round(item.snowfallCm),
            precipitationProbabilityPct: round(item.precipitationProbabilityPct, 0),
            sunshineHours: round(item.sunshineHours),
            source: ['forecast', 'archive', 'climate'].includes(item.source) ? item.source : 'climate'
        };
    }

    function normalizeTripWeather(value) {
        const input = value && typeof value === 'object' ? value : {};
        const stages = {};
        for (const [id, stageValue] of Object.entries(input.stages || {}).slice(0, 100)) {
            if (!/^[\w.-]{1,120}$/.test(id)) continue;
            const stage = stageValue && typeof stageValue === 'object' ? stageValue : {};
            const climate = stage.climate && typeof stage.climate === 'object' ? {
                source: 'open-meteo',
                period: String(stage.climate.period || '').slice(0, 40),
                fetchedAt: String(stage.climate.fetchedAt || '').slice(0, 30),
                monthly: (Array.isArray(stage.climate.monthly) ? stage.climate.monthly : []).slice(0, 12).map((item, index) => normalizeMonth(item, index + 1))
            } : null;
            const stay = stage.stay && typeof stage.stay === 'object' ? {
                source: ['forecast', 'archive', 'climate'].includes(stage.stay.source) ? stage.stay.source : 'climate',
                fetchedAt: String(stage.stay.fetchedAt || '').slice(0, 30),
                startDate: isoDate(stage.stay.startDate),
                endDate: isoDate(stage.stay.endDate),
                daily: (Array.isArray(stage.stay.daily) ? stage.stay.daily : []).slice(0, 120).map(normalizeDay).filter(item => item.date)
            } : null;
            stages[id] = {
                name: String(stage.name || '').slice(0, 160),
                lat: round(stage.lat, 5),
                lng: round(stage.lng, 5),
                ...(climate ? { climate } : {}),
                ...(stay ? { stay } : {})
            };
        }
        return { stages };
    }

    function weatherInfo(code) {
        const value = Number(code);
        if (value === 0) return { icon: '☀️', label: 'Ciel dégagé' };
        if ([1, 2].includes(value)) return { icon: '🌤️', label: 'Éclaircies' };
        if (value === 3) return { icon: '☁️', label: 'Couvert' };
        if ([45, 48].includes(value)) return { icon: '🌫️', label: 'Brouillard' };
        if ([51, 53, 55, 56, 57].includes(value)) return { icon: '🌦️', label: 'Bruine' };
        if ([61, 63, 65, 66, 67, 80, 81, 82].includes(value)) return { icon: '🌧️', label: 'Pluie' };
        if ([71, 73, 75, 77, 85, 86].includes(value)) return { icon: '🌨️', label: 'Neige' };
        if ([95, 96, 99].includes(value)) return { icon: '⛈️', label: 'Orage' };
        return { icon: '🌡️', label: 'Tendance météo' };
    }

    function climateCode(month) {
        if ((month?.snowfallCm || 0) >= 2) return 71;
        if ((month?.rainyDays || 0) >= 13 || (month?.precipitationMm || 0) >= 130) return 61;
        if ((month?.rainyDays || 0) >= 7) return 2;
        return 1;
    }

    function estimateStay(climate, startDate, endDate) {
        const monthly = Array.isArray(climate?.monthly) ? climate.monthly : [];
        return dateRange(startDate, endDate).map(date => {
            const month = monthly.find(item => Number(item.month) === Number(date.slice(5, 7))) || {};
            const daysInMonth = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
            return normalizeDay({
                date,
                weatherCode: climateCode(month),
                tempMinC: month.tempMinC,
                tempMeanC: month.tempMeanC,
                tempMaxC: month.tempMaxC,
                humidityPct: month.humidityPct,
                precipitationMm: finite(month.precipitationMm) === null ? null : month.precipitationMm / daysInMonth,
                snowfallCm: finite(month.snowfallCm) === null ? null : month.snowfallCm / daysInMonth,
                sunshineHours: finite(month.sunshineHours) === null ? null : month.sunshineHours / daysInMonth,
                source: 'climate'
            });
        });
    }

    function monthScore(month) {
        if (finite(month?.tempMeanC) === null) return null;
        const temperaturePenalty = month.tempMeanC < 18 ? (18 - month.tempMeanC) * 3 : Math.max(0, month.tempMeanC - 27) * 4;
        const rainPenalty = Math.min(30, (month.rainyDays || 0) * 1.4 + (month.precipitationMm || 0) / 18);
        const humidityPenalty = Math.max(0, (month.humidityPct || 65) - 75) * .7;
        const snowPenalty = Math.min(15, (month.snowfallCm || 0) / 3);
        return Math.max(0, Math.min(100, Math.round(100 - temperaturePenalty - rainPenalty - humidityPenalty - snowPenalty)));
    }

    function tripSummary(value) {
        const trip = normalizeTripWeather(value);
        const byDate = new Map();
        for (const stage of Object.values(trip.stages)) {
            for (const day of stage.stay?.daily || []) {
                if (!byDate.has(day.date)) byDate.set(day.date, []);
                byDate.get(day.date).push(day);
            }
        }
        const days = [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({
            date,
            tempMinC: average(values.map(item => item.tempMinC)),
            tempMaxC: average(values.map(item => item.tempMaxC)),
            humidityPct: average(values.map(item => item.humidityPct)),
            precipitationMm: average(values.map(item => item.precipitationMm)),
            snowfallCm: average(values.map(item => item.snowfallCm)),
            sources: new Set(values.map(item => item.source))
        }));
        return {
            coverageDays: days.length,
            tempMinC: round(average(days.map(item => item.tempMinC))),
            tempMaxC: round(average(days.map(item => item.tempMaxC))),
            humidityPct: round(average(days.map(item => item.humidityPct)), 0),
            precipitationMm: round(sum(days.map(item => item.precipitationMm))),
            snowfallCm: round(sum(days.map(item => item.snowfallCm))),
            forecastDays: days.filter(item => item.sources.has('forecast')).length,
            archiveDays: days.filter(item => item.sources.has('archive')).length,
            estimatedDays: days.filter(item => item.sources.has('climate')).length
        };
    }

    function tripClimateSummary(value) {
        const trip = normalizeTripWeather(value);
        const climates = Object.values(trip.stages).map(stage => stage.climate).filter(climate => climate?.monthly?.length);
        const months = Array.from({ length: 12 }, (_, index) => {
            const values = climates.map(climate => climate.monthly.find(month => month.month === index + 1)).filter(Boolean);
            if (!values.length) return { month: index + 1, score: null };
            const combined = {
                tempMeanC: average(values.map(month => month.tempMeanC)),
                humidityPct: average(values.map(month => month.humidityPct)),
                precipitationMm: average(values.map(month => month.precipitationMm)),
                rainyDays: average(values.map(month => month.rainyDays)),
                snowfallCm: average(values.map(month => month.snowfallCm))
            };
            return { month: index + 1, score: monthScore(combined) };
        });
        return {
            coverageStages: climates.length,
            bestMonths: months.filter(item => item.score !== null).sort((a, b) => b.score - a.score).slice(0, 3)
        };
    }

    function stageIcon(stage, date) {
        const daily = stage?.stay?.daily || [];
        const day = daily.find(item => item.date === date) || daily[0];
        return day ? { ...weatherInfo(day.weatherCode), day } : null;
    }

    return { MONTHS, climateFromDaily, dailyFromApi, dateRange, estimateStay, monthScore, normalizeTripWeather, stageIcon, tripClimateSummary, tripSummary, weatherInfo };
});
