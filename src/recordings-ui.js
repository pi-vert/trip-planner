/* global L, $, ACTIVE_TRIP, LOADED, state, TRIPS, TripPlanning, TripStructure, TripPdfExport, TripRouteMaps, TripGps, planningFromControls, tripItineraryFromStart, escapeHtml, showToast */
'use strict';
let GPS_DATA = { references: [], tracks: [] }, GPS_TRIP = '', GPS_REFERENCE = '', GPS_STAGE = '', GPS_TRACK = '', GPS_LOAD = 0, GPS_LOADING = false, GPS_READY = false, GPS_BUSY = false;
let GPS_MARK_IDS = [], GPS_COMPARED_TRACK_IDS = [];
let gpsMap = null, gpsLayers = null;

async function gpsRequest(method, body, query = {}) {
    const response = await fetch(`./api/recordings?${new URLSearchParams(query)}`, {
        method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Erreur GPS HTTP ${response.status}`);
    return data;
}
function gpsStatus(text, tripId = ACTIVE_TRIP) {
    if (tripId === ACTIVE_TRIP && $('#gpsStatus')) $('#gpsStatus').textContent = text;
}
async function loadRecordings(force = false) {
    if (!ACTIVE_TRIP || (!force && GPS_TRIP === ACTIVE_TRIP && (GPS_LOADING || GPS_READY))) return;
    const tripId = ACTIVE_TRIP, token = ++GPS_LOAD, progressToken = VISIT_PROGRESS_TOKEN;
    if (GPS_TRIP !== tripId) { GPS_DATA = { references: [], tracks: [] }; GPS_REFERENCE = ''; GPS_STAGE = ''; GPS_TRACK = ''; $('#gpsDaySelect').value = ''; $('#gpsRemainingStart').value = ''; }
    GPS_TRIP = tripId; GPS_LOADING = true; GPS_READY = false;
    renderRecordingPage();
    try {
        const data = await gpsRequest('GET', null, { tripId });
        if (token !== GPS_LOAD || tripId !== ACTIVE_TRIP) return;
        GPS_DATA = data; GPS_READY = true;
        if (progressToken === VISIT_PROGRESS_TOKEN || VISIT_PROGRESS_TRIP !== tripId) acceptVisitProgress(tripId, data.completedPlaces);
        gpsStatus('Parcours chargés.');
    } catch (error) {
        if (token === GPS_LOAD && tripId === ACTIVE_TRIP) gpsStatus(error.message);
    } finally {
        if (token === GPS_LOAD) {
            GPS_LOADING = false;
            if (LOADED && typeof renderAll === 'function') renderAll(); else renderRecordingPage();
        }
    }
}
function gpsSelection() {
    const reference = GPS_DATA.references.find(item => item.id === GPS_REFERENCE);
    let stage = GPS_STAGE === TripGps.ALL_STAGES ? TripGps.wholeTrip(reference) : reference?.stages.find(item => item.key === GPS_STAGE);
    if (stage?.wholeTrip) {
        const ids = new Set(stage.stops.map(stop => stop.id));
        for (const id of state.itinerary || []) {
            const place = state.places[id];
            if (!place || ids.has(id) || !canCompleteVisit(id)) continue;
            stage.stops.push({ id, title: place.name || id, lat: place.lat, lng: place.lng, currentOnly: true });
            ids.add(id);
        }
    }
    return { reference, stage };
}
function gpsSelectedTracks() {
    return GPS_TRACK ? GPS_DATA.tracks.filter(track => track.id === GPS_TRACK)
        : GPS_DATA.tracks.filter(track => track.referenceId === GPS_REFERENCE && (GPS_STAGE === TripGps.ALL_STAGES || track.stageKey === GPS_STAGE || track.stageKey === TripGps.ALL_STAGES));
}
function gpsSetBusy(busy) { GPS_BUSY = busy; renderRecordingPage(); }
async function captureGpsReference() {
    if (GPS_BUSY || !GPS_READY || !LOADED) return;
    const tripId = ACTIVE_TRIP;
    const snapshot = JSON.parse(JSON.stringify({ ...state, itinerary: tripItineraryFromStart(), planning: planningFromControls() }));
    const structure = TripStructure.buildOutline(snapshot);
    const dated = snapshot.planning.startDate || snapshot.planning.endDate;
    const result = dated ? TripPlanning.buildPlan({ ...snapshot, structure }) : null;
    if (dated && !result.days.length) { showToast({ type: 'warn', text: result.conflicts[0] }); return; }
    const stages = TripPdfExport.collectStageRoutes({ ...snapshot, structure, result });
    if (!stages.length) { showToast({ type: 'warn', text: 'Ajoutez une grande étape au voyage.' }); return; }
    const label = $('#gpsReferenceName').value.trim() || `Prévu du ${new Date().toLocaleDateString('fr-CH')}`;
    gpsSetBusy(true);
    try {
        const frozen = await TripRouteMaps.captureReference(stages, snapshot.places, {
            onProgress: (current, total) => gpsStatus(`Sauvegarde du prévu : tracé ${current}/${total}…`, tripId)
        });
        const reference = await gpsRequest('POST', { tripId, action: 'reference', reference: { label, stages: frozen } });
        if (tripId !== ACTIVE_TRIP) return;
        await loadRecordings(true);
        if (tripId !== ACTIVE_TRIP) return;
        GPS_REFERENCE = reference.id; GPS_STAGE = TripGps.ALL_STAGES; GPS_TRACK = '';
        $('#gpsDaySelect').value = '';
        const indicative = frozen.flatMap(stage => stage.segments).filter(route => route.geometrySource !== 'road').length;
        gpsStatus(`Référence enregistrée le ${new Date(reference.capturedAt).toLocaleString('fr-CH')}.${indicative ? ` ${indicative} liaison(s) indicative(s) : les écarts au tracé ne seront pas calculés pour ces étapes.` : ''}`, tripId);
    } catch (error) { gpsStatus(`Enregistrement impossible : ${error.message}`, tripId); }
    finally { gpsSetBusy(false); }
}
async function importGpsFiles(files) {
    if (GPS_BUSY || !GPS_READY || !gpsSelection().stage) return;
    const tripId = ACTIVE_TRIP, referenceId = GPS_REFERENCE, stageKey = GPS_STAGE;
    const reports = [];
    gpsSetBusy(true);
    try {
        for (const file of files) {
            try {
                if (!/\.gpx$/i.test(file.name)) throw new Error('Format GPX requis.');
                if (file.size > 20 * 1024 * 1024) throw new Error('Maximum 20 Mo par fichier.');
                gpsStatus(`Import de ${file.name}…`, tripId);
                const result = await gpsRequest('POST', { tripId, action: 'import', referenceId, stageKey, filename: file.name, content: await file.text() });
                reports.push(`${file.name} : ${result.duplicate ? 'déjà enregistré (affectation conservée)' : 'importé'}${result.track.warnings.length ? ` · ${result.track.warnings.join(' ')}` : ''}`);
            } catch (error) { reports.push(`${file.name} : ${error.message}`); }
        }
        if (tripId === ACTIVE_TRIP) { await loadRecordings(true); gpsStatus(reports.join('\n'), tripId); }
    } finally { $('#gpsFiles').value = ''; gpsSetBusy(false); }
}
async function changeGpsTrack(trackId, remove = false) {
    if (GPS_BUSY || !GPS_READY) return;
    const track = GPS_DATA.tracks.find(item => item.id === trackId);
    if (!track || (remove && !confirm(`Supprimer la trace « ${track.name} » de ce voyage ?`))) return;
    const tripId = ACTIVE_TRIP;
    gpsSetBusy(true);
    try {
        if (remove) await gpsRequest('DELETE', null, { tripId, trackId });
        else await gpsRequest('PUT', { tripId, trackId, referenceId: GPS_REFERENCE, stageKey: GPS_STAGE });
        if (tripId === ACTIVE_TRIP) { await loadRecordings(true); gpsStatus(remove ? 'Trace supprimée.' : 'Trace rattachée à l’étape sélectionnée.'); }
    } catch (error) { gpsStatus(error.message, tripId); }
    finally { gpsSetBusy(false); }
}
function gpsNumber(value, unit = '') { return value == null ? '—' : `${value.toLocaleString('fr-CH', { maximumFractionDigits: 1 })}${unit}`; }
function gpsDuration(value) {
    if (value == null) return '—';
    const minutes = Math.round(value);
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}
function renderRecordingPage() {
    if (!$('#cardRecordings') || document.body.dataset.page !== 'recordings') return;
    if (GPS_TRIP !== ACTIVE_TRIP) { loadRecordings(); return; }
    if (!GPS_DATA.references.some(item => item.id === GPS_REFERENCE)) GPS_REFERENCE = GPS_DATA.references.at(-1)?.id || '';
    let { reference, stage } = gpsSelection();
    if (!stage) { GPS_STAGE = reference ? TripGps.ALL_STAGES : ''; stage = gpsSelection().stage; }
    $('#gpsReferenceSelect').innerHTML = GPS_DATA.references.map(item => `<option value="${escapeHtml(item.id)}"${item.id === GPS_REFERENCE ? ' selected' : ''}>${escapeHtml(item.label)} · ${escapeHtml(new Date(item.capturedAt).toLocaleString('fr-CH'))}</option>`).join('') || '<option>Aucune référence enregistrée</option>';
    $('#gpsStageSelect').innerHTML = reference ? `<option value="${TripGps.ALL_STAGES}"${GPS_STAGE === TripGps.ALL_STAGES ? ' selected' : ''}>Ensemble du voyage</option>` + reference.stages.map(item => `<option value="${escapeHtml(item.key)}"${item.key === GPS_STAGE ? ' selected' : ''}>${escapeHtml(item.title)}${item.arrivalDate ? ` · ${escapeHtml(item.arrivalDate)} → ${escapeHtml(item.departureDate)}` : ''}</option>`).join('') : '<option>Figez le prévu avant d’importer</option>';
    $('#gpsCapture').disabled = GPS_BUSY || VISIT_PROGRESS_BUSY || !GPS_READY || !LOADED;
    $('#gpsImport').disabled = GPS_BUSY || !GPS_READY || !stage;
    $('#gpsReload').disabled = GPS_BUSY || GPS_LOADING;
    for (const id of ['gpsReferenceSelect', 'gpsStageSelect', 'gpsTrackSelect', 'gpsDaySelect', 'gpsThreshold', 'gpsReferenceName']) $('#' + id).disabled = GPS_BUSY || VISIT_PROGRESS_BUSY || !GPS_READY;
    $('#gpsReferenceInfo').textContent = reference ? `Référence figée le ${new Date(reference.capturedAt).toLocaleString('fr-CH')}. Les modifications du planning ne changent pas ce prévu.` : 'Aucune référence : cliquez sur « Figer le prévu actuel » avant le départ, puis importez vos enregistrements Garmin.';
    if (GPS_TRACK && !GPS_DATA.tracks.some(track => track.id === GPS_TRACK)) GPS_TRACK = '';
    $('#gpsTrackSelect').innerHTML = '<option value="">Toutes les traces du périmètre</option>' + GPS_DATA.tracks.map(track => `<option value="${track.id}"${track.id === GPS_TRACK ? ' selected' : ''}>${escapeHtml(track.name)} · ${escapeHtml(track.filename)}</option>`).join('');
    const tracks = gpsSelectedTracks();
    const days = new Set((stage?.segments || []).map(route => route.date).filter(Boolean));
    tracks.forEach(track => track.segments.forEach(points => points.forEach(point => { const day = TripGps.localDay(point[2]); if (day) days.add(day); })));
    const day = $('#gpsDaySelect').value;
    $('#gpsDaySelect').innerHTML = '<option value="">Tous les jours enregistrés</option>' + [...days].sort().map(value => `<option value="${value}"${day === value ? ' selected' : ''}>${value}</option>`).join('');
    renderGpsResults(stage, tracks);
    $('#gpsTracks').innerHTML = GPS_DATA.tracks.map(track => {
        const ref = GPS_DATA.references.find(item => item.id === track.referenceId), target = ref?.stages.find(item => item.key === track.stageKey);
        const stats = TripGps.trackStats(track);
        const selected = tracks.some(item => item.id === track.id), assigned = track.referenceId === GPS_REFERENCE && track.stageKey === GPS_STAGE;
        return `<article class="gps-track${selected ? ' is-selected' : ''}"><div><strong>${escapeHtml(track.name)}</strong><small>${escapeHtml(track.filename)} · ${gpsNumber(stats.km, ' km')} · ${stats.start == null ? 'Sans horodatage' : escapeHtml(new Date(stats.start).toLocaleString('fr-CH'))}</small><small>${escapeHtml(ref?.label || '')} → ${escapeHtml(track.stageKey === TripGps.ALL_STAGES ? 'Ensemble du voyage' : target?.title || '')}</small>${track.warnings.map(warning => `<small class="err">${escapeHtml(warning)}</small>`).join('')}</div><div class="actions"><button class="btn" type="button" data-gps-move="${track.id}"${GPS_BUSY || !stage || assigned ? ' disabled' : ''}>Rattacher ici</button><button class="btn danger" type="button" data-gps-delete="${track.id}"${GPS_BUSY ? ' disabled' : ''}>Supprimer</button></div></article>`;
    }).join('') || '<p class="muted">Aucune trace importée pour ce voyage.</p>';
    $('#gpsTracks').onclick = event => {
        const remove = event.target.closest('[data-gps-delete]'), move = event.target.closest('[data-gps-move]');
        if (remove) changeGpsTrack(remove.dataset.gpsDelete, true);
        if (move) changeGpsTrack(move.dataset.gpsMove);
    };
}
function renderGpsResults(stage, tracks) {
    const result = TripGps.compare(stage, tracks, { day: $('#gpsDaySelect').value, threshold: $('#gpsThreshold').value });
    GPS_COMPARED_TRACK_IDS = result.tracks.map(track => track.id);
    GPS_MARK_IDS = [...new Set(result.stops.filter(stop => stop.distanceMeters !== null && stop.distanceMeters <= 100 && !state.places[stop.id]?.completed && canCompleteVisit(stop.id)).map(stop => stop.id))];
    $('#gpsMarkCompleted').textContent = `Marquer réalisés les lieux à ≤ 100 m (${GPS_MARK_IDS.length})`;
    $('#gpsMarkCompleted').disabled = !GPS_MARK_IDS.length || GPS_BUSY || GPS_LOADING || VISIT_PROGRESS_BUSY || !VISIT_PROGRESS_READY;
    $('#gpsReplanRemaining').disabled = GPS_BUSY || VISIT_PROGRESS_BUSY || !VISIT_PROGRESS_READY;
    if (!$('#gpsRemainingStart').value && result.end != null) {
        const next = new Date(result.end); next.setDate(next.getDate() + 1);
        $('#gpsRemainingStart').value = TripGps.localDay(next.getTime());
    }
    const delta = result.actualKm == null || result.plannedKm == null ? null : result.actualKm - result.plannedKm;
    const dates = result.start == null ? '—' : `${new Date(result.start).toLocaleString('fr-CH')} → ${new Date(result.end).toLocaleString('fr-CH')}`;
    const starts = result.routes.map(route => Date.parse(route.start)).filter(Number.isFinite);
    const ends = result.routes.map(route => Date.parse(route.end)).filter(Number.isFinite);
    const plannedDates = starts.length && ends.length ? `${new Date(Math.min(...starts)).toLocaleString('fr-CH')} → ${new Date(Math.max(...ends)).toLocaleString('fr-CH')}` : '—';
    $('#gpsMetrics').innerHTML = `<div><b>Distance prévue</b><strong>${gpsNumber(result.plannedKm, ' km')}</strong><small>Valeurs du planning figé${result.routes.some(route => route.estimated) ? ' · estimation incluse' : ''}</small></div><div><b>Distance réalisée</b><strong>${gpsNumber(result.actualKm, ' km')}</strong><small>Écart : ${delta == null ? '—' : `${delta > 0 ? '+' : ''}${gpsNumber(delta, ' km')}`}</small></div><div><b>Déplacements prévus</b><strong>${gpsDuration(result.plannedMinutes)}</strong></div><div><b>En mouvement (estimé)</b><strong>${gpsDuration(result.movingMinutes)}</strong><small>Total enregistré : ${gpsDuration(result.elapsedMinutes)}</small></div><div><b>Hors du tracé prévu</b><strong>${gpsNumber(result.offRouteKm, ' km')}</strong><small>Couloir de ${result.threshold} m · estimation</small></div>`;
    $('#gpsDetails').textContent = `${result.tracks.length} enregistrement(s) affiché(s). ${stage?.wholeTrip ? 'Prévu : ensemble du voyage, tous les jours ; les lieux actuels absents de la référence sont également recherchés. ' : ''}Horaires prévus : ${plannedDates}. Horaires réalisés : ${dates}. ${result.partialTiming ? 'Horodatages incomplets ou interruptions : durées partielles. ' : ''}${result.overlap ? 'Des enregistrements se chevauchent : les totaux peuvent compter deux fois le même parcours. ' : ''}${result.offRouteKm == null ? 'Écart au tracé disponible uniquement avec une référence routière complète et une trace réalisée. ' : ''}Temps en mouvement estimé au-dessus de 1,8 km/h, entre points espacés de deux minutes au maximum. Dates et horaires dans le fuseau du navigateur.`;
    $('#gpsStops').innerHTML = result.stops.map(stop => {
        const completed = state.places[stop.id]?.completed;
        const toggle = state.places[stop.id] && (completed || canCompleteVisit(stop.id)) ? `<label class="completed-toggle"><input type="checkbox" data-gps-completed="${escapeHtml(stop.id)}" ${completed ? 'checked' : ''} ${GPS_BUSY || GPS_LOADING || visitProgressDisabled(stop.id) ? 'disabled' : ''}/> Réalisé</label>` : '';
        return `<div class="gps-stop${completed ? ' is-completed' : ''}"><span>${stop.hotel ? '🛏️ ' : ''}${escapeHtml(stop.title)}${stop.currentOnly ? ' · lieu actuel ajouté' : ''}${stop.stageTitles?.length ? `<small>${escapeHtml(stop.stageTitles.join(' · '))}</small>` : ''}</span><b class="${stop.observed ? 'ok' : 'muted'}">${stop.observed === null ? 'Non vérifiable' : stop.observed ? `À proximité (≤ ${result.threshold} m)` : 'Non observé'}</b>${toggle}</div>`;
    }).join('');
    $('#gpsStops').onchange = event => {
        const input = event.target.closest('[data-gps-completed]');
        if (input) setPlacesCompleted([input.dataset.gpsCompleted], input.checked, { source: 'gps', referenceId: GPS_REFERENCE, trackIds: GPS_COMPARED_TRACK_IDS });
    };
    const container = $('#gpsMap'); container.hidden = !stage;
    if (!stage) { gpsLayers?.clearLayers(); return; }
    if (!gpsMap) {
        gpsMap = L.map(container).setView([46.2, 6.1], 8);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(gpsMap);
        gpsLayers = L.featureGroup().addTo(gpsMap);
    }
    gpsLayers.clearLayers();
    for (const route of result.routes) {
        if (route.geometry?.length) L.polyline(route.geometry.map(point => [point[1], point[0]]), { color: '#2563eb', weight: 5, opacity: .75, dashArray: route.geometrySource === 'road' ? null : '8 8' }).bindTooltip(`Prévu : ${escapeHtml(route.title || '')}`).addTo(gpsLayers);
    }
    for (const track of result.tracks) for (const points of track.segments) {
        if (points.length) L.polyline(TripGps.displayPath(points).map(point => [point[0], point[1]]), { color: '#128447', weight: 4, opacity: .9 }).bindTooltip(`Réalisé : ${escapeHtml(track.name)}`).addTo(gpsLayers);
    }
    for (const stop of result.stops) if (stop.lat != null && stop.lng != null) {
        L.circleMarker([stop.lat, stop.lng], { radius: 6, color: stop.observed ? '#128447' : '#2563eb', fillOpacity: .8 }).bindTooltip(escapeHtml(stop.title)).addTo(gpsLayers);
    }
    setTimeout(() => { gpsMap.invalidateSize(); if (gpsLayers.getBounds().isValid()) gpsMap.fitBounds(gpsLayers.getBounds(), { padding: [25, 25], maxZoom: 16 }); }, 80);
}
function initRecordingsUi() {
    $('#gpsCapture').onclick = captureGpsReference;
    $('#gpsReload').onclick = () => loadRecordings(true);
    $('#gpsImport').onclick = () => $('#gpsFiles').click();
    $('#gpsFiles').onchange = event => importGpsFiles(Array.from(event.target.files || []));
    $('#gpsReferenceSelect').onchange = event => { GPS_REFERENCE = event.target.value; GPS_STAGE = ''; $('#gpsDaySelect').value = ''; renderRecordingPage(); };
    $('#gpsStageSelect').onchange = event => { GPS_STAGE = event.target.value; $('#gpsDaySelect').value = ''; renderRecordingPage(); };
    $('#gpsTrackSelect').onchange = event => { GPS_TRACK = event.target.value; $('#gpsDaySelect').value = ''; $('#gpsRemainingStart').value = ''; renderRecordingPage(); };
    $('#gpsMarkCompleted').onclick = () => setPlacesCompleted(GPS_MARK_IDS, true, { source: 'gps', referenceId: GPS_REFERENCE, trackIds: GPS_COMPARED_TRACK_IDS });
    $('#gpsReplanRemaining').onclick = replanRemainingVisits;
    $('#gpsDaySelect').onchange = renderRecordingPage;
    $('#gpsThreshold').onchange = renderRecordingPage;
}
