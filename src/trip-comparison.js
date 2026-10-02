(function (root, factory) {
    const weather = typeof module === 'object' && module.exports ? require('./weather.js') : root.TripWeather;
    const api = factory(weather);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.TripComparison = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (TripWeather) {
    'use strict';

    function normalizeCurrency(value) {
        const currency = String(value || '').trim().toUpperCase();
        return /^[A-Z]{3}$/.test(currency) ? currency : 'CHF';
    }

    function normalizeDocument(document) {
        const source = document && typeof document === 'object' ? document : {};
        const places = {};
        for (const [id, value] of Object.entries(source.places || {})) {
            const place = value || {};
            places[id] = {
                id,
                name: String(place.name || 'Lieu'),
                lat: Number(place.lat) || 0,
                lng: Number(place.lng) || 0,
                durationH: Math.max(0, Number(place.durationH ?? place.duration_h) || 0),
                budget: Math.max(0, Number(place.budget) || 0),
                budgetFree: place.budgetFree === true,
                budgetCurrency: normalizeCurrency(place.budgetCurrency),
                budgetScope: place.budgetScope === 'group' ? 'group' : 'individual',
                ratings: place.ratings && typeof place.ratings === 'object' ? place.ratings : {},
                stageType: place.stageType === 'detail' ? 'detail' : 'main'
            };
        }
        const itinerary = (Array.isArray(source.itinerary) ? source.itinerary : []).filter(id => places[id]);
        return {
            places,
            itinerary,
            edges: source.edges && typeof source.edges === 'object' ? source.edges : {},
            planning: source.planning && typeof source.planning === 'object' ? source.planning : {},
            people: Math.max(1, Number(source.people) || 2),
            weather: TripWeather.normalizeTripWeather(source.weather)
        };
    }

    function distanceKm(a, b) {
        if (!a || !b) return 0;
        const toRad = value => value * Math.PI / 180;
        const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
        const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
        return 2 * 6371 * Math.asin(Math.sqrt(h));
    }

    function dayCount(planning) {
        const start = /^\d{4}-\d{2}-\d{2}$/.test(String(planning?.startDate || '')) ? new Date(`${planning.startDate}T12:00:00`) : null;
        const end = /^\d{4}-\d{2}-\d{2}$/.test(String(planning?.endDate || '')) ? new Date(`${planning.endDate}T12:00:00`) : null;
        if (!start || !end || end < start) return 0;
        return Math.round((end - start) / 86400000) + 1;
    }

    function placeKey(place) {
        const name = String(place?.name || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();
        return `${name}|${Number(place?.lat || 0).toFixed(2)}|${Number(place?.lng || 0).toFixed(2)}`;
    }

    function metrics(document, offer = {}) {
        const state = normalizeDocument(document);
        const nativeTotals = {};
        const ratings = [];
        let routeKm = 0, routeMin = 0;
        for (let index = 0; index < state.itinerary.length; index += 1) {
            const id = state.itinerary[index], place = state.places[id];
            for (const rating of Object.values(place.ratings || {}).map(Number).filter(Number.isFinite)) ratings.push(rating);
            if (!place.budgetFree) {
                const amount = place.budgetScope === 'group' ? place.budget : place.budget * state.people;
                nativeTotals[place.budgetCurrency] = (nativeTotals[place.budgetCurrency] || 0) + amount;
            }
            if (index === 0) continue;
            const previousId = state.itinerary[index - 1], previous = state.places[previousId];
            const edge = state.edges[`${previousId}|${id}`] || {};
            const km = Number.isFinite(Number(edge.realKm)) ? Number(edge.realKm) : distanceKm(previous, place);
            const minutes = Number.isFinite(Number(edge.realMin)) ? Number(edge.realMin) : km / Math.max(1, Number(state.planning.speedKmh) || 60) * 60;
            routeKm += km;
            routeMin += minutes;
        }
        const reservationCount = Array.isArray(state.planning.reservations) ? state.planning.reservations.length : 0;
        const uniquePlaces = [...new Map(state.itinerary.map(id => [placeKey(state.places[id]), state.places[id]])).values()];
        const weather = TripWeather.tripSummary(state.weather);
        const climate = TripWeather.tripClimateSummary(state.weather);
        const offerPrice = Math.max(0, Number(offer.price) || 0);
        const flightPrice = Math.max(0, Number(offer.flightPrice) || 0);
        const flightIncluded = offer.flightIncluded === true ? true : offer.flightIncluded === false ? false : null;
        const offerTotal = offerPrice > 0 && (flightIncluded === true || (flightIncluded === false && flightPrice > 0))
            ? offerPrice + (flightIncluded ? 0 : flightPrice) : null;
        return {
            state,
            days: dayCount(state.planning),
            stages: state.itinerary.filter(id => state.places[id].stageType !== 'detail').length,
            visits: state.itinerary.length,
            uniquePlaces,
            optionalPlaces: Math.max(0, Object.keys(state.places).length - new Set(state.itinerary).size),
            routeKm: Math.round(routeKm),
            routeMin: Math.round(routeMin),
            nativeTotals,
            reservationCount,
            weather,
            climate,
            averageRating: ratings.length ? Math.round(ratings.reduce((sum, value) => sum + value, 0) / ratings.length * 10) / 10 : null,
            offerPrice,
            offerCurrency: normalizeCurrency(offer.currency),
            flightIncluded,
            flightPrice,
            offerTotal,
            offerRating: Math.max(0, Math.min(6, Number(offer.rating) || 0))
        };
    }

    function sharedPlaceKeys(items) {
        if (!items.length) return new Set();
        const counts = new Map();
        for (const item of items) {
            for (const place of item.metrics.uniquePlaces) {
                const key = placeKey(place);
                counts.set(key, (counts.get(key) || 0) + 1);
            }
        }
        return new Set([...counts].filter(([, count]) => count === items.length).map(([key]) => key));
    }

    return { metrics, normalizeDocument, placeKey, sharedPlaceKeys };
});
