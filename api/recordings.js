'use strict';
const { createRecordingsStore } = require('../recordings-store');
function createApi(store = createRecordingsStore()) {
    const handle = operation => (req, res) => {
        try { res.set('Cache-Control', 'no-store').json(operation(req)); }
        catch (error) { res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Impossible de lire ou enregistrer les parcours GPS.' }); }
    };
    return {
        path: '/api/recordings',
        get: handle(req => {
            const data = store.load(req.query.tripId);
            return req.query.progress === '1' ? { completedPlaces: data.completedPlaces || {} } : data;
        }),
        post: handle(req => {
            const body = req.body || {};
            if (body.action === 'reference') return store.addReference(body.tripId, body.reference);
            if (body.action === 'import') return store.importTrack(body.tripId, body);
            const error = new Error('Action GPS inconnue.'); error.statusCode = 400; throw error;
        }),
        put: handle(req => req.body?.action === 'completed' ? store.setCompleted(req.body?.tripId, req.body) : store.moveTrack(req.body?.tripId, req.body || {})),
        delete: handle(req => store.deleteTrack(req.query.tripId, req.query.trackId))
    };
}
module.exports = createApi();
module.exports.createApi = createApi;
