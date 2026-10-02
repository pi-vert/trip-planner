/* =======================
   Trip Planner - index.js
   v2.4.1 – fix: remove duplicated declarations + map height slider ok
   ======================= */

let state = { places: {}, itinerary: [], startPlaceId: '', notes: '', view: null, edges: {}, planning: {}, people: 2, budgetCurrencies: ['CHF'] };
let markers = {}, map, layer, routeLayer, candidateLayer, comparisonLayer;
let LOADED = false, LAST_PROVIDER = null, ACTIVE_ID = null, PLAN = [];
let TRIPS = [], ACTIVE_TRIP = null, TRIPS_INIT_DONE = false;
let STORAGE_PATH = '/home/pi/trips';
let ROUTE_PROPOSAL = null;
let PENDING_CANDIDATE_IMPORT = null;
let BUDGET_RATES = { CHF: 1 };
let BUDGET_RATE_STATUS = 'loading';
let BUDGET_RATE_UPDATED_AT = '';
let TRIP_NOTES_SAVE_TIMER = null;
let TRIP_NOTES_DIRTY = false;
let YAML_EXPORT_BUSY = false;
const SELECTED_CANDIDATE_IDS = new Set();
let FILLING_IMAGES = false;
const IMAGE_SEARCHES = new Set();
const BUDGET_RATE_CACHE_KEY = 'trip_budget_rates_chf';
const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
const isCandidate = (id) => !state.itinerary.includes(id) && !state.places[id]?.completed;

function tripOutline() {
    return window.TripStructure?.buildOutline(state) || { assignments: {}, mainIds: state.itinerary || [], stages: [], nights: [] };
}

function tripStartPlaceId() {
    return state.itinerary.includes(state.startPlaceId) ? state.startPlaceId : (state.itinerary[0] || '');
}

function rotateIdsToStart(ids, startId) {
    const route = (ids || []).filter(id => state.places[id]);
    const startIndex = route.indexOf(startId);
    if (startIndex <= 0) return route;
    const first = state.places[route[0]], last = state.places[route.at(-1)];
    const closesLoop = route.length > 1 && (route[0] === route.at(-1) || (first && last && kmBetween(first, last) <= 0.1));
    const core = closesLoop ? (route.slice(0, -1).includes(startId) ? route.slice(0, -1) : route.slice(1)) : route;
    const coreStartIndex = core.indexOf(startId);
    if (coreStartIndex < 0) return route;
    const rotated = [...core.slice(coreStartIndex), ...core.slice(0, coreStartIndex)];
    return closesLoop ? [...rotated, rotated[0]] : rotated;
}

function tripItineraryFromStart() {
    return TripPlanning.remainingItinerary({ ...state, itinerary: rotateIdsToStart(state.itinerary, tripStartPlaceId()) });
}

function routeIdsForCurrentView() {
    if (document.body.dataset.page !== 'overview') return tripItineraryFromStart();
    const startId = tripStartPlaceId();
    const stageIds = TripStructure.chronologicalStages(tripOutline().stages).map(stage => stage.id).filter(id => !state.places[id]?.completed || id === startId);
    if (startId && !stageIds.includes(startId)) stageIds.unshift(startId);
    return rotateIdsToStart(stageIds, startId);
}

// --- URL param support (called by a "chapeau" app) ---
// Usage examples:
//   /trip_planner/?trip=default
//   /trip_planner/?trip=voyage%20japon   (match by name)
//   /trip_planner/?tripId=<id>#page=itinerary
let URL_TRIP_RAW = null;
(function initUrlTripParam() {
    try {
        const qs = new URLSearchParams(location.search || '');
        const hs = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
        const v =
            qs.get('trip') || qs.get('tripId') || qs.get('id') ||
            hs.get('trip') || hs.get('tripId') || hs.get('id');
        URL_TRIP_RAW = (v != null && String(v).trim()) ? String(v).trim() : null;
    } catch (_) { URL_TRIP_RAW = null; }
})();

function normKey(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function tripIdFromParam(trips, raw) {
    if (!raw || !Array.isArray(trips) || !trips.length) return null;

    // 1) exact id match
    const exact = trips.find(t => t && t.id === raw);
    if (exact) return exact.id;

    // 2) exact name match (case/diacritics-insensitive)
    const nk = normKey(raw);
    const byName = trips.filter(t => t && normKey(t.name) === nk);
    if (byName.length === 1) return byName[0].id;

    // 3) contains match (useful if caller passes a short label)
    const byContains = trips.filter(t =>
        t && (normKey(t.name || t.id).includes(nk) || normKey(t.id).includes(nk))
    );
    if (byContains.length === 1) return byContains[0].id;

    return null;
}

/* ---------- Toasts ---------- */
function showToast(t) {
    const wrap = $('#toastWrap'); if (!wrap || !t) return;
    const type = t.type || 'info', icon = type === 'success' ? '✅' : type === 'warn' ? '⚠️' : type === 'error' ? '⛔' : 'ℹ️';
    const el = document.createElement('div'); el.className = `toast ${type}`;
    el.innerHTML = `<div class="icon">${icon}</div><div class="txt">${t.text || ''}</div><div class="close">✖</div>`;
    wrap.appendChild(el);
    const close = () => { el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; setTimeout(() => el.remove(), 280) };
    el.querySelector('.close').onclick = close; setTimeout(close, Math.max(1200, Number(t.timeout) || 3500));
}

/* ---------- Helpers ---------- */
function kmBetween(a, b) { const R = 6371, toRad = d => d * Math.PI / 180; const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lng - a.lng); const la1 = toRad(a.lat), la2 = toRad(b.lat); const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(Math.abs(dLon) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)) }
function estimateTravel(p1, p2, speedKmh) { const km = kmBetween({ lat: p1.lat, lng: p1.lng }, { lat: p2.lat, lng: p2.lng }); const min = (km / Math.max(speedKmh, 1)) * 60; return { km: Math.round(km * 10) / 10, min: Math.round(min) } }
function fmtHours(h) { if (h == null) return '—'; const n = Number(h); return (Math.round(n * 100) / 100) + ' h' }
function fmtDurMin(m) { if (m == null) return '—'; const hh = (m / 60); return fmtHours(hh) }
function fmtMoney(n, currency = 'CHF') {
    const code = window.TripBudget?.normalizeCurrency(currency) || 'CHF';
    if (n == null || isNaN(n)) return `${code} 0.00`;
    try { return new Intl.NumberFormat('fr-CH', { style: 'currency', currency: code, currencyDisplay: 'code' }).format(Number(n) || 0) }
    catch (_) { return `${code} ${(Number(n) || 0).toFixed(2)}` }
}
function fmtChf(n) { return fmtMoney(n, 'CHF') }
function normalizeBudgetCurrencies(value) {
    const values = Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/);
    const currencies = values.map(currency => String(currency || '').trim().toUpperCase()).filter((currency, index, all) => /^[A-Z]{3}$/.test(currency) && all.indexOf(currency) === index);
    return currencies.length ? currencies : ['CHF'];
}
function tripBudgetCurrencies() { return normalizeBudgetCurrencies(state.budgetCurrencies) }
function saveTripBudgetCurrencies(value) {
    const currencies = normalizeBudgetCurrencies(value);
    const defaultCurrency = currencies[0];
    let migrated = 0;
    for (const place of Object.values(state.places || {})) {
        const current = place?.budgetCurrency ? window.TripBudget.normalizeCurrency(place.budgetCurrency) : defaultCurrency;
        if (!currencies.includes(current)) {
            place.budgetCurrency = defaultCurrency;
            migrated += 1;
        }
    }
    state.budgetCurrencies = currencies;
    send('setBudgetCurrencies', { currencies });
    renderTripCurrenciesEditor();
    if (LOADED) { renderBudgetSummary(); renderBudgetBreakdown(); updateRouteSummary(); }
    if (migrated) showToast({ type: 'info', text: `${migrated} budget${migrated > 1 ? 's ont' : ' a'} été basculé${migrated > 1 ? 's' : ''} en ${defaultCurrency}.` });
}
function renderTripCurrenciesEditor() {
    const wrap = $('#tripCurrenciesList');
    if (!wrap) return;
    const currencies = tripBudgetCurrencies();
    wrap.innerHTML = currencies.map((currency, index) => `
      <span class="trip-currency ${index === 0 ? 'is-default' : ''}">
        <strong>${currency}</strong>
        ${index === 0 ? '<small>par défaut</small>' : `<button type="button" data-currency-default="${currency}" title="Utiliser ${currency} par défaut">Par défaut</button>`}
        <button type="button" data-currency-remove="${currency}" title="Retirer ${currency}" aria-label="Retirer ${currency}">×</button>
      </span>`).join('');
    wrap.querySelectorAll('[data-currency-default]').forEach(button => {
        button.onclick = () => saveTripBudgetCurrencies([button.dataset.currencyDefault, ...currencies.filter(currency => currency !== button.dataset.currencyDefault)]);
    });
    wrap.querySelectorAll('[data-currency-remove]').forEach(button => {
        button.onclick = () => {
            if (currencies.length === 1) {
                showToast({ type: 'warn', text: 'Le voyage doit conserver au moins une devise.' });
                return;
            }
            saveTripBudgetCurrencies(currencies.filter(currency => currency !== button.dataset.currencyRemove));
        };
    });
}
function fmtTime(dt) { const pad = n => String(n).padStart(2, '0'); return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}` }
function parseTime(h) { const [H, M] = String(h || '00:00').split(':').map(Number); return { h: (H || 0), m: (M || 0) } }
function toMin(hhmm) { const [H, M] = String(hhmm || '00:00').split(':').map(Number); return (H || 0) * 60 + (M || 0) }
function dow(dt) { return dt.getDay() }
function avg(a) { if (!a || !a.length) return null; const s = a.reduce((x, y) => x + y, 0); return Math.round((s / a.length) * 10) / 10 }
function hueForScore(s) { if (s == null) return 0; const t = Math.max(0, Math.min(1, (s - 1) / 5)); return Math.round(120 * t) } // 1→rouge, 6→vert
function keyEdge(a, b) { return `${a}|${b}` } function getEdge(a, b) { return (state.edges && state.edges[keyEdge(a, b)]) || null }
function getUserName() {
    const el = $('#userName');
    const name = (el && el.value && el.value.trim()) || localStorage.getItem('trip_user') || '';
    return name || 'Anonyme';
}
function send(action, data) { uibuilder.send({ payload: { action, data, user: getUserName() } }) }

function updateTripSource() {
    const trip = TRIPS.find(t => t?.id === ACTIVE_TRIP);
    const name = trip?.name || 'Aucun voyage sélectionné';
    const file = trip?.file || (ACTIVE_TRIP ? `${STORAGE_PATH}/${ACTIVE_TRIP}.yaml` : STORAGE_PATH);
    const count = TRIPS.length;
    if ($('#tripCurrentName')) $('#tripCurrentName').textContent = name;
    if ($('#tripFilePath')) $('#tripFilePath').textContent = file;
    if ($('#tripCount')) $('#tripCount').textContent = `${count} voyage${count > 1 ? 's' : ''}`;
    if ($('#yamlStoragePath')) $('#yamlStoragePath').textContent = STORAGE_PATH;
    if ($('#tripExportYaml')) $('#tripExportYaml').disabled = YAML_EXPORT_BUSY || !trip;
}

/* ---------- Import / export des fichiers YAML ---------- */
async function yamlRequest(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || `Échec du transfert YAML (HTTP ${response.status}).`);
    }
    return response;
}

async function importYamlFiles(files) {
    if (!files.length) return;
    const button = $('#tripImportYaml');
    button.disabled = true;
    let imported = 0;
    try {
        for (const [index, file] of files.entries()) {
            button.textContent = `Import ${index + 1}/${files.length}…`;
            try {
                if (!/\.ya?ml$/i.test(file.name)) throw new Error('Choisissez un fichier .yaml ou .yml.');
                if (file.size > 1024 * 1024) throw new Error('Le fichier dépasse la limite de 1 Mo.');
                const response = await yamlRequest('./api/yaml', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: file.name, content: await file.text() })
                });
                const result = await response.json();
                imported += 1;
                showToast({ type: 'success', text: `Voyage importé : ${escapeHtml(result.filename)}` });
            } catch (error) {
                showToast({ type: 'error', text: `${escapeHtml(file.name)} : ${escapeHtml(error.message)}`, timeout: 10000 });
            }
        }
        if (imported) send('listTrips', { rescan: true });
    } finally {
        button.disabled = false;
        button.textContent = 'Importer des YAML';
        $('#tripYamlFiles').value = '';
    }
}

async function exportTripYaml() {
    const trip = TRIPS.find(item => item.id === ACTIVE_TRIP);
    if (!trip || YAML_EXPORT_BUSY) return;
    YAML_EXPORT_BUSY = true;
    const button = $('#tripExportYaml');
    button.textContent = 'Export…';
    updateTripSource();
    try {
        const response = await yamlRequest(`./api/yaml?id=${encodeURIComponent(trip.id)}`);
        const blob = await response.blob();
        const disposition = response.headers.get('Content-Disposition') || '';
        const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
        const filename = encodedName ? decodeURIComponent(encodedName) : 'voyage.yaml';
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        showToast({ type: 'success', text: `Export YAML : ${escapeHtml(filename)}` });
    } catch (error) {
        showToast({ type: 'error', text: escapeHtml(error.message), timeout: 8000 });
    } finally {
        YAML_EXPORT_BUSY = false;
        button.textContent = 'Exporter le YAML';
        updateTripSource();
    }
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));
}

/* ---------- Trips (multi-config) ---------- */
function setTripSelect(trips, activeTripId) {
    TRIPS = Array.isArray(trips) ? trips : [];
    const sel = $('#tripSelect');

    // pick priority: current UI selection > localStorage > activeTripId > first item
    const current = sel && sel.value ? sel.value : null;
    const stored = localStorage.getItem('trip_active');
    let pick = null;

    const urlPick = tripIdFromParam(TRIPS, URL_TRIP_RAW);
    if (urlPick) pick = urlPick;

    if (!pick && current && TRIPS.some(t => t && t.id === current)) pick = current;
    else if (!pick && stored && TRIPS.some(t => t && t.id === stored)) pick = stored;
    else if (!pick && activeTripId && TRIPS.some(t => t && t.id === activeTripId)) pick = activeTripId;
    else if (!pick && TRIPS[0] && TRIPS[0].id) pick = TRIPS[0].id;
    else if (stored && TRIPS.some(t => t && t.id === stored)) pick = stored;
    else if (activeTripId && TRIPS.some(t => t && t.id === activeTripId)) pick = activeTripId;
    else if (TRIPS[0] && TRIPS[0].id) pick = TRIPS[0].id;

    if (sel) {
        sel.innerHTML = '';
        for (const t of TRIPS) {
            if (!t || !t.id) continue;
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.name || t.id;
            opt.dataset.file = t.file || '';
            sel.appendChild(opt);
        }
        if (pick) sel.value = pick;
    }

    if (pick) {
        ACTIVE_TRIP = pick;
        localStorage.setItem('trip_active', pick);
    }
    updateTripSource();
}

function setActiveTripUi(activeTripId) {
    if (!activeTripId) return;
    if (ACTIVE_TRIP && ACTIVE_TRIP !== activeTripId) {
        clearTimeout(TRIP_NOTES_SAVE_TIMER);
        TRIP_NOTES_DIRTY = false;
        $('#tripNotes')?.blur();
    }
    ACTIVE_TRIP = activeTripId;
    localStorage.setItem('trip_active', activeTripId);
    const sel = $('#tripSelect');
    if (sel && sel.value !== activeTripId) sel.value = activeTripId;
    updateTripSource();
}

function candidatePlaceCopy(place) {
    return {
        name: String(place?.name || 'Lieu'),
        lat: Number(place?.lat) || 0,
        lng: Number(place?.lng) || 0,
        durationH: Number(place?.durationH) || 0,
        budget: Number(place?.budget) || 0,
        budgetFree: place?.budgetFree === true,
        budgetCurrency: place?.budgetCurrency ? window.TripBudget.normalizeCurrency(place.budgetCurrency) : tripBudgetCurrencies()[0],
        budgetScope: window.TripBudget?.normalizeScope(place?.budgetScope) || 'individual',
        desc: String(place?.desc || ''),
        closedDays: [...(place?.closedDays || [])],
        ratings: { ...(place?.ratings || {}) },
        tags: [...(place?.tags || [])],
        image: String(place?.image || ''),
        slot: String(place?.slot || ''),
        optionGroup: String(place?.optionGroup || ''),
        url: String(place?.url || '')
    };
}

function beginCandidateTripCreation() {
    const ids = [...SELECTED_CANDIDATE_IDS].filter(id => isCandidate(id) && state.places[id]);
    if (!ids.length) { showToast({ type: 'warn', text: 'Sélectionnez au moins un lieu optionnel.' }); return; }
    const name = prompt('Nom du nouveau voyage ?');
    if (!name || !name.trim()) return;
    PENDING_CANDIDATE_IMPORT = {
        sourceTripId: ACTIVE_TRIP,
        targetTripId: '',
        places: ids.map(id => candidatePlaceCopy(state.places[id])),
        index: 0,
        phase: 'creating',
        knownIds: []
    };
    send('createTrip', { name: name.trim() });
    showToast({ type: 'info', text: `Création du voyage avec ${ids.length} lieu${ids.length > 1 ? 'x' : ''}...` });
}

function importNextCandidatePlace() {
    const pending = PENDING_CANDIDATE_IMPORT;
    if (!pending || pending.index >= pending.places.length) return;
    const place = pending.places[pending.index];
    pending.knownIds = Object.keys(state.places);
    pending.phase = 'adding';
    send('addPlace', {
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        durationH: place.durationH,
        budget: place.budget,
        budgetFree: place.budgetFree,
        budgetCurrency: place.budgetCurrency,
        budgetScope: place.budgetScope,
        desc: place.desc,
        closedDays: place.closedDays,
        tags: place.tags,
        image: place.image,
        optionGroup: place.optionGroup,
        url: place.url
    });
}

function continueCandidateImport() {
    const pending = PENDING_CANDIDATE_IMPORT;
    if (!pending || !pending.targetTripId || ACTIVE_TRIP !== pending.targetTripId) return;
    if (pending.phase === 'waiting-state') {
        importNextCandidatePlace();
        return;
    }
    if (pending.phase === 'adding') {
        const knownIds = new Set(pending.knownIds);
        const addedId = Object.keys(state.places).find(id => !knownIds.has(id));
        if (!addedId) return;
        const place = pending.places[pending.index];
        pending.phase = 'updating';
        send('updatePlace', {
            id: addedId,
            patch: {
                ...place,
                stageType: '',
                parentStageId: '',
                arrivalDate: '',
                arrivalTime: '',
                departureDate: '',
                departureTime: '',
                relativePeriod: ''
            }
        });
        return;
    }
    if (pending.phase === 'updating') {
        pending.index += 1;
        if (pending.index < pending.places.length) {
            importNextCandidatePlace();
            return;
        }
        const count = pending.places.length;
        PENDING_CANDIDATE_IMPORT = null;
        SELECTED_CANDIDATE_IDS.clear();
        showToast({ type: 'success', text: `Nouveau voyage créé avec ${count} lieu${count > 1 ? 'x' : ''}.` });
    }
}

function autoLoadDefaultTripIfNeeded(msg) {
    if (TRIPS_INIT_DONE) return;
    if (LOADED) { TRIPS_INIT_DONE = true; return; } // state already loaded

    // Note: if Node-RED also triggers a load (via a Trigger Load node), this can duplicate the load once — harmless.

    const sel = $('#tripSelect');
    let pick = tripIdFromParam(TRIPS, URL_TRIP_RAW) || ((sel && sel.value) ? sel.value : ACTIVE_TRIP);
    
    if (!pick && msg?.payload?.activeTripId) pick = msg.payload.activeTripId;
    if (!pick && TRIPS[0] && TRIPS[0].id) pick = TRIPS[0].id;
    if (!pick) return;

    TRIPS_INIT_DONE = true;
    ACTIVE_TRIP = pick;
    localStorage.setItem('trip_active', pick);

    // sync backend + load YAML for selected trip
    send('selectTrip', { id: pick });
    send('loadYaml');
}

function readCachedBudgetRates() {
    try {
        const cached = JSON.parse(localStorage.getItem(BUDGET_RATE_CACHE_KEY) || 'null');
        if (!cached?.rates || typeof cached.rates !== 'object') return;
        BUDGET_RATES = { ...cached.rates, CHF: 1 };
        BUDGET_RATE_UPDATED_AT = String(cached.updatedAt || '');
        BUDGET_RATE_STATUS = 'cached';
    } catch (_) { /* cache absent ou invalide */ }
}

async function loadBudgetRates() {
    readCachedBudgetRates();
    if (LOADED) { renderBudgetSummary(); renderBudgetBreakdown(); updateRouteSummary(); }
    try {
        const response = await fetch('https://open.er-api.com/v6/latest/CHF', { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (payload?.result !== 'success' || !payload.rates) throw new Error('Réponse de taux invalide');
        BUDGET_RATES = { ...payload.rates, CHF: 1 };
        BUDGET_RATE_UPDATED_AT = String(payload.time_last_update_utc || new Date().toISOString());
        BUDGET_RATE_STATUS = 'fresh';
        localStorage.setItem(BUDGET_RATE_CACHE_KEY, JSON.stringify({ rates: BUDGET_RATES, updatedAt: BUDGET_RATE_UPDATED_AT }));
    } catch (_) {
        BUDGET_RATE_STATUS = Object.keys(BUDGET_RATES).length > 1 ? 'cached' : 'error';
    }
    if (LOADED) { renderBudgetSummary(); renderBudgetBreakdown(); updateRouteSummary(); }
}

function showAlert(msg) { const a = $('#mapAlert'); if (a) { a.style.display = 'block'; a.textContent = msg } }

/* ---------- Icons / Pins ---------- */
function typeFromFirstTag(tags) {
    if (!tags || !tags.length) return { glyph: '•' }
    const t = String(tags[0]).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    if (/baignade|plage|piscine|lac|mer/.test(t)) return { glyph: '🏊' }
    if (/randonnee|rando|marche|trail|hike/.test(t)) return { glyph: '🥾' }
    if (/restaurant|resto|bar|cafe|café|food/.test(t)) return { glyph: '🍽️' }
    if (/hebergement|hébergement|hotel|hôtel|camping|gite|gîte|bnb/.test(t)) return { glyph: '🛏️' }
    if (/culture|musee|musée|monument|expo/.test(t)) return { glyph: '🏛️' }
    return { glyph: '•' }
}
function markerColorForPlace(p) { const ratings = p.ratings ? Object.values(p.ratings).map(Number).filter(n => !Number.isNaN(n)) : []; const a = avg(ratings); const hue = hueForScore(a); return `hsl(${hue} 85% 55%)` }
function iconForPlace(p, asCandidate = false) {
    const color = markerColorForPlace(p), { glyph } = typeFromFirstTag(p.tags || []);
    const cls = asCandidate ? 'pin cand' : 'pin';
    return L.divIcon({ className: 'div-pin', html: `<div class="${cls}" style="--pin-color:${color}"><div class="glyph">${glyph}</div></div>`, iconSize: [36, 46], iconAnchor: [18, 44], popupAnchor: [0, -34] })
}

/* ---------- Header/Map layout ---------- */
function setHeaderHeight() {
    const hdr = $('#appHeader'); if (!hdr) return;
    const h = hdr.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--hdrH', h + 'px');
}
function fixMapHeight() {
    const mapEl = $('#map'); if (!mapEl) return;
    mapEl.style.height = '';
}
function applyMapLayout() {
    const cont = $('#mapContainer'), anchor = $('#mapAnchor');
    if (!cont || !anchor) return;
    anchor.after(cont);
    document.body.classList.remove('map-in-header');
    fixMapHeight();
    if (map) { setTimeout(() => map.invalidateSize(), 30); setTimeout(() => map.invalidateSize(), 250) }
    setTimeout(setHeaderHeight, 50);
}


/* ---------- Tabs (pages) ---------- */
function initTabs() {
    const nav = document.querySelector('#appTabs');
    if (!nav) return;

    const allowed = new Set(['overview', 'segments', 'recordings', 'add', 'itinerary', 'planning', 'budget', 'weather', 'compare', 'candidates', 'map', 'settings']);

    function setPage(page, { push = true } = {}) {
        if (!allowed.has(page)) page = 'overview';
        const pageChanged = document.body.dataset.page !== page;
        document.body.dataset.page = page;
        localStorage.setItem('ui_page', page);

        nav.querySelectorAll('.tab[data-page]').forEach(b => b.classList.toggle('on', b.dataset.page === page));
        syncExperienceNavigation(page);
        $('#moreNavigation').open = false;

        if (page === 'recordings') {
            clearComparisonMap();
            loadRecordings();
            renderRecordingPage();
        } else if (page === 'compare') {
            loadComparisonPage(pageChanged);
            renderComparisonMap();
        } else if (page === 'weather') {
            loadTripWeather();
            renderWeatherPage();
        } else if (LOADED) {
            clearComparisonMap();
            renderTripOutline();
            drawMarkers();
            drawRouteRealThrottled();
            updateRouteSummary();
        }

        // header height depends on wrapping
        if (typeof setHeaderHeight === 'function') setHeaderHeight();

        if (push) {
            const sp = new URLSearchParams();
            sp.set('page', page);
            location.hash = sp.toString();
        }

        setTimeout(() => map?.invalidateSize?.(), 80);
        setTimeout(() => map?.invalidateSize?.(), 220);
    }

    nav.querySelectorAll('.tab[data-page]').forEach(b => {
        b.addEventListener('click', () => setPage(b.dataset.page));
    });
    document.addEventListener('click', event => {
        const button = event.target.closest('[data-open-page]');
        if (button) setPage(button.dataset.openPage);
    });
    navigateTripPage = setPage;
    initExperienceUi();

    window.addEventListener('hashchange', () => {
        const sp = new URLSearchParams(location.hash.replace('#', ''));
        const p = sp.get('page');
        if (p) setPage(p, { push: false });
    });

    // init
    const sp = new URLSearchParams(location.hash.replace('#', ''));
    const fromHash = sp.get('page');
    const fromStore = localStorage.getItem('ui_page');
    setPage(fromHash || fromStore || 'overview', { push: false });
}

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', () => {
    setHeaderHeight(); window.addEventListener('resize', () => { setHeaderHeight(); if (map) map.invalidateSize() });

    // --- Trips selector (optional UI element: <select id="tripSelect">)
    const tripSel = $('#tripSelect');
    if (tripSel) {
        tripSel.addEventListener('change', () => {
            saveTripNotes();
            const id = tripSel.value;
            if (!id) return;
            ACTIVE_TRIP = id;
            prepareTripWeather(id);
            localStorage.setItem('trip_active', id);
            updateTripSource();
            send('selectTrip', { id });
            send('loadYaml');
        });

        // --- Trip buttons (NEW / RENAME / DELETE)
        const btnNew = document.getElementById('tripNew');
        if (btnNew) {
            btnNew.addEventListener('click', () => {
                const name = prompt('Nom du nouveau voyage ?');
                if (!name || !name.trim()) return;
                send('createTrip', { name: name.trim() });
                // (optionnel) si tu veux forcer un refresh côté UI:
                // setTimeout(() => send('listTrips'), 300);
            });
        }

        const btnRename = document.getElementById('tripRename');
        if (btnRename) {
            btnRename.addEventListener('click', () => {
                const sel = document.getElementById('tripSelect');
                const id = sel?.value;
                if (!id) return;
                const currentName = sel.options[sel.selectedIndex]?.textContent || '';
                const name = prompt('Nouveau nom ?', currentName);
                if (!name || !name.trim()) return;
                send('renameTrip', { id, name: name.trim() });
                // setTimeout(() => send('listTrips'), 300);
            });
        }

        const btnDelete = document.getElementById('tripDelete');
        if (btnDelete) {
            btnDelete.addEventListener('click', () => {
                const sel = document.getElementById('tripSelect');
                const id = sel?.value;
                if (!id) return;
                if (id === 'default') {
                    alert("Impossible de supprimer le voyage principal (default).");
                    return;
                }
                if (!confirm('Supprimer ce voyage ?')) return;
                send('deleteTrip', { id });
                // setTimeout(() => send('listTrips'), 300);
            });
        }
    }

    const candidateSelectAll = $('#candidateSelectAll');
    if (candidateSelectAll) candidateSelectAll.onclick = toggleAllCandidateSelections;
    const candidateCreateTrip = $('#candidateCreateTrip');
    if (candidateCreateTrip) candidateCreateTrip.onclick = beginCandidateTripCreation;

    if (!window.L) { showAlert('Leaflet non chargé (vendor/leaflet manquant).') }
    else {
        map = L.map('map', { preferCanvas: true }).setView([46.2, 6.15], 6);
        const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' });
        tiles.on('tileerror', () => showAlert('Impossible de charger les tuiles OSM.')); tiles.addTo(map);
        routeLayer = L.layerGroup().addTo(map);
        layer = L.layerGroup().addTo(map);
        candidateLayer = L.layerGroup().addTo(map);
        comparisonLayer = L.layerGroup().addTo(map);
        map.on('click', e => openDialogAt(e.latlng));

        // --- fermeture de la modale "Ajouter un lieu (clic carte)" ---
        const dlg = document.getElementById('dlg');
        if (dlg) {
            // clic sur l’arrière-plan = fermer
            dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.classList.remove('open'); });
            // Échap = fermer
            window.addEventListener('keydown', (e) => { if (e.key === 'Escape') dlg.classList.remove('open'); });
        }

        setTimeout(() => map.invalidateSize(), 200); window.addEventListener('resize', () => map && map.invalidateSize());
    }

    applyMapLayout();

    const saved = localStorage.getItem('trip_user'); if (saved && $('#userName')) $('#userName').value = saved;
    if ($('#saveName')) $('#saveName').onclick = () => localStorage.setItem('trip_user', $('#userName').value.trim() || 'Anonyme');
    if ($('#tripImportYaml')) $('#tripImportYaml').onclick = () => $('#tripYamlFiles').click();
    if ($('#tripYamlFiles')) $('#tripYamlFiles').onchange = event => importYamlFiles(Array.from(event.target.files));
    if ($('#tripExportYaml')) $('#tripExportYaml').onclick = exportTripYaml;
    if ($('#tripRefresh')) $('#tripRefresh').onclick = () => {
        $('#tripRefresh').disabled = true;
        $('#tripRefresh').textContent = 'Analyse...';
        send('listTrips', { rescan: true, forceSave: true });
        setTimeout(() => {
            $('#tripRefresh').disabled = false;
            $('#tripRefresh').textContent = 'Actualiser les YAML';
        }, 1200);
    };

    if ($('#btnCenterLast')) $('#btnCenterLast').onclick = () => { const ids = state.itinerary; if (ids.length) { const p = state.places[ids[ids.length - 1]]; if (p && map) map.setView([p.lat, p.lng], map.getZoom()) } }
    if ($('#btnSaveStartup')) $('#btnSaveStartup').onclick = saveStartupCenterFromMap;
    if ($('#btnFullMap')) $('#btnFullMap').onclick = () => document.querySelector('.tab[data-page="map"]')?.click();

    const showCand = $('#showCandidates'); if (showCand) { showCand.onchange = () => { if (candidateLayer) candidateLayer.clearLayers(); if (showCand.checked) drawCandidateMarkers() } }

    initSearchAndForms();
    initWeatherUi();
    initRecordingsUi();
    initComparisonUi();
    initTabs();

    const tripNotes = $('#tripNotes');
    if (tripNotes) tripNotes.addEventListener('input', () => {
        state.notes = tripNotes.value;
        TRIP_NOTES_DIRTY = true;
        if ($('#tripNotesStatus')) $('#tripNotesStatus').textContent = 'Enregistrement...';
        clearTimeout(TRIP_NOTES_SAVE_TIMER);
        TRIP_NOTES_SAVE_TIMER = setTimeout(saveTripNotes, 600);
    });
    if (tripNotes) tripNotes.addEventListener('change', saveTripNotes);

    let planningSaveTimer = null;
    ['startDate', 'endDate', 'startTime', 'dayStart', 'dayEnd', 'speed', 'breakfastAt', 'breakfastDur', 'lunchAt', 'lunchDur', 'dinnerAt', 'dinnerDur'].forEach(id => {
        const control = $('#' + id);
        if (!control) return;
        control.addEventListener('change', () => {
            if (typeof planningFromControls !== 'function') return;
            state.planning = planningFromControls();
            renderTripOutline();
            clearTimeout(planningSaveTimer);
            planningSaveTimer = setTimeout(() => send('setPlanning', state.planning), 250);
        });
    });

    // Synchronisation personnes (Budget ↔ Planning)
    const peopleEl = $('#people');
    const budgetPeopleEl = $('#budgetPeople');
    const tripCurrencyNewEl = $('#tripCurrencyNew');
    if (peopleEl && budgetPeopleEl) {
        let peopleSaveTimer = null;
        const updatePeople = value => {
            const people = Math.max(1, parseInt(value || '1', 10));
            state.people = people;
            peopleEl.value = people;
            budgetPeopleEl.value = people;
            if (LOADED) { renderBudgetSummary(); renderBudgetBreakdown(); updateRouteSummary(); }
            clearTimeout(peopleSaveTimer);
            peopleSaveTimer = setTimeout(() => send('setPeople', { people }), 250);
        };

        peopleEl.addEventListener('input', event => updatePeople(event.target.value));
        budgetPeopleEl.addEventListener('input', event => updatePeople(event.target.value));
    } else if (peopleEl) {
        // fallback: au moins recalcul du budget si l’entrée existe
        peopleEl.addEventListener('input', () => { if (LOADED) { renderBudgetSummary(); renderBudgetBreakdown(); } });
    }

    const addTripCurrency = () => {
        if (!tripCurrencyNewEl) return;
        const currency = tripCurrencyNewEl.value.trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) {
            showToast({ type: 'warn', text: 'Indiquez un code de devise à trois lettres, par exemple EUR.' });
            return;
        }
        const currencies = tripBudgetCurrencies();
        if (!currencies.includes(currency)) saveTripBudgetCurrencies([...currencies, currency]);
        tripCurrencyNewEl.value = '';
        tripCurrencyNewEl.focus();
    };
    if ($('#tripCurrencyAdd')) $('#tripCurrencyAdd').onclick = addTripCurrency;
    if (tripCurrencyNewEl) {
        tripCurrencyNewEl.onkeydown = event => {
            if (event.key === 'Enter') { event.preventDefault(); addTripCurrency(); }
        };
    }
    renderTripCurrenciesEditor();


    uibuilder.start();
    uibuilder.onChange('msg', (msg) => {
        if (msg?.payload?.storagePath) {
            STORAGE_PATH = msg.payload.storagePath;
            updateTripSource();
        }
        // --- trips list / active trip coming from Trip Manager
        if (msg?.payload?.trips) {
            setTripSelect(msg.payload.trips, msg.payload.activeTripId);
            autoLoadDefaultTripIfNeeded(msg);
        }
        if (msg?.payload?.activeTripId) {
            setActiveTripUi(msg.payload.activeTripId);
            prepareTripWeather(msg.payload.activeTripId);
            if (PENDING_CANDIDATE_IMPORT?.phase === 'creating' && msg.payload.activeTripId !== PENDING_CANDIDATE_IMPORT.sourceTripId) {
                PENDING_CANDIDATE_IMPORT.targetTripId = msg.payload.activeTripId;
                PENDING_CANDIDATE_IMPORT.phase = 'waiting-state';
            }
        }

        // --- existing payloads
        if (msg?.payload?.state) {
            state = msg.payload.state;
            state.startPlaceId = state.itinerary?.includes(state.startPlaceId) ? state.startPlaceId : (state.itinerary?.[0] || '');
            state.planning = window.TripPlanning?.normalizePlanning(state.planning) || {};
            state.people = Math.max(1, parseInt(state.people || '2', 10));
            state.budgetCurrencies = normalizeBudgetCurrencies(state.budgetCurrencies);
            if (peopleEl) peopleEl.value = state.people;
            if (budgetPeopleEl) budgetPeopleEl.value = state.people;
            renderTripCurrenciesEditor();
            LOADED = true;
            renderAll(); applyStartupView(); updateTripSource(); continueCandidateImport();
            loadTripWeather();
        }
        if (msg?.payload?.toast) { showToast(msg.payload.toast) }
        if (msg?.payload?.toastText) { showToast({ text: String(msg.payload.toastText) }) }
        if (msg?.payload?.toastSuccess) { showToast({ text: String(msg.payload.toastSuccess), type: 'success' }) }
        if (msg?.payload?.toastError) { showToast({ text: String(msg.payload.toastError), type: 'error' }) }
    });

    // Ask Node-RED for the trips list first (Trip Manager will decide which file is active)
    setTimeout(() => send('listTrips',{ forceSave: true }), 250);

    // Fallback (if Trip Manager isn't wired yet): keep previous behaviour
    setTimeout(() => { if (!TRIPS_INIT_DONE && !LOADED) send('loadYaml'); }, 2000);
});

/* ---------- Splitter ---------- */
(function initSplitter() {
    const layout = $('.layout'), left = $('.col-left'), right = $('.col-right'), split = $('#splitter');
    if (!layout || !left || !right || !split) return;
    let dragging = false, startX = 0, leftStart = 0, layoutW = 0;
    split.addEventListener('mousedown', e => { dragging = true; startX = e.clientX; layoutW = layout.getBoundingClientRect().width; leftStart = left.getBoundingClientRect().width; document.body.style.userSelect = 'none' });
    window.addEventListener('mousemove', e => { if (!dragging) return; const dx = e.clientX - startX; let leftNew = leftStart + dx; const min = layoutW * 0.3, max = layoutW * 0.5; leftNew = Math.min(max, Math.max(min, leftNew)); const rightNew = layoutW - leftNew; layout.style.setProperty('--left', leftNew + 'px'); layout.style.setProperty('--right', rightNew + 'px'); split.style.left = leftNew + 'px'; if (map) map.invalidateSize() });
    window.addEventListener('mouseup', () => { if (dragging) { dragging = false; document.body.style.userSelect = ''; if (map) setTimeout(() => map.invalidateSize(), 60) } });
})();

/* ---------- Search (Nominatim) ---------- */
let searchAbort = null, previewMarker = null, searchTimer = null, ADD_IMAGE_CONTEXT = null, ADD_AUTO_IMAGE_URL = '', ADD_IMAGE_SEARCH_TOKEN = 0;
function nominatimUrl(q) { const base = 'https://nominatim.openstreetmap.org/search'; const params = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', namedetails: '1', extratags: '1', polygon_geojson: '0', limit: '5', 'accept-language': 'fr', q }); return `${base}?${params}` }
async function doSearch(q) { if (!q || q.trim().length < 3) { $('#searchResults').innerHTML = ''; return } try { if (searchAbort) searchAbort.abort(); searchAbort = new AbortController(); const res = await fetch(nominatimUrl(q), { signal: searchAbort.signal, headers: { 'Accept': 'application/json' } }); const data = await res.json(); renderSearchResults(Array.isArray(data) ? data : []) } catch (e) { if (e.name !== 'AbortError') { console.warn('search error', e); $('#searchResults').innerHTML = '<div class="muted">Erreur de recherche</div>' } } }
function onSearchInput() { clearTimeout(searchTimer); searchTimer = setTimeout(() => doSearch($('#searchQ').value.trim()), 350) }
function setAddImagePreview(url) {
    const preview = $('#pImagePreview');
    if (!preview) return;
    preview.src = url || '';
    preview.hidden = !url;
}
async function fillAddFormImage(force = false) {
    const input = $('#pImgUrl'), button = $('#btnFindImage'), status = $('#imageSearchStatus');
    const context = ADD_IMAGE_CONTEXT || { name: $('#pName')?.value.trim(), lat: Number($('#pLat')?.value), lng: Number($('#pLng')?.value) };
    if (!context.name) { showToast({ type: 'warn', text: 'Choisissez ou nommez d’abord un lieu.' }); return }
    if (!force && input.value && input.value !== ADD_AUTO_IMAGE_URL) return;
    const token = ++ADD_IMAGE_SEARCH_TOKEN;
    button.disabled = true;
    status.textContent = 'Recherche Wikimedia...';
    try {
        const image = await window.TripWikimediaImages.findImage(context);
        if (token !== ADD_IMAGE_SEARCH_TOKEN) return;
        if (!image) { status.textContent = 'Aucune image trouvée'; return }
        input.value = image;
        ADD_AUTO_IMAGE_URL = image;
        setAddImagePreview(image);
        status.textContent = 'Image Wikimedia trouvée';
    } catch (error) {
        if (token !== ADD_IMAGE_SEARCH_TOKEN) return;
        console.warn('Wikimedia image search error', error);
        status.textContent = 'Recherche d’image indisponible';
    } finally {
        if (token === ADD_IMAGE_SEARCH_TOKEN) button.disabled = false;
    }
}
function renderSearchResults(list) {
    const wrap = $('#searchResults'); if (!wrap) return;
    if (!list.length) { wrap.innerHTML = '<div class="muted">Aucun résultat</div>'; return }
    wrap.innerHTML = list.map((r, i) => { const title = r.namedetails?.name || r.display_name?.split(',')[0] || r.name || 'Résultat'; const addr = r.display_name || ''; return `<div class="item" data-i="${i}"><div class="title">${title}</div><div class="addr">${addr}</div></div>` }).join('');
    wrap.querySelectorAll('.item').forEach(el => el.onclick = () => {
        const r = list[+el.dataset.i]; if (!r) return;
        const lat = parseFloat(r.lat), lng = parseFloat(r.lon), title = r.namedetails?.name || r.display_name?.split(',')[0] || r.name || 'Lieu';
        $('#pName').value = title; $('#pLat').value = lat; $('#pLng').value = lng;
        ADD_IMAGE_CONTEXT = { name: title, country: r.address?.country || '', lat, lng, wikidataId: r.extratags?.wikidata || '' };
        if (!$('#pImgUrl').value || $('#pImgUrl').value === ADD_AUTO_IMAGE_URL) {
            $('#pImgUrl').value = '';
            ADD_AUTO_IMAGE_URL = '';
            setAddImagePreview('');
            fillAddFormImage();
        }
        if (map) { if (previewMarker) { map.removeLayer(previewMarker); previewMarker = null } previewMarker = L.marker([lat, lng], { icon: L.divIcon({ className: 'div-pin', html: `<div class="pin" style="--pin-color:#999"><div class="glyph">⭐</div></div>`, iconSize: [36, 46], iconAnchor: [18, 44], popupAnchor: [0, -34] }) }).addTo(layer).bindPopup(`<b>${title}</b><br><i>Prévisualisation</i>`).openPopup(); const keep = $('#preserveZoom')?.checked; map.setView([lat, lng], keep ? map.getZoom() : map.getZoom()) }
    })
}

/* ---------- Views ---------- */
function applyStartupView() { if (map && state?.view?.center) { const c = state.view.center; map.setView([c.lat, c.lng], c.zoom || 10) } else if (map && state?.itinerary?.length > 1) { const latlngs = state.itinerary.map(id => state.places[id]).filter(Boolean).map(p => [p.lat, p.lng]); if (latlngs.length > 1) { map.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30] }) } } }
function saveStartupCenterFromMap() { if (!map) return; const c = map.getCenter(), z = map.getZoom(); send('setView', { center: { lat: c.lat, lng: c.lng, zoom: z } }) }

/* ---------- Render pipeline ---------- */
function renderAll() { applyVisitProgress(); loadVisitProgress(); renderTagFilters(); renderTripOutline(); renderTripNotes(); renderPlaces(); renderCandidates(); attachDnD(); if (document.body.dataset.page === 'compare') renderComparisonMap(); else if (document.body.dataset.page !== 'recordings') { drawMarkers(); drawRouteRealThrottled(); } renderSegments(); renderBudgetSummary(); renderBudgetBreakdown(); updateRouteSummary(); renderPlanningControls(); renderFixedDates(); renderPlanning(); renderWeatherPage(); renderRecordingPage(); renderExperienceGuide() }
function saveTripNotes() {
    clearTimeout(TRIP_NOTES_SAVE_TIMER);
    if (!TRIP_NOTES_DIRTY) return;
    TRIP_NOTES_DIRTY = false;
    send('setTripNotes', { notes: state.notes });
    if ($('#tripNotesStatus')) $('#tripNotesStatus').textContent = 'Enregistré';
}
function renderTripNotes() {
    const input = $('#tripNotes');
    if (input && document.activeElement !== input) input.value = String(state.notes || '');
}
function renderTagFilters() { const counts = {}; for (const id of state.itinerary) { const p = state.places[id]; if (!p || !Array.isArray(p.tags)) continue; for (const t of p.tags) { counts[t] = (counts[t] || 0) + 1 } } const wrap = $('#tagFilters'); if (!wrap) return; wrap.innerHTML = Object.keys(counts).sort().map(t => `<span class="tag" data-t="${t}">${t} <span class="x">×</span> <span class="muted">(${counts[t]})</span></span>`).join(''); wrap.querySelectorAll('.tag').forEach(el => { el.onclick = () => { el.classList.toggle('on'); renderPlaces(); attachDnD() }; el.querySelector('.x').onclick = (e) => { e.stopPropagation(); el.classList.remove('on'); renderPlaces(); attachDnD() } }) }
function activeTags() { return $$('#tagFilters .tag.on').map(el => el.dataset.t) }

function drawMarkers() {
    if (!layer) return; layer.clearLayers(); if (candidateLayer) candidateLayer.clearLayers(); markers = {};
    for (const id of routeIdsForCurrentView()) {
        const p = state.places[id]; if (!p) continue;
        const tags = (p.tags && p.tags.length) ? `<br><span class='muted'>Tags:</span> ${p.tags.join(', ')}` : '';
        const url = p.url ? `<br><a href="${p.url}" target="_blank">🔗 Plus d'infos</a>` : '';
        const mk = L.marker([p.lat, p.lng], { icon: iconForPlace(p, false) }).addTo(layer)
            .bindPopup(`<b>${p.name}</b><br>${p.desc ? p.desc.replace(/[`]/g, '') + '<br>' : ''}${p.image ? '<img src="' + p.image + '" style="max-width:200px;max-height:120px;border-radius:6px;border:1px solid #334"/><br>' : ''}Durée: ${fmtHours(Number(p.durationH) > 0 ? p.durationH : 2)} | Budget: ${p.budgetFree ? 'Gratuit' : fmtMoney(p.budget, p.budgetCurrency)}${tags}${url}`);
        mk.on('click', () => focusPlace(id, { pan: true, openPopup: true }));
        markers[id] = mk;
    }
    const showCand = $('#showCandidates'); if (document.body.dataset.page !== 'overview' && showCand && showCand.checked) drawCandidateMarkers();
}
function drawCandidateMarkers() {
    if (!candidateLayer) return;
    candidateLayer.clearLayers();
    Object.keys(state.places).filter(isCandidate).forEach(id => {
        const p = state.places[id]; if (!p) return;
        const mk = L.marker([p.lat, p.lng], { icon: iconForPlace(p, true) }).addTo(candidateLayer)
            .bindPopup(`<b>${p.name}</b><br><i>Lieu optionnel (hors itinéraire)</i>`)
            .on('click', () => focusPlace(id, { pan: true, openPopup: true }));
        markers[id] = mk;
    });
}

/* ---------- Liste Itinéraire & DnD ---------- */
function formatOutlineDate(value, options = { day: 'numeric', month: 'short' }) {
    if (!value) return 'Date à préciser';
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? 'Date à préciser' : new Intl.DateTimeFormat('fr-FR', options).format(date);
}

function updateOutlineStage(id, patch) {
    if (!state.places[id]) return;
    Object.assign(state.places[id], patch);
    renderTripOutline();
    send('updatePlace', { id, patch });
}

function setTripStartPlace(id) {
    if (!state.itinerary.includes(id) || !state.places[id]) return;
    state.startPlaceId = id;
    renderAll();
    send('reorder', { itinerary: state.itinerary, startPlaceId: id });
    showToast({ type: 'success', text: `${state.places[id].name} est maintenant le point de départ.` });
}

function saveOutlinePlanning(planning) {
    state.planning = planning;
    renderTripOutline();
    send('setPlanning', planning);
}

function addMinutesToClock(value, minutes) {
    const [hours, mins] = String(value || '12:00').split(':').map(Number);
    const total = ((hours || 0) * 60 + (mins || 0) + minutes) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function outlineConstraintPlaceIds(item) {
    const placeIds = Array.isArray(item?.placeIds) && item.placeIds.length ? item.placeIds : [item?.placeId].filter(Boolean);
    return placeIds.filter(id => state.places[id]);
}

function outlineConstraintPlaceId(item, stageId = '') {
    const placeIds = outlineConstraintPlaceIds(item);
    if (!stageId) return placeIds[0] || '';
    const outline = tripOutline();
    return placeIds.find(id => {
        const assignment = outline.assignments[id];
        return id === stageId || (assignment?.stageType === 'detail' && assignment.parentStageId === stageId);
    }) || placeIds[0] || '';
}

function outlineConstraintStageId(item, outline = tripOutline()) {
    const explicitStageId = String(item?.stageId || '');
    if (explicitStageId && outline.stages.some(stage => stage.id === explicitStageId)) return explicitStageId;
    const placeId = outlineConstraintPlaceId(item);
    const assignment = outline.assignments[placeId];
    return assignment?.stageType === 'detail' ? assignment.parentStageId : placeId;
}

function outlineSectionTag(section) {
    return section === 'lodging' ? 'hébergement' : section === 'lunch' || section === 'dinner' ? 'restaurant' : '';
}

function outlineActivitySlot(section) {
    return ['morning', 'afternoon', 'evening'].includes(section) ? section : '';
}

function outlineDetailSection(place) {
    if (place?.slot === 'midday') return 'lunch';
    if (place?.slot === 'afternoon') return 'afternoon';
    if (place?.slot === 'evening' || place?.slot === 'night') return 'evening';
    return 'morning';
}

function tagOutlinePlace(placeId, section) {
    const place = state.places[placeId];
    if (!place) return;
    const requiredTag = outlineSectionTag(section);
    const tags = requiredTag
        ? [requiredTag, ...(place.tags || []).filter(tag => String(tag).toLowerCase() !== requiredTag)]
        : place.tags || [];
    const patch = { tags };
    Object.assign(place, patch);
    send('updatePlace', { id: placeId, patch });
}

function assignPlaceToOutlineSection(placeId, stageId, section) {
    const activitySlot = outlineActivitySlot(section);
    if (section === 'detail' || activitySlot) {
        const patch = { stageType: 'detail', parentStageId: stageId, ...(activitySlot ? { slot: activitySlot } : {}) };
        Object.assign(state.places[placeId], patch);
        renderTripOutline();
        send('updatePlace', { id: placeId, patch });
        return;
    }
    tagOutlinePlace(placeId, section);
    const planning = typeof planningFromControls === 'function' ? planningFromControls() : state.planning;
    const kind = section === 'lodging' ? 'lodging' : 'meal';
    const existing = (planning.reservations || []).find(item => item.kind === kind
        && (kind !== 'meal' || item.meal === section)
        && outlineConstraintStageId(item) === stageId
        && outlineConstraintPlaceIds(item).includes(placeId));
    if (existing) {
        moveOutlineConstraint(existing.id, stageId, section);
        return;
    }
    const meal = planning.meals?.[section];
    const startTime = section === 'lodging' ? '18:00' : meal?.at || (section === 'dinner' ? '19:00' : '12:00');
    const endTime = section === 'lodging' ? '09:00' : addMinutesToClock(startTime, Number(meal?.durationMin) || 60);
    const place = state.places[placeId];
    const reservation = TripPlanning.normalizeReservation({
        id: `relative-${section}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        title: place?.name || (section === 'lodging' ? 'Hébergement' : 'Restaurant'),
        kind,
        meal: kind === 'meal' ? section : '',
        placeId,
        placeIds: [placeId],
        stageId,
        dateMode: 'stage',
        relativeDay: 'arrival',
        startTime,
        endTime
    });
    const targetStage = tripOutline().stages.find(stage => stage.id === stageId);
    const replacedIds = kind === 'meal' ? new Set((targetStage?.meals?.[section] || []).map(item => item.id)) : new Set();
    saveOutlinePlanning({ ...planning, reservations: [...(planning.reservations || []).filter(item => !replacedIds.has(item.id)), reservation] });
}

function removeOutlineConstraint(reservationId) {
    const planning = typeof planningFromControls === 'function' ? planningFromControls() : state.planning;
    if (!(planning.reservations || []).some(reservation => reservation.id === reservationId)) return;
    saveOutlinePlanning({ ...planning, reservations: (planning.reservations || []).filter(reservation => reservation.id !== reservationId) });
}

function duplicateOutlineConstraint(reservationId) {
    const planning = typeof planningFromControls === 'function' ? planningFromControls() : state.planning;
    const reservation = (planning.reservations || []).find(item => item.id === reservationId);
    if (!reservation) return;
    const duplicate = TripPlanning.normalizeReservation({
        ...reservation,
        id: `copy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    });
    saveOutlinePlanning({ ...planning, reservations: [...(planning.reservations || []), duplicate] });
}

function moveOutlineConstraint(reservationId, stageId, section, draggedPlaceId = '') {
    const planning = typeof planningFromControls === 'function' ? planningFromControls() : state.planning;
    const item = (planning.reservations || []).find(reservation => reservation.id === reservationId);
    if (!item) return;
    const placeId = state.places[draggedPlaceId] ? draggedPlaceId : outlineConstraintPlaceId(item);
    const activitySlot = outlineActivitySlot(section);
    if (section === 'detail' || activitySlot) {
        if (placeId) {
            const patch = { stageType: 'detail', parentStageId: stageId, ...(activitySlot ? { slot: activitySlot } : {}) };
            Object.assign(state.places[placeId], patch);
            send('updatePlace', { id: placeId, patch });
        }
        saveOutlinePlanning({ ...planning, reservations: (planning.reservations || []).filter(reservation => reservation.id !== reservationId) });
        return;
    }
    if (placeId) tagOutlinePlace(placeId, section);
    const targetKind = section === 'lodging' ? 'lodging' : 'meal';
    const meal = planning.meals?.[section];
    const targetStage = tripOutline().stages.find(stage => stage.id === stageId);
    const replacedIds = targetKind === 'meal' ? new Set((targetStage?.meals?.[section] || []).map(reservation => reservation.id).filter(id => id !== reservationId)) : new Set();
    const reservations = (planning.reservations || []).filter(reservation => !replacedIds.has(reservation.id)).map(reservation => {
        if (reservation.id !== reservationId) return reservation;
        const patch = { ...reservation, kind: targetKind, meal: targetKind === 'meal' ? section : '', placeId: placeId || stageId, placeIds: [placeId || stageId], stageId };
        if (patch.dateMode === 'stage' && targetKind === 'meal') {
            patch.startTime = meal?.at || (section === 'dinner' ? '19:00' : '12:00');
            patch.endTime = addMinutesToClock(patch.startTime, Number(meal?.durationMin) || 60);
        } else if (patch.dateMode !== 'stage' && targetKind === 'meal' && patch.start) {
            const date = patch.start.slice(0, 10);
            const startTime = meal?.at || (section === 'dinner' ? '19:00' : '12:00');
            patch.start = `${date}T${startTime}`;
            patch.end = `${date}T${addMinutesToClock(startTime, Number(meal?.durationMin) || 60)}`;
        }
        return TripPlanning.normalizeReservation(patch);
    });
    saveOutlinePlanning({ ...planning, reservations });
}

function bindOutlineEditor(wrap) {
    wrap.querySelectorAll('[data-stage-name]').forEach(input => {
        input.onchange = () => {
            const name = input.value.trim();
            if (!name) { renderTripOutline(); return; }
            updateOutlineStage(input.dataset.stageName, { name });
        };
        input.onkeydown = event => { if (event.key === 'Enter') input.blur(); };
    });
    wrap.querySelectorAll('[data-stage-date]').forEach(input => {
        input.onchange = () => updateOutlineStage(input.dataset.stageId, { [input.dataset.stageDate]: input.value });
    });
    wrap.querySelectorAll('[data-stage-relative]').forEach(input => {
        input.onchange = () => {
            const relativePeriod = TripStructure.normalizeRelativePeriod(input.value);
            if (input.value.trim() && !relativePeriod) {
                showToast({ type: 'warn', text: 'Repère invalide. Utilisez par exemple J1, J3-J6, J2M, J2A ou J2S.' });
                renderTripOutline();
                return;
            }
            updateOutlineStage(input.dataset.stageRelative, { relativePeriod });
        };
        input.onkeydown = event => { if (event.key === 'Enter') input.blur(); };
    });
    const startPlace = wrap.querySelector('[data-start-place]');
    if (startPlace) startPlace.onchange = () => setTripStartPlace(startPlace.value);

    wrap.querySelectorAll('[data-drag-type]').forEach(chip => {
        chip.ondragstart = event => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', JSON.stringify({ type: chip.dataset.dragType, id: chip.dataset.dragId, placeId: chip.dataset.dragPlaceId || '' }));
            chip.classList.add('is-dragging');
        };
        chip.ondragend = () => {
            chip.classList.remove('is-dragging');
            wrap.querySelectorAll('.is-drag-over').forEach(zone => zone.classList.remove('is-drag-over'));
        };
    });
    wrap.querySelectorAll('[data-remove-constraint]').forEach(button => {
        button.onclick = event => {
            event.stopPropagation();
            removeOutlineConstraint(button.dataset.removeConstraint);
        };
    });
    wrap.querySelectorAll('[data-duplicate-constraint]').forEach(button => {
        button.onclick = event => {
            event.stopPropagation();
            duplicateOutlineConstraint(button.dataset.duplicateConstraint);
        };
    });
    wrap.querySelectorAll('[data-drop-stage]').forEach(zone => {
        zone.ondragover = event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; zone.classList.add('is-drag-over'); };
        zone.ondragleave = event => { if (!zone.contains(event.relatedTarget)) zone.classList.remove('is-drag-over'); };
        zone.ondrop = event => {
            event.preventDefault();
            zone.classList.remove('is-drag-over');
            let transfer;
            try { transfer = JSON.parse(event.dataTransfer.getData('text/plain')); } catch (_) { return; }
            const stageId = zone.dataset.dropStage;
            const section = zone.dataset.dropKind || 'detail';
            if (transfer.type === 'detail' && state.places[transfer.id] && transfer.id !== stageId) {
                assignPlaceToOutlineSection(transfer.id, stageId, section);
            } else if (transfer.type === 'constraint') {
                moveOutlineConstraint(transfer.id, stageId, section, transfer.placeId);
            }
        };
    });
}

function outlinePhotos(stage) {
    const ids = [...new Set([stage.id, ...stage.detailIds,
        ...(stage.lodgings || []).flatMap(outlineConstraintPlaceIds),
        ...(stage.meals?.lunch || []).flatMap(outlineConstraintPlaceIds),
        ...(stage.meals?.dinner || []).flatMap(outlineConstraintPlaceIds)
    ])].filter(id => state.places[id]);
    return `<div class="outline-photos" role="region" aria-label="Photos de l’étape" tabindex="0">${ids.map(id => {
        const place = state.places[id];
        const image = String(place.image || '').trim();
        const displayable = /^(https?:\/\/|data:image\/(png|jpeg|webp|gif);base64,)/i.test(image) && !window.TripWikimediaImages.needsImage(place);
        const searching = IMAGE_SEARCHES.has(`${ACTIVE_TRIP}:${id}`);
        return `<figure class="outline-photo">
            ${displayable ? `<a class="outline-photo__link" href="${escapeHtml(image)}" target="_blank" rel="noopener noreferrer" aria-label="Agrandir la photo de ${escapeHtml(place.name)}"><img src="${escapeHtml(image)}" alt="${escapeHtml(place.name)}" loading="lazy" decoding="async" width="192" height="120"></a>` : ''}
            <div class="outline-photo__placeholder" ${displayable ? 'hidden' : ''}><span aria-hidden="true">📷</span><span>Photo à compléter</span></div>
            <figcaption>${escapeHtml(place.name || id)}</figcaption>
            <button class="btn" type="button" data-photo-search="${escapeHtml(id)}" ${searching ? 'disabled' : ''}>${searching ? 'Recherche…' : displayable ? 'Changer la photo' : 'Trouver une photo'}</button>
        </figure>`;
    }).join('')}</div>`;
}

function renderTripOutline() {
    const wrap = $('#tripOutline'); if (!wrap) return;
    const openDates = new Set(wrap.dataset.tripId === ACTIVE_TRIP ? [...wrap.querySelectorAll('[data-stage-dates][open]')].map(details => details.dataset.stageDates) : []);
    wrap.dataset.tripId = ACTIVE_TRIP || '';
    const outline = tripOutline();
    const start = state.planning?.startDate, end = state.planning?.endDate;
    const startDate = start ? new Date(`${start}T12:00:00`) : null;
    const endDate = end ? new Date(`${end}T12:00:00`) : null;
    const fixedDayCount = startDate && endDate && endDate >= startDate ? Math.round((endDate - startDate) / 86400000) + 1 : 0;

    if (!outline.stages.length) {
        wrap.innerHTML = '<div class="outline-empty"><strong>Votre voyage commence ici.</strong><span>Un premier lieu suffit. Les dates et les détails peuvent venir plus tard.</span><button class="btn primary" type="button" data-open-page="add">Ajouter un premier lieu</button></div>';
        return;
    }
    if (EXPERIENCE_MODE === 'travel') {
        renderTravelOutline(wrap, outline);
        bindOutlinePhotoControls(wrap);
        return;
    }

    const chronologicalStages = TripStructure.chronologicalStages(outline.stages);
    const relativeDayCount = TripStructure.relativeDayCount(chronologicalStages);
    const dayCount = fixedDayCount || relativeDayCount;
    const startPlaceId = tripStartPlaceId();
    const startOptions = [...new Set(state.itinerary)].filter(id => state.places[id]).map(id => `<option value="${escapeHtml(id)}" ${id === startPlaceId ? 'selected' : ''}>${escapeHtml(state.places[id]?.name || id)}</option>`).join('');
    const assignedPlaceIds = new Set(chronologicalStages.flatMap(stage => [
        ...(stage.lodgings || []),
        ...(stage.meals?.lunch || []),
        ...(stage.meals?.dinner || [])
    ].flatMap(outlineConstraintPlaceIds)));
    const detailCount = Object.entries(outline.assignments).filter(([id, item]) => item.stageType === 'detail' && !assignedPlaceIds.has(id)).length;
    const metrics = `
        <div class="outline-metrics">
            <div><strong>${dayCount || '—'}</strong><span>jour${dayCount > 1 ? 's' : ''}${fixedDayCount ? '' : ' prévu' + (dayCount > 1 ? 's' : '')}</span></div>
            <div><strong>${outline.mainIds.length}</strong><span>grande${outline.mainIds.length > 1 ? 's' : ''} étape${outline.mainIds.length > 1 ? 's' : ''}</span></div>
            <div><strong>${detailCount}</strong><span>sous-étape${detailCount > 1 ? 's' : ''}</span></div>
            <div><strong>${outline.nights.length}</strong><span>nuit${outline.nights.length > 1 ? 's' : ''}</span></div>
        </div>`;
    const startPicker = `<div class="outline-start"><label for="outlineStartPlace">Point de départ</label><select id="outlineStartPlace" data-start-place>${startOptions}</select><span>Le trajet et le planning commenceront par ce lieu.</span></div>`;
    const dateNotice = fixedDayCount
        ? ''
        : `<div class="outline-notice"><strong>Trame sans dates fixes</strong><span>Utilisez J1 ou J3-J6 pour les jours, et ajoutez M, A ou S pour préciser matin, après-midi ou soir (ex. J2M).</span></div>`;
    const stages = chronologicalStages.map((stage, index) => {
        const place = state.places[stage.id] || {};
        const period = TripStructure.stagePeriodLabel(stage);
        const relativePeriodLabel = TripStructure.relativePeriodLabel(stage.relativePeriod);
        const arrivalWeekday = stage.arrivalDate ? formatOutlineDate(stage.arrivalDate, { weekday: 'long' }) : '';
        const departureWeekday = stage.departureDate ? formatOutlineDate(stage.departureDate, { weekday: 'long' }) : '';
        const weekday = !arrivalWeekday ? departureWeekday
            : stage.arrivalDate === stage.departureDate || !departureWeekday
                ? arrivalWeekday : `${arrivalWeekday} → ${departureWeekday}`;
        const detailsBySection = { morning: [], lunch: [], afternoon: [], evening: [] };
        stage.detailIds.filter(id => !assignedPlaceIds.has(id)).forEach(id => {
            detailsBySection[outlineDetailSection(state.places[id])].push(id);
        });
        const detailMarkup = section => detailsBySection[section].map(id => `<button class="outline-detail${state.places[id]?.completed ? ' is-completed' : ''}" type="button" draggable="true" data-drag-type="detail" data-drag-id="${escapeHtml(id)}" data-focus="${escapeHtml(id)}">${state.places[id]?.completed ? '✓ Réalisé · ' : ''}${escapeHtml(state.places[id]?.name || id)}</button>`).join('');
        const activityMarkup = section => detailMarkup(section) || '<span class="muted">Déposez une sous-étape ici</span>';
        const accommodations = [...new Map((stage.lodgings || []).map(item => [item.id || item.title, item])).values()];
        const lodging = accommodations.length
            ? accommodations.map(item => { const placeId = outlineConstraintPlaceId(item, stage.id); return `<span class="outline-lodging" draggable="true" data-drag-type="constraint" data-drag-id="${escapeHtml(item.id)}" data-drag-place-id="${escapeHtml(placeId)}"><span>${escapeHtml(state.places[placeId]?.name || item.title || 'Hébergement')}</span><button type="button" data-duplicate-constraint="${escapeHtml(item.id)}" aria-label="Dupliquer cet hébergement" title="Dupliquer pour le réutiliser">+</button><button type="button" data-remove-constraint="${escapeHtml(item.id)}" aria-label="Retirer cet hébergement">×</button></span>`; }).join('')
            : '<span class="outline-missing">Déposez un lieu d’hébergement ici</span>';
        const mealMarkup = meal => {
            const reservations = stage.meals?.[meal] || [];
            return reservations.length
                ? reservations.map(item => { const placeId = outlineConstraintPlaceId(item, stage.id); return `<span class="outline-meal" draggable="true" data-drag-type="constraint" data-drag-id="${escapeHtml(item.id)}" data-drag-place-id="${escapeHtml(placeId)}"><span>${escapeHtml(state.places[placeId]?.name || item.title || 'Restaurant')}</span><button type="button" data-duplicate-constraint="${escapeHtml(item.id)}" aria-label="Dupliquer ce repas" title="Dupliquer pour le réutiliser">+</button><button type="button" data-remove-constraint="${escapeHtml(item.id)}" aria-label="Retirer ce restaurant">×</button></span>`; }).join('')
                : '<span class="outline-missing">Déposez un lieu de restaurant ici</span>';
        };
        return `<article class="outline-stage" data-stage-id="${escapeHtml(stage.id)}">
            <div class="outline-stage__rail"><span>${index + 1}</span></div>
            <div class="outline-stage__body">
                <details class="outline-dates advanced-fields" data-stage-dates="${escapeHtml(stage.id)}:${index}" ${openDates.has(`${stage.id}:${index}`) ? 'open' : ''}>
                <summary>Dates et repère <span>${escapeHtml([stage.arrivalDate, stage.departureDate].filter(Boolean).map(value => formatOutlineDate(value)).join(' → ') || relativePeriodLabel || 'Facultatif')}</span></summary>
                <div class="outline-stage__date-editor">
                    <label>Repère<input class="outline-stage__relative-input" type="text" value="${escapeHtml(stage.relativePeriod)}" placeholder="J1 ou J3-J6" aria-label="Repère relatif de ${escapeHtml(place.name || stage.id)}" data-stage-relative="${escapeHtml(stage.id)}"></label>
                    <label>Arrivée<input type="date" value="${escapeHtml(stage.arrivalDate)}" data-stage-id="${escapeHtml(stage.id)}" data-stage-date="arrivalDate"></label>
                    <label>Départ<input type="date" value="${escapeHtml(stage.departureDate)}" data-stage-id="${escapeHtml(stage.id)}" data-stage-date="departureDate"></label>
                    ${relativePeriodLabel ? `<span class="outline-stage__relative">${escapeHtml(relativePeriodLabel)}</span>` : ''}
                    ${weekday ? `<span class="outline-stage__weekday">${escapeHtml(weekday)}</span>` : ''}
                    ${period ? `<span class="outline-stage__period">${escapeHtml(period)}</span>` : ''}
                </div>
                </details>
                <div class="outline-stage__name-row">
                    <input class="outline-stage__name" type="text" value="${escapeHtml(place.name || stage.id)}" data-stage-name="${escapeHtml(stage.id)}" aria-label="Nom de l'étape ${index + 1}">
                    ${stageWeatherBadge(stage.id, stage.arrivalDate)}
                    ${stage.id === startPlaceId ? '<span class="outline-start-badge">Départ</span>' : ''}
                    <button class="btn outline-map-button" type="button" data-focus="${escapeHtml(stage.id)}">Voir sur la carte</button>
                </div>
                ${outlinePhotos(stage)}
                <div class="outline-stage__assignments">
                    <div class="outline-stage__assignment outline-stage__activity outline-dropzone" data-drop-stage="${escapeHtml(stage.id)}" data-drop-kind="morning"><strong>Matin</strong><div>${activityMarkup('morning')}</div></div>
                    <div class="outline-stage__assignment outline-stage__lunch outline-dropzone" data-drop-stage="${escapeHtml(stage.id)}" data-drop-kind="lunch"><strong>Déjeuner</strong><div>${detailMarkup('lunch')}${mealMarkup('lunch')}</div></div>
                    <div class="outline-stage__assignment outline-stage__activity outline-dropzone" data-drop-stage="${escapeHtml(stage.id)}" data-drop-kind="afternoon"><strong>Après-Midi</strong><div>${activityMarkup('afternoon')}</div></div>
                    <div class="outline-stage__assignment outline-stage__dinner outline-dropzone" data-drop-stage="${escapeHtml(stage.id)}" data-drop-kind="dinner"><strong>Dîner</strong><div>${mealMarkup('dinner')}</div></div>
                    <div class="outline-stage__assignment outline-stage__activity outline-dropzone" data-drop-stage="${escapeHtml(stage.id)}" data-drop-kind="evening"><strong>Soir</strong><div>${activityMarkup('evening')}</div></div>
                    <div class="outline-stage__assignment outline-stage__lodging outline-dropzone" data-drop-stage="${escapeHtml(stage.id)}" data-drop-kind="lodging"><strong>Hébergement</strong><div>${lodging}</div></div>
                </div>
            </div>
        </article>`;
    }).join('');
    const tripDays = TripStructure.tripDays(state.planning);
    const nightsByDate = new Map(outline.nights.map(night => [night.date, night]));
    const days = tripDays.length ? `<section class="night-board"><h3>Chaque jour</h3><div class="night-table-wrap"><table class="night-table">
        <thead><tr><th>Date</th><th>Déjeuner</th><th>Dîner</th><th>Hébergement</th></tr></thead>
        <tbody>${tripDays.map(day => {
        const dayStages = TripStructure.stagesForDate(chronologicalStages, day.date);
        const meals = meal => [...new Map(dayStages.flatMap(stage => stage.meals?.[meal] || []).map(item => [item.id, item])).values()];
        const lodging = nightsByDate.get(day.date)?.lodging || [];
        const cellMarkup = (items, type, fallback) => items?.length
            ? items.map(item => { const placeId = outlineConstraintPlaceId(item, item.stageId || ''); return `<span class="${type}">${escapeHtml(state.places[placeId]?.name || item.title || fallback)}</span>`; }).join('')
            : `<span class="outline-missing">${fallback}</span>`;
        const lodgingFallback = day.date === end ? 'Fin du séjour' : 'À réserver';
        return `<tr><th scope="row"><time>${escapeHtml(formatOutlineDate(day.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</time></th><td><div class="night-cell">${cellMarkup(meals('lunch'), 'outline-meal', 'À définir')}</div></td><td><div class="night-cell">${cellMarkup(meals('dinner'), 'outline-meal', 'À définir')}</div></td><td><div class="night-cell">${cellMarkup(lodging, 'outline-lodging', lodgingFallback)}</div></td></tr>`;
    }).join('')}</tbody></table></div></section>` : '';

    wrap.innerHTML = startPicker + metrics + dateNotice + `<div class="outline-timeline">${stages}</div>` + days;
    wrap.querySelectorAll('[data-focus]').forEach(button => button.onclick = () => focusPlace(button.dataset.focus, { pan: true, openPopup: true, scrollList: false }));
    bindOutlinePhotoControls(wrap);
    bindOutlineEditor(wrap);
}

function bindOutlinePhotoControls(wrap) {
    wrap.querySelectorAll('[data-photo-search]').forEach(button => {
        button.onclick = () => findImageForPlace(button.dataset.photoSearch, button);
    });
    wrap.querySelectorAll('.outline-photo img').forEach(image => {
        image.onerror = () => {
            const card = image.closest('.outline-photo');
            card.querySelector('a').hidden = true;
            const placeholder = card.querySelector('.outline-photo__placeholder');
            placeholder.hidden = false;
            placeholder.lastElementChild.textContent = 'Photo indisponible';
            card.querySelector('button').textContent = 'Trouver une photo';
        };
    });
}

function renderPlaces() {
    const wrap = $('#places'); if (!wrap) return;
    const expanded = new Set(wrap.dataset.tripId === ACTIVE_TRIP ? [...wrap.querySelectorAll('details[open][data-disclosure]')].map(details => `${details.closest('.item').dataset.id}:${details.dataset.disclosure}`) : []);
    wrap.dataset.tripId = ACTIVE_TRIP || '';
    wrap.innerHTML = ''; const me = getUserName(); const act = new Set(activeTags());
    const completedCount = Object.values(state.places).filter(place => place.completed).length;
    const remainingCount = state.itinerary.filter(id => !state.places[id]?.completed && canCompleteVisit(id)).length;
    if ($('#visitProgressSummary')) $('#visitProgressSummary').textContent = `${completedCount} lieu(x) réalisé(s) · ${remainingCount} visite(s) restante(s). Décochez « Réalisé » pour remettre une visite au planning.`;
    const outline = tripOutline();
    const stageById = new Map(outline.stages.map(stage => [stage.id, stage]));
    for (let i = 0; i < state.itinerary.length; i++) {
        const id = state.itinerary[i]; const p = state.places[id]; if (!p) continue;
        if (act.size && (!p.tags || !p.tags.some(t => act.has(t)))) continue;
        const myRating = (p.ratings && typeof p.ratings[me] !== 'undefined') ? p.ratings[me] : '';
        const ratings = p.ratings ? Object.values(p.ratings).map(Number).filter(n => !Number.isNaN(n)) : []; const a = avg(ratings);
        const assignment = outline.assignments[id] || { stageType: 'main', parentStageId: '' };
        const item = document.createElement('div'); item.className = `item hierarchy-place stage-${assignment.stageType}${p.completed ? ' completed-place' : ''}`; item.dataset.id = id; item.draggable = true;
        const thumb = p.image ? `<img class="thumb" src="${p.image}" alt="image de ${p.name}" />` : '';
        const tagsline = (p.tags && p.tags.length) ? `<div class="tagsline">${p.tags.map(t => `<span class="tagchip">${t}</span>`).join('')}</div>` : '';
        const fixedDates = typeof placeFixedDatesMarkup === 'function' ? placeFixedDatesMarkup(id, p.name) : '';
        const startPlace = state.places[tripStartPlaceId()];
        const isHome = id === tripStartPlaceId() || (startPlace && kmBetween(startPlace, p) <= 0.1);
        const parentOptions = outline.mainIds.filter(mainId => mainId !== id).map(mainId => `<option value="${escapeHtml(mainId)}" ${assignment.parentStageId === mainId ? 'selected' : ''}>${escapeHtml(state.places[mainId]?.name || mainId)}</option>`).join('');
        const stageDates = stageById.get(id) || {};
        item.innerHTML = `
      <div class="hdr">
        <span class="hierarchy-badge">${assignment.stageType === 'main' ? 'ÉTAPE PRINCIPALE' : 'SOUS-ÉTAPE'}</span>
        <div class="place-name-editor">
          <span>${i + 1}.</span>
          <input class="placeName" type="text" value="${escapeHtml(p.name)}" aria-label="${assignment.stageType === 'main' ? 'Nom de l’étape' : 'Nom de la sous-étape'} ${i + 1}" />
        </div>
        <div class="actions">
          <label class="optional-toggle" title="${isHome ? 'Le domicile ne peut pas être optionnel' : 'Conserver ce lieu sans le planifier'}"><input type="checkbox" ${isHome ? 'disabled' : ''}/> Optionnel</label>
          <label class="completed-toggle" title="Visite déjà faite, exclue du planning restant"><input type="checkbox" ${p.completed ? 'checked' : ''} ${visitProgressDisabled(id) ? 'disabled' : ''}/> Réalisé</label>
          <details class="place-actions" data-disclosure="actions"><summary>Ordre et actions</summary><div class="row wrap">
          <input class="pos" type="number" min="1" max="${state.itinerary.length}" value="${i + 1}" title="Position"/>
          <button class="btn" data-act="up">↟</button>
          <button class="btn" data-act="down">↡</button>
          <button class="btn" data-act="dup">➕ Étape (copie)</button>
          <button class="btn danger" data-act="del">🗑️</button>
          </div></details>
        </div>
      </div>
      ${tagsline}
      <div class="place-brief">${thumb}<div><span>${fmtHours(Number(p.durationH) > 0 ? p.durationH : 2)}${p.budget ? ` · ${fmtMoney(p.budget, p.budgetCurrency)}` : ''}</span>${p.desc ? `<p>${escapeHtml(p.desc)}</p>` : ''}</div></div>
      <details class="place-editor" data-disclosure="editor"><summary>Modifier les informations du lieu</summary>
      <details class="advanced-fields" data-disclosure="structure"><summary>Étape, rattachement et dates</summary>
      <div class="stage-fields">
        <div><label>Niveau</label><select class="stageType"><option value="main" ${assignment.stageType === 'main' ? 'selected' : ''}>Étape principale</option><option value="detail" ${assignment.stageType === 'detail' ? 'selected' : ''}>Sous-étape</option></select></div>
        <div class="parent-stage-field"><label>Rattachée à</label><select class="parentStage"><option value="">Choisir une étape</option>${parentOptions}</select></div>
        <div class="main-stage-date"><label>Arrivée</label><div class="stage-date-time"><input class="stageArrival" type="date" value="${escapeHtml(p.arrivalDate || stageDates.arrivalDate || '')}" /><input class="stageArrivalTime" type="time" value="${escapeHtml(p.arrivalTime || stageDates.arrivalTime || '')}" aria-label="Heure d’arrivée" /></div></div>
        <div class="main-stage-date"><label>Départ</label><div class="stage-date-time"><input class="stageDeparture" type="date" value="${escapeHtml(p.departureDate || stageDates.departureDate || '')}" /><input class="stageDepartureTime" type="time" value="${escapeHtml(p.departureTime || stageDates.departureTime || '')}" aria-label="Heure de départ" /></div></div>
      </div>
      </details>
      <div class="row" style="margin-top:6px">
        <div><label>Durée (h)</label><input class="dur" type="number" step="0.25" min="0" value="${Number(p.durationH) > 0 ? p.durationH : 2}"/></div>
        <div><label>Budget (${p.budgetFree ? 'gratuit' : window.TripBudget.normalizeCurrency(p.budgetCurrency)})</label><input class="bud" type="number" step="0.05" min="0" value="${(p.budget ?? 0)}" ${p.budgetFree ? 'disabled title="Décochez Gratuit dans la page Budget"' : ''}/></div>
        <div><label>Votre note (1–6)</label><select class="rate"><option value="">—</option>${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${myRating == n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div><label>Moment préféré</label>
          <select class="slot">
            <option value="" ${!p.slot ? 'selected' : ''}>Flexible</option>
            <option value="morning" ${p.slot === 'morning' ? 'selected' : ''}>Matin</option>
            <option value="midday" ${p.slot === 'midday' ? 'selected' : ''}>Midi</option>
            <option value="afternoon" ${p.slot === 'afternoon' ? 'selected' : ''}>Après-midi</option>
            <option value="evening" ${p.slot === 'evening' ? 'selected' : ''}>Soir</option>
            <option value="night" ${p.slot === 'night' ? 'selected' : ''}>Nuit</option>
          </select>
        </div>
        <div class="rating">Moy.: <span class="avg">${a ?? '—'}</span> (${ratings.length || 0})</div>
      </div>
      <div class="row" style="margin-top:6px">
        <div style="flex:1"><label>Description</label><textarea class="desc">${p.desc || ''}</textarea></div>
      </div>
      <div class="row"><div><label>Tags (virgules)</label><input class="tags" type="text" value="${escapeHtml((p.tags || []).join(', '))}"/></div></div>
      <details class="advanced-fields" data-disclosure="extras"><summary>Photo, liens et alternatives</summary>
      <div class="row" style="margin-top:6px">
        <div><label>Alternative (groupe)</label><input class="alt" type="text" value="${p.optionGroup || ''}"/></div>
        <div class="drop" tabindex="0">📷 Glissez/collez une image</div>
         <div><label>Image (URL)</label><div class="row"><input class="imgurl" type="url" value="${p.image && p.image.startsWith('http') ? p.image : ''}" placeholder="https://..."/><button class="btn" data-act="image-inline" type="button">Trouver</button></div></div>
         <div><label>URL (infos)</label><input class="urlInput" type="url" value="${p.url || ''}" placeholder="https://..."/></div>
      </div>
      <div class="muted">Coordonnées : ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</div>
      </details>
      ${fixedDates}</details>`;
        const placeNameInput = item.querySelector('.placeName');
        placeNameInput.onchange = () => {
            const name = placeNameInput.value.trim();
            if (!name) { placeNameInput.value = p.name; return; }
            placeNameInput.value = name;
            p.name = name;
            send('updatePlace', { id, patch: { name } });
        };
        placeNameInput.onkeydown = event => { if (event.key === 'Enter') placeNameInput.blur(); };
        item.querySelector('.pos').onchange = e => moveToPosition(id, e.target.value);
        item.querySelector('.dur').onchange = e => updateDurationH(id, e.target.value);
        item.querySelector('.bud').onchange = e => updateBudget(id, e.target.value);
        item.querySelector('.rate').onchange = e => ratePlace(id, e.target.value);
        item.querySelector('.slot').onchange = e => send('updatePlace', { id, patch: { slot: e.target.value || '' } });
        item.querySelector('.stageType').onchange = e => {
            const stageType = e.target.value === 'detail' ? 'detail' : 'main';
            const fallbackParent = outline.mainIds.find(mainId => mainId !== id) || '';
            send('updatePlace', { id, patch: { stageType, parentStageId: stageType === 'detail' ? (assignment.parentStageId || fallbackParent) : '' } });
        };
        item.querySelector('.parentStage').onchange = e => send('updatePlace', { id, patch: { parentStageId: e.target.value } });
        item.querySelector('.stageArrival').onchange = e => send('updatePlace', { id, patch: { arrivalDate: e.target.value } });
        item.querySelector('.stageArrivalTime').onchange = e => send('updatePlace', { id, patch: { arrivalTime: e.target.value } });
        item.querySelector('.stageDeparture').onchange = e => send('updatePlace', { id, patch: { departureDate: e.target.value } });
        item.querySelector('.stageDepartureTime').onchange = e => send('updatePlace', { id, patch: { departureTime: e.target.value } });
        item.querySelector('.desc').onchange = e => send('updatePlace', { id, patch: { desc: e.target.value } });
        item.querySelector('.tags').onchange = e => updateTags(id, e.target.value);
        item.querySelector('.alt').onchange = e => updateAltGroup(id, e.target.value);
        setupDrop(item.querySelector('.drop'), (dataUrl) => updateImage(id, dataUrl));
        item.querySelector('.imgurl').onchange = e => { const v = e.target.value.trim(); if (v) updateImage(id, v) }
        item.querySelector('.urlInput').onchange = e => updateUrl(id, e.target.value);
        item.querySelector('[data-act="up"]').onclick = () => moveUp(id);
        item.querySelector('[data-act="down"]').onclick = () => moveDown(id);
        item.querySelector('[data-act="dup"]').onclick = () => duplicatePlace(id, i + 2);
        item.querySelector('[data-act="image-inline"]').onclick = event => findImageForPlace(id, event.currentTarget);
        item.querySelector('[data-act="del"]').onclick = () => removePlace(id);
        item.querySelector('.optional-toggle input').onchange = event => { if (event.target.checked) markPlaceOptional(id) };
        item.querySelector('.completed-toggle input').onchange = event => setPlacesCompleted([id], event.target.checked);
        if (typeof bindPlaceFixedDateControls === 'function') bindPlaceFixedDateControls(item, id);
        item.addEventListener('click', (e) => { if (e.target.closest('button, input, select, textarea, a, summary')) return; focusPlace(id, { pan: true, openPopup: true }); });
        wrap.appendChild(item);
    }
    const optionalIds = Object.keys(state.places)
        .filter(id => !state.itinerary.includes(id))
        .filter(id => !act.size || state.places[id]?.tags?.some(tag => act.has(tag)))
        .sort((a, b) => String(state.places[a]?.name || a).localeCompare(String(state.places[b]?.name || b), 'fr'));
    for (const id of optionalIds) {
        const p = state.places[id]; if (!p) continue;
        const item = document.createElement('div'); item.className = `item optional-place${p.completed ? ' completed-place' : ''}`; item.dataset.id = id;
        const thumb = p.image ? `<img class="thumb" src="${p.image}" alt="image de ${p.name}" />` : '';
        const tagsline = (p.tags && p.tags.length) ? `<div class="tagsline">${p.tags.map(tag => `<span class="tagchip">${tag}</span>`).join('')}</div>` : '';
        const fixedDates = typeof placeFixedDatesMarkup === 'function' ? placeFixedDatesMarkup(id, p.name) : '';
        item.innerHTML = `
            <div class="hdr">
                <span class="optional-badge">${p.completed ? 'RÉALISÉ' : 'OPTIONNEL'}</span>
                <div class="name" style="flex:1;min-width:0;">${p.name}</div>
                <div class="meta">${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</div>
                <div class="actions"><input class="pos" type="number" min="2" value="${Math.max(2, state.itinerary.length + 1)}" title="Position de réintégration"/><button class="btn primary addToItin" type="button">Inclure dans l’itinéraire</button><button class="btn" data-act="image" type="button">Image auto</button><button class="btn danger" data-act="del" type="button">🗑️</button></div>
            </div>
            ${tagsline}${thumb}
            <div class="row optional-place__fields"><div><label>Durée (h)</label><input class="dur" type="number" step="0.25" min="0" value="${Number(p.durationH) > 0 ? p.durationH : 2}"/></div><div><label>Budget (${p.budgetFree ? 'gratuit' : window.TripBudget.normalizeCurrency(p.budgetCurrency)})</label><input class="bud" type="number" step="0.05" min="0" value="${p.budget ?? 0}" ${p.budgetFree ? 'disabled title="Décochez Gratuit dans la page Budget"' : ''}/></div><div style="flex:1"><label>URL</label><input class="urlInput" type="url" value="${p.url || ''}" placeholder="https://..."/></div></div>
            ${fixedDates}`;
        item.querySelector('.dur').onchange = event => updateDurationH(id, event.target.value);
        item.querySelector('.bud').onchange = event => updateBudget(id, event.target.value);
        item.querySelector('.urlInput').onchange = event => updateUrl(id, event.target.value);
        item.querySelector('[data-act="image"]').onclick = event => findImageForPlace(id, event.currentTarget);
        item.querySelector('[data-act="del"]').onclick = () => removePlace(id);
        item.querySelector('.addToItin').onclick = () => addCandidateToItinerary(id, item.querySelector('.pos').value);
        item.querySelector('.addToItin').disabled = Boolean(p.completed);
        const completion = document.createElement('label'); completion.className = 'completed-toggle';
        completion.innerHTML = `<input type="checkbox" ${p.completed ? 'checked' : ''} ${visitProgressDisabled(id) ? 'disabled' : ''}/> Réalisé`;
        completion.querySelector('input').onchange = event => setPlacesCompleted([id], event.target.checked);
        item.querySelector('.actions').prepend(completion);
        if (typeof bindPlaceFixedDateControls === 'function') bindPlaceFixedDateControls(item, id);
        item.addEventListener('click', event => { if (event.target.closest('button,input,select,textarea,a,summary')) return; focusPlace(id, { pan: true, openPopup: true }) });
        wrap.appendChild(item);
    }
    wrap.querySelectorAll('details[data-disclosure]').forEach(details => {
        details.open = expanded.has(`${details.closest('.item').dataset.id}:${details.dataset.disclosure}`);
    });
}
function attachDnD() {
    const wrap = $('#places'); if (!wrap) return;
    let dragEl = null;
    wrap.querySelectorAll('.item[draggable="true"]').forEach(el => {
        el.addEventListener('dragstart', e => { dragEl = el; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move' });
        el.addEventListener('dragend', () => { if (dragEl) { el.classList.remove('dragging'); dragEl = null } });
        el.addEventListener('dragover', e => { e.preventDefault(); const cur = el; const list = [...wrap.querySelectorAll('.item[draggable="true"]')]; const dragging = wrap.querySelector('.item.dragging'); if (!dragging || cur === dragging) return; const ci = list.indexOf(cur), di = list.indexOf(dragging); if (ci > di) { wrap.insertBefore(dragging, cur.nextSibling) } else { wrap.insertBefore(dragging, cur) } });
        el.addEventListener('drop', e => { e.preventDefault(); commitOrder() })
    });
    function commitOrder() {
        const visibleIds = [...wrap.querySelectorAll('.item[draggable="true"]')].map(element => element.dataset.id);
        const visibleSet = new Set(visibleIds);
        const reordered = [...visibleIds];
        const itinerary = state.itinerary.map(id => visibleSet.has(id) ? reordered.shift() : id);
        send('reorder', { itinerary });
        updateRouteSummary();
    }
}

/* ---------- Candidats ---------- */
function candidateIds() {
    return Object.keys(state.places).filter(isCandidate);
}

function updateCandidateSelectionControls() {
    const ids = candidateIds();
    for (const id of SELECTED_CANDIDATE_IDS) if (!ids.includes(id)) SELECTED_CANDIDATE_IDS.delete(id);
    const count = SELECTED_CANDIDATE_IDS.size;
    const selectAll = $('#candidateSelectAll');
    const createTrip = $('#candidateCreateTrip');
    if (selectAll) {
        selectAll.disabled = !ids.length;
        selectAll.textContent = ids.length && count === ids.length ? 'Tout désélectionner' : 'Tout sélectionner';
    }
    if (createTrip) {
        createTrip.disabled = !count || Boolean(PENDING_CANDIDATE_IMPORT);
        createTrip.textContent = `Créer un voyage (${count})`;
    }
}

function toggleAllCandidateSelections() {
    const ids = candidateIds();
    if (ids.length && ids.every(id => SELECTED_CANDIDATE_IDS.has(id))) SELECTED_CANDIDATE_IDS.clear();
    else ids.forEach(id => SELECTED_CANDIDATE_IDS.add(id));
    renderCandidates();
}

function renderCandidates() {
    const wrap = $('#candidates'); if (!wrap) return;
    wrap.innerHTML = '';
    const ids = candidateIds();
    if (ids.length === 0) { wrap.innerHTML = '<div class="muted">Aucun lieu optionnel.</div>'; updateCandidateSelectionControls(); return }
    ids.forEach((id) => {
        const p = state.places[id]; if (!p) return;
        const item = document.createElement('div'); item.className = 'item cand'; item.dataset.id = id;
        const thumb = p.image ? `<img class="thumb" src="${p.image}" alt="image de ${p.name}" />` : '';
        const tagsline = (p.tags && p.tags.length) ? `<div class="tagsline">${p.tags.map(t => `<span class="tagchip">${t}</span>`).join('')}</div>` : '';
        item.innerHTML = `
      <div class="hdr">
        <label class="candidate-select"><input type="checkbox" ${SELECTED_CANDIDATE_IDS.has(id) ? 'checked' : ''} aria-label="Sélectionner ${escapeHtml(p.name)}" /></label>
        <div class="name" style="flex:1;min-width:0;">${p.name}</div>
        <div class="meta">${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</div>
        <div class="actions">
          <input class="pos" type="number" min="1" value="${state.itinerary.length + 1}" title="Position dans l’itinéraire"/>
          <button class="btn primary addToItin">➕ Ajouter à l’itinéraire</button>
          <button class="btn" data-act="dup">Dupliquer</button>
          <button class="btn" data-act="image">Image auto</button>
          <button class="btn danger" data-act="del">🗑️</button>
        </div>
      </div>
      ${tagsline}
      ${thumb}
      <div class="row" style="margin-top:6px">
        <div><label>Durée (h)</label><input class="dur" type="number" step="0.25" min="0" value="${Number(p.durationH) > 0 ? p.durationH : 2}"/></div>
        <div><label>Budget (${p.budgetFree ? 'gratuit' : window.TripBudget.normalizeCurrency(p.budgetCurrency)})</label><input class="bud" type="number" step="0.05" min="0" value="${(p.budget ?? 0)}" ${p.budgetFree ? 'disabled title="Décochez Gratuit dans la page Budget"' : ''}/></div>
        <div><label>URL</label><input class="urlInput" type="url" value="${p.url || ''}" placeholder="https://..."/></div>
      </div>`;
        item.querySelector('.dur').onchange = e => updateDurationH(id, e.target.value);
        item.querySelector('.candidate-select input').onchange = event => {
            if (event.target.checked) SELECTED_CANDIDATE_IDS.add(id);
            else SELECTED_CANDIDATE_IDS.delete(id);
            updateCandidateSelectionControls();
        };
        item.querySelector('.bud').onchange = e => updateBudget(id, e.target.value);
        item.querySelector('.urlInput').onchange = e => updateUrl(id, e.target.value);
        item.querySelector('[data-act="dup"]').onclick = () => duplicatePlace(id, state.itinerary.length + 1);
        item.querySelector('[data-act="image"]').onclick = event => findImageForPlace(id, event.currentTarget);
        item.querySelector('[data-act="del"]').onclick = () => removePlace(id);
        item.querySelector('.addToItin').onclick = () => { const pos = parseInt(item.querySelector('.pos').value, 10) || state.itinerary.length + 1; addCandidateToItinerary(id, pos) };
        item.addEventListener('click', (e) => { if (e.target.closest('button,input,select,textarea,a')) return; focusPlace(id, { pan: true, openPopup: true }) });
        wrap.appendChild(item);
    });
    updateCandidateSelectionControls();
}
function addCandidateToItinerary(id, pos1) {
    const n = state.itinerary.length;
    const first = state.places[state.itinerary[0]], last = state.places[state.itinerary[n - 1]];
    const returnsHome = n > 1 && (state.itinerary[0] === state.itinerary[n - 1] || (first && last && kmBetween(first, last) <= 0.1));
    const maxPosition = returnsHome ? n : n + 1;
    let p = Math.max(2, Math.min(maxPosition, parseInt(pos1, 10) || maxPosition));
    const arr = [...state.itinerary]; arr.splice(p - 1, 0, id); send('reorder', { itinerary: arr });
    showToast({ type: 'success', text: `Ajouté à l’itinéraire en position ${p}.` });
}
function markPlaceOptional(id) {
    const startPlace = state.places[tripStartPlaceId()], place = state.places[id];
    const isStart = id === tripStartPlaceId() || (startPlace && place && kmBetween(startPlace, place) <= 0.1);
    if (!id || isStart) { showToast({ type: 'warn', text: 'Le point de départ doit rester dans l’itinéraire.' }); return }
    const itinerary = state.itinerary.filter(placeId => placeId !== id);
    send('reorder', { itinerary });
    showToast({ type: 'success', text: `${state.places[id]?.name || 'Lieu'} est maintenant optionnel et retiré du planning.` });
}

/* ---------- Lieux: add/update ---------- */
function openDialogAt(latlng) { $('#dlg').classList.add('open'); $('#dName').value = ''; $('#dLat').value = latlng.lat.toFixed(6); $('#dLng').value = latlng.lng.toFixed(6); $('#dDurH').value = '2'; $('#dBudget').value = ''; $('#dDesc').value = ''; $('#dRate').value = '4'; $('#dUrl').value = ''; $('#dSlot').value = ''; $('#dPos').value = '' }
function addPlaceFromForm() {
    const name = $('#pName').value.trim(), lat = parseFloat($('#pLat').value), lng = parseFloat($('#pLng').value), durH = parseFloat($('#pDurH').value || '2'), budget = parseFloat($('#pBudget').value || '0'), desc = $('#pDesc').value.trim(), rate = $('#pRate').value ? parseInt($('#pRate').value, 10) : null, url = $('#pUrl').value.trim();
    const tags = ($('#pTags').value || '').split(',').map(s => s.trim()).filter(Boolean); const optionGroup = ($('#pAlt').value || '').trim(); const slot = $('#pSlot').value || '';
    let image = ''; if ($('#pDrop')?.dataset.img) { image = $('#pDrop').dataset.img } else if ($('#pImgUrl')?.value) { image = $('#pImgUrl').value.trim() }
    const pos = $('#pPos').value ? (parseInt($('#pPos').value, 10) - 1) : null; if (!name || Number.isNaN(lat) || Number.isNaN(lng)) return alert('Nom, lat et lng requis.');
    const closed = $$('#addPlace ~ .week .closed:checked').map(c => +c.value);
    const addToItin = $('#pAddItin')?.checked !== false;
    if (addToItin) addPlace(name, lat, lng, durH, closed, budget, desc, rate, tags, image, slot, url, pos, optionGroup);
    else addCandidate(name, lat, lng, durH, closed, budget, desc, rate, tags, image, slot, url);
    ['pName', 'pLat', 'pLng', 'pDurH', 'pBudget', 'pDesc', 'pRate', 'pTags', 'pImgUrl', 'pAlt', 'pUrl', 'pPos', 'pSlot'].forEach(id => { const el = $('#' + id); if (el) el.value = '' });
    $('#pDurH').value = '2';
    if ($('#pDrop')) { $('#pDrop').dataset.img = ''; $('#pDrop').textContent = '📷 Glissez-déposez / collez une image ici' }
    ADD_IMAGE_CONTEXT = null;
    ADD_AUTO_IMAGE_URL = '';
    ADD_IMAGE_SEARCH_TOKEN += 1;
    setAddImagePreview('');
    if ($('#imageSearchStatus')) $('#imageSearchStatus').textContent = '';
    if ($('#btnFindImage')) $('#btnFindImage').disabled = false;
    $$('#addPlace ~ .week .closed').forEach(c => c.checked = false)
}
function addPlace(name, lat, lng, durationH = 2, closedDays = [], budget = 0, desc = '', initRate = null, tags = [], image = '', slot = '', url = '', insertIndex = null, optionGroup = '') {
    send('addPlace', { name, lat, lng, durationH, closedDays, budget, budgetCurrency: tripBudgetCurrencies()[0], desc, rating: initRate, tags, image, slot, url, insertIndex, optionGroup });
    if (map && isFinite(lat) && isFinite(lng)) { map.setView([lat, lng], map.getZoom()); send('setView', { center: { lat, lng, zoom: map.getZoom() } }) }
}
function addCandidate(name, lat, lng, durationH = 2, closedDays = [], budget = 0, desc = '', initRate = null, tags = [], image = '', slot = '', url = '') {
    send('addCandidate', { name, lat, lng, durationH, closedDays, budget, budgetCurrency: tripBudgetCurrencies()[0], desc, rating: initRate, tags, image, slot, url });
    if (map && isFinite(lat) && isFinite(lng)) { map.setView([lat, lng], map.getZoom()) }
}
function duplicatePlace(id, insertAt) {
    const p = state.places[id]; if (!p) return;
    send('addPlace', { name: p.name + ' (bis)', lat: p.lat, lng: p.lng, durationH: Number(p.durationH) > 0 ? p.durationH : 2, closedDays: p.closedDays || [], budget: p.budget || 0, budgetFree: p.budgetFree === true, budgetCurrency: p.budgetCurrency || 'CHF', budgetScope: p.budgetScope || 'individual', desc: p.desc || '', rating: null, tags: p.tags || [], image: p.image || '', slot: p.slot || '', url: p.url || '', insertIndex: (isFinite(insertAt) ? (insertAt - 1) : null), optionGroup: p.optionGroup || '' })
}
function removePlace(id) { if (confirm('Supprimer ce lieu ?')) send('removePlace', { id }) }
function moveUp(id) { const idx = state.itinerary.indexOf(id); if (idx > 0) { const arr = [...state.itinerary];[arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]; send('reorder', { itinerary: arr }); updateRouteSummary() } }
function moveDown(id) { const idx = state.itinerary.indexOf(id); if (idx >= 0 && idx < state.itinerary.length - 1) { const arr = [...state.itinerary];[arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]]; send('reorder', { itinerary: arr }); updateRouteSummary() } }
function moveToPosition(id, pos1) { const n = state.itinerary.length; let p = Math.max(1, Math.min(n, parseInt(pos1, 10) || 1)); const arr = state.itinerary.filter(x => x !== id); arr.splice(p - 1, 0, id); send('reorder', { itinerary: arr }); updateRouteSummary() }
function updateDurationH(id, d) { send('updatePlace', { id, patch: { durationH: Math.max(0, parseFloat(d || '0')) } }) }

function updateBudget(id, v) {
    updateBudgetDetails(id, { budget: v });
}

function updateBudgetDetails(id, patch) {
    const place = state.places[id];
    if (!place) return;
    const normalized = {};
    if ('budget' in patch) normalized.budget = Math.max(0, parseFloat(patch.budget || '0'));
    if ('budgetFree' in patch) normalized.budgetFree = patch.budgetFree === true;
    if ('budgetCurrency' in patch) {
        const currency = window.TripBudget.normalizeCurrency(patch.budgetCurrency);
        normalized.budgetCurrency = tripBudgetCurrencies().includes(currency) ? currency : tripBudgetCurrencies()[0];
    }
    if ('budgetScope' in patch) normalized.budgetScope = window.TripBudget.normalizeScope(patch.budgetScope);
    Object.assign(place, normalized);
    send('updatePlace', { id, patch: normalized });
    renderBudgetSummary();
    renderBudgetBreakdown();
    updateRouteSummary();
}

function updateTags(id, str) { const tags = String(str || '').split(',').map(s => s.trim()).filter(Boolean); send('updatePlace', { id, patch: { tags } }) }
function updateAltGroup(id, str) { send('updatePlace', { id, patch: { optionGroup: String(str || '').trim() } }) }
function updateImage(id, dataUrl) { send('updatePlace', { id, patch: { image: dataUrl || '' } }) }
async function findImageForPlace(id, button) {
    const place = state.places[id]; if (!place) return;
    const tripId = ACTIVE_TRIP, originalImage = place.image;
    const searchKey = `${tripId}:${id}`;
    if (IMAGE_SEARCHES.has(searchKey)) return;
    IMAGE_SEARCHES.add(searchKey);
    const originalLabel = button?.textContent;
    if (button) { button.disabled = true; button.textContent = 'Recherche...'; }
    try {
        const image = await window.TripWikimediaImages.findImage(place);
        if (ACTIVE_TRIP !== tripId || !state.places[id] || state.places[id].image !== originalImage) return;
        if (!image) { showToast({ type: 'warn', text: `Aucune image trouvée pour ${place.name}.` }); return }
        state.places[id].image = image;
        updateImage(id, image);
        showToast({ type: 'success', text: `Image ajoutée pour ${place.name}.` });
    } catch (error) {
        console.warn('Wikimedia image search error', error);
        showToast({ type: 'error', text: `Recherche d’image impossible pour ${place.name}.` });
    } finally {
        IMAGE_SEARCHES.delete(searchKey);
        if (button) { button.disabled = false; button.textContent = originalLabel; }
        if (ACTIVE_TRIP === tripId) renderTripOutline();
    }
}
async function fillMissingImages() {
    if (FILLING_IMAGES) return;
    const buttons = $$('[data-fill-images]');
    const statuses = $$('[data-fill-images-status], #fillImagesStatus');
    const setStatus = text => statuses.forEach(status => { status.textContent = text; });
    const tripId = ACTIVE_TRIP;
    const entries = Object.entries(state.places).filter(([, place]) => window.TripWikimediaImages.needsImage(place));
    if (!entries.length) { showToast({ type: 'info', text: 'Toutes les images sont déjà renseignées.' }); return }
    FILLING_IMAGES = true;
    buttons.forEach(button => { button.disabled = true; });
    let found = 0;
    try {
        for (let index = 0; index < entries.length; index += 1) {
            if (ACTIVE_TRIP !== tripId) break;
            const [id, place] = entries[index];
            const originalImage = place.image;
            setStatus(`${index + 1}/${entries.length} : ${place.name}`);
            try {
                const image = await window.TripWikimediaImages.findImage(place);
                if (ACTIVE_TRIP !== tripId) break;
                if (image && state.places[id] && state.places[id].image === originalImage) {
                    state.places[id].image = image;
                    updateImage(id, image);
                    renderTripOutline();
                    found += 1;
                }
            } catch (error) {
                console.warn(`Wikimedia image search error for ${place.name}`, error);
            }
        }
        if (ACTIVE_TRIP !== tripId) { setStatus('Recherche interrompue : le voyage a changé.'); return; }
        setStatus(`${found}/${entries.length} photo${found > 1 ? 's' : ''} ajoutée${found > 1 ? 's' : ''}${found < entries.length ? ' · Certains lieux restent à compléter manuellement.' : ''}`);
        showToast({ type: found ? 'success' : 'warn', text: found ? `${found} photo${found > 1 ? 's' : ''} ajoutée${found > 1 ? 's' : ''}.` : 'Aucune photo trouvée.' });
    } finally {
        FILLING_IMAGES = false;
        buttons.forEach(button => { button.disabled = false; });
    }
}
function updateUrl(id, u) { send('updatePlace', { id, patch: { url: String(u || '').trim() } }) }
function toggleClosed(id, day, checked) { let p = state.places[id]; if (!p) return; const arr = new Set(p.closedDays || []); if (checked) arr.add(day); else arr.delete(day); send('updatePlace', { id, patch: { closedDays: Array.from(arr) } }) }
function ratePlace(id, rating) { const r = Math.max(1, Math.min(6, parseInt(rating, 10) || 0)); if (!r) return; send('ratePlace', { id, rating: r }) }
function setupDrop(el, onDataUrl) { if (!el) return; el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag') }); el.addEventListener('dragleave', () => el.classList.remove('drag')); el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('drag'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) { const r = new FileReader(); r.onload = () => onDataUrl(r.result); r.readAsDataURL(f) } }); el.addEventListener('paste', e => { const it = (e.clipboardData.items || [])[0]; if (it && it.type.startsWith('image/')) { const f = it.getAsFile(); const r = new FileReader(); r.onload = () => onDataUrl(r.result); r.readAsDataURL(f) } }) }

/* ---------- Liens carte ↔ lieux ↔ planning ---------- */
function setActiveMarker(id, on = true) { const mk = markers[id]; const pin = mk && mk._icon ? mk._icon.querySelector('.pin') : null; if (pin) pin.classList.toggle('active', !!on) }
function focusPlace(id, opts = {}) {
    const p = state.places[id]; if (!p) return; const { pan = true, openPopup = true, pulse = true, scrollList = true, flashPlan = true } = opts;
    const mk = markers[id]; if (map && pan) map.setView([p.lat, p.lng], map.getZoom(), { animate: true }); if (mk && openPopup) mk.openPopup();
    if (pulse) { if (ACTIVE_ID && ACTIVE_ID !== id) setActiveMarker(ACTIVE_ID, false); setActiveMarker(id, true); setTimeout(() => setActiveMarker(id, false), 1600); ACTIVE_ID = id }
    const card = document.querySelector(`#places .item[data-id="${id}"]`) || document.querySelector(`#candidates .item[data-id="${id}"]`);
    if (card) { if (scrollList) card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('hl'); setTimeout(() => card.classList.remove('hl'), 1200) }
    if (flashPlan) { $$('#planWrap tr[data-id]').forEach(tr => tr.classList.toggle('hl', tr.getAttribute('data-id') === id)) }
}

/* ---------- OSRM (unique) ---------- */
const OSRM_PROVIDERS = ['https://router.project-osrm.org/route/v1/driving', 'https://routing.openstreetmap.de/routed-car/route/v1/driving'];
const OSRM_TABLE_PROVIDERS = ['https://router.project-osrm.org/table/v1/driving', 'https://routing.openstreetmap.de/routed-car/table/v1/driving'];
async function fetchOsrmRoute(locs, params = 'overview=full&geometries=geojson&steps=false&annotations=distance,duration') { let last = null; for (const base of OSRM_PROVIDERS) { const url = `${base}/${locs}?${params}`; try { const res = await fetch(url, { headers: { 'Accept': 'application/json' } }); if (!res.ok) throw new Error(`${res.status} ${res.statusText}`); const js = await res.json(); const route = js?.routes?.[0]; if (route) { LAST_PROVIDER = base; return { route, used: base } } throw new Error('Réponse OSRM sans route') } catch (e) { last = e } } throw last || new Error('Tous les endpoints OSRM ont échoué') }
async function fetchOsrmTable(ids) {
    const locations = ids.map(id => state.places[id]);
    const coords = locations.map(place => `${place.lng},${place.lat}`).join(';');
    let lastError = null;
    for (const base of OSRM_TABLE_PROVIDERS) {
        try {
            const response = await fetch(`${base}/${coords}?annotations=duration,distance`, { headers: { 'Accept': 'application/json' } });
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            const result = await response.json();
            if (!Array.isArray(result.durations) || !Array.isArray(result.distances)) throw new Error('Matrice OSRM incomplète');
            LAST_PROVIDER = base;
            return { durations: result.durations, distances: result.distances, source: base.includes('project-osrm') ? 'OSRM demo' : 'FOSSGIS' };
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('Matrice OSRM indisponible');
}

function estimatedRouteTable(ids) {
    const speedKmh = Math.max(1, Number($('#speed')?.value) || 60);
    const distances = ids.map(from => ids.map(to => kmBetween(state.places[from], state.places[to]) * 1000));
    const durations = distances.map(row => row.map(metres => (metres / 1000) / speedKmh * 3600));
    return { durations, distances, source: 'estimation à vol d’oiseau' };
}

function routeMetrics(route, table) {
    return {
        minutes: TripRouteOptimizer.routeCost(route, table.durations) / 60,
        km: TripRouteOptimizer.routeCost(route, table.distances) / 1000
    };
}

function closeRouteProposal() {
    ROUTE_PROPOSAL = null;
    const wrap = $('#routeProposal');
    if (wrap) { wrap.hidden = true; wrap.innerHTML = '' }
}

function renderRouteProposal(proposal) {
    const wrap = $('#routeProposal'); if (!wrap) return;
    ROUTE_PROPOSAL = proposal;
    const gainMinutes = Math.max(0, proposal.current.minutes - proposal.optimized.minutes);
    const gainKm = Math.max(0, proposal.current.km - proposal.optimized.km);
    const percent = proposal.current.minutes > 0 ? Math.round(gainMinutes / proposal.current.minutes * 100) : 0;
    const names = proposal.route.map(index => state.places[proposal.ids[index]]?.name || proposal.ids[index]);
    const fixedCount = (state.planning?.reservations || []).filter(item => (item.placeIds || [item.placeId]).some(placeId => placeId && proposal.ids.includes(placeId))).length;
    wrap.hidden = false;
    wrap.innerHTML = `
        <div><strong>Proposition de tournée fermée</strong><div class="route-proposal__note">${escapeHtml(proposal.source)} · point de départ verrouillé au départ et au retour${proposal.returnAdded ? ' · retour au point de départ ajouté' : ''}${fixedCount ? ` · ${fixedCount} date${fixedCount > 1 ? 's' : ''} fixe${fixedCount > 1 ? 's' : ''} conservée${fixedCount > 1 ? 's' : ''}` : ''}</div></div>
        <div class="route-proposal__metrics">
            <div><span>Ordre actuel</span><strong>${proposal.current.km.toFixed(1)} km · ${fmtDurMin(Math.round(proposal.current.minutes))}</strong></div>
            <div><span>Ordre proposé</span><strong>${proposal.optimized.km.toFixed(1)} km · ${fmtDurMin(Math.round(proposal.optimized.minutes))}</strong></div>
            <div><span>Gain estimé</span><strong>${gainKm.toFixed(1)} km · ${fmtDurMin(Math.round(gainMinutes))} (${percent} %)</strong></div>
        </div>
        <div class="route-proposal__path">${names.map(escapeHtml).join(' → ')}</div>
        <div class="route-proposal__actions"><button class="btn" type="button" data-route-cancel>Annuler</button><button class="btn primary" type="button" data-route-apply>Appliquer cet ordre</button></div>`;
    wrap.querySelector('[data-route-cancel]').onclick = closeRouteProposal;
    wrap.querySelector('[data-route-apply]').onclick = applyRouteProposal;
}

function applyRouteProposal() {
    const proposal = ROUTE_PROPOSAL;
    if (!proposal || JSON.stringify(state.itinerary) !== JSON.stringify(proposal.storedIds) || tripStartPlaceId() !== proposal.startPlaceId) {
        closeRouteProposal();
        showToast({ type: 'warn', text: 'L’itinéraire a changé. Relancez l’optimisation.' });
        return;
    }
    const optimizedIds = proposal.route.map(index => proposal.ids[index]);
    send('reorder', { itinerary: optimizedIds, startPlaceId: proposal.startPlaceId });
    for (let i = 0; i < proposal.route.length - 1; i++) {
        const fromIndex = proposal.route[i], toIndex = proposal.route[i + 1];
        const metres = proposal.table.distances[fromIndex]?.[toIndex];
        const seconds = proposal.table.durations[fromIndex]?.[toIndex];
        if (metres != null && seconds != null) setEdgeReal(proposal.ids[fromIndex], proposal.ids[toIndex], Math.round(metres / 100) / 10, Math.round(seconds / 60));
    }
    closeRouteProposal();
    showToast({ type: 'success', text: 'Nouvel ordre appliqué. Le point de départ reste la première et la dernière étape.' });
}

async function proposeOptimizedRoute() {
    const button = $('#btnOptimizeRoute');
    const storedIds = [...state.itinerary];
    const originalIds = tripItineraryFromStart();
    const startPlaceId = tripStartPlaceId();
    if (originalIds.length < 2) { showToast({ type: 'warn', text: 'Il faut un point de départ et au moins un lieu à visiter.' }); return }
    const first = state.places[originalIds[0]], last = state.places[originalIds.at(-1)];
    if (!first || !last) { showToast({ type: 'warn', text: 'Certaines étapes de l’itinéraire sont introuvables.' }); return }
    const hasReturnHome = originalIds[0] === originalIds.at(-1) || kmBetween(first, last) <= 0.1;
    const ids = hasReturnHome ? originalIds : [...originalIds, originalIds[0]];
    const returnAdded = !hasReturnHome;
    if (ids.length > 50) { showToast({ type: 'warn', text: 'L’optimisation est limitée à 50 étapes.' }); return }
    closeRouteProposal();
    if (button) { button.disabled = true; button.textContent = 'Calcul en cours…' }
    try {
        let table;
        try {
            table = await fetchOsrmTable(ids);
        } catch (error) {
            console.warn('Matrice OSRM indisponible, utilisation de l’estimation', error);
            table = estimatedRouteTable(ids);
            showToast({ type: 'warn', text: 'OSRM indisponible : proposition basée sur les distances à vol d’oiseau.' });
        }
        const currentRoute = ids.map((_, index) => index);
        const result = TripRouteOptimizer.optimizeRoundTrip(table.durations);
        if (!result) throw new Error('Certains lieux ne sont pas reliés par la route');
        const current = routeMetrics(currentRoute, table);
        const optimized = routeMetrics(result.route, table);
        if (!returnAdded && optimized.minutes + 0.5 >= current.minutes) {
            showToast({ type: 'success', text: 'L’ordre actuel est déjà optimal selon les temps de trajet.' });
            return;
        }
        renderRouteProposal({ storedIds, originalIds, startPlaceId, ids, route: result.route, table, current, optimized, source: table.source, returnAdded });
    } catch (error) {
        showToast({ type: 'error', text: `Optimisation impossible : ${String(error.message || error)}` });
    } finally {
        if (button) { button.disabled = false; button.textContent = 'Optimiser la tournée' }
    }
}
const throttle = (fn, delay) => { let last = 0, t = null, args = null; return (...a) => { const now = Date.now(), rem = delay - (now - last); args = a; if (rem <= 0) { clearTimeout(t); t = null; last = now; fn(...args) } else if (!t) { t = setTimeout(() => { last = Date.now(); t = null; fn(...args) }, rem) } } }
const drawRouteRealThrottled = throttle(drawRouteReal, 800);
async function drawRouteReal() {
    if (!routeLayer) return; routeLayer.clearLayers();
    const ids = routeIdsForCurrentView(); if (!ids || ids.length < 2) return;
    const coords = ids.map(id => state.places[id]).filter(Boolean).map(p => ({ lat: p.lat, lng: p.lng }));
    const locs = coords.map(c => `${c.lng},${c.lat}`).join(';');
    try {
        const { route } = await fetchOsrmRoute(locs);
        const geom = route.geometry, legs = route.legs || [];
        if (geom) { const real = L.geoJSON(geom, { style: { color: '#7aa2ff', weight: 5, opacity: 0.9 } }).addTo(routeLayer); try { map.fitBounds(real.getBounds(), { padding: [30, 30] }) } catch (_) { } }
        for (let i = 0; i < legs.length; i++) { const leg = legs[i]; const dk = (leg.annotation?.distance || []).reduce((a, b) => a + b, 0) || leg.distance || 0; const ds = (leg.annotation?.duration || []).reduce((a, b) => a + b, 0) || leg.duration || 0; const km = Math.round((dk / 1000) * 10) / 10; const min = Math.round(ds / 60); const f = ids[i], t = ids[i + 1]; const cur = getEdge(f, t); if (!cur || cur.realKm !== km || cur.realMin !== min) setEdgeReal(f, t, km, min) }
        for (let i = 0; i < ids.length - 1; i++) { const a = state.places[ids[i]], b = state.places[ids[i + 1]]; const speedKmh = parseFloat($('#speed')?.value || '60'); const est = estimateTravel(a, b, speedKmh); const over = getEdge(ids[i], ids[i + 1]); const txt = `${a.name} → ${b.name} — th: ${est.km} km • ≈ ${fmtDurMin(est.min)}` + (over && over.realKm != null ? `<br>réel: ${over.realKm} km • ≈ ${fmtDurMin(over.realMin)}` : ''); L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { weight: 8, opacity: 0 }).addTo(routeLayer).bindTooltip(txt, { sticky: true }) }
    } catch (e) {
        console.warn('OSRM indisponible, fallback vol d’oiseau', e); showToast({ type: 'warn', text: `Routage indisponible: ${String(e.message || e)}` });
        const latlngs = ids.map(id => state.places[id]).filter(Boolean).map(p => [p.lat, p.lng]); const poly = L.polyline(latlngs, { weight: 4, opacity: 0.9, color: '#7aa2ff' }).addTo(routeLayer);
        try { map.fitBounds(poly.getBounds(), { padding: [30, 30] }) } catch (_) { }
    } finally { updateRouteSummary() }
}
async function osrmRoute(a, b) { const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false&alternatives=false&steps=false&annotations=distance,duration`; const r = await fetch(url, { headers: { 'Accept': 'application/json' } }); if (!r.ok) throw new Error('OSRM HTTP ' + r.status); const js = await r.json(); const R = js?.routes?.[0]; if (!R) throw new Error('OSRM: pas de route'); return { km: Math.round((R.distance || 0) / 100) / 10, min: Math.round((R.duration || 0) / 60) } }
async function computeOsrmAll() { const itinerary = tripItineraryFromStart(); if (itinerary.length < 2) { showToast({ text: 'Ajouter au moins 2 lieux.', type: 'warn' }); return } let ok = 0, fail = 0; for (let i = 0; i < itinerary.length - 1; i++) { const a = state.places[itinerary[i]], b = state.places[itinerary[i + 1]]; try { const r = await osrmRoute(a, b); setEdgeReal(itinerary[i], itinerary[i + 1], r.km, r.min); ok++ } catch (e) { fail++ } } showToast({ text: `Distances réelles: ${ok} ok, ${fail} échec(s).`, type: fail ? 'warn' : 'success' }); updateRouteSummary() }
function setEdgeReal(f, t, km, min) { send('setEdge', { from: f, to: t, realKm: isNaN(km) ? null : Number(km), realMin: isNaN(min) ? null : Number(min) }) }

/* ---------- Alternatives & tri ---------- */
function groupScores() { const g = {}; for (const id of state.itinerary) { const p = state.places[id]; if (!p || !p.optionGroup) continue; const vals = p.ratings ? Object.values(p.ratings).map(Number).filter(n => !Number.isNaN(n)) : []; const s = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : 0; (g[p.optionGroup] = g[p.optionGroup] || []).push({ id, score: s }) } return g }
function arbitrateAlternatives() { const groups = groupScores(); const ids = [...state.itinerary]; ids.sort((a, b) => { const pa = state.places[a], pb = state.places[b]; const ga = pa && pa.optionGroup, gb = pb && pb.optionGroup; if (!ga && !gb) return 0; if (ga && gb && ga === gb) { const sa = (groups[ga].find(x => x.id === a) || {}).score || 0; const sb = (groups[gb].find(x => x.id === b) || {}).score || 0; return (sb - sa) } return 0 }); send('reorder', { itinerary: ids }); updateRouteSummary() }
function sortByScore() { const ids = [...state.itinerary]; const scores = {}; ids.forEach(id => { const p = state.places[id]; const vals = p?.ratings ? Object.values(p.ratings).map(Number).filter(n => !Number.isNaN(n)) : []; scores[id] = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : -1 }); ids.sort((a, b) => (scores[b] - scores[a]) || 0); send('reorder', { itinerary: ids }); updateRouteSummary() }

/* ---------- Planning (slots + blocs) ---------- */
function isClosed(place, dt) { const closed = new Set(place.closedDays || []); return closed.has(dow(dt)) }
function alignToSlot(t, slot, dayStartMins, lunchAt, lunchEnd, aftEnd, dinerAt, dinerEnd, nightAt) {
    if (!slot) return new Date(t);
    const base = new Date(t); base.setHours(0, 0, 0, 0); const dayMin = (d) => { const dt = new Date(base); dt.setMinutes(d, 0, 0); return dt };
    const windows = { morning: [dayMin(dayStartMins), dayMin(Math.min(lunchAt, aftEnd))], midday: [dayMin(lunchAt), dayMin(lunchEnd)], afternoon: [dayMin(lunchEnd), dayMin(aftEnd)], evening: [dayMin(dinerAt), dayMin(dinerEnd)], night: [dayMin(nightAt), dayMin(24 * 60)] };
    let [s, e] = windows[slot] || [new Date(t), new Date(t)];
    if (t < s) return new Date(s);
    if (t > e) { const next = new Date(base); next.setDate(next.getDate() + 1); next.setHours(0, 0, 0, 0); const dt = new Date(next.getTime()); dt.setMinutes((windows[slot][0].getHours() * 60) + windows[slot][0].getMinutes(), 0, 0); return dt }
    return new Date(t);
}
function generateLegacyPlan() {
    const itinerary = tripItineraryFromStart();
    if (itinerary.length === 0) { showToast({ text: 'Ajoutez des lieux d’abord.', type: 'warn' }); return }
    const startDate = $('#startDate')?.value; if (!startDate) { showToast({ text: 'Choisissez une date de début.', type: 'warn' }); return }
    const startTime = $('#startTime')?.value || '09:00', dayStart = $('#dayStart')?.value || '09:00', dayEnd = $('#dayEnd')?.value || '18:00';
    const templ = $('#templMode')?.checked; const lunchAt = toMin($('#lunchAt')?.value || '12:30'); const lunchDur = Number($('#lunchDur')?.value || 60); const lunchEnd = lunchAt + lunchDur;
    const dinerAt = toMin($('#dinerAt')?.value || '19:30'); const dinerDur = Number($('#dinerDur')?.value || 60); const dinerEnd = dinerAt + dinerDur; const nightAt = toMin($('#nightAt')?.value || '22:00');
    const { h: dh1, m: dm1 } = parseTime(dayStart), { h: dh2, m: dm2 } = parseTime(dayEnd);
    const dayStartMins = dh1 * 60 + dm1, dayEndMins = dh2 * 60 + dm2, aftEnd = Math.min(dayEndMins, Math.max(lunchEnd + 240, dayEndMins));
    const speedKmh = parseFloat($('#speed')?.value || '60');
    let t = new Date(`${startDate}T${startTime}:00`);
    const plan = []; function add(kind, data) { plan.push({ kind, ...data }) }
    function fitTravel(min) { if (min <= 0) return; let start = new Date(t), end = new Date(t.getTime() + min * 60000); const curM = t.getHours() * 60 + t.getMinutes(); if (curM >= dayEndMins) { t.setDate(t.getDate() + 1); t.setHours(Math.floor(dayStartMins / 60), dayStartMins % 60, 0, 0); start = new Date(t); end = new Date(t.getTime() + min * 60000) } add('travel', { start, end }); t = end }
    function fitVisit(place, minutes, placeId) {
        if (minutes <= 0) return;
        if (templ && place.slot) { t = alignToSlot(t, place.slot, dayStartMins, lunchAt, lunchEnd, aftEnd, dinerAt, dinerEnd, nightAt) }
        let remaining = minutes;
        while (remaining > 0) {
            const curM = t.getHours() * 60 + t.getMinutes();
            if (curM < dayStartMins) { t.setHours(Math.floor(dayStartMins / 60), dayStartMins % 60, 0, 0) }
            if (curM >= dayEndMins) { t.setDate(t.getDate() + 1); t.setHours(Math.floor(dayStartMins / 60), dayStartMins % 60, 0, 0) }
            let windowEnd = dayEndMins;
            if (templ && place.slot) {
                if (place.slot === 'midday') windowEnd = lunchEnd;
                else if (place.slot === 'evening') windowEnd = dinerEnd;
                else if (place.slot === 'night') windowEnd = 24 * 60;
                else if (place.slot === 'morning') windowEnd = Math.min(lunchAt, dayEndMins);
                else if (place.slot === 'afternoon') windowEnd = Math.min(dinerAt, dayEndMins);
            }
            const room = windowEnd - (t.getHours() * 60 + t.getMinutes());
            const use = Math.max(0, Math.min(remaining, room));
            const start = new Date(t); const end = new Date(t.getTime() + use * 60000);
            add('visit', { id: placeId, title: place.name, start, end, closed: isClosed(place, start), slot: place.slot || '' });
            t = end; remaining -= use;
            if (remaining > 0) {
                t.setDate(t.getDate() + (place.slot === 'night' ? 1 : 0));
                if (place.slot === 'night') { t.setHours(Math.floor(dayStartMins / 60), dayStartMins % 60, 0, 0) }
                else { t = alignToSlot(t, place.slot || '', dayStartMins, lunchAt, lunchEnd, aftEnd, dinerAt, dinerEnd, nightAt) }
            }
        }
    }
    for (let i = 0; i < itinerary.length; i++) {
        const place = state.places[itinerary[i]], placeId = itinerary[i];
        if (i > 0) { const prev = state.places[itinerary[i - 1]]; const over = getEdge(itinerary[i - 1], itinerary[i]); const est = estimateTravel(prev, place, speedKmh); const min = (over && over.realMin != null) ? Number(over.realMin) : est.min; fitTravel(min) }
        const durMins = Math.round((parseFloat(place.durationH || 0) || 0) * 60); fitVisit(place, durMins, placeId)
    }
    PLAN = plan;
    const rows = plan.map(ev => {
        if (ev.kind === 'travel') return `<tr><td>${fmtTime(ev.start)}</td><td>${fmtTime(ev.end)}</td><td>Déplacement</td><td></td></tr>`;
        if (ev.kind === 'meal') return `<tr><td>${fmtTime(ev.start)}</td><td>${fmtTime(ev.end)}</td><td>Repas</td><td>${ev.title || ''}</td></tr>`;
        if (ev.kind === 'night') return `<tr><td>${fmtTime(ev.start)}</td><td>${fmtTime(ev.end)}</td><td>Nuit</td><td>${ev.title || ''}</td></tr>`;
        return `<tr data-id="${ev.id}"><td>${fmtTime(ev.start)}</td><td>${fmtTime(ev.end)}</td><td>Visite</td><td><button class="linklike" data-focus="${ev.id}" title="Voir sur la carte">📍</button> ${ev.title}${ev.closed ? ' <span class="err">⚠ fermé ce jour</span>' : ''}${ev.slot ? ` <span class="muted">(${ev.slot})</span>` : ''}</td></tr>`;
    }).join('');
    const pw = $('#planWrap'); pw.className = 'panel'; pw.innerHTML = `<table class="plan"><thead><tr><th>Début</th><th>Fin</th><th>Type</th><th>Détails</th></tr></thead><tbody>${rows}</tbody></table>`;
    pw.addEventListener('click', (e) => { const btn = e.target.closest('[data-focus]'); const id = btn ? btn.getAttribute('data-focus') : (e.target.closest('tr[data-id]')?.getAttribute('data-id') || null); if (id) focusPlace(id, { pan: true, openPopup: true }) });
    renderBudgetSummary(); updateRouteSummary();
}

/* ---------- Segments / Budget / Summary ---------- */
function renderSegments() {
    const wrap = $('#itineraryDetails'); if (!wrap) return;
    const itinerary = tripItineraryFromStart();
    const speedKmh = parseFloat($('#speed')?.value || '60'); let html = '';
    if (itinerary.length <= 1) { html = '<div class="muted">Ajoutez au moins 2 lieux pour voir les segments.</div>' }
    else {
        let totalKm = 0, totalMin = 0, totalRealKm = 0, totalRealMin = 0;
        html += '<table class="plan"><thead><tr><th>De</th><th>À</th><th>Théorique</th><th>Réel (km)</th></tr></thead><tbody>';
        for (let i = 0; i < itinerary.length - 1; i++) {
            const a = state.places[itinerary[i]], b = state.places[itinerary[i + 1]];
            const est = estimateTravel(a, b, speedKmh); totalKm += est.km; totalMin += est.min;
            const over = getEdge(itinerary[i], itinerary[i + 1]) || {};
            totalRealKm += (over.realKm != null ? Number(over.realKm) : est.km);
            totalRealMin += (over.realMin != null ? Number(over.realMin) : est.min);
            html += `<tr data-f="${itinerary[i]}" data-t="${itinerary[i + 1]}"><td>${a.name}</td><td>${b.name}</td><td>${est.km} km • ${fmtDurMin(est.min)}</td><td><input type="number" step="0.1" min="0" value="${over.realKm ?? ''}" data-f="${itinerary[i]}" data-t="${itinerary[i + 1]}" class="edgeKm"/></td></tr>`
        }
        html += '</tbody></table>';
        html += `<div style="margin-top:8px"><b>Total théorique</b> — ${Math.round(totalKm * 10) / 10} km • ≈ ${fmtDurMin(totalMin)}<br/><b>Total estimé (avec données réelles)</b> — ${Math.round(totalRealKm * 10) / 10} km • ≈ ${fmtDurMin(Math.round(totalRealMin))}</div>`
    }
    wrap.innerHTML = html;
    $$('#itineraryDetails .edgeKm').forEach(inp => { inp.onchange = () => { setEdgeReal(inp.dataset.f, inp.dataset.t, parseFloat(inp.value), getEdge(inp.dataset.f, inp.dataset.t)?.realMin ?? null); updateRouteSummary(); } });
    wrap.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-t]'); if (!tr) return; const idTo = tr.getAttribute('data-t'); if (idTo) focusPlace(idTo, { pan: true, openPopup: true }) });
}

function renderBudgetSummary() {
    const wrap = $('#budgetSummary');
    if (!wrap) return;
    const people = Math.max(1, parseInt($('#people')?.value || '1', 10));
    const budget = window.TripBudget.calculate(state.itinerary, state.places, people);
    if (!budget.entries.length) {
        wrap.innerHTML = '<div class="muted">Aucune étape dans l’itinéraire pour calculer un budget.</div>';
        return;
    }
    if (!budget.currencies.length) {
        wrap.innerHTML = `<div class="budget-summary__title">Budget global pour ${people} personne${people > 1 ? 's' : ''}</div><div class="budget-summary__free">Toutes les étapes sont gratuites.</div>`;
        return;
    }
    wrap.innerHTML = `
      <div class="budget-summary__title">Budget global pour ${people} personne${people > 1 ? 's' : ''}</div>
      <div class="budget-summary__totals">
        ${budget.currencies.sort().map(currency => {
            const total = budget.nativeTotals[currency];
            return `<div class="budget-total"><strong>${fmtMoney(total, currency)}</strong><span>${fmtMoney(total / people, currency)} /pers.</span></div>`;
        }).join('')}
      </div>`;
}

function renderBudgetBreakdown() {
    const wrap = $('#budgetBreakdown');
    if (!wrap) return;

    const people = Math.max(1, parseInt($('#people')?.value || '1', 10));
    const budget = window.TripBudget.calculate(state.itinerary, state.places, people);

    if (!budget.entries.length) {
        wrap.innerHTML = '<div class="muted">Aucune étape dans l’itinéraire pour calculer un budget.</div>';
        return;
    }

    wrap.innerHTML = budget.entries.map(entry => {
        const place = state.places[entry.id];
        return `
          <div class="item budget-item" data-id="${escapeHtml(entry.id)}">
            <div class="budget-item__name">${escapeHtml(place.name || entry.id)}</div>
            <label class="budget-free">
              <input type="checkbox" ${entry.free ? 'checked' : ''} /> Gratuit
            </label>
            <label class="budget-paid-field" ${entry.free ? 'hidden' : ''}>Coût
              <input class="budget-amount" type="number" min="0" step="0.05" value="${entry.storedAmount}" />
            </label>
            <label class="budget-paid-field" ${entry.free ? 'hidden' : ''}>Devise
              <select class="budget-currency" aria-label="Devise pour ${escapeHtml(place.name || entry.id)}">
                ${tripBudgetCurrencies().map(currency => `<option value="${currency}" ${currency === entry.currency ? 'selected' : ''}>${currency}</option>`).join('')}
              </select>
            </label>
            <label class="budget-paid-field" ${entry.free ? 'hidden' : ''}>Type de coût
              <select class="budget-scope">
                <option value="individual" ${entry.scope === 'individual' ? 'selected' : ''}>Individuel</option>
                <option value="group" ${entry.scope === 'group' ? 'selected' : ''}>Groupe</option>
              </select>
            </label>
            <div class="budget-item__calculation" ${entry.free ? 'hidden' : ''}>
              <span>${fmtMoney(entry.groupAmount, entry.currency)} groupe</span>
              <span>${fmtMoney(entry.perPersonAmount, entry.currency)} /pers.</span>
            </div>
          </div>`;
    }).join('');

    wrap.querySelectorAll('.budget-item').forEach(item => {
        const id = item.dataset.id;
        item.querySelector('.budget-free input').onchange = event => updateBudgetDetails(id, { budgetFree: event.target.checked });
        item.querySelector('.budget-amount').onchange = event => updateBudgetDetails(id, { budget: event.target.value });
        item.querySelector('.budget-currency').onchange = event => updateBudgetDetails(id, { budgetCurrency: event.target.value });
        item.querySelector('.budget-scope').onchange = event => updateBudgetDetails(id, { budgetScope: event.target.value });
    });
}

function updateRouteSummary() {
    const wrap = $('#routeSummary'); if (!wrap) return;
    const itinerary = routeIdsForCurrentView();
    const people = Math.max(1, parseInt($('#people')?.value || '1', 10));
    let totKm = 0, totMin = 0, totRealKm = 0, totRealMin = 0; const speedKmh = parseFloat($('#speed')?.value || '60');
    for (let i = 0; i < itinerary.length - 1; i++) {
        const a = state.places[itinerary[i]], b = state.places[itinerary[i + 1]];
        const est = estimateTravel(a, b, speedKmh), over = getEdge(itinerary[i], itinerary[i + 1]) || {};
        totKm += est.km; totMin += est.min; totRealKm += (over.realKm != null ? Number(over.realKm) : est.km); totRealMin += (over.realMin != null ? Number(over.realMin) : est.min);
    }
    const budget = window.TripBudget.calculate(state.itinerary, state.places, people);
    const budgetTotal = budget.currencies.sort().map(currency => fmtMoney(budget.nativeTotals[currency], currency)).join(' + ') || (budget.entries.every(entry => entry.free) ? 'Gratuit' : fmtChf(0));
    const provider = LAST_PROVIDER ? (LAST_PROVIDER.includes('project-osrm') ? 'OSRM demo' : 'FOSSGIS') : '—';
    const scope = document.body.dataset.page === 'overview' ? 'Trame globale' : 'Itinéraire complet';
    wrap.innerHTML = [`<span class="pill route-scope">${scope}</span>`, `<span class="pill">Théo: ${Math.round(totKm * 10) / 10} km • ${fmtDurMin(totMin)}</span>`, `<span class="pill">Réel: ${Math.round(totRealKm * 10) / 10} km • ${fmtDurMin(Math.round(totRealMin))}</span>`, `<span class="pill">Budget total: ${budgetTotal}</span>`, `<span class="pill">Routage: ${provider}</span>`].join(' ')
}

/* ---------- Search/forms + FAB bottom-sheet ---------- */
function initSearchAndForms() {
    const q = $('#searchQ'); if (q) q.addEventListener('input', onSearchInput);
    if ($('#searchBtn')) $('#searchBtn').onclick = () => doSearch($('#searchQ').value.trim());
    if ($('#btnFindImage')) $('#btnFindImage').onclick = () => fillAddFormImage(true);
    $$('[data-fill-images]').forEach(button => { button.onclick = fillMissingImages; });
    if ($('#addPlace')) $('#addPlace').onclick = addPlaceFromForm;
    if ($('#genPlan')) $('#genPlan').onclick = () => generatePlan();
    if ($('#exportPlanningOnlyPdf')) $('#exportPlanningOnlyPdf').onclick = () => exportPlanningOnlyPdf();
    $$('[data-export-routes-pdf]').forEach(button => { button.onclick = exportRoutesPdf; });
    $$('[data-export-stage-routes-pdf]').forEach(button => { button.onclick = exportStageRoutesPdf; });
    if ($('#exportPlanPdf')) $('#exportPlanPdf').onclick = () => exportPlanningPdf();
    if ($('#fixedAdd')) $('#fixedAdd').onclick = saveFixedDate;
    if ($('#fixedCancelEdit')) $('#fixedCancelEdit').onclick = resetFixedForm;
    if ($('#fixedKind')) $('#fixedKind').onchange = toggleFixedMealField;
    if ($('#fixedDateMode')) $('#fixedDateMode').onchange = () => toggleFixedDateMode();
    $$('[data-shift-target]').forEach(button => button.onclick = () => shiftPlanningDate(button.dataset.shiftTarget, Number(button.dataset.shiftDays) || 0));
    if ($('#dCancel')) $('#dCancel').onclick = () => $('#dlg').classList.remove('open');
    if ($('#dAdd')) $('#dAdd').onclick = () => { addPlace($('#dName').value, parseFloat($('#dLat').value), parseFloat($('#dLng').value), parseFloat($('#dDurH').value || '2'), [], parseFloat($('#dBudget').value || '0'), ($('#dDesc').value || '').trim(), $('#dRate').value ? parseInt($('#dRate').value, 10) : null, [], '', $('#dSlot').value || '', $('#dUrl').value.trim(), $('#dPos').value ? (parseInt($('#dPos').value, 10) - 1) : null); $('#dlg').classList.remove('open') }
    setupDrop($('#pDrop'), (dataUrl) => { $('#pDrop').dataset.img = dataUrl; $('#pDrop').textContent = 'Image prête ✔'; ADD_AUTO_IMAGE_URL = ''; setAddImagePreview(dataUrl) });
    if ($('#pImgUrl')) $('#pImgUrl').oninput = () => {
        ADD_IMAGE_SEARCH_TOKEN += 1;
        ADD_AUTO_IMAGE_URL = '';
        $('#btnFindImage').disabled = false;
        $('#imageSearchStatus').textContent = '';
        if ($('#pImgUrl').value) { $('#pDrop').dataset.img = ''; $('#pDrop').textContent = 'URL entrée (optionnellement)' }
        setAddImagePreview($('#pImgUrl').value);
    }
    ['pName', 'pLat', 'pLng'].forEach(id => $('#' + id)?.addEventListener('input', () => {
        ADD_IMAGE_CONTEXT = null;
        ADD_IMAGE_SEARCH_TOKEN += 1;
        $('#btnFindImage').disabled = false;
    }));

    if ($('#btnSortScore')) $('#btnSortScore').onclick = sortByScore;
    if ($('#btnSortScoreRight')) $('#btnSortScoreRight').onclick = sortByScore;
    if ($('#btnOptimizeRoute')) $('#btnOptimizeRoute').onclick = proposeOptimizedRoute;
    if ($('#btnOsrm')) $('#btnOsrm').onclick = computeOsrmAll;
    if ($('#btnArbitrate')) $('#btnArbitrate').onclick = arbitrateAlternatives;

    const sheet = $('#sheet'), fab = $('#fabAdd');

    function closeSheet() {
        if (!sheet) return;
        sheet.classList.remove('open');
        sheet.setAttribute('aria-hidden', 'true');
    }
    function openSheet() {
        if (!sheet) return;
        sheet.classList.add('open');
        sheet.setAttribute('aria-hidden', 'false');
        $('#sQ')?.focus();
    }

    if ($('#sheetClose')) $('#sheetClose').onclick = closeSheet;
    if ($('#sCancel')) $('#sCancel').onclick = closeSheet;
    if (fab) fab.onclick = openSheet;

    // clic sur fond sombre = fermer
    if (sheet) sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
    // Échap = fermer
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });    
    const sDur = $('#sDur'), sDurVal = $('#sDurVal'); if (sDur && sDurVal) { sDur.oninput = () => { sDurVal.textContent = Number(sDur.value).toFixed(2) } }
    const sTagsWrap = $('#sTags'); if (sTagsWrap) sTagsWrap.addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b || b.classList.contains('chip-input')) return; b.classList.toggle('on') });
    if ($('#sTagCustom')) $('#sTagCustom').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.value.trim()) { const t = e.target.value.trim(); e.target.value = ''; const b = document.createElement('button'); b.type = 'button'; b.className = 'chip on'; b.dataset.tag = t; b.textContent = '🏷️ ' + t; sTagsWrap.insertBefore(b, e.target) } });

    async function nomi(q) { const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&accept-language=fr&q=${encodeURIComponent(q)}`; const r = await fetch(url, { headers: { 'Accept': 'application/json' } }); return r.json() }
    if ($('#sBtn')) $('#sBtn').onclick = async () => {
        const q = $('#sQ').value.trim(); if (q.length < 3) return; const data = await nomi(q); const sRes = $('#sRes');
        sRes.innerHTML = (data || []).map((r, i) => `<div class="item" data-i="${i}"><div class="title">${(r.display_name || 'Résultat').split(',')[0]}</div><div class="addr">${r.display_name || ''}</div></div>`).join('') || '<div class="muted">Aucun résultat</div>';
        sRes.querySelectorAll('.item').forEach(el => el.onclick = () => { const r = data[+el.dataset.i]; if (!r) return; $('#sName').value = (r.display_name || 'Lieu').split(',')[0]; $('#sLat').value = parseFloat(r.lat).toFixed(6); $('#sLng').value = parseFloat(r.lon).toFixed(6); if (map) map.setView([+r.lat, +r.lon], map.getZoom()) })
    }
    if ($('#sAdd')) $('#sAdd').onclick = () => {
        const name = $('#sName')?.value.trim();
        const lat = parseFloat($('#sLat')?.value);
        const lng = parseFloat($('#sLng')?.value);
        const durationH = parseFloat($('#sDur')?.value) || 2;

        const tags = Array.from($('#sTags')?.querySelectorAll('.chip.on') || []).map(b => b.dataset.tag).filter(Boolean);
        // tag perso (si saisi)
        const custom = ($('#sTagCustom')?.value || '').trim();
        if (custom) tags.push(custom);

        const slot = $('#sSlot')?.value || '';
        const pos = $('#sPos')?.value ? (parseInt($('#sPos').value, 10) - 1) : null;
        const addToItin = $('#sAddItin')?.checked !== false;

        const budget = parseFloat($('#sBudget')?.value || '0') || 0;
        const url = ($('#sUrl')?.value || '').trim();
        const desc = ($('#sDesc')?.value || '').trim();
        const closedDays = Array.from(document.querySelectorAll('#sheet .week input[type="checkbox"]:checked')).map(c => +c.value);

        if (!name || !isFinite(lat) || !isFinite(lng)) return alert('Nom + coordonnées requis');

        if (addToItin) addPlace(name, lat, lng, durationH, closedDays, budget, desc, null, tags, '', slot, url, pos);
        else addCandidate(name, lat, lng, durationH, closedDays, budget, desc, null, tags, '', slot, url);

        // reset
        ['sQ', 'sName', 'sLat', 'sLng', 'sPos', 'sBudget', 'sUrl', 'sDesc', 'sTagCustom'].forEach(id => { const el = $('#' + id); if (el) el.value = '' });
        if ($('#sDur')) { $('#sDur').value = '2'; }
        if ($('#sDurVal')) { $('#sDurVal').textContent = '2.00'; }
        if ($('#sSlot')) { $('#sSlot').value = ''; }
        $('#sTags')?.querySelectorAll('.chip.on')?.forEach(b => b.classList.remove('on'));
        if ($('#sRes')) $('#sRes').innerHTML = '';
        document.querySelectorAll('#sheet .week input[type="checkbox"]').forEach(c => (c.checked = false));

        $('#sheet')?.classList.remove('open');
        showToast({ type: 'success', text: 'Lieu ajouté ✔' });
    };
}
