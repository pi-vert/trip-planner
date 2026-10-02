const test = require('node:test');
const assert = require('node:assert/strict');
const Weather = require('../src/weather.js');

test('agrège les relevés quotidiens en tendances mensuelles', () => {
    const payload = { daily: {
        time: ['2024-01-01', '2024-01-02', '2025-01-01', '2025-01-02'],
        temperature_2m_min: [0, 2, 4, 6],
        temperature_2m_mean: [5, 7, 9, 11],
        temperature_2m_max: [10, 12, 14, 16],
        relative_humidity_2m_mean: [80, 70, 60, 50],
        precipitation_sum: [0, 2, 4, 0],
        snowfall_sum: [1, 0, 0, 0],
        sunshine_duration: [3600, 7200, 10800, 14400]
    } };

    const climate = Weather.climateFromDaily(payload, '2024-2025');
    assert.equal(climate.monthly[0].tempMeanC, 8);
    assert.equal(climate.monthly[0].humidityPct, 65);
    assert.equal(climate.monthly[0].precipitationMm, 3);
    assert.equal(climate.monthly[0].rainyDays, 1);
    assert.equal(climate.monthly[0].snowfallCm, 0.5);
    assert.equal(climate.monthly[0].sunshineHours, 5);
    assert.equal(climate.monthly[1].tempMeanC, null);
});

test('produit une tendance quotidienne pour un séjour hors horizon', () => {
    const climate = { monthly: [{ month: 7, tempMinC: 15, tempMeanC: 22, tempMaxC: 28, humidityPct: 60, precipitationMm: 31, rainyDays: 4, snowfallCm: 0, sunshineHours: 248 }] };
    const daily = Weather.estimateStay(climate, '2027-07-30', '2027-08-01');

    assert.equal(daily.length, 3);
    assert.equal(daily[0].source, 'climate');
    assert.equal(daily[0].precipitationMm, 1);
    assert.equal(daily[2].tempMeanC, null);
});

test('résume un voyage sans compter deux fois une date de transition', () => {
    const summary = Weather.tripSummary({ stages: {
        a: { stay: { source: 'forecast', startDate: '2026-09-10', endDate: '2026-09-11', daily: [
            { date: '2026-09-10', tempMinC: 10, tempMaxC: 20, humidityPct: 60, precipitationMm: 2, source: 'forecast' },
            { date: '2026-09-11', tempMinC: 12, tempMaxC: 22, humidityPct: 70, precipitationMm: 4, snowfallCm: 0, source: 'forecast' }
        ] } },
        b: { stay: { source: 'climate', startDate: '2026-09-11', endDate: '2026-09-11', daily: [
            { date: '2026-09-11', tempMinC: 14, tempMaxC: 24, humidityPct: 80, precipitationMm: 6, snowfallCm: 2, source: 'climate' }
        ] } }
    } });

    assert.equal(summary.coverageDays, 2);
    assert.equal(summary.tempMinC, 11.5);
    assert.equal(summary.tempMaxC, 21.5);
    assert.equal(summary.precipitationMm, 7);
    assert.equal(summary.snowfallCm, 1);
    assert.equal(summary.forecastDays, 2);
    assert.equal(summary.estimatedDays, 1);
});

test('classe les mois favorables sur l’ensemble des étapes', () => {
    const monthly = Weather.MONTHS.map((_, index) => ({ month: index + 1, tempMeanC: index === 5 ? 22 : 8, humidityPct: 65, precipitationMm: 40, rainyDays: 5, snowfallCm: 0 }));
    const result = Weather.tripClimateSummary({ stages: { a: { climate: { monthly } }, b: { climate: { monthly } } } });

    assert.equal(result.coverageStages, 2);
    assert.equal(result.bestMonths[0].month, 6);
});

test('associe les codes WMO à une icône concise', () => {
    assert.equal(Weather.weatherInfo(0).icon, '☀️');
    assert.equal(Weather.weatherInfo(63).label, 'Pluie');
    assert.equal(Weather.weatherInfo(75).icon, '🌨️');
});
