/* global TripExperience, $, $$, state, LOADED, escapeHtml, TripStructure, outlinePhotos, outlineConstraintPlaceIds, formatOutlineDate, formatPlanningDateTime, renderTripOutline, renderPlaces, attachDnD, focusPlace, setHeaderHeight, map, setPlacesCompleted, visitProgressDisabled */
'use strict';

let EXPERIENCE_MODE = TripExperience.normalizeMode(localStorage.getItem('trip_experience_mode'));
let navigateTripPage = () => {};

function setExperienceMode(mode, { navigate = true } = {}) {
    EXPERIENCE_MODE = TripExperience.normalizeMode(mode);
    localStorage.setItem('trip_experience_mode', EXPERIENCE_MODE);
    document.body.dataset.experience = EXPERIENCE_MODE;
    const planningSetup = $('#planningSetup');
    if (planningSetup) planningSetup.open = EXPERIENCE_MODE === 'prepare';
    syncExperienceNavigation(document.body.dataset.page);
    if (LOADED) renderTripOutline();
    if (navigate) navigateTripPage('overview');
    renderExperienceGuide();
    setHeaderHeight();
    setTimeout(() => map?.invalidateSize(), 80);
}

function syncExperienceNavigation(page) {
    const primary = TripExperience.primaryPages(EXPERIENCE_MODE);
    const labels = EXPERIENCE_MODE === 'travel'
        ? { overview: 'Mon voyage', itinerary: 'Modifier les lieux', planning: 'Jour par jour', recordings: 'Suivi GPS' }
        : { overview: 'Étapes', itinerary: 'Lieux', planning: 'Séjour', recordings: 'Suivi GPS' };
    const main = $('#mainPages'), more = $('#morePages');
    if (!main || !more) return;
    const buttons = $$('#appTabs .tab[data-page]');
    const focused = document.activeElement;
    primary.forEach(id => { const button = buttons.find(item => item.dataset.page === id); if (button) main.append(button); });
    buttons.filter(button => !primary.includes(button.dataset.page)).forEach(button => more.append(button));
    buttons.forEach(button => {
        button.textContent = labels[button.dataset.page] || button.dataset.label;
        if (button.dataset.page === 'planning') button.title = 'Dates, réservations et planning jour par jour';
        button.classList.toggle('on', button.dataset.page === page);
        if (button.dataset.page === page) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    });
    $('#moreNavigation > summary').classList.toggle('on', !primary.includes(page));
    $$('[data-experience-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.experienceMode === EXPERIENCE_MODE)));
    $('#editTripShortcut').hidden = EXPERIENCE_MODE !== 'travel';
    $('#cardOutline h2').textContent = EXPERIENCE_MODE === 'travel' ? 'Votre carnet de voyage' : 'Grandes étapes et nuits';
    if (buttons.includes(focused)) focused.focus({ preventScroll: true });
    renderExperienceGuide();
}

function renderExperienceGuide() {
    const guide = $('#experienceGuide');
    if (!guide) return;
    const page = document.body.dataset.page;
    guide.hidden = EXPERIENCE_MODE !== 'prepare' || !['overview', 'itinerary', 'add', 'planning', 'budget'].includes(page);
    if (guide.hidden) return;
    const summary = TripExperience.summarize(state);
    const steps = [
        { page: 'add', title: '1 · Choisir des lieux', text: `${summary.places} lieu${summary.places > 1 ? 'x' : ''} enregistré${summary.places > 1 ? 's' : ''}` },
        { page: 'overview', title: '2 · Organiser les étapes', text: `${summary.visits} lieu${summary.visits > 1 ? 'x' : ''} dans l’itinéraire` },
        { page: 'planning', title: '3 · Préciser le séjour', text: summary.dated ? `${summary.reservations} réservation${summary.reservations > 1 ? 's' : ''}` : 'Dates facultatives' }
    ];
    guide.innerHTML = `<div class="experience-guide__heading"><div><strong>${summary.places ? 'Votre voyage, à votre rythme' : 'Par où commencer ?'}</strong><p>${summary.places ? 'Ajoutez des lieux, organisez-les, puis précisez les dates si vous les connaissez.' : 'Cherchez un premier lieu ou importez un voyage avec « Gérer ». Vous pourrez tout ajuster ensuite.'}</p></div><button class="btn" data-preview-trip type="button">Voir mon carnet →</button></div>
        <nav class="experience-steps" aria-label="Préparer le voyage">${steps.map(step => `<button type="button" class="${page === step.page ? 'is-current' : ''}" data-open-page="${step.page}"><strong>${step.title}</strong><span>${step.text}</span></button>`).join('')}</nav>`;
}

function editExperiencePlace(id) {
    setExperienceMode('prepare', { navigate: false });
    navigateTripPage('itinerary');
    $$('#tagFilters .tag.on').forEach(tag => tag.classList.remove('on'));
    renderPlaces();
    attachDnD();
    const card = document.querySelector(`#places .item[data-id="${CSS.escape(id)}"]`);
    const editor = card?.querySelector('.place-editor');
    if (editor) editor.open = true;
    card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card?.querySelector('.placeName')?.focus({ preventScroll: true });
    focusPlace(id, { scrollList: false, openPopup: false });
}

function renderTravelOutline(wrap, outline) {
    const stages = TripStructure.chronologicalStages(outline.stages);
    const summary = TripExperience.summarize(state);
    const date = value => value ? formatOutlineDate(value, { day: 'numeric', month: 'short' }) : '';
    const period = stage => [date(stage.arrivalDate), date(stage.departureDate)].filter(Boolean).join(' → ') || TripStructure.relativePeriodLabel(stage.relativePeriod) || 'Dates libres';
    const placeLine = id => {
        const place = state.places[id];
        if (!place) return '';
        return `<li><button class="travel-place-link" type="button" data-travel-focus="${escapeHtml(id)}">${escapeHtml(place.name || id)}</button><label class="completed-toggle"><input type="checkbox" data-travel-completed="${escapeHtml(id)}" ${place.completed ? 'checked' : ''} ${visitProgressDisabled(id) ? 'disabled' : ''}> Visité</label><button class="btn" type="button" data-edit-place="${escapeHtml(id)}" aria-label="Modifier ${escapeHtml(place.name || id)}">Modifier</button></li>`;
    };
    wrap.innerHTML = `<div class="travel-intro"><strong>${summary.visits} lieux au programme · ${summary.completed} réalisés</strong><p>Consultez votre parcours ou ouvrez « Jour par jour ». Une envie de changement ? Chaque lieu reste modifiable.</p></div>` + stages.map((stage, index) => {
        const place = state.places[stage.id] || {};
        const reserved = new Set([...(stage.lodgings || []), ...(stage.meals?.lunch || []), ...(stage.meals?.dinner || [])].flatMap(outlineConstraintPlaceIds));
        const visits = stage.detailIds.filter(id => !reserved.has(id));
        const group = (label, ids) => ids.length ? `<section class="travel-group"><h4>${label}</h4><ul>${[...new Set(ids)].map(placeLine).join('')}</ul></section>` : '';
        const reservations = (label, items) => items?.length ? `<section class="travel-group"><h4>${label}</h4><ul>${items.map(item => `<li><div><strong>${escapeHtml(item.title || label)}</strong>${item.start ? `<small>${escapeHtml(formatPlanningDateTime(item.start))}</small>` : ''}${item.notes ? `<small>${escapeHtml(item.notes)}</small>` : ''}</div></li>`).join('')}</ul></section>` : '';
        return `<article class="travel-stage"><header><span class="eyebrow">ÉTAPE ${index + 1} · ${escapeHtml(period(stage))}</span><h3>${escapeHtml(place.name || stage.id)}</h3><div class="actions"><button class="btn" type="button" data-travel-focus="${escapeHtml(stage.id)}">Sur la carte</button><button class="btn" type="button" data-edit-place="${escapeHtml(stage.id)}">Modifier cette étape</button></div></header>${place.desc ? `<p class="travel-description">${escapeHtml(place.desc)}</p>` : ''}${outlinePhotos(stage)}${group('À découvrir', visits)}${reservations('Hébergement', stage.lodgings)}${reservations('Déjeuner', stage.meals?.lunch)}${reservations('Dîner', stage.meals?.dinner)}</article>`;
    }).join('');
    wrap.querySelectorAll('[data-travel-focus]').forEach(button => {
        button.onclick = () => { navigateTripPage('map'); focusPlace(button.dataset.travelFocus, { scrollList: false }); };
    });
    wrap.querySelectorAll('[data-travel-completed]').forEach(input => {
        input.onchange = () => setPlacesCompleted([input.dataset.travelCompleted], input.checked);
    });
}

function initExperienceUi() {
    $$('#appTabs .tab[data-page]').forEach(button => { button.dataset.label = button.textContent === '＋' ? 'Ajouter un lieu' : button.textContent; });
    document.addEventListener('click', event => {
        const mode = event.target.closest('[data-experience-mode]');
        if (mode) setExperienceMode(mode.dataset.experienceMode);
        if (event.target.closest('[data-preview-trip]')) setExperienceMode('travel');
        if (event.target.closest('#editTripShortcut')) setExperienceMode('prepare');
        const edit = event.target.closest('[data-edit-place]');
        if (edit) editExperiencePlace(edit.dataset.editPlace);
        if (!event.target.closest('#moreNavigation')) $('#moreNavigation').open = false;
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && $('#moreNavigation').open) { $('#moreNavigation').open = false; $('#moreNavigation > summary').focus(); }
    });
    setExperienceMode(EXPERIENCE_MODE, { navigate: false });
}
