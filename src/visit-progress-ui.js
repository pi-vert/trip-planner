/* global $, ACTIVE_TRIP, state, LOADED, TripVisitProgress, gpsRequest, renderAll, showToast, planningFromControls, generatePlan */
'use strict';
let VISIT_PROGRESS_TRIP = '', VISIT_PROGRESS = {}, VISIT_PROGRESS_READY = false, VISIT_PROGRESS_LOADING = false, VISIT_PROGRESS_BUSY = false, VISIT_PROGRESS_TOKEN = 0;

function applyVisitProgress() {
    for (const [id, place] of Object.entries(state.places || {})) place.completed = VISIT_PROGRESS_TRIP === ACTIVE_TRIP && Object.hasOwn(VISIT_PROGRESS, id);
}
function acceptVisitProgress(tripId, completedPlaces) {
    if (tripId !== ACTIVE_TRIP) return;
    VISIT_PROGRESS_TRIP = tripId;
    VISIT_PROGRESS = completedPlaces || {};
    VISIT_PROGRESS_READY = true;
    VISIT_PROGRESS_LOADING = false;
    VISIT_PROGRESS_TOKEN++;
    applyVisitProgress();
}
async function loadVisitProgress(force = false) {
    if (!ACTIVE_TRIP || !LOADED || (!force && VISIT_PROGRESS_TRIP === ACTIVE_TRIP)) return;
    const tripId = ACTIVE_TRIP, token = ++VISIT_PROGRESS_TOKEN;
    if (tripId !== VISIT_PROGRESS_TRIP) VISIT_PROGRESS = {};
    VISIT_PROGRESS_TRIP = tripId; VISIT_PROGRESS_READY = false; VISIT_PROGRESS_LOADING = true;
    try {
        const result = await gpsRequest('GET', null, { tripId, progress: '1' });
        if (tripId !== ACTIVE_TRIP || token !== VISIT_PROGRESS_TOKEN) return;
        acceptVisitProgress(tripId, result.completedPlaces);
        renderAll();
    } catch (error) {
        if (tripId === ACTIVE_TRIP && token === VISIT_PROGRESS_TOKEN) showToast({ type: 'error', text: `Statuts des visites indisponibles : ${error.message}` });
    } finally { if (token === VISIT_PROGRESS_TOKEN) VISIT_PROGRESS_LOADING = false; }
}
function canCompleteVisit(id) { return TripVisitProgress.canComplete(id, state); }
function visitProgressDisabled(id) { return VISIT_PROGRESS_BUSY || !VISIT_PROGRESS_READY || VISIT_PROGRESS_TRIP !== ACTIVE_TRIP || (!state.places[id]?.completed && !canCompleteVisit(id)); }
async function setPlacesCompleted(placeIds, completed, context = {}) {
    if (VISIT_PROGRESS_BUSY || !VISIT_PROGRESS_READY || VISIT_PROGRESS_TRIP !== ACTIVE_TRIP) return;
    const tripId = ACTIVE_TRIP;
    VISIT_PROGRESS_BUSY = true;
    renderAll();
    try {
        const result = await gpsRequest('PUT', { tripId, action: 'completed', placeIds, completed, ...context });
        if (tripId !== ACTIVE_TRIP) return;
        acceptVisitProgress(tripId, result.completedPlaces);
        showToast({ type: result.skipped.length ? 'warn' : 'success', text: `${result.changed.length} lieu(x) ${completed ? 'marqué(s) réalisé(s)' : 'remis à visiter'}.${result.skipped.length ? ` ${result.skipped.length} lieu(x) non modifiable(s).` : ''}` });
    } catch (error) {
        if (tripId === ACTIVE_TRIP) showToast({ type: 'error', text: `Statut non enregistré : ${error.message}` });
    } finally { VISIT_PROGRESS_BUSY = false; renderAll(); }
}
function replanRemainingVisits() {
    const startDate = $('#gpsRemainingStart')?.value;
    const planning = planningFromControls();
    if (!startDate || !planning.endDate || startDate > planning.endDate) {
        showToast({ type: 'warn', text: 'Choisissez un premier jour restant au plus tard à la date de fin du voyage.' });
        return;
    }
    $('#startDate').value = startDate;
    generatePlan();
    document.querySelector('.tab[data-page="planning"]')?.click();
    showToast({ type: 'success', text: 'Planning des visites restantes recalculé. Vous pouvez compléter les jours suivants avec de nouvelles visites.' });
}
