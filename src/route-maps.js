(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.TripRouteMaps = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const WIDTH = 1200, HEIGHT = 490, TILE_SIZE = 256;
    const ROUTERS = ['https://router.project-osrm.org/route/v1/driving', 'https://routing.openstreetmap.de/routed-car/route/v1/driving'];

    function coordinates(place) {
        if (place?.lat == null || place?.lng == null || place.lat === '' || place.lng === '') return null;
        const lat = Number(place.lat), lng = Number(place.lng);
        return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lng, lat] : null;
    }

    function project(point) {
        const lat = Math.max(-85.0511, Math.min(85.0511, point[1])) * Math.PI / 180;
        return { x: (point[0] + 180) / 360, y: (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 };
    }

    function mapViewport(points, width = WIDTH, height = HEIGHT) {
        const projected = [];
        for (const point of points) {
            const p = project(point);
            if (projected.length) p.x += Math.round(projected.at(-1).x - p.x);
            projected.push(p);
        }
        const bounds = projected.reduce((b, p) => ({ minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x), minY: Math.min(b.minY, p.y), maxY: Math.max(b.maxY, p.y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
        let zoom = 16;
        while (zoom > 0 && ((bounds.maxX - bounds.minX) * TILE_SIZE * 2 ** zoom > width - 100 || (bounds.maxY - bounds.minY) * TILE_SIZE * 2 ** zoom > height - 100)) zoom--;
        const scale = TILE_SIZE * 2 ** zoom;
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const left = centerX * scale - width / 2;
        const top = (bounds.minY + bounds.maxY) / 2 * scale - height / 2;
        return { zoom, left, top, scale, pixel(point) {
            const p = project(point);
            p.x += Math.round(centerX - p.x);
            return { x: p.x * scale - left, y: p.y * scale - top };
        } };
    }

    async function routeGeometry(from, to, fetcher) {
        for (const base of ROUTERS) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            try {
                const response = await fetcher(`${base}/${from.join(',')};${to.join(',')}?overview=full&geometries=geojson&steps=false`, { signal: controller.signal });
                if (!response.ok) continue;
                const data = await response.json();
                const points = data.routes?.[0]?.geometry?.coordinates;
                if (Array.isArray(points) && points.length > 1 && points.every(p => Array.isArray(p) && coordinates({ lng: p[0], lat: p[1] }))) return points;
            } catch (_) { /* Try the alternate router before drawing an indicative link. */ }
            finally { clearTimeout(timeout); }
        }
        return null;
    }

    function loadTile(url) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = 'anonymous';
            const finish = (error) => {
                clearTimeout(timeout);
                image.onload = image.onerror = null;
                if (error) { image.src = ''; reject(error); } else resolve(image);
            };
            const timeout = setTimeout(() => finish(new Error('Délai de chargement de la carte dépassé')), 8000);
            image.onload = () => finish();
            image.onerror = () => finish(new Error('Fond de carte indisponible'));
            image.src = url;
        });
    }

    async function drawRouteMap(routes, markers, tileLoader, canvasFactory, options = {}) {
        const width = options.width || WIDTH, height = options.height || HEIGHT;
        const canvas = canvasFactory();
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Le navigateur ne permet pas de dessiner les cartes.');
        ctx.fillStyle = '#edf1f5'; ctx.fillRect(0, 0, width, height);
        const viewport = mapViewport([...routes.flatMap(route => route.points), ...markers.map(marker => marker.point)], width, height);
        const count = 2 ** viewport.zoom;
        const tiles = [];
        for (let y = Math.floor(viewport.top / TILE_SIZE); y <= Math.floor((viewport.top + height) / TILE_SIZE); y++) {
            if (y < 0 || y >= count) continue;
            for (let x = Math.floor(viewport.left / TILE_SIZE); x <= Math.floor((viewport.left + width) / TILE_SIZE); x++) tiles.push({ x, y });
        }
        let cursor = 0, loaded = 0;
        await Promise.all(Array.from({ length: Math.min(4, tiles.length) }, async () => {
            while (cursor < tiles.length) {
                const tile = tiles[cursor++];
                const wrappedX = ((tile.x % count) + count) % count;
                try {
                    const image = await tileLoader(`https://tile.openstreetmap.org/${viewport.zoom}/${wrappedX}/${tile.y}.png`);
                    ctx.drawImage(image, tile.x * TILE_SIZE - viewport.left, tile.y * TILE_SIZE - viewport.top, TILE_SIZE, TILE_SIZE);
                    loaded++;
                } catch (_) { /* Missing tiles are reported in the PDF caption. */ }
            }
        }));
        if (!loaded) {
            ctx.strokeStyle = '#c5ced8'; ctx.lineWidth = 1;
            for (let x = 0; x < width; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
            for (let y = 0; y < height; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
        }
        for (const route of routes) {
            for (const [color, lineWidth] of [['#ffffff', 9], [route.color || '#245dc1', 5]]) {
                ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
                ctx.setLineDash(route.indicative ? [12, 9] : []);
                route.points.forEach((point, index) => { const p = viewport.pixel(point); if (index) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
                ctx.stroke();
            }
        }
        ctx.setLineDash([]);
        markers.forEach(({ point, label, color }) => {
            const p = viewport.pixel(point);
            ctx.beginPath(); ctx.arc(p.x, p.y, 17, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke();
            ctx.fillStyle = '#ffffff'; ctx.font = 'bold 19px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, p.x, p.y);
        });
        const binary = atob(canvas.toDataURL('image/jpeg', 0.88).split(',')[1]);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        return { image: { bytes, width, height }, complete: loaded === tiles.length && loaded > 0,
            background: loaded ? (loaded === tiles.length ? 'Fond OpenStreetMap' : 'Fond OpenStreetMap partiel') : 'Fond cartographique indisponible · repérage schématique',
            attribution: loaded ? '© OpenStreetMap contributors · openstreetmap.org/copyright' : '' };
    }

    async function prepareMaps(segments, places, options = {}) {
        const fetcher = options.fetch || globalThis.fetch;
        const createCanvas = options.createCanvas || (() => document.createElement('canvas'));
        const imageLoader = options.loadTile || loadTile;
        const tileCache = new Map(), mapCache = new Map();
        const cachedTile = url => {
            if (!tileCache.has(url)) {
                // Bound memory for long journeys while reusing nearby map tiles.
                if (tileCache.size >= 160) tileCache.delete(tileCache.keys().next().value);
                tileCache.set(url, imageLoader(url));
            }
            return tileCache.get(url);
        };
        const prepared = [];
        for (const [index, segment] of segments.entries()) {
            options.onProgress?.(index + 1, segments.length);
            const from = coordinates(places[segment.fromId]), to = coordinates(places[segment.toId]);
            if (!from || !to) {
                prepared.push({ ...segment, map: { caption: 'Carte indisponible · coordonnées à compléter', complete: false } });
                continue;
            }
            const key = JSON.stringify([from, to, segment.fixed]);
            if (!mapCache.has(key)) {
                const geometry = segment.fixed ? null : await routeGeometry(from, to, fetcher);
                const map = await drawRouteMap([{ points: geometry || [from, to], indicative: !geometry }],
                    [{ point: from, label: 'A', color: '#157347' }, { point: to, label: 'B', color: '#bd3b2f' }], cachedTile, createCanvas);
                const lineLabel = geometry ? 'Tracé routier OSRM' : segment.fixed ? 'Transport réservé · liaison indicative, sans tracé routier' : 'Liaison à vol d’oiseau · itinéraire routier indisponible';
                map.caption = `${lineLabel} · ${map.background}`;
                map.complete = map.complete && Boolean(geometry || segment.fixed);
                mapCache.set(key, map);
            }
            prepared.push({ ...segment, map: mapCache.get(key) });
        }
        return prepared;
    }

    const DAY_COLORS = ['#245dc1', '#bd3b2f', '#157347', '#8c3fb0', '#a96000', '#087f8c', '#bc3770', '#505c25'];

    async function prepareStageMaps(stages, places, options = {}) {
        const fetcher = options.fetch || globalThis.fetch;
        const createCanvas = options.createCanvas || (() => document.createElement('canvas'));
        const imageLoader = options.loadTile || loadTile;
        const tileCache = new Map(), geometryCache = new Map();
        const cachedTile = url => {
            if (!tileCache.has(url)) {
                if (tileCache.size >= 160) tileCache.delete(tileCache.keys().next().value);
                tileCache.set(url, imageLoader(url));
            }
            return tileCache.get(url);
        };
        const prepared = [];
        for (const [index, stage] of stages.entries()) {
            options.onProgress?.(index + 1, stages.length);
            const dates = [...new Set(stage.segments.map(segment => segment.date || ''))];
            const routeDays = dates.map((date, i) => ({ date, color: DAY_COLORS[i % DAY_COLORS.length],
                label: date ? new Date(`${date}T12:00:00`).toLocaleDateString('fr-CH', { weekday: 'short', day: '2-digit', month: '2-digit' }) : 'Ordre de l’itinéraire' }));
            const segments = stage.segments.map(segment => ({ ...segment, color: routeDays.find(day => day.date === (segment.date || '')).color }));
            const stops = (stage.stops || []).map(stop => ({ ...stop, missingCoordinates: !coordinates(places[stop.id]) }));
            const markers = stops.filter(stop => !stop.missingCoordinates).map(stop => ({ point: coordinates(places[stop.id]), label: String(stop.number), color: stop.hotel ? '#157347' : '#24374f' }));
            const routes = [];
            let missing = 0, indicative = 0;
            for (const [segmentIndex, segment] of segments.entries()) {
                options.onProgress?.(index + 1, stages.length, segmentIndex + 1, segments.length);
                const from = coordinates(places[segment.fromId]), to = coordinates(places[segment.toId]);
                if (!from || !to) { missing++; continue; }
                const key = JSON.stringify([from, to]);
                if (!segment.fixed && !geometryCache.has(key)) geometryCache.set(key, await routeGeometry(from, to, fetcher));
                const geometry = segment.fixed ? null : geometryCache.get(key);
                if (!geometry) indicative++;
                routes.push({ points: geometry || [from, to], color: segment.color, indicative: !geometry });
            }
            const map = markers.length || routes.length
                ? await drawRouteMap(routes, markers, cachedTile, createCanvas, { width: 1200, height: 800 })
                : { complete: false, background: 'Carte indisponible · coordonnées à compléter' };
            map.caption = [map.background, 'Couleurs : jours · repères verts : hôtels',
                indicative ? `${indicative} liaison(s) indicative(s) en pointillés` : routes.length ? 'Tracés routiers OSRM' : 'Lieux de l’étape',
                missing ? `${missing} trajet(s) non cartographié(s) : GPS à compléter` : ''
            ].filter(Boolean).join(' · ');
            map.complete = map.complete && missing === 0 && indicative === 0;
            prepared.push({ ...stage, segments, stops, routeDays, map });
        }
        return prepared;
    }

    async function captureReference(stages, places, options = {}) {
        const cache = new Map(), captured = [];
        const total = stages.reduce((sum, stage) => sum + stage.segments.length, 0);
        // Stay below the server's point limit while retaining endpoints of every route.
        const perRoute = Math.max(2, Math.min(4000, Math.floor(95000 / Math.max(1, total))));
        let done = 0;
        for (const stage of stages) {
            const segments = [];
            for (const segment of stage.segments) {
                options.onProgress?.(++done, total);
                const from = coordinates(places[segment.fromId]), to = coordinates(places[segment.toId]);
                let geometry = null;
                if (from && to && !segment.fixed) {
                    const key = JSON.stringify([from, to]);
                    if (!cache.has(key)) cache.set(key, await routeGeometry(from, to, options.fetch || globalThis.fetch));
                    geometry = cache.get(key);
                }
                const points = geometry || (from && to ? [from, to] : []);
                const step = Math.max(1, Math.ceil((points.length - 1) / (perRoute - 1)));
                segments.push({ ...segment, geometry: points.filter((_, i) => i % step === 0 || i === points.length - 1), geometrySource: geometry && step === 1 ? 'road' : 'indicative' });
            }
            const stops = stage.stops.map(stop => {
                const point = coordinates(places[stop.id]);
                return { ...stop, lat: point?.[1] ?? null, lng: point?.[0] ?? null };
            });
            captured.push({ key: stage.key, id: stage.id, title: stage.title, arrivalDate: stage.arrivalDate, departureDate: stage.departureDate, segments, stops });
        }
        return captured;
    }

    return { coordinates, mapViewport, prepareMaps, prepareStageMaps, captureReference };
});
