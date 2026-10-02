(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.TripGps = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const RAD = Math.PI / 180, R = 6371000;
    const ALL_STAGES = '__all__';
    function wholeTrip(reference) {
        if (!reference) return null;
        const stops = new Map();
        for (const stage of reference.stages || []) for (const stop of stage.stops || []) {
            if (!stops.has(stop.id)) stops.set(stop.id, { ...stop, stageTitles: [] });
            const entry = stops.get(stop.id);
            if (!entry.stageTitles.includes(stage.title)) entry.stageTitles.push(stage.title);
        }
        return { key: ALL_STAGES, title: 'Ensemble du voyage', wholeTrip: true,
            segments: (reference.stages || []).flatMap(stage => stage.segments || []), stops: [...stops.values()] };
    }
    const longitudeDelta = value => ((value + 540) % 360) - 180;
    function distance(a, b) {
        const dLat = (b[0] - a[0]) * RAD, dLng = longitudeDelta(b[1] - a[1]) * RAD;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    function localDay(time) {
        if (time == null || !Number.isFinite(time)) return '';
        const date = new Date(time), pad = value => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }
    function filterDay(track, day) {
        if (!day) return track;
        const segments = [];
        for (const points of track.segments) {
            let current = [];
            for (const point of points) {
                if (localDay(point[2]) === day) current.push(point);
                else if (current.length) { segments.push(current); current = []; }
            }
            if (current.length) segments.push(current);
        }
        return { ...track, segments };
    }
    function trackStats(track) {
        let meters = 0, movingSeconds = 0, measuredSeconds = 0, timedEdges = 0, first = Infinity, last = -Infinity, pointCount = 0, timedPoints = 0, gaps = 0;
        for (const points of track.segments || []) {
            for (let i = 0; i < points.length; i++) {
                const point = points[i]; pointCount++;
                if (point[2] != null) { first = Math.min(first, point[2]); last = Math.max(last, point[2]); timedPoints++; }
                if (!i) continue;
                const previous = points[i - 1], length = distance(previous, point);
                meters += length;
                if (point[2] == null || previous[2] == null) continue;
                const seconds = (point[2] - previous[2]) / 1000;
                if (seconds <= 0 || seconds > 120) { gaps++; continue; }
                timedEdges++; measuredSeconds += seconds;
                if (length / seconds >= 0.5) movingSeconds += seconds;
            }
        }
        return { km: meters / 1000, movingMinutes: timedEdges ? movingSeconds / 60 : null,
            elapsedMinutes: timedPoints >= 2 && last > first ? (last - first) / 60000 : null,
            measuredMinutes: measuredSeconds / 60, start: timedPoints ? first : null, end: timedPoints ? last : null,
            pointCount, timedPoints, gaps };
    }
    // Spatial grid avoids comparing every recorded point with every planned segment.
    function spatialIndex(paths, origin, observed = false) {
        const project = point => [longitudeDelta(point[1] - origin[1]) * RAD * R * Math.cos(origin[0] * RAD), (point[0] - origin[0]) * RAD * R];
        const cells = new Map(), broad = [], size = 1000;
        const add = (a, b) => {
            const pair = [project(a), project(b)];
            const minX = Math.floor(Math.min(pair[0][0], pair[1][0]) / size), maxX = Math.floor(Math.max(pair[0][0], pair[1][0]) / size);
            const minY = Math.floor(Math.min(pair[0][1], pair[1][1]) / size), maxY = Math.floor(Math.max(pair[0][1], pair[1][1]) / size);
            if ((maxX - minX + 1) * (maxY - minY + 1) > 1000) { broad.push(pair); return; }
            for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
                const key = `${x}:${y}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(pair);
            }
        };
        for (const points of paths) for (let i = 0; i < points.length; i++) {
            add(points[i], points[i]);
            if (!i) continue;
            const a = points[i - 1], b = points[i];
            if (observed && (distance(a, b) > 1000 || (a[2] != null && b[2] != null && (b[2] <= a[2] || b[2] - a[2] > 120000)))) continue;
            add(a, b);
        }
        return point => {
            const p = project(point), x = Math.floor(p[0] / size), y = Math.floor(p[1] / size);
            let minimum = Infinity;
            const inspect = ([a, b]) => {
                const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
                const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
                minimum = Math.min(minimum, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
            };
            for (let i = x - 1; i <= x + 1; i++) for (let j = y - 1; j <= y + 1; j++) (cells.get(`${i}:${j}`) || []).forEach(inspect);
            broad.forEach(inspect);
            return minimum;
        };
    }
    function compare(stage, tracks, options = {}) {
        const threshold = Math.max(20, Math.min(500, Number(options.threshold) || 100));
        const selected = tracks.map(track => filterDay(track, options.day)).filter(track => track.segments.some(points => points.length));
        const routes = (stage?.segments || []).filter(segment => stage?.wholeTrip || !options.day || segment.date === options.day);
        const actualPaths = selected.flatMap(track => track.segments);
        const stats = selected.map(trackStats);
        const plannedPaths = routes.map(route => (route.geometry || []).map(point => [point[1], point[0]]));
        const origin = actualPaths.find(points => points.length)?.[0] || plannedPaths.find(points => points.length)?.[0];
        const timed = stats.filter(item => item.elapsedMinutes != null), moving = stats.filter(item => item.movingMinutes != null);
        const plannedKm = routes.length && routes.every(route => route.km != null) ? routes.reduce((sum, route) => sum + route.km, 0) : null;
        const plannedMinutes = routes.length && routes.every(route => route.minutes != null) ? routes.reduce((sum, route) => sum + route.minutes, 0) : null;
        let offRouteKm = null;
        if (origin && actualPaths.length && routes.length && routes.every(route => route.geometrySource === 'road' && route.geometry?.length >= 2)) {
            const nearest = spatialIndex(plannedPaths, origin);
            let meters = 0;
            for (const points of actualPaths) for (let i = 1; i < points.length; i++) {
                const a = points[i - 1], b = points[i];
                const midpoint = [(a[0] + b[0]) / 2, a[1] + longitudeDelta(b[1] - a[1]) / 2];
                if (nearest(midpoint) > threshold) meters += distance(a, b);
            }
            offRouteKm = meters / 1000;
        }
        const nearActual = origin && actualPaths.length ? spatialIndex(actualPaths, origin, true) : null;
        const routePlaceIds = new Set(routes.flatMap(route => [route.fromId, route.toId]));
        const stops = (stage?.stops || []).filter(stop => stage?.wholeTrip || !options.day || routePlaceIds.has(stop.id)).map(stop => {
            const distanceMeters = stop.lat == null || stop.lng == null || !nearActual ? null : nearActual([stop.lat, stop.lng]);
            return { ...stop, distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : null,
                observed: distanceMeters === null ? null : distanceMeters <= threshold };
        });
        const ordered = stats.filter(item => item.start != null).sort((a, b) => a.start - b.start);
        let overlap = false, lastEnd = -Infinity;
        for (const item of ordered) { if (item.start < lastEnd) overlap = true; lastEnd = Math.max(lastEnd, item.end); }
        return { tracks: selected, routes, stops, threshold, plannedKm, plannedMinutes, offRouteKm, overlap,
            actualKm: stats.length ? stats.reduce((sum, item) => sum + item.km, 0) : null,
            elapsedMinutes: timed.length ? timed.reduce((sum, item) => sum + item.elapsedMinutes, 0) : null,
            movingMinutes: moving.length ? moving.reduce((sum, item) => sum + item.movingMinutes, 0) : null,
            partialTiming: stats.some(item => item.timedPoints < item.pointCount || item.gaps > 0),
            start: ordered[0]?.start ?? null, end: ordered.length ? Math.max(...ordered.map(item => item.end)) : null };
    }
    function displayPath(points, maximum = 4000) {
        if (points.length <= maximum) return points;
        const step = Math.ceil((points.length - 1) / (maximum - 1));
        return points.filter((_, index) => index % step === 0 || index === points.length - 1);
    }
    return { ALL_STAGES, wholeTrip, distance, localDay, filterDay, trackStats, compare, displayPath };
});
