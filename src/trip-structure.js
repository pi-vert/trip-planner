(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.TripStructure = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const DAY_MS = 24 * 60 * 60 * 1000;

    function parseDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
        const date = new Date(`${value}T00:00:00Z`);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function parseTime(value) {
        const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
        return match ? Number(match[1]) * 60 + Number(match[2]) : null;
    }

    function parseRelativePeriod(value) {
        const normalized = String(value || '').toUpperCase().replace(/\s+/g, '');
        const match = /^J([1-9]\d*)([MAS])?(?:-J?([1-9]\d*)([MAS])?)?$/.exec(normalized);
        if (!match) return null;
        const startDay = Number(match[1]), endDay = Number(match[3] || match[1]);
        if (endDay < startDay) return null;
        return { startDay, startSlot: match[2] || '', endDay, endSlot: match[4] || '' };
    }

    function normalizeRelativePeriod(value) {
        const period = parseRelativePeriod(value);
        if (!period) return '';
        const start = `J${period.startDay}${period.startSlot}`;
        if (period.endDay === period.startDay && !period.endSlot) return start;
        return `${start}-J${period.endDay}${period.endSlot}`;
    }

    function relativePeriodLabel(value) {
        const period = parseRelativePeriod(value);
        if (!period) return '';
        const slots = { M: 'matin', A: 'après-midi', S: 'soir' };
        if (period.startDay === period.endDay && !period.endSlot) {
            return `Jour ${period.startDay}${period.startSlot ? ` · ${slots[period.startSlot]}` : ''}`;
        }
        const start = `Jour ${period.startDay}${period.startSlot ? ` ${slots[period.startSlot]}` : ''}`;
        const end = `jour ${period.endDay}${period.endSlot ? ` ${slots[period.endSlot]}` : ''}`;
        return `${start} → ${end}`;
    }

    function relativeDayCount(stages) {
        return Math.max(0, ...(stages || []).map(stage => parseRelativePeriod(stage?.relativePeriod)?.endDay || 0));
    }

    function dateKey(date) { return date.toISOString().slice(0, 10); }
    function addDays(date, days) { return new Date(date.getTime() + days * DAY_MS); }

    function distanceKm(a, b) {
        if (!a || !b) return Infinity;
        const values = [a.lat, a.lng, b.lat, b.lng].map(Number);
        if (!values.every(Number.isFinite)) return Infinity;
        const [lat1, lng1, lat2, lng2] = values.map(value => value * Math.PI / 180);
        const dLat = lat2 - lat1, dLng = lng2 - lng1;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
        return 2 * 6371 * Math.asin(Math.sqrt(h));
    }

    function hasLodgingTag(place) {
        return (place?.tags || []).some(tag => /^(hebergement|hébergement|hotel|hôtel)$/i.test(String(tag).trim()));
    }

    function suggestedAssignments(itinerary, places, thresholdKm = 30) {
        const assignments = {};
        let currentMainId = '';
        for (const id of itinerary || []) {
            const place = places?.[id];
            if (!place) continue;
            const newArea = !currentMainId || distanceKm(places[currentMainId], place) >= thresholdKm;
            const isMain = newArea || hasLodgingTag(place);
            if (isMain) currentMainId = id;
            assignments[id] = isMain
                ? { stageType: 'main', parentStageId: '' }
                : { stageType: 'detail', parentStageId: currentMainId };
        }
        return assignments;
    }

    function effectiveAssignments(itinerary, places) {
        const suggested = suggestedAssignments(itinerary, places);
        const mainIds = new Set();
        const assignments = {};

        for (const id of itinerary || []) {
            const place = places?.[id];
            if (!place) continue;
            const stageType = place.stageType === 'detail' || place.stageType === 'main'
                ? place.stageType : suggested[id]?.stageType || 'main';
            assignments[id] = { stageType, parentStageId: '' };
            if (stageType === 'main') mainIds.add(id);
        }

        if (!mainIds.size) {
            const firstId = (itinerary || []).find(id => places?.[id]);
            if (firstId) { assignments[firstId].stageType = 'main'; mainIds.add(firstId); }
        }

        let precedingMainId = '';
        for (const id of itinerary || []) {
            const assignment = assignments[id];
            if (!assignment) continue;
            if (assignment.stageType === 'main') { precedingMainId = id; continue; }
            const requestedParent = String(places[id]?.parentStageId || '');
            assignment.parentStageId = mainIds.has(requestedParent)
                ? requestedParent : (precedingMainId || mainIds.values().next().value || '');
        }
        return assignments;
    }

    function tripNights(planning) {
        const first = parseDate(planning?.startDate), last = parseDate(planning?.endDate);
        if (!first || !last || last < first) return [];
        const lodging = (planning?.reservations || []).filter(item => item?.kind === 'lodging');
        const nights = [];
        for (let date = first; date < last; date = addDays(date, 1)) {
            const key = dateKey(date);
            const matches = lodging.filter(item => {
                const start = parseDate(String(item.start || '').slice(0, 10));
                const end = parseDate(String(item.end || '').slice(0, 10));
                return start && end && date >= start && date < end;
            });
            nights.push({ date: key, lodging: matches });
        }
        return nights;
    }

    function tripDays(planning) {
        const first = parseDate(planning?.startDate), last = parseDate(planning?.endDate);
        if (!first || !last || last < first) return [];
        const days = [];
        for (let date = first; date <= last; date = addDays(date, 1)) days.push({ date: dateKey(date) });
        return days;
    }

    function inferredStageDates(index, count, planning) {
        const first = parseDate(planning?.startDate), last = parseDate(planning?.endDate);
        if (!first || !last || last < first || !count) return { arrivalDate: '', departureDate: '' };
        const dayCount = Math.round((last - first) / DAY_MS) + 1;
        const startOffset = Math.floor(index * dayCount / count);
        const endOffset = index === count - 1
            ? dayCount - 1 : Math.max(startOffset, Math.floor((index + 1) * dayCount / count));
        return { arrivalDate: dateKey(addDays(first, startOffset)), departureDate: dateKey(addDays(first, endOffset)) };
    }

    function chronologicalStages(stages) {
        return (stages || []).map((stage, index) => ({ stage, index })).sort((a, b) => {
            const aArrival = parseDate(a.stage?.arrivalDate), bArrival = parseDate(b.stage?.arrivalDate);
            if (aArrival && bArrival && aArrival.getTime() !== bArrival.getTime()) return aArrival - bArrival;
            if (aArrival && !bArrival) return -1;
            if (!aArrival && bArrival) return 1;
            const aArrivalTime = parseTime(a.stage?.arrivalTime), bArrivalTime = parseTime(b.stage?.arrivalTime);
            if (aArrivalTime !== null && bArrivalTime !== null && aArrivalTime !== bArrivalTime) return aArrivalTime - bArrivalTime;
            if (aArrivalTime !== null && bArrivalTime === null) return -1;
            if (aArrivalTime === null && bArrivalTime !== null) return 1;
            const aDeparture = parseDate(a.stage?.departureDate), bDeparture = parseDate(b.stage?.departureDate);
            if (aDeparture && bDeparture && aDeparture.getTime() !== bDeparture.getTime()) return aDeparture - bDeparture;
            const aRelative = parseRelativePeriod(a.stage?.relativePeriod), bRelative = parseRelativePeriod(b.stage?.relativePeriod);
            if (aRelative && bRelative) {
                const slotOrder = { '': 0, M: 1, A: 2, S: 3 };
                if (aRelative.startDay !== bRelative.startDay) return aRelative.startDay - bRelative.startDay;
                if (aRelative.startSlot !== bRelative.startSlot) return slotOrder[aRelative.startSlot] - slotOrder[bRelative.startSlot];
                if (aRelative.endDay !== bRelative.endDay) return aRelative.endDay - bRelative.endDay;
            }
            if (aRelative && !bRelative) return -1;
            if (!aRelative && bRelative) return 1;
            return a.index - b.index;
        }).map(entry => entry.stage);
    }

    function stagesForDate(stages, value) {
        const date = parseDate(value);
        if (!date) return [];
        return chronologicalStages(stages).filter(stage => {
            const arrival = parseDate(stage?.arrivalDate), departure = parseDate(stage?.departureDate);
            return arrival && departure && date >= arrival && date <= departure;
        });
    }

    function stagePeriodLabel(stage) {
        const arrivalDate = parseDate(stage?.arrivalDate), departureDate = parseDate(stage?.departureDate);
        const arrivalTime = parseTime(stage?.arrivalTime), departureTime = parseTime(stage?.departureTime);
        if (!arrivalDate || !departureDate || arrivalTime === null || departureTime === null) return '';
        if (departureDate > arrivalDate) return 'Journée complète';
        const duration = departureTime - arrivalTime;
        if (duration <= 0) return '';
        if (duration >= 8 * 60) return 'Journée complète';
        const midpoint = arrivalTime + duration / 2;
        if (midpoint < 12 * 60) return 'Matin';
        if (midpoint < 18 * 60) return 'Après-midi';
        return 'Soir';
    }

    function buildOutline(input) {
        const itinerary = Array.isArray(input?.itinerary) ? input.itinerary : [];
        const places = input?.places || {};
        const planning = input?.planning || {};
        const assignments = effectiveAssignments(itinerary, places);
        const mainIds = itinerary.filter(id => assignments[id]?.stageType === 'main');
        const detailsByStage = Object.fromEntries(mainIds.map(id => [id, []]));

        for (const id of itinerary) {
            const assignment = assignments[id];
            if (assignment?.stageType === 'detail' && detailsByStage[assignment.parentStageId]) {
                detailsByStage[assignment.parentStageId].push(id);
            }
        }

        const renderedStageIds = new Set();
        const stages = mainIds.map((id, index) => {
            const inferred = inferredStageDates(index, mainIds.length, planning);
            const arrivalDate = parseDate(places[id]?.arrivalDate) ? places[id].arrivalDate : inferred.arrivalDate;
            const departureDate = parseDate(places[id]?.departureDate) ? places[id].departureDate : inferred.departureDate;
            const arrivalTime = parseTime(places[id]?.arrivalTime) !== null ? places[id].arrivalTime : (parseTime(planning.dayStart) !== null ? planning.dayStart : '07:00');
            const departureTime = parseTime(places[id]?.departureTime) !== null ? places[id].departureTime : (parseTime(planning.dayEnd) !== null ? planning.dayEnd : '22:00');
            const relativePeriod = normalizeRelativePeriod(places[id]?.relativePeriod);
            const detailIds = renderedStageIds.has(id) ? [] : detailsByStage[id] || [];
            renderedStageIds.add(id);
            return { id, detailIds, arrivalDate, departureDate, arrivalTime, departureTime, relativePeriod };
        });
        const effectiveReservations = (planning.reservations || []).map(item => {
            if (item?.dateMode !== 'stage') return item;
            const placeIds = Array.isArray(item.placeIds) && item.placeIds.length ? item.placeIds : [item.placeId].filter(Boolean);
            const linkedPlaceId = placeIds.find(id => itinerary.includes(id));
            const assignment = assignments[linkedPlaceId];
            const stageId = String(item.stageId || '') || (assignment?.stageType === 'detail' ? assignment.parentStageId : linkedPlaceId);
            const matchingStages = stages.filter(entry => entry.id === stageId);
            if (matchingStages.length !== 1) return item;
            const stage = matchingStages[0];
            const date = item.relativeDay === 'departure' ? stage?.departureDate : stage?.arrivalDate;
            if (!date || !item.startTime || !item.endTime) return item;
            let endDate = item.kind === 'lodging' && item.relativeDay !== 'departure' && stage.departureDate > date ? stage.departureDate : date;
            if (endDate === date && item.endTime <= item.startTime) endDate = dateKey(addDays(parseDate(date), 1));
            return { ...item, start: `${date}T${item.startTime}`, end: `${endDate}T${item.endTime}` };
        });
        const nights = tripNights({ ...planning, reservations: effectiveReservations });
        const completedStages = stages.map(stage => {
            const stageNights = nights.filter(night => stagesForDate([stage], night.date).length);
            const stagePlaceIds = new Set([stage.id, ...stage.detailIds]);
            const lodgings = (planning.reservations || []).filter(item => {
                if (item?.kind !== 'lodging') return false;
                if (stageNights.some(night => night.lodging.some(lodging => lodging.id === item.id))) return true;
                if (item.stageId) return item.stageId === stage.id;
                const placeIds = Array.isArray(item.placeIds) && item.placeIds.length
                    ? item.placeIds : (item.placeId ? [item.placeId] : []);
                if (placeIds.length) return placeIds.some(placeId => stagePlaceIds.has(placeId));
                return false;
            });
            const meals = { lunch: [], dinner: [] };
            for (const item of planning.reservations || []) {
                if (item?.kind !== 'meal' || !meals[item.meal]) continue;
                if (item.stageId) {
                    if (item.stageId === stage.id) meals[item.meal].push(item);
                    continue;
                }
                const placeIds = Array.isArray(item.placeIds) && item.placeIds.length ? item.placeIds : [item.placeId].filter(Boolean);
                if (placeIds.some(placeId => stagePlaceIds.has(placeId))) meals[item.meal].push(item);
            }
            return { ...stage, nights: stageNights, lodgings, meals };
        });

        return { assignments, mainIds, stages: completedStages, nights };
    }

    return { buildOutline, chronologicalStages, effectiveAssignments, normalizeRelativePeriod, parseRelativePeriod, relativeDayCount, relativePeriodLabel, stagePeriodLabel, stagesForDate, suggestedAssignments, tripDays, tripNights };
});
