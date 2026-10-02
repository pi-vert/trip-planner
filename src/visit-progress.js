(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.TripVisitProgress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    function canComplete(id, input) {
        const place = input?.places?.[id], itinerary = input?.itinerary || [];
        if (!place) return false;
        if (id === (input.startPlaceId || itinerary[0])) return false;
        const first = input.places[itinerary[0]];
        if (id === itinerary.at(-1) && first && Math.abs(Number(first.lat) - Number(place.lat)) < .0001 && Math.abs(Number(first.lng) - Number(place.lng)) < .0001) return false;
        const tags = Array.isArray(place.tags) ? place.tags : String(place.tags || '').split(',');
        if (tags.some(tag => /^(hébergement|hebergement|hôtel|hotel|lodging|camping|gîte|gite|restaurant|repas|transport|domicile)$/i.test(String(tag).trim()))) return false;
        if ((input.planning?.reservations || []).some(item => ['lodging', 'meal', 'travel'].includes(item.kind) && (item.placeId === id || item.placeIds?.includes(id)))) return false;
        // A city/region containing other visits is a grouping, not a completed visit.
        if (itinerary.some(child => child !== id && input.places[child]?.parentStageId === id)) return false;
        return true;
    }
    return { canComplete };
});
