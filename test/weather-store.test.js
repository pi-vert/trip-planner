const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWeatherStore } = require('../weather-store.js');

test('enregistre la météo uniquement pour un voyage déclaré', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-weather-'));
    try {
        const registryFile = path.join(directory, 'trips.json');
        const weatherFile = path.join(directory, 'trip-weather.json');
        fs.writeFileSync(registryFile, JSON.stringify({ trips: [{ id: 'japon', file: path.join(directory, 'japon.yaml') }] }));
        const store = createWeatherStore({ tripsDir: directory, registryFile, weatherFile });
        const saved = store.save('japon', { stages: { tokyo: {
            name: 'Tokyo', lat: 35.68, lng: 139.76,
            stay: { source: 'forecast', startDate: '2026-09-10', endDate: '2026-09-10', daily: [{ date: '2026-09-10', weatherCode: 2, tempMinC: 20, tempMaxC: 28, source: 'forecast' }] }
        } } });

        assert.equal(saved.stages.tokyo.stay.daily[0].weatherCode, 2);
        assert.equal(store.load('japon').stages.tokyo.name, 'Tokyo');
        store.saveStage('japon', 'kyoto', { name: 'Kyoto', climate: { period: '2016-2025', monthly: [{ month: 1, tempMeanC: 5 }] } });
        store.saveStage('japon', 'tokyo', { climate: { period: '2016-2025', monthly: [{ month: 1, tempMeanC: 7 }] } });
        const merged = store.load('japon');
        assert.equal(merged.stages.kyoto.climate.monthly[0].tempMeanC, 5);
        assert.equal(merged.stages.tokyo.stay.daily[0].weatherCode, 2);
        assert.equal(merged.stages.tokyo.climate.monthly[0].tempMeanC, 7);
        assert.deepEqual(store.load('inconnu'), { stages: {} });
        assert.throws(() => store.save('inconnu', {}), /Voyage inconnu/);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
