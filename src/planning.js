(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.TripPlanning = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const DAY_MS = 24 * 60 * 60000;
    const DEFAULTS = {
        startDate: '',
        endDate: '',
        startTime: '07:00',
        dayStart: '07:00',
        dayEnd: '22:00',
        speedKmh: 60,
        meals: {
            breakfast: { at: '07:00', durationMin: 60 },
            lunch: { at: '12:00', durationMin: 60 },
            dinner: { at: '19:00', durationMin: 60 }
        },
        reservations: []
    };
    const MEAL_LABELS = { breakfast: 'Petit déjeuner', lunch: 'Déjeuner', dinner: 'Dîner' };

    function pad(value) { return String(value).padStart(2, '0'); }
    function dateKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
    function parseDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
        const date = new Date(`${value}T00:00:00`);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    function parseDateTime(value) {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(value || ''))) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    function toMinutes(value) {
        const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
        if (!match) return 0;
        return Math.max(0, Math.min(1439, Number(match[1]) * 60 + Number(match[2])));
    }
    function atTime(day, value) {
        const result = new Date(day);
        result.setHours(0, toMinutes(value), 0, 0);
        return result;
    }
    function addDays(day, count) {
        const result = new Date(day);
        result.setDate(result.getDate() + count);
        return result;
    }
    function addMinutes(date, minutes) { return new Date(date.getTime() + minutes * 60000); }
    function cloneDefaults() { return JSON.parse(JSON.stringify(DEFAULTS)); }

    function normalizeReservation(value) {
        const reservation = value && typeof value === 'object' ? value : {};
        const legacyPlaceId = String(reservation.placeId || '');
        const placeIds = Array.isArray(reservation.placeIds)
            ? reservation.placeIds.map(id => String(id || '')).filter(Boolean).slice(0, 50) : [];
        if (legacyPlaceId && !placeIds.includes(legacyPlaceId)) placeIds.unshift(legacyPlaceId);
        return {
            id: String(reservation.id || `fixed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
            title: String(reservation.title || '').trim().slice(0, 160),
            kind: ['activity', 'meal', 'lodging', 'travel', 'other'].includes(reservation.kind) ? reservation.kind : 'activity',
            placeId: placeIds[0] || '',
            placeIds: [...new Set(placeIds)],
            stageId: String(reservation.stageId || ''),
            start: String(reservation.start || ''),
            end: String(reservation.end || ''),
            meal: ['breakfast', 'lunch', 'dinner'].includes(reservation.meal) ? reservation.meal : '',
            notes: String(reservation.notes || '').trim().slice(0, 1000),
            dateMode: reservation.dateMode === 'stage' ? 'stage' : 'fixed',
            relativeDay: reservation.relativeDay === 'departure' ? 'departure' : 'arrival',
            startTime: /^\d{2}:\d{2}$/.test(String(reservation.startTime || '')) ? reservation.startTime : '',
            endTime: /^\d{2}:\d{2}$/.test(String(reservation.endTime || '')) ? reservation.endTime : ''
        };
    }

    function normalizePlanning(value) {
        const source = value && typeof value === 'object' ? value : {};
        const defaults = cloneDefaults();
        const meals = source.meals && typeof source.meals === 'object' ? source.meals : {};
        for (const key of Object.keys(defaults.meals)) {
            defaults.meals[key] = {
                at: /^\d{2}:\d{2}$/.test(String(meals[key]?.at || '')) ? meals[key].at : defaults.meals[key].at,
                durationMin: Math.max(15, Number(meals[key]?.durationMin) || defaults.meals[key].durationMin)
            };
        }
        defaults.startDate = String(source.startDate || '');
        defaults.endDate = String(source.endDate || '');
        defaults.startTime = /^\d{2}:\d{2}$/.test(String(source.startTime || '')) ? source.startTime : defaults.startTime;
        defaults.dayStart = /^\d{2}:\d{2}$/.test(String(source.dayStart || '')) ? source.dayStart : defaults.dayStart;
        defaults.dayEnd = /^\d{2}:\d{2}$/.test(String(source.dayEnd || '')) ? source.dayEnd : defaults.dayEnd;
        defaults.speedKmh = Math.max(1, Number(source.speedKmh) || defaults.speedKmh);
        defaults.reservations = Array.isArray(source.reservations) ? source.reservations.map(normalizeReservation) : [];
        return defaults;
    }

    function distanceKm(a, b) {
        if (!a || !b || !Number.isFinite(Number(a.lat)) || !Number.isFinite(Number(a.lng)) || !Number.isFinite(Number(b.lat)) || !Number.isFinite(Number(b.lng))) return null;
        const toRad = value => value * Math.PI / 180;
        const dLat = toRad(Number(b.lat) - Number(a.lat));
        const dLng = toRad(Number(b.lng) - Number(a.lng));
        const lat1 = toRad(Number(a.lat));
        const lat2 = toRad(Number(b.lat));
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
        return 2 * 6371 * Math.asin(Math.sqrt(h));
    }

    function travelInfo(fromId, toId, places, edges, speedKmh) {
        if (!fromId || !toId || fromId === toId) return { minutes: 0, km: 0, estimated: false };
        const edge = edges?.[`${fromId}|${toId}`];
        if (Number.isFinite(Number(edge?.realMin))) {
            return { minutes: Math.max(0, Number(edge.realMin)), km: Number(edge.realKm) || null, estimated: false };
        }
        const km = distanceKm(places[fromId], places[toId]);
        if (km == null) return { minutes: null, km: null, estimated: true };
        return { minutes: Math.max(1, Math.round(km / speedKmh * 60)), km: Math.round(km * 10) / 10, estimated: true };
    }

    function closestMeal(reservation, planning) {
        if (reservation.meal) return reservation.meal;
        const start = parseDateTime(reservation.start);
        if (!start) return 'lunch';
        const minute = start.getHours() * 60 + start.getMinutes();
        return Object.keys(planning.meals).sort((a, b) =>
            Math.abs(toMinutes(planning.meals[a].at) - minute) - Math.abs(toMinutes(planning.meals[b].at) - minute)
        )[0];
    }

    function remainingItinerary(input) {
        const itinerary = Array.isArray(input?.itinerary) ? input.itinerary : [];
        const places = input?.places || {};
        const anchors = new Set([itinerary[0]]);
        const last = itinerary.at(-1);
        if (last && (last === itinerary[0] || (distanceKm(places[itinerary[0]], places[last]) ?? Infinity) <= .1)) anchors.add(last);
        for (const item of input?.planning?.reservations || []) {
            if (['lodging', 'meal', 'travel'].includes(item.kind)) for (const id of [item.placeId, ...(item.placeIds || [])]) anchors.add(id);
        }
        return itinerary.filter(id => !places[id]?.completed || anchors.has(id));
    }

    function buildPlan(input) {
        const itinerary = remainingItinerary(input);
        const places = input?.places && typeof input.places === 'object' ? input.places : {};
        const edges = input?.edges && typeof input.edges === 'object' ? input.edges : {};
        const planning = normalizePlanning(input?.planning);
        const structure = input?.structure && typeof input.structure === 'object' ? input.structure : null;
        const firstDay = parseDate(planning.startDate);
        const lastDay = parseDate(planning.endDate);
        const conflicts = [];
        const activePlaceIds = new Set(itinerary);
        const firstPlaceId = itinerary[0] || '';
        const lastPlaceId = itinerary[itinerary.length - 1] || '';
        const roundTrip = itinerary.length > 1 && (firstPlaceId === lastPlaceId || (distanceKm(places[firstPlaceId], places[lastPlaceId]) ?? Infinity) <= 0.1);
        const activityItinerary = roundTrip ? itinerary.slice(1, -1) : itinerary;

        if (!firstDay || !lastDay) return { planning, days: [], events: [], conflicts: ['Les dates de début et de fin sont requises.'], unscheduled: [] };
        if (lastDay < firstDay) return { planning, days: [], events: [], conflicts: ['La date de fin doit suivre la date de début.'], unscheduled: [] };
        if (toMinutes(planning.dayEnd) <= toMinutes(planning.dayStart)) return { planning, days: [], events: [], conflicts: ["L'heure de fin de journée doit suivre son heure de début."], unscheduled: [] };

        const rangeStart = atTime(firstDay, planning.startTime);
        const rangeEnd = atTime(lastDay, planning.dayEnd);
        const days = [];
        const dayMap = new Map();
        for (let day = new Date(firstDay); day <= lastDay; day = addDays(day, 1)) {
            const entry = { date: dateKey(day), events: [], lodging: null, morningLodging: null, conflicts: [] };
            days.push(entry);
            dayMap.set(entry.date, entry);
        }
        const addEvent = event => {
            const day = dayMap.get(dateKey(event.start));
            if (day && event.render !== false) day.events.push(event);
        };

        const relativeRange = reservation => {
            if (reservation.dateMode !== 'stage') return { start: parseDateTime(reservation.start), end: parseDateTime(reservation.end) };
            const linkedPlaceId = reservation.placeIds.find(id => activePlaceIds.has(id)) || reservation.placeId;
            const assignment = structure?.assignments?.[linkedPlaceId];
            const stageId = reservation.stageId || (assignment?.stageType === 'detail' ? assignment.parentStageId : linkedPlaceId);
            const matchingStages = structure?.stages?.filter(item => item.id === stageId) || [];
            if (matchingStages.length > 1) return { start: null, end: null, ambiguous: true };
            const stage = matchingStages[0];
            const stageDate = reservation.relativeDay === 'departure' ? stage?.departureDate : stage?.arrivalDate;
            const start = parseDateTime(`${stageDate || ''}T${reservation.startTime || ''}`);
            const lodgingEndDate = reservation.kind === 'lodging' && reservation.relativeDay !== 'departure' && stage?.departureDate > stageDate
                ? stage.departureDate : stageDate;
            let end = parseDateTime(`${lodgingEndDate || ''}T${reservation.endTime || ''}`);
            if (start && end && end <= start) end = addDays(end, 1);
            return { start, end };
        };
        const validReservations = [];
        for (const reservation of planning.reservations) {
            const requestedPlaceIds = reservation.placeIds || [];
            const reservationPlaceIds = requestedPlaceIds.filter(id => activePlaceIds.has(id) && (['lodging', 'meal', 'travel'].includes(reservation.kind) || !places[id]?.completed));
            if (requestedPlaceIds.length && !reservationPlaceIds.length) continue;
            const { start, end, ambiguous } = relativeRange(reservation);
            if (!reservation.title || !start || !end || end <= start) {
                const label = reservation.dateMode === 'stage' ? 'Créneau relatif' : 'Date fixe';
                conflicts.push(ambiguous
                    ? `${label} ambigu : le lieu associé à « ${reservation.title || 'sans titre'} » apparaît plusieurs fois dans la trame.`
                    : `${label} incomplet ou invalide : ${reservation.title || 'sans titre'}.`);
                continue;
            }
            const overlappingLodging = reservation.kind === 'lodging' && start < addDays(lastDay, 1) && end > firstDay;
            if (!overlappingLodging && (start < firstDay || end > addDays(lastDay, 1))) {
                conflicts.push(`« ${reservation.title} » se trouve hors des dates du voyage.`);
                continue;
            }
            validReservations.push({ ...reservation, placeId: reservationPlaceIds[0] || '', placeIds: reservationPlaceIds, endPlaceId: reservationPlaceIds.at(-1) || '', startDate: start, endDate: end });
        }

        const mealReservations = new Map();
        for (const reservation of validReservations.filter(item => item.kind === 'meal')) {
            mealReservations.set(`${dateKey(reservation.startDate)}:${closestMeal(reservation, planning)}`, reservation);
        }

        const blockers = [];
        for (const day of days) {
            const base = parseDate(day.date);
            for (const meal of ['breakfast', 'lunch', 'dinner']) {
                const reserved = mealReservations.get(`${day.date}:${meal}`);
                const start = reserved ? reserved.startDate : atTime(base, planning.meals[meal].at);
                const end = reserved ? reserved.endDate : addMinutes(start, planning.meals[meal].durationMin);
                const event = {
                    id: reserved?.id || `meal-${day.date}-${meal}`,
                    kind: 'meal', meal, start, end,
                    title: reserved?.title || 'À compléter',
                    label: MEAL_LABELS[meal],
                    fixed: Boolean(reserved),
                    dateMode: reserved?.dateMode || '',
                    placeId: reserved?.placeId || '',
                    placeIds: reserved?.placeIds || [],
                    endPlaceId: reserved?.endPlaceId || reserved?.placeId || '',
                    notes: reserved?.notes || ''
                };
                blockers.push(event);
                addEvent(event);
            }
            const offStart = atTime(base, planning.dayEnd);
            const offEnd = atTime(addDays(base, 1), planning.dayStart);
            blockers.push({ id: `off-${day.date}`, kind: 'unavailable', start: offStart, end: offEnd, render: false, placeId: '' });
        }

        for (const reservation of validReservations.filter(item => item.kind !== 'meal')) {
            if (reservation.kind === 'lodging') {
                const checkInEnd = new Date(Math.min(reservation.endDate.getTime(), addMinutes(reservation.startDate, 30).getTime()));
                const checkOutStart = new Date(Math.max(reservation.startDate.getTime(), addMinutes(reservation.endDate, -30).getTime()));
                const checkIn = { id: `${reservation.id}-in`, reservationId: reservation.id, kind: 'fixed', fixedType: 'lodging', title: `Arrivée : ${reservation.title}`, start: reservation.startDate, end: checkInEnd, fixed: true, dateMode: reservation.dateMode, placeId: reservation.placeId, placeIds: reservation.placeIds, endPlaceId: reservation.endPlaceId, notes: reservation.notes };
                const checkOut = { id: `${reservation.id}-out`, reservationId: reservation.id, kind: 'fixed', fixedType: 'lodging', title: `Départ : ${reservation.title}`, start: checkOutStart, end: reservation.endDate, fixed: true, dateMode: reservation.dateMode, placeId: reservation.placeId, placeIds: reservation.placeIds, endPlaceId: reservation.endPlaceId, notes: reservation.notes };
                blockers.push(checkIn, checkOut);
                addEvent(checkIn); addEvent(checkOut);
                const lodging = { reservationId: reservation.id, title: reservation.title, fixed: true, notes: reservation.notes, placeId: reservation.placeId, placeIds: reservation.placeIds };
                const arrival = dateKey(reservation.startDate), departure = dateKey(reservation.endDate);
                for (const day of days) {
                    if (arrival <= day.date && day.date < departure) day.lodging = lodging;
                    if (arrival < day.date && day.date <= departure) day.morningLodging = lodging;
                }
                if (!reservation.placeId) conflicts.push(`Associez un lieu à « ${reservation.title} » pour calculer les trajets depuis et vers l’hôtel.`);
                continue;
            }
            const event = {
                id: reservation.id,
                kind: reservation.kind === 'activity' ? 'activity' : reservation.kind === 'travel' ? 'travel' : 'fixed',
                title: reservation.title,
                start: reservation.startDate,
                end: reservation.endDate,
                fixed: true,
                dateMode: reservation.dateMode,
                fixedType: reservation.kind,
                placeId: reservation.placeId,
                placeIds: reservation.placeIds,
                endPlaceId: reservation.endPlaceId,
                notes: reservation.notes
            };
            blockers.push(event);
            addEvent(event);
        }

        // Each night is a route destination, including nights without a check-in.
        // The off-hours blocker keeps that location until the following morning.
        for (const day of days) {
            const base = parseDate(day.date);
            const off = blockers.find(item => item.id === `off-${day.date}`);
            if (day.lodging) {
                off.placeId = day.lodging.placeId;
                off.title = `Retour à l’hôtel : ${day.lodging.title}`;
            }
            for (const [boundary, lodging, time] of [
                ['start', day.morningLodging, day.date === planning.startDate ? planning.startTime : planning.dayStart],
                ['end', day.lodging, planning.dayEnd]
            ]) {
                if (!lodging) continue;
                const start = atTime(base, time);
                addEvent({ ...lodging, kind: 'lodging', fixedType: 'lodging', fixed: false, boundary,
                    title: `${boundary === 'start' ? 'Départ de la journée' : 'Fin de journée'} : ${lodging.title}`,
                    start, end: new Date(start) });
            }
        }

        const visibleFixed = blockers.filter(item => item.render !== false).sort((a, b) => a.start - b.start || a.end - b.end);
        for (let index = 1; index < visibleFixed.length; index++) {
            const previous = visibleFixed[index - 1];
            const current = visibleFixed[index];
            if (current.start < previous.end) {
                previous.conflict = current.conflict = true;
                conflicts.push(`Conflit entre « ${previous.label || previous.title} » et « ${current.label || current.title} » le ${dateKey(current.start)}.`);
            }
        }

        const fixedPlaceCounts = new Map();
        for (const reservation of validReservations) {
            for (const placeId of reservation.placeIds) fixedPlaceCounts.set(placeId, (fixedPlaceCounts.get(placeId) || 0) + 1);
        }
        const tasks = [];
        for (const id of activityItinerary) {
            if (!places[id] || places[id].completed) continue;
            const fixedCount = fixedPlaceCounts.get(id) || 0;
            if (fixedCount > 0) { fixedPlaceCounts.set(id, fixedCount - 1); continue; }
            const durationH = Number(places[id].durationH);
            const assignment = structure?.assignments?.[id];
            const stageId = assignment?.stageType === 'detail' ? assignment.parentStageId : id;
            const stage = structure?.stages?.find(item => item.id === stageId);
            const stageStart = parseDate(stage?.arrivalDate || places[stageId]?.arrivalDate);
            const stageEnd = parseDate(stage?.departureDate || places[stageId]?.departureDate);
            const stageStartTime = stage?.arrivalTime || places[stageId]?.arrivalTime || planning.dayStart;
            const stageEndTime = stage?.departureTime || places[stageId]?.departureTime || planning.dayEnd;
            tasks.push({
                id,
                title: places[id].name || id,
                remaining: Math.round((durationH > 0 ? durationH : 2) * 60),
                started: false,
                minStart: stageStart ? atTime(stageStart, stageStartTime) : null,
                maxEnd: stageEnd ? atTime(stageEnd, stageEndTime) : null
            });
        }

        let cursor = new Date(rangeStart);
        let currentPlace = days[0].morningLodging?.placeId || (roundTrip ? firstPlaceId : '');
        let taskIndex = 0;
        const missedTasks = [];
        const addTravel = (start, info, fromId, toId, fixed = false, title = '') => {
            if (!info?.minutes) return start;
            const end = addMinutes(start, info.minutes);
            addEvent({ kind: 'travel', title: title || `${places[fromId]?.name || 'Départ'} → ${places[toId]?.name || 'destination'}`, start: new Date(start), end, fromId, placeId: toId, fixed, km: info.km, estimated: info.estimated });
            return end;
        };

        function scheduleGap(gapEnd, targetPlace) {
            while (taskIndex < tasks.length && cursor < gapEnd) {
                const task = tasks[taskIndex];
                if (task.remaining <= 0) { taskIndex++; continue; }
                if (task.minStart && cursor < task.minStart) {
                    if (task.minStart >= gapEnd) break;
                    cursor = new Date(task.minStart);
                }
                if (task.maxEnd && cursor >= task.maxEnd) {
                    missedTasks.push(task);
                    taskIndex++;
                    continue;
                }
                const taskGapEnd = task.maxEnd && task.maxEnd < gapEnd ? task.maxEnd : gapEnd;
                const before = travelInfo(currentPlace, task.id, places, edges, planning.speedKmh);
                if (before.minutes == null) break;
                const after = targetPlace ? travelInfo(task.id, targetPlace, places, edges, planning.speedKmh) : { minutes: 0 };
                if (after.minutes == null) break;
                const available = Math.floor((taskGapEnd - cursor) / 60000) - before.minutes - after.minutes;
                if (available <= 0 || (available < task.remaining && available < 30)) {
                    if (task.maxEnd && task.maxEnd <= gapEnd) { missedTasks.push(task); taskIndex++; continue; }
                    break;
                }
                if (before.minutes) cursor = addTravel(cursor, before, currentPlace, task.id);
                const used = Math.min(task.remaining, available);
                const end = addMinutes(cursor, used);
                addEvent({ kind: 'activity', id: task.id, placeId: task.id, title: task.title, start: new Date(cursor), end, fixed: false, closed: Array.isArray(places[task.id].closedDays) && places[task.id].closedDays.includes(cursor.getDay()), continued: task.started || used < task.remaining });
                cursor = end;
                currentPlace = task.id;
                task.started = true;
                task.remaining -= used;
                if (task.remaining <= 0) taskIndex++;
            }
        }

        const timeline = blockers.filter(item => item.end > rangeStart && (item.start < rangeEnd || (item.kind === 'unavailable' && item.placeId && item.start.getTime() === rangeEnd.getTime()))).sort((a, b) => a.start - b.start || a.end - b.end);
        for (const blocker of timeline) {
            if (blocker.start > cursor) scheduleGap(new Date(Math.min(blocker.start.getTime(), rangeEnd.getTime())), blocker.placeId);
            if (blocker.placeId) {
                const info = travelInfo(currentPlace, blocker.placeId, places, edges, planning.speedKmh);
                if (info.minutes == null) {
                    conflicts.push(`Trajet à compléter avant « ${blocker.label || blocker.title} ».`);
                } else if (info.minutes > 0) {
                    const travelStart = addMinutes(blocker.start, -info.minutes);
                    if (travelStart < cursor) {
                        blocker.conflict = true;
                        conflicts.push(`Temps de trajet insuffisant avant « ${blocker.label || blocker.title} ».`);
                    } else {
                        addTravel(travelStart, info, currentPlace, blocker.placeId);
                    }
                }
                currentPlace = blocker.endPlaceId || blocker.placeId;
            }
            if (blocker.end > cursor) cursor = new Date(blocker.end);
        }
        if (cursor < rangeEnd) scheduleGap(rangeEnd, roundTrip ? lastPlaceId : '');
        if (roundTrip && currentPlace && currentPlace !== lastPlaceId && cursor < rangeEnd) {
            const info = travelInfo(currentPlace, lastPlaceId, places, edges, planning.speedKmh);
            if (info.minutes == null || addMinutes(cursor, info.minutes) > rangeEnd) {
                conflicts.push('Le trajet de retour au domicile ne tient pas dans les dates choisies.');
            } else {
                cursor = addTravel(cursor, info, currentPlace, lastPlaceId);
                currentPlace = lastPlaceId;
            }
        }

        const unscheduled = [...missedTasks, ...tasks.slice(taskIndex)].filter(task => task.remaining > 0).map(task => ({ id: task.id, title: task.title, remainingMin: task.remaining }));
        if (unscheduled.length) conflicts.push(`${unscheduled.length} activité(s) ne tiennent pas dans les dates choisies.`);

        for (const day of days) {
            const off = blockers.find(item => item.id === `off-${day.date}`);
            if (off?.conflict) {
                const endMarker = day.events.find(event => event.boundary === 'end');
                if (endMarker) endMarker.conflict = true;
            }
            day.events.sort((a, b) => a.start - b.start || a.end - b.end);
            day.conflicts = day.events.filter(event => event.conflict).map(event => event.title || event.label);
        }
        return { planning, days, events: days.flatMap(day => day.events), conflicts: [...new Set(conflicts)], unscheduled };
    }

    return { DEFAULTS, MEAL_LABELS, normalizePlanning, normalizeReservation, remainingItinerary, buildPlan, dateKey };
});
