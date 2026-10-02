'use strict';

const { createStore } = require('../comparison-store');
const { createWeatherStore } = require('../weather-store.js');

const store = createStore();
const weatherStore = createWeatherStore();

module.exports = {
    path: '/api/comparison',

    get(req, res) {
        try {
            const ids = String(req.query.ids || '').split(',').filter(Boolean);
            const data = store.load(ids);
            const weather = weatherStore.loadMany(data.snapshots.map(snapshot => snapshot.id));
            data.snapshots.forEach(snapshot => { snapshot.document.weather = weather[snapshot.id] || { stages: {} }; });
            res.set('Cache-Control', 'no-store').json(data);
        } catch (error) {
            res.status(500).json({ error: `Lecture des circuits impossible : ${error.message}` });
        }
    },

    put(req, res) {
        try {
            res.json(store.save(req.body));
        } catch (error) {
            res.status(500).json({ error: `Enregistrement de la comparaison impossible : ${error.message}` });
        }
    }
};
