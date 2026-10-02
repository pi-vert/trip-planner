/* global TripPlanning, TripPdfExport, TripRouteMaps, TripStructure, state, $, send, showToast, escapeHtml, focusPlace, typeFromFirstTag, renderBudgetSummary, updateRouteSummary, renderPlaces, attachDnD, fmtDurMin, PLAN, TRIPS, ACTIVE_TRIP */
'use strict';

const FIXED_KIND_LABELS = { activity: 'Visite / activité', meal: 'Restaurant / repas', lodging: 'Hôtel / hébergement', travel: 'Transport réservé', other: 'Autre contrainte' };

function normalizedPlanning(value = state.planning) {
    return TripPlanning?.normalizePlanning(value) || { meals: {}, reservations: [] };
}

function reservationPlaceIds(reservation) {
    if (Array.isArray(reservation?.placeIds) && reservation.placeIds.length) return reservation.placeIds;
    return reservation?.placeId ? [reservation.placeId] : [];
}

function selectedFixedPlaceIds() {
    return Array.from($('#fixedPlaces')?.querySelectorAll('input[type="checkbox"]:checked') || []).map(input => input.value);
}

function planningFromControls() {
    const planning = normalizedPlanning();
    planning.startDate = $('#startDate')?.value || '';
    planning.endDate = $('#endDate')?.value || '';
    planning.startTime = $('#startTime')?.value || '07:00';
    planning.dayStart = $('#dayStart')?.value || '07:00';
    planning.dayEnd = $('#dayEnd')?.value || '22:00';
    planning.speedKmh = Math.max(1, Number($('#speed')?.value) || 60);
    planning.meals = {
        breakfast: { at: $('#breakfastAt')?.value || '07:00', durationMin: Math.max(15, Number($('#breakfastDur')?.value) || 60) },
        lunch: { at: $('#lunchAt')?.value || '12:00', durationMin: Math.max(15, Number($('#lunchDur')?.value) || 60) },
        dinner: { at: $('#dinnerAt')?.value || '19:00', durationMin: Math.max(15, Number($('#dinnerDur')?.value) || 60) }
    };
    return planning;
}

function renderPlanningControls() {
    const planning = normalizedPlanning();
    state.planning = planning;
    const values = {
        startDate: planning.startDate, endDate: planning.endDate, startTime: planning.startTime,
        dayStart: planning.dayStart, dayEnd: planning.dayEnd, speed: planning.speedKmh,
        breakfastAt: planning.meals.breakfast.at, breakfastDur: planning.meals.breakfast.durationMin,
        lunchAt: planning.meals.lunch.at, lunchDur: planning.meals.lunch.durationMin,
        dinnerAt: planning.meals.dinner.at, dinnerDur: planning.meals.dinner.durationMin
    };
    Object.entries(values).forEach(([id, value]) => { const element = $(`#${id}`); if (element) element.value = String(value ?? '') });
    const picker = $('#fixedPlaces');
    if (!picker) return;
    const selected = new Set(selectedFixedPlaceIds());
    const orderedIds = [...state.itinerary, ...Object.keys(state.places || {}).filter(id => !state.itinerary.includes(id)).sort((a, b) => String(state.places[a]?.name).localeCompare(String(state.places[b]?.name), 'fr'))];
    picker.innerHTML = orderedIds.map(id => {
        const place = state.places[id];
        const optional = !state.itinerary.includes(id);
        return `<label class="fixed-place-choice"><input type="checkbox" value="${escapeHtml(id)}"${selected.has(id) ? ' checked' : ''}><span>${escapeHtml(place?.name || id)}${optional ? ' <i>optionnel</i>' : ''}</span></label>`;
    }).join('') || '<span class="muted">Ajoutez d’abord des lieux au voyage.</span>';
}

function formatPlanningDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date à compléter' : date.toLocaleString('fr-CH', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function reservationTimingLabel(item) {
    if (item?.dateMode === 'stage') {
        const day = item.relativeDay === 'departure' ? 'jour de départ' : 'jour d’arrivée';
        return `Créneau relatif · ${day} · ${item.startTime || '??:??'} → ${item.endTime || '??:??'}`;
    }
    return `${formatPlanningDateTime(item?.start)} → ${formatPlanningDateTime(item?.end)}`;
}

function stageDateForPlace(placeId, relativeDay = 'arrival') {
    if (!placeId || typeof TripStructure === 'undefined') return '';
    const outline = TripStructure.buildOutline(state);
    const assignment = outline.assignments[placeId];
    const stageId = assignment?.stageType === 'detail' ? assignment.parentStageId : placeId;
    const matches = outline.stages.filter(stage => stage.id === stageId);
    if (matches.length !== 1) return '';
    return relativeDay === 'departure' ? matches[0].departureDate : matches[0].arrivalDate;
}

function applyDateModeInputs(modeInput, relativeDayField, startInput, endInput, startLabel, endLabel, preserve = true, referenceDate = '') {
    const relative = modeInput.value === 'stage';
    const previousStart = startInput.value;
    const previousEnd = endInput.value;
    relativeDayField.hidden = !relative;
    startInput.type = relative ? 'time' : 'datetime-local';
    endInput.type = relative ? 'time' : 'datetime-local';
    startLabel.textContent = relative ? 'Heure de début' : 'Début fixe';
    endLabel.textContent = relative ? 'Heure de fin' : 'Fin fixe';
    if (!preserve) return;
    if (relative) {
        startInput.value = previousStart.includes('T') ? previousStart.slice(11, 16) : previousStart;
        endInput.value = previousEnd.includes('T') ? previousEnd.slice(11, 16) : previousEnd;
    } else {
        const date = referenceDate || state.planning?.startDate || '';
        startInput.value = date && previousStart ? `${date}T${previousStart.slice(-5)}` : '';
        endInput.value = date && previousEnd ? `${date}T${previousEnd.slice(-5)}` : '';
    }
}

function placeFixedDatesMarkup(placeId, placeName) {
    const reservations = normalizedPlanning().reservations
        .filter(item => reservationPlaceIds(item).includes(placeId))
        .sort((a, b) => String(a.start || a.startTime).localeCompare(String(b.start || b.startTime)));
    const existing = reservations.length ? reservations.map(item => `
        <div class="place-fixed-item">
             <div><strong>${escapeHtml(item.title || placeName)}</strong><span>${escapeHtml(reservationTimingLabel(item))}${reservationPlaceIds(item).length > 1 ? ` · ${reservationPlaceIds(item).length} lieux` : ''}</span></div>
            <span class="fixed-kind">${escapeHtml(FIXED_KIND_LABELS[item.kind] || item.kind)}</span>
            <button class="btn" type="button" data-place-fixed-edit="${escapeHtml(item.id)}">Modifier</button>
            <button class="btn danger" type="button" data-place-fixed-delete="${escapeHtml(item.id)}">Supprimer</button>
        </div>`).join('') : '<span class="muted">Aucune contrainte horaire pour ce lieu.</span>';
    const kindOptions = Object.entries(FIXED_KIND_LABELS).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('');
    return `
        <section class="place-fixed-dates" data-place-fixed="${escapeHtml(placeId)}">
            <div class="place-fixed-head"><strong>Contraintes horaires</strong><span>${reservations.length || 'Aucune'}</span></div>
            <div class="place-fixed-list">${existing}</div>
            <details class="place-fixed-editor">
                <summary>Ajouter une contrainte à ce lieu</summary>
                <input class="place-fixed-id" type="hidden" />
                <div class="place-fixed-grid">
                    <div><label>Type</label><select class="place-fixed-kind">${kindOptions}</select></div>
                    <div><label>Mode de date</label><select class="place-fixed-mode"><option value="fixed">Date fixe</option><option value="stage">Relative à l’étape</option></select></div>
                    <div class="place-fixed-relative-day" hidden><label>Jour de référence</label><select><option value="arrival">Jour d’arrivée</option><option value="departure">Jour de départ</option></select></div>
                    <div class="place-fixed-title"><label>Intitulé</label><input class="place-fixed-title-input" type="text" placeholder="${escapeHtml(placeName)}" /></div>
                    <div><label class="place-fixed-start-label">Début fixe</label><input class="place-fixed-start" type="datetime-local" /></div>
                    <div><label class="place-fixed-end-label">Fin fixe</label><input class="place-fixed-end" type="datetime-local" /></div>
                    <div class="place-fixed-meal" hidden><label>Repas</label><select><option value="breakfast">Petit déjeuner</option><option value="lunch" selected>Déjeuner</option><option value="dinner">Dîner</option></select></div>
                    <div class="place-fixed-notes"><label>Informations</label><input type="text" placeholder="Référence, conditions, adresse…" /></div>
                </div>
                <div class="place-fixed-actions"><button class="btn place-fixed-cancel" type="button" hidden>Annuler</button><button class="btn primary place-fixed-save" type="button">Ajouter</button></div>
            </details>
        </section>`;
}

function commitPlanningDates(planning, refreshPlaces = false) {
    state.planning = planning;
    send('setPlanning', planning);
    renderFixedDates();
    renderPlanning(planning);
    if (refreshPlaces && typeof renderPlaces === 'function') {
        renderPlaces();
        if (typeof attachDnD === 'function') attachDnD();
    }
}

function bindPlaceFixedDateControls(placeElement, placeId) {
    const section = placeElement.querySelector('.place-fixed-dates');
    const place = state.places[placeId];
    if (!section || !place) return;
    const editor = section.querySelector('.place-fixed-editor');
    const idInput = section.querySelector('.place-fixed-id');
    const kindInput = section.querySelector('.place-fixed-kind');
    const modeInput = section.querySelector('.place-fixed-mode');
    const relativeDayField = section.querySelector('.place-fixed-relative-day');
    const relativeDayInput = relativeDayField.querySelector('select');
    const titleInput = section.querySelector('.place-fixed-title-input');
    const startInput = section.querySelector('.place-fixed-start');
    const endInput = section.querySelector('.place-fixed-end');
    const startLabel = section.querySelector('.place-fixed-start-label');
    const endLabel = section.querySelector('.place-fixed-end-label');
    const mealField = section.querySelector('.place-fixed-meal');
    const mealInput = mealField.querySelector('select');
    const notesInput = section.querySelector('.place-fixed-notes input');
    const saveButton = section.querySelector('.place-fixed-save');
    const cancelButton = section.querySelector('.place-fixed-cancel');
    const toggleMeal = () => { mealField.hidden = kindInput.value !== 'meal' };
    const reset = () => {
        idInput.value = '';
        kindInput.value = 'activity';
        modeInput.value = 'fixed';
        relativeDayInput.value = 'arrival';
        applyDateModeInputs(modeInput, relativeDayField, startInput, endInput, startLabel, endLabel, false);
        titleInput.value = '';
        startInput.value = '';
        endInput.value = '';
        mealInput.value = 'lunch';
        notesInput.value = '';
        saveButton.textContent = 'Ajouter';
        cancelButton.hidden = true;
        toggleMeal();
    };
    kindInput.onchange = toggleMeal;
    modeInput.onchange = () => applyDateModeInputs(modeInput, relativeDayField, startInput, endInput, startLabel, endLabel, true, stageDateForPlace(placeId, relativeDayInput.value));
    cancelButton.onclick = reset;
    section.querySelectorAll('[data-place-fixed-edit]').forEach(button => {
        button.onclick = () => {
            const item = normalizedPlanning().reservations.find(reservation => reservation.id === button.dataset.placeFixedEdit);
            if (!item) return;
            idInput.value = item.id;
            kindInput.value = item.kind;
            titleInput.value = item.title || '';
            modeInput.value = item.dateMode || 'fixed';
            relativeDayInput.value = item.relativeDay || 'arrival';
            applyDateModeInputs(modeInput, relativeDayField, startInput, endInput, startLabel, endLabel, false);
            startInput.value = modeInput.value === 'stage' ? item.startTime : item.start;
            endInput.value = modeInput.value === 'stage' ? item.endTime : item.end;
            mealInput.value = item.meal || 'lunch';
            notesInput.value = item.notes || '';
            saveButton.textContent = 'Enregistrer';
            cancelButton.hidden = false;
            toggleMeal();
            editor.open = true;
        };
    });
    section.querySelectorAll('[data-place-fixed-delete]').forEach(button => {
        button.onclick = () => removeFixedDate(button.dataset.placeFixedDelete);
    });
    saveButton.onclick = () => {
        const start = startInput.value;
        const end = endInput.value;
        const relative = modeInput.value === 'stage';
        if (!start || !end || (!relative && new Date(end) <= new Date(start))) {
            showToast({ type: 'warn', text: `Renseignez ${relative ? 'un créneau horaire' : 'une période fixe'} valide pour ${place.name}.` });
            return;
        }
        const planning = planningFromControls();
        const id = idInput.value || `fixed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const existing = normalizedPlanning().reservations.find(item => item.id === id);
        const placeIds = existing ? reservationPlaceIds(existing) : [placeId];
        const reservation = TripPlanning.normalizeReservation({
            id,
            title: titleInput.value.trim() || place.name,
            kind: kindInput.value,
            placeId,
            placeIds,
            stageId: existing?.stageId || '',
            meal: mealInput.value,
            dateMode: modeInput.value,
            relativeDay: relativeDayInput.value,
            start: relative ? '' : start,
            end: relative ? '' : end,
            startTime: relative ? start : '',
            endTime: relative ? end : '',
            notes: notesInput.value
        });
        planning.reservations = planning.reservations.filter(item => item.id !== id).concat(reservation);
        commitPlanningDates(planning, true);
        showToast({ type: 'success', text: `${relative ? 'Créneau relatif' : 'Date fixe'} enregistré pour ${place.name}.` });
    };
}

function renderFixedDates() {
    const wrap = $('#fixedDatesList'); if (!wrap) return;
    const reservations = normalizedPlanning().reservations.filter(item => !reservationPlaceIds(item).length || reservationPlaceIds(item).some(id => state.itinerary.includes(id)));
    if (!reservations.length) { wrap.innerHTML = '<div class="panel muted">Aucune contrainte enregistrée.</div>'; return }
    wrap.innerHTML = reservations.slice().sort((a, b) => String(a.start || a.startTime).localeCompare(String(b.start || b.startTime))).map(item => `
        <article class="fixed-item">
            <div class="fixed-item__date"><strong>${escapeHtml(reservationTimingLabel(item))}</strong></div>
            <div class="fixed-item__body"><span class="fixed-kind">${escapeHtml(FIXED_KIND_LABELS[item.kind] || item.kind)}</span><span class="date-mode-badge date-mode-badge--${escapeHtml(item.dateMode)}">${item.dateMode === 'stage' ? 'RELATIF À L’ÉTAPE' : 'DATE FIXE'}</span><h4>${escapeHtml(item.title || 'À compléter')}</h4><p>${escapeHtml([reservationPlaceIds(item).map(placeId => state.places[placeId]?.name || placeId).join(' → '), item.notes].filter(Boolean).join(' · ') || 'Informations à compléter')}</p></div>
            <div class="fixed-item__actions"><button class="btn" type="button" data-fixed-edit="${escapeHtml(item.id)}">Modifier</button><button class="btn danger" type="button" data-fixed-delete="${escapeHtml(item.id)}">Supprimer</button></div>
        </article>`).join('');
    wrap.querySelectorAll('[data-fixed-edit]').forEach(button => button.onclick = () => editFixedDate(button.dataset.fixedEdit));
    wrap.querySelectorAll('[data-fixed-delete]').forEach(button => button.onclick = () => removeFixedDate(button.dataset.fixedDelete));
}

function toggleFixedMealField() { if ($('#fixedMealField')) $('#fixedMealField').hidden = $('#fixedKind')?.value !== 'meal' }
function toggleFixedDateMode(preserve = true) {
    const mode = $('#fixedDateMode'), relativeDay = $('#fixedRelativeDayField'), start = $('#fixedStart'), end = $('#fixedEnd');
    if (!mode || !relativeDay || !start || !end) return;
    const placeId = selectedFixedPlaceIds()[0] || '';
    applyDateModeInputs(mode, relativeDay, start, end, $('#fixedStartLabel'), $('#fixedEndLabel'), preserve, stageDateForPlace(placeId, $('#fixedRelativeDay')?.value));
}

function resetFixedForm() {
    ['fixedId', 'fixedTitle', 'fixedStart', 'fixedEnd', 'fixedNotes'].forEach(id => { const element = $(`#${id}`); if (element) element.value = '' });
    if ($('#fixedKind')) $('#fixedKind').value = 'activity';
    if ($('#fixedDateMode')) $('#fixedDateMode').value = 'fixed';
    if ($('#fixedRelativeDay')) $('#fixedRelativeDay').value = 'arrival';
    $('#fixedPlaces')?.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = false });
    if ($('#fixedMeal')) $('#fixedMeal').value = 'lunch';
    if ($('#fixedAdd')) $('#fixedAdd').textContent = 'Ajouter la contrainte';
    if ($('#fixedCancelEdit')) $('#fixedCancelEdit').hidden = true;
    toggleFixedMealField();
    toggleFixedDateMode(false);
}

function editFixedDate(id) {
    const item = normalizedPlanning().reservations.find(reservation => reservation.id === id); if (!item) return;
    if ($('#reservationEditor')) $('#reservationEditor').open = true;
    $('#fixedId').value = item.id; $('#fixedTitle').value = item.title; $('#fixedKind').value = item.kind;
    const placeIds = new Set(reservationPlaceIds(item));
    $('#fixedPlaces')?.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = placeIds.has(input.value) });
    $('#fixedMeal').value = item.meal || 'lunch';
    $('#fixedDateMode').value = item.dateMode || 'fixed'; $('#fixedRelativeDay').value = item.relativeDay || 'arrival'; toggleFixedDateMode(false);
    $('#fixedStart').value = item.dateMode === 'stage' ? item.startTime : item.start; $('#fixedEnd').value = item.dateMode === 'stage' ? item.endTime : item.end; $('#fixedNotes').value = item.notes || '';
    $('#fixedAdd').textContent = 'Enregistrer la contrainte'; $('#fixedCancelEdit').hidden = false; toggleFixedMealField();
}

function saveFixedDate() {
    const title = $('#fixedTitle')?.value.trim(), start = $('#fixedStart')?.value, end = $('#fixedEnd')?.value;
    const relative = $('#fixedDateMode')?.value === 'stage';
    if (!title || !start || !end || (!relative && new Date(end) <= new Date(start))) { showToast({ type: 'warn', text: `Renseignez un intitulé et ${relative ? 'un créneau horaire' : 'une période fixe'} valide.` }); return }
    const planning = planningFromControls();
    const id = $('#fixedId')?.value || `fixed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const existing = planning.reservations.find(item => item.id === id);
    const placeIds = selectedFixedPlaceIds();
    if (relative && !placeIds.length) { showToast({ type: 'warn', text: 'Un créneau relatif doit être associé à une étape ou une sous-étape.' }); return }
    const reservation = TripPlanning.normalizeReservation({ id, title, kind: $('#fixedKind')?.value, placeId: placeIds[0] || '', placeIds, stageId: existing?.stageId || '', meal: $('#fixedMeal')?.value, dateMode: $('#fixedDateMode')?.value, relativeDay: $('#fixedRelativeDay')?.value, start: relative ? '' : start, end: relative ? '' : end, startTime: relative ? start : '', endTime: relative ? end : '', notes: $('#fixedNotes')?.value });
    planning.reservations = planning.reservations.filter(item => item.id !== id).concat(reservation);
    resetFixedForm(); commitPlanningDates(planning, true);
}

function removeFixedDate(id) {
    const item = normalizedPlanning().reservations.find(reservation => reservation.id === id);
    if (!item || !confirm(`Supprimer la contrainte « ${item.title} » ?`)) return;
    const planning = planningFromControls(); planning.reservations = planning.reservations.filter(reservation => reservation.id !== id);
    commitPlanningDates(planning, true);
}

function shiftPlanningDate(target, days) {
    const input = $(`#${target}`); if (!input?.value) { showToast({ type: 'warn', text: 'Choisissez d’abord une date.' }); return }
    const date = new Date(`${input.value}T12:00:00`); date.setDate(date.getDate() + days);
    const pad = value => String(value).padStart(2, '0');
    input.value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    generatePlan();
}

function planningEventLabel(event) {
    if (event.kind === 'meal') return event.label;
    if (event.kind === 'travel') return event.fixed ? 'Transport réservé' : 'Trajet';
    if (event.fixedType === 'lodging') return 'Hébergement';
    if (event.fixed && event.fixedType) return FIXED_KIND_LABELS[event.fixedType] || 'Date fixe';
    return event.fixed ? 'Date fixe' : 'Activité';
}

function formatEventDuration(event) {
    const minutes = Math.max(0, Math.round((event.end - event.start) / 60000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours} h ${String(remainder).padStart(2, '0')}` : `${hours} h`;
}

function placeDefinitionLink(placeId, label, reservationId = '') {
    if (state.places[placeId]) return `<button type="button" class="linklike" data-place-definition="${escapeHtml(placeId)}" title="Ouvrir la fiche du lieu">${escapeHtml(label)}</button>`;
    if (reservationId) return `<button type="button" class="linklike" data-reservation-definition="${escapeHtml(reservationId)}" title="Ouvrir la réservation">${escapeHtml(label)}</button>`;
    return escapeHtml(label);
}

function openRouteDefinition(event) {
    const placeButton = event.target.closest('[data-place-definition]');
    if (placeButton) {
        document.querySelector('.tab[data-page="itinerary"]')?.click();
        // A tag filter must not hide the target of a hotel/visit reference.
        document.querySelectorAll('#tagFilters .tag.on').forEach(tag => tag.classList.remove('on'));
        renderPlaces();
        attachDnD();
        const editor = document.querySelector(`#places .item[data-id="${CSS.escape(placeButton.dataset.placeDefinition)}"] .place-editor`);
        if (editor) editor.open = true;
        focusPlace(placeButton.dataset.placeDefinition, { pan: true, openPopup: true });
        return true;
    }
    const reservationButton = event.target.closest('[data-reservation-definition]');
    if (reservationButton) {
        document.querySelector('.tab[data-page="planning"]')?.click();
        editFixedDate(reservationButton.dataset.reservationDefinition);
        $('#fixedTitle')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
    }
    return false;
}

function renderDailyRoutes(result) {
    const wrap = $('#dailyRoutes'); if (!wrap) return;
    wrap.hidden = !result?.days.some(day => day.lodging || day.morningLodging);
    if (wrap.hidden) { wrap.innerHTML = ''; return; }
    const dateFormat = new Intl.DateTimeFormat('fr-CH', { weekday: 'long', day: 'numeric', month: 'long' });
    wrap.innerHTML = `<h3>Parcours quotidiens</h3><p class="muted">Départ depuis l’hôtel de la nuit précédente, retour à l’hôtel du soir. Cliquez sur un lieu pour ouvrir sa fiche.</p>${result.days.map(day => {
        const stops = [];
        const addStop = (placeId, label, role = '', reservationId = '') => {
            if (!role && placeId && stops.at(-1)?.placeId === placeId) return;
            stops.push({ placeId, label, role, reservationId });
        };
        if (day.morningLodging) addStop(day.morningLodging.placeId, day.morningLodging.title, '🛏️ Départ', day.morningLodging.reservationId);
        for (const event of day.events) {
            if (event.boundary) continue;
            if (event.fromId) addStop(event.fromId, state.places[event.fromId]?.name || event.fromId);
            for (const id of reservationPlaceIds(event)) addStop(id, state.places[id]?.name || event.title);
        }
        if (day.lodging) {
            if (stops.at(-1)?.placeId === day.lodging.placeId && !stops.at(-1)?.role) stops.pop();
            addStop(day.lodging.placeId, day.lodging.title, '🛏️ Nuit', day.lodging.reservationId);
        }
        return `<div class="daily-route"><h4>${escapeHtml(dateFormat.format(new Date(`${day.date}T12:00:00`)))}</h4><ol>${stops.map(stop => `<li${stop.role ? ' class="daily-route__hotel"' : ''}>${stop.role ? `<small>${escapeHtml(stop.role)}</small>` : ''}${placeDefinitionLink(stop.placeId, stop.label, stop.reservationId)}</li>`).join('') || '<li class="muted">Aucun lieu planifié</li>'}</ol></div>`;
    }).join('')}`;
    wrap.onclick = openRouteDefinition;
}

function renderPlanning(value = state.planning) {
    const wrap = $('#planWrap'); if (!wrap) return;
    const planning = normalizedPlanning(value);
    if (!planning.startDate || !planning.endDate) { renderDailyRoutes(null); wrap.className = 'planning-output muted'; wrap.textContent = 'Choisissez le premier et le dernier jour puis recalculez le planning.'; return }
    const result = TripPlanning.buildPlan({ itinerary: tripItineraryFromStart(), places: state.places, edges: state.edges, planning, structure: TripStructure.buildOutline(state) });
    renderDailyRoutes(result);
    PLAN = result.events;
    const dateFormat = new Intl.DateTimeFormat('fr-CH', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    const timeFormat = new Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit' });
    const notices = result.conflicts.length ? `<div class="planning-alert"><strong>Points à vérifier</strong>${result.conflicts.map(message => `<span>${escapeHtml(message)}</span>`).join('')}</div>` : '';
    const cards = result.days.map((day, index) => {
        const activities = day.events.filter(event => ['activity', 'fixed'].includes(event.kind));
        const travels = day.events.filter(event => event.kind === 'travel');
        const rows = day.events.map(event => {
            const place = state.places[event.placeId];
            const eventPlaceIds = reservationPlaceIds(event);
            const focus = place ? `<button class="linklike planning-place-icon" data-focus="${escapeHtml(event.placeId)}" title="Voir ${escapeHtml(place.name)} sur la carte">${escapeHtml(typeFromFirstTag(place.tags || []).glyph)}</button>` : '';
            const flags = `${event.fixed ? `<span class="fixed-badge">${event.dateMode === 'stage' ? 'RELATIF' : 'FIXE'}</span>` : ''}${event.closed ? '<span class="err">Fermé ce jour</span>' : ''}${event.conflict ? '<span class="err">Conflit</span>' : ''}`;
            const groupedPlaces = eventPlaceIds.length > 1 ? `<small class="planning-event__places">Étapes : ${eventPlaceIds.map(placeId => `<button class="linklike" data-focus="${escapeHtml(placeId)}">${escapeHtml(state.places[placeId]?.name || placeId)}</button>`).join(' → ')}</small>` : '';
            const title = event.fixedType === 'lodging' ? placeDefinitionLink(event.placeId, event.title, event.reservationId) : escapeHtml(event.title || 'À compléter');
            const time = event.boundary ? timeFormat.format(event.start) : `${timeFormat.format(event.start)}–${timeFormat.format(event.end)}`;
            return `<div class="planning-event planning-event--${escapeHtml(event.kind)}${event.conflict ? ' has-conflict' : ''}"><time>${time}</time><span class="planning-event__type">${escapeHtml(planningEventLabel(event))}</span><span class="planning-event__duration">${event.boundary ? '' : escapeHtml(formatEventDuration(event))}</span><div><strong>${focus}${title}</strong>${flags}${groupedPlaces}${event.notes ? `<small>${escapeHtml(event.notes)}</small>` : ''}</div></div>`;
        }).join('');
        return `<article class="planning-day${day.conflicts.length ? ' has-conflict' : ''}"><header><span>JOUR ${String(index + 1).padStart(2, '0')}</span><h3>${escapeHtml(dateFormat.format(new Date(`${day.date}T12:00:00`)))}</h3></header><div class="planning-timeline">${rows}</div><div class="planning-completeness">${activities.length ? '' : '<div><b>Activités</b><span>À compléter</span></div>'}${travels.length ? '' : '<div><b>Trajets</b><span>À compléter</span></div>'}<div><b>Hébergement</b><span>${escapeHtml(day.lodging?.title || 'À compléter')}</span>${day.lodging?.fixed ? '<i>FIXE</i>' : ''}</div></div></article>`;
    }).join('');
    const unscheduled = result.unscheduled.length ? `<div class="planning-unscheduled"><strong>À placer</strong>${result.unscheduled.map(item => `<button class="btn" data-focus="${escapeHtml(item.id)}">${escapeHtml(typeFromFirstTag(state.places[item.id]?.tags || []).glyph)} ${escapeHtml(item.title)} · ${fmtDurMin(item.remainingMin)}</button>`).join('')}</div>` : '';
    wrap.className = 'planning-output'; wrap.innerHTML = `${notices}<div class="planning-days">${cards}</div>${unscheduled}`;
    wrap.onclick = event => { if (openRouteDefinition(event)) return; const button = event.target.closest('[data-focus]'); if (button) focusPlace(button.dataset.focus, { pan: true, openPopup: true }) };
}

function generatePlan() {
    const planning = planningFromControls(); state.planning = planning; send('setPlanning', planning);
    renderFixedDates(); renderPlanning(planning); renderBudgetSummary(); updateRouteSummary();
    showToast({ type: 'success', text: 'Planning recalculé en respectant les dates fixes.' });
}

function exportPlanningPdf() {
    if (typeof TripPdfExport === 'undefined') {
        showToast({ type: 'error', text: 'Le générateur PDF n’a pas pu être chargé.' });
        return;
    }
    const planning = planningFromControls();
    const itinerary = tripItineraryFromStart();
    const result = TripPlanning.buildPlan({ itinerary, places: state.places, edges: state.edges, planning, structure: TripStructure.buildOutline(state) });
    if (!result.days.length) {
        showToast({ type: 'warn', text: result.conflicts[0] || 'Choisissez des dates valides avant de télécharger le PDF.' });
        return;
    }
    const activeTrip = TRIPS.find(trip => trip?.id === ACTIVE_TRIP);
    const tripName = activeTrip?.name || 'Voyage';
    const people = Math.max(1, Number($('#people')?.value) || 1);
    try {
        state.planning = planning;
        send('setPlanning', planning);
        const filename = TripPdfExport.downloadTripPdf({
            tripName, planning, result, itinerary,
            places: state.places, edges: state.edges, people, generatedAt: new Date()
        });
        showToast({ type: 'success', text: `PDF téléchargé : ${filename}` });
    } catch (error) {
        console.error('Export PDF impossible', error);
        showToast({ type: 'error', text: `Export PDF impossible : ${error.message || error}` });
    }
}

function exportPlanningOnlyPdf() {
    if (typeof TripPdfExport === 'undefined') {
        showToast({ type: 'error', text: 'Le générateur PDF n’a pas pu être chargé.' });
        return;
    }
    const planning = planningFromControls();
    const itinerary = tripItineraryFromStart();
    const result = TripPlanning.buildPlan({ itinerary, places: state.places, edges: state.edges, planning, structure: TripStructure.buildOutline(state) });
    if (!result.days.length) {
        showToast({ type: 'warn', text: result.conflicts[0] || 'Choisissez des dates valides avant de télécharger le PDF.' });
        return;
    }
    const activeTrip = TRIPS.find(trip => trip?.id === ACTIVE_TRIP);
    const tripName = activeTrip?.name || 'Voyage';
    try {
        state.planning = planning;
        send('setPlanning', planning);
        const filename = TripPdfExport.downloadPlanningPdf({ tripName, planning, result, places: state.places, itinerary, generatedAt: new Date() });
        showToast({ type: 'success', text: `Planning PDF téléchargé : ${filename}` });
    } catch (error) {
        console.error('Export du planning PDF impossible', error);
        showToast({ type: 'error', text: `Export PDF impossible : ${error.message || error}` });
    }
}

let routesPdfExporting = false;
async function exportRoutesPdf(mode) {
    const byStage = mode === 'stages';
    if (routesPdfExporting) return;
    if (typeof TripPdfExport === 'undefined' || typeof TripRouteMaps === 'undefined') {
        showToast({ type: 'error', text: 'Le générateur de cartes PDF n’a pas pu être chargé. Rechargez la page.' });
        return;
    }
    const planning = planningFromControls();
    // Keep a consistent document even if the active voyage changes while maps load.
    const snapshot = JSON.parse(JSON.stringify({ ...state, itinerary: tripItineraryFromStart(), planning }));
    const hasDates = Boolean(planning.startDate || planning.endDate);
    const structure = hasDates || byStage ? TripStructure.buildOutline(snapshot) : null;
    const result = hasDates ? TripPlanning.buildPlan({ ...snapshot, structure }) : null;
    if (hasDates && !result.days.length) {
        showToast({ type: 'warn', text: result.conflicts[0] || 'Renseignez les deux dates du planning.' });
        return;
    }
    const input = { ...snapshot, result, structure, tripName: TRIPS.find(trip => trip?.id === ACTIVE_TRIP)?.name || 'Voyage', generatedAt: new Date() };
    const segments = TripPdfExport.collectRouteSegments(input);
    const entries = byStage ? TripPdfExport.collectStageRoutes({ ...input, segments }) : segments;
    if (!entries.length) {
        showToast({ type: 'warn', text: hasDates ? 'Aucun trajet dans le planning. Vérifiez les lieux et les dates.' : 'Ajoutez au moins deux lieux à l’itinéraire.' });
        return;
    }
    const buttons = Array.from(document.querySelectorAll('[data-export-routes-pdf], [data-export-stage-routes-pdf]'));
    const statuses = Array.from(document.querySelectorAll('[data-routes-pdf-status]'));
    const status = text => statuses.forEach(element => { element.hidden = false; element.textContent = text; });
    routesPdfExporting = true;
    buttons.forEach(button => { button.disabled = true; });
    try {
        const prepare = byStage ? TripRouteMaps.prepareStageMaps : TripRouteMaps.prepareMaps;
        const prepared = await prepare(entries, snapshot.places, {
            onProgress: (current, total, route, routes) => status(`Préparation des ${byStage ? 'plans des étapes' : 'cartes'} : ${current}/${total}${route ? ` · trajet ${route}/${routes}` : ''}…`)
        });
        const filename = byStage ? TripPdfExport.downloadStageRoutesPdf({ ...input, stages: prepared }) : TripPdfExport.downloadRoutesPdf({ ...input, segments: prepared });
        const incomplete = prepared.filter(segment => !segment.map?.complete).length;
        const detail = incomplete ? ` ${incomplete} carte(s) partielle(s) ou indicative(s), signalée(s) dans le PDF.` : '';
        status(`${prepared.length} ${byStage ? 'étape(s)' : 'trajet(s)'} exporté(s).${detail}`);
        showToast({ type: incomplete ? 'warn' : 'success', text: `PDF téléchargé : ${filename}.${detail}` });
    } catch (error) {
        console.error('Export des trajets impossible', error);
        status('La génération du PDF a échoué. Vous pouvez réessayer.');
        showToast({ type: 'error', text: `Export des trajets impossible : ${error.message || error}` });
    } finally {
        routesPdfExporting = false;
        buttons.forEach(button => { button.disabled = false; });
    }
}

function exportStageRoutesPdf() {
    return exportRoutesPdf('stages');
}
