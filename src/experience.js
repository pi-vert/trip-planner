(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.TripExperience = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const pages = {
        prepare: ['overview', 'itinerary', 'planning', 'budget'],
        travel: ['overview', 'planning', 'map', 'recordings']
    };
    function normalizeMode(value) { return value === 'travel' ? 'travel' : 'prepare'; }
    function primaryPages(mode) { return [...pages[normalizeMode(mode)]]; }
    function summarize(state = {}) {
        const places = state.places || {};
        const itinerary = [...new Set(state.itinerary || [])].filter(id => places[id]);
        return {
            places: Object.keys(places).length,
            visits: itinerary.length,
            candidates: Object.keys(places).filter(id => !itinerary.includes(id)).length,
            dated: Boolean(state.planning?.startDate && state.planning?.endDate),
            reservations: (state.planning?.reservations || []).length,
            completed: itinerary.filter(id => places[id].completed).length
        };
    }
    return { normalizeMode, primaryPages, summarize };
});
