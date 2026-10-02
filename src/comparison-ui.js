/* global $, TRIPS, ACTIVE_TRIP, state, map, layer, routeLayer, candidateLayer, comparisonLayer, L, showToast, escapeHtml, fmtDurMin, fmtMoney, weatherNumber, TripWeather */

let COMPARISON_DATA = { groups: [], offers: {}, trips: [], snapshots: [] };
let COMPARISON_GROUP_ID = '';
let COMPARISON_ITEMS = [];
let COMPARISON_LOAD_TOKEN = 0;
const COMPARISON_COLORS = ['#70e1a1', '#f4b860', '#7aa2ff', '#ff7a90', '#c59cff', '#6ee7f2'];

function comparisonGroup() {
    return COMPARISON_DATA.groups.find(group => group.id === COMPARISON_GROUP_ID) || null;
}

function comparisonId() {
    return `compare-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function comparisonApi(ids = []) {
    const query = ids.length ? `?ids=${encodeURIComponent(ids.join(','))}` : '';
    return `./api/comparison${query}`;
}

async function comparisonRequest(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
}

function renderComparisonPicker() {
    const select = $('#comparisonSelect'), picker = $('#comparisonTrips'), group = comparisonGroup();
    if (!select || !picker) return;
    select.innerHTML = COMPARISON_DATA.groups.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === COMPARISON_GROUP_ID ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
    if (!group) {
        select.innerHTML = '<option value="">Nouvelle comparaison</option>';
        $('#comparisonName').value = '';
    } else {
        select.value = group.id;
        $('#comparisonName').value = group.name;
    }
    const selected = new Set(group?.tripIds || [ACTIVE_TRIP].filter(Boolean));
    const trips = COMPARISON_DATA.trips.length ? COMPARISON_DATA.trips : TRIPS;
    picker.innerHTML = trips.map(trip => `<label class="comparison-trip-choice"><input type="checkbox" value="${escapeHtml(trip.id)}" ${selected.has(trip.id) ? 'checked' : ''} /><span>${escapeHtml(trip.name || trip.id)}</span></label>`).join('');
    $('#comparisonDelete').disabled = !group;
}

function newComparison() {
    COMPARISON_GROUP_ID = comparisonId();
    COMPARISON_DATA.groups.push({ id: COMPARISON_GROUP_ID, name: 'Nouvelle comparaison', tripIds: [ACTIVE_TRIP].filter(Boolean) });
    COMPARISON_ITEMS = [];
    renderComparisonPicker();
    $('#comparisonName').select();
    $('#comparisonResults').innerHTML = '<div class="muted">Sélectionnez au moins deux circuits.</div>';
    clearComparisonMap();
}

async function saveComparisonData() {
    const response = await comparisonRequest(comparisonApi(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: COMPARISON_DATA.groups, offers: COMPARISON_DATA.offers })
    });
    COMPARISON_DATA.groups = response.groups || [];
    COMPARISON_DATA.offers = response.offers || {};
}

function readOfferEditors() {
    document.querySelectorAll('[data-comparison-offer]').forEach(form => {
        const id = form.dataset.comparisonOffer;
        const value = selector => form.querySelector(selector)?.value || '';
        COMPARISON_DATA.offers[id] = {
            provider: value('.offer-provider').trim(),
            price: Math.max(0, Number(value('.offer-price')) || 0),
            currency: value('.offer-currency').trim().toUpperCase(),
            flightIncluded: value('.offer-flight-status') === 'included' ? true : value('.offer-flight-status') === 'excluded' ? false : null,
            flightPrice: Math.max(0, Number(value('.offer-flight-price')) || 0),
            rating: Math.max(0, Math.min(6, Number(value('.offer-rating')) || 0)),
            url: value('.offer-url').trim(),
            included: value('.offer-included').split(/\r?\n/).map(item => item.trim()).filter(Boolean),
            excluded: value('.offer-excluded').split(/\r?\n/).map(item => item.trim()).filter(Boolean),
            cancellation: value('.offer-cancellation').trim(),
            notes: value('.offer-notes').trim()
        };
    });
}

async function saveOffers() {
    readOfferEditors();
    try {
        await saveComparisonData();
        COMPARISON_ITEMS.forEach(item => { item.metrics = window.TripComparison.metrics(item.document, COMPARISON_DATA.offers[item.id]); });
        renderComparisonResults();
        showToast({ type: 'success', text: 'Informations voyagistes enregistrées.' });
    } catch (error) {
        showToast({ type: 'error', text: error.message });
    }
}

async function runComparison() {
    const tripIds = [...document.querySelectorAll('#comparisonTrips input:checked')].map(input => input.value);
    if (tripIds.length < 2) { showToast({ type: 'warn', text: 'Sélectionnez au moins deux circuits.' }); return }
    const name = $('#comparisonName').value.trim() || 'Comparaison de circuits';
    let group = comparisonGroup();
    if (!group) {
        COMPARISON_GROUP_ID = comparisonId();
        group = { id: COMPARISON_GROUP_ID, name, tripIds };
        COMPARISON_DATA.groups.push(group);
    } else {
        group.name = name;
        group.tripIds = tripIds;
    }
    readOfferEditors();
    $('#comparisonRun').disabled = true;
    try {
        await saveComparisonData();
        renderComparisonPicker();
        await loadComparisonSnapshots(tripIds);
    } catch (error) {
        $('#comparisonStatus').textContent = error.message;
        showToast({ type: 'error', text: error.message });
    } finally {
        $('#comparisonRun').disabled = false;
    }
}

async function deleteComparison() {
    const group = comparisonGroup();
    if (!group || !confirm(`Supprimer la comparaison « ${group.name} » ?`)) return;
    COMPARISON_DATA.groups = COMPARISON_DATA.groups.filter(item => item.id !== group.id);
    COMPARISON_GROUP_ID = COMPARISON_DATA.groups[0]?.id || '';
    await saveComparisonData();
    renderComparisonPicker();
    const next = comparisonGroup();
    if (next?.tripIds?.length >= 2) loadComparisonSnapshots(next.tripIds);
    else {
        COMPARISON_ITEMS = [];
        $('#comparisonResults').innerHTML = '<div class="muted">Sélectionnez au moins deux circuits.</div>';
        clearComparisonMap();
    }
}

function offerEditor(item, index) {
    const offer = COMPARISON_DATA.offers[item.id] || {};
    const included = Array.isArray(offer.included) ? offer.included.join('\n') : '';
    const excluded = Array.isArray(offer.excluded) ? offer.excluded.join('\n') : '';
    const flightStatus = offer.flightIncluded === true ? 'included' : offer.flightIncluded === false ? 'excluded' : '';
    return `<section class="offer-editor" data-comparison-offer="${escapeHtml(item.id)}" style="--circuit-color:${COMPARISON_COLORS[index % COMPARISON_COLORS.length]}">
        <div class="offer-editor__title"><span class="circuit-swatch"></span><h3>${escapeHtml(item.name)}</h3><button class="btn" type="button" data-open-comparison-trip="${escapeHtml(item.id)}">Ouvrir</button></div>
        <div class="offer-editor__grid">
            <label>Voyagiste<input class="offer-provider" type="text" value="${escapeHtml(offer.provider || '')}" /></label>
            <label>Prix du forfait<div class="offer-price-row"><input class="offer-price" type="number" min="0" step="0.01" value="${Number(offer.price) || ''}" /><input class="offer-currency" type="text" maxlength="3" value="${escapeHtml(offer.currency || 'CHF')}" /></div></label>
            <label>Vol dans le forfait<select class="offer-flight-status"><option value="" ${flightStatus === '' ? 'selected' : ''}>À préciser</option><option value="included" ${flightStatus === 'included' ? 'selected' : ''}>Inclus</option><option value="excluded" ${flightStatus === 'excluded' ? 'selected' : ''}>Non inclus</option></select></label>
            <label>Coût du vol à ajouter<input class="offer-flight-price" type="number" min="0" step="0.01" value="${Number(offer.flightPrice) || ''}" placeholder="Même devise que le forfait" ${flightStatus === 'included' ? 'disabled' : ''} /></label>
            <label>Note personnelle (1-6)<input class="offer-rating" type="number" min="1" max="6" step="1" value="${Number(offer.rating) || ''}" /></label>
            <label>Page de l’offre<input class="offer-url" type="url" value="${escapeHtml(offer.url || '')}" placeholder="https://..." /></label>
            <label>Inclus, une ligne par élément<textarea class="offer-included" rows="4">${escapeHtml(included)}</textarea></label>
            <label>Non inclus, une ligne par élément<textarea class="offer-excluded" rows="4">${escapeHtml(excluded)}</textarea></label>
            <label>Annulation<textarea class="offer-cancellation" rows="3">${escapeHtml(offer.cancellation || '')}</textarea></label>
            <label>Notes<textarea class="offer-notes" rows="3">${escapeHtml(offer.notes || '')}</textarea></label>
        </div>
    </section>`;
}

function nativeBudget(metrics) {
    const values = Object.entries(metrics.nativeTotals);
    return values.length ? values.map(([currency, amount]) => fmtMoney(amount, currency)).join(' + ') : 'Non renseigné';
}

function matrixRow(label, values, className = '') {
    return `<tr class="${className}"><th scope="row">${label}</th>${values.map(value => `<td>${value}</td>`).join('')}</tr>`;
}

function comparisonWeather(item) {
    const weather = item.metrics.weather;
    if (!weather?.coverageDays) return 'À renseigner dans Météo';
    const measured = weather.forecastDays + weather.archiveDays;
    const source = [measured ? `${measured} j météo` : '', weather.estimatedDays ? `${weather.estimatedDays} j en tendance` : ''].filter(Boolean).join(', ');
    return `<strong>${weatherNumber(weather.tempMinC, ' °C')} / ${weatherNumber(weather.tempMaxC, ' °C')}</strong><br><small>${weatherNumber(weather.humidityPct, ' % humidité')} · ${escapeHtml(source)}</small>`;
}

function comparisonClimate(item) {
    const climate = item.metrics.climate;
    if (!climate?.coverageStages) return 'À analyser dans Météo';
    return `${climate.bestMonths.map(item => TripWeather.MONTHS[item.month - 1]).join(', ')}<br><small>${climate.coverageStages} étape${climate.coverageStages > 1 ? 's' : ''} analysée${climate.coverageStages > 1 ? 's' : ''}</small>`;
}

function comparisonFlight(item) {
    if (item.metrics.flightIncluded === true) return 'Inclus dans le forfait';
    if (item.metrics.flightIncluded === false && item.metrics.flightPrice > 0) return fmtMoney(item.metrics.flightPrice, item.metrics.offerCurrency);
    if (item.metrics.flightIncluded === false) return 'Coût à renseigner';
    return 'À préciser';
}

function renderComparisonResults() {
    const wrap = $('#comparisonResults');
    if (!wrap || COMPARISON_ITEMS.length < 2) return;
    const shared = window.TripComparison.sharedPlaceKeys(COMPARISON_ITEMS);
    const cells = callback => COMPARISON_ITEMS.map(callback);
    const table = `<div class="comparison-table-wrap"><table class="comparison-table"><thead><tr><th>Critère</th>${COMPARISON_ITEMS.map((item, index) => `<th style="--circuit-color:${COMPARISON_COLORS[index % COMPARISON_COLORS.length]}"><span class="circuit-swatch"></span>${escapeHtml(item.name)}</th>`).join('')}</tr></thead><tbody>
        ${matrixRow('Voyagiste', cells(item => escapeHtml((COMPARISON_DATA.offers[item.id] || {}).provider || 'À renseigner')))}
        ${matrixRow('Prix du forfait', cells(item => item.metrics.offerPrice ? fmtMoney(item.metrics.offerPrice, item.metrics.offerCurrency) : 'À renseigner'))}
        ${matrixRow('Vol', cells(comparisonFlight))}
        ${matrixRow('Total forfait + vol', cells(item => item.metrics.offerTotal !== null ? `<strong>${fmtMoney(item.metrics.offerTotal, item.metrics.offerCurrency)}</strong>` : 'Informations incomplètes'), 'comparison-highlight')}
        ${matrixRow('Budget des étapes', cells(item => nativeBudget(item.metrics)))}
        ${matrixRow('Durée', cells(item => item.metrics.days ? `${item.metrics.days} jours` : 'Dates manquantes'))}
        ${matrixRow('Mois favorables', cells(comparisonClimate))}
        ${matrixRow('Météo du séjour', cells(comparisonWeather), 'comparison-highlight')}
        ${matrixRow('Pluie / neige', cells(item => item.metrics.weather?.coverageDays ? `${weatherNumber(item.metrics.weather.precipitationMm, ' mm')} / ${weatherNumber(item.metrics.weather.snowfallCm, ' cm')} sur ${item.metrics.weather.coverageDays} j` : 'À renseigner'))}
        ${matrixRow('Étapes / visites', cells(item => `${item.metrics.stages} / ${item.metrics.visits}`))}
        ${matrixRow('Trajet estimé', cells(item => `${item.metrics.routeKm} km`))}
        ${matrixRow('Temps de déplacement', cells(item => fmtDurMin(item.metrics.routeMin)))}
        ${matrixRow('Réservations', cells(item => String(item.metrics.reservationCount)))}
        ${matrixRow('Lieux optionnels', cells(item => String(item.metrics.optionalPlaces)))}
        ${matrixRow('Note des lieux', cells(item => item.metrics.averageRating == null ? 'Non noté' : `${item.metrics.averageRating}/6`))}
        ${matrixRow('Note personnelle', cells(item => item.metrics.offerRating ? `${item.metrics.offerRating}/6` : 'À noter'))}
    </tbody></table></div>`;
    const placeLists = `<div class="comparison-place-grid">${COMPARISON_ITEMS.map((item, index) => {
        const common = item.metrics.uniquePlaces.filter(place => shared.has(window.TripComparison.placeKey(place)));
        const exclusive = item.metrics.uniquePlaces.filter(place => !shared.has(window.TripComparison.placeKey(place)));
        const names = values => values.length ? values.map(place => `<span>${escapeHtml(place.name)}</span>`).join('') : '<em>Aucun</em>';
        return `<section style="--circuit-color:${COMPARISON_COLORS[index % COMPARISON_COLORS.length]}"><h3><span class="circuit-swatch"></span>${escapeHtml(item.name)}</h3><h4>Communs aux circuits</h4><div class="comparison-place-list common">${names(common)}</div><h4>Spécifiques à ce circuit</h4><div class="comparison-place-list exclusive">${names(exclusive)}</div></section>`;
    }).join('')}</div>`;
    wrap.innerHTML = `<div class="comparison-actions"><button id="comparisonSaveOffers" class="btn primary" type="button">Enregistrer les informations voyagistes</button></div>${table}<div class="offer-editor-grid">${COMPARISON_ITEMS.map(offerEditor).join('')}</div>${placeLists}`;
    $('#comparisonSaveOffers').onclick = saveOffers;
    wrap.querySelectorAll('.offer-flight-status').forEach(select => {
        const input = select.closest('.offer-editor')?.querySelector('.offer-flight-price');
        select.onchange = () => { if (input) input.disabled = select.value === 'included'; };
    });
    wrap.querySelectorAll('[data-open-comparison-trip]').forEach(button => button.onclick = () => openComparisonTrip(button.dataset.openComparisonTrip));
}

async function loadComparisonSnapshots(ids) {
    const token = ++COMPARISON_LOAD_TOKEN;
    $('#comparisonStatus').textContent = 'Chargement des circuits...';
    $('#comparisonResults').innerHTML = '<div class="muted">Analyse des itinéraires...</div>';
    try {
        const response = await comparisonRequest(comparisonApi(ids));
        if (token !== COMPARISON_LOAD_TOKEN) return;
        COMPARISON_DATA.offers = response.offers || COMPARISON_DATA.offers;
        const snapshots = response.snapshots || [];
        COMPARISON_ITEMS = snapshots.map(snapshot => {
            const document = snapshot.id === ACTIVE_TRIP ? { ...state, weather: window.TRIP_WEATHER } : snapshot.document;
            return { ...snapshot, document, metrics: window.TripComparison.metrics(document, COMPARISON_DATA.offers[snapshot.id]) };
        });
        if (COMPARISON_ITEMS.length < 2) throw new Error('Au moins deux circuits lisibles sont nécessaires.');
        $('#comparisonStatus').textContent = `${COMPARISON_ITEMS.length} circuits comparés`;
        renderComparisonResults();
        renderComparisonMap();
    } catch (error) {
        if (token !== COMPARISON_LOAD_TOKEN) return;
        $('#comparisonStatus').textContent = error.message;
        $('#comparisonResults').innerHTML = `<div class="muted">${escapeHtml(error.message)}</div>`;
        clearComparisonMap();
    }
}

function clearComparisonMap() {
    comparisonLayer?.clearLayers();
}

function renderComparisonMap() {
    if (!map || !comparisonLayer || document.body.dataset.page !== 'compare') return;
    routeLayer?.clearLayers();
    layer?.clearLayers();
    candidateLayer?.clearLayers();
    comparisonLayer.clearLayers();
    const bounds = [];
    COMPARISON_ITEMS.forEach((item, index) => {
        const color = COMPARISON_COLORS[index % COMPARISON_COLORS.length];
        const points = item.metrics.state.itinerary.map(id => item.metrics.state.places[id]).filter(Boolean).map(place => [place.lat, place.lng]);
        if (!points.length) return;
        points.forEach(point => bounds.push(point));
        L.polyline(points, { color, weight: 5, opacity: .78, dashArray: index % 2 ? '10 7' : '' }).addTo(comparisonLayer).bindTooltip(item.name);
        L.circleMarker(points[0], { radius: 7, color, fillColor: color, fillOpacity: 1 }).addTo(comparisonLayer).bindTooltip(`${item.name} : départ`);
    });
    if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds), { padding: [28, 28] });
}

function openComparisonTrip(id) {
    const select = $('#tripSelect');
    if (!select || !TRIPS.some(trip => trip.id === id)) return;
    document.querySelector('.tab[data-page="overview"]')?.click();
    select.value = id;
    select.dispatchEvent(new Event('change'));
}

async function loadComparisonPage(force = false) {
    if (COMPARISON_DATA.trips.length && !force) {
        renderComparisonPicker();
        const group = comparisonGroup();
        if (group?.tripIds?.length >= 2 && !COMPARISON_ITEMS.length) loadComparisonSnapshots(group.tripIds);
        else renderComparisonMap();
        return;
    }
    $('#comparisonStatus').textContent = 'Chargement...';
    try {
        const response = await comparisonRequest(comparisonApi());
        COMPARISON_DATA = { ...COMPARISON_DATA, ...response };
        COMPARISON_GROUP_ID = COMPARISON_DATA.groups.find(group => group.tripIds.includes(ACTIVE_TRIP))?.id || COMPARISON_DATA.groups[0]?.id || '';
        if (!COMPARISON_GROUP_ID) newComparison();
        else renderComparisonPicker();
        const group = comparisonGroup();
        if (group?.tripIds?.length >= 2) await loadComparisonSnapshots(group.tripIds);
        else $('#comparisonStatus').textContent = 'Sélectionnez les circuits';
    } catch (error) {
        $('#comparisonStatus').textContent = error.message;
        $('#comparisonResults').innerHTML = `<div class="muted">${escapeHtml(error.message)}</div>`;
    }
}

function initComparisonUi() {
    $('#comparisonNew').onclick = newComparison;
    $('#comparisonDelete').onclick = () => deleteComparison().catch(error => showToast({ type: 'error', text: error.message }));
    $('#comparisonRun').onclick = runComparison;
    $('#comparisonSelect').onchange = event => {
        COMPARISON_GROUP_ID = event.target.value;
        COMPARISON_ITEMS = [];
        renderComparisonPicker();
        const group = comparisonGroup();
        if (group?.tripIds?.length >= 2) loadComparisonSnapshots(group.tripIds);
    };
}
