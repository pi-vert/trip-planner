/* global $, ACTIVE_TRIP, LOADED, state, tripOutline, renderTripOutline, escapeHtml, showToast, TripWeather */

window.TRIP_WEATHER = { stages: {} };
let WEATHER_TRIP_ID = '';
let WEATHER_STAGE_ID = '';
let WEATHER_LOAD_TOKEN = 0;

function weatherApi(query = {}) {
    const params = new URLSearchParams(query);
    return `./api/weather${params.size ? `?${params}` : ''}`;
}

async function weatherRequest(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload.error || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return payload;
}

function weatherStages() {
    const unique = new Map();
    for (const stage of tripOutline().stages || []) {
        const place = state.places?.[stage.id];
        if (place && !unique.has(stage.id)) unique.set(stage.id, { ...stage, place });
    }
    return [...unique.values()];
}

function validWeatherCoordinates(place) {
    const lat = Number(place?.lat), lng = Number(place?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
}

function weatherNumber(value, suffix = '', fallback = '—') {
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? `${Number(value).toLocaleString('fr-CH', { maximumFractionDigits: 1 })}${suffix}` : fallback;
}

function weatherSourceLabel(source) {
    return source === 'forecast' ? 'Prévision' : source === 'archive' ? 'Historique météo' : 'Tendance climatique';
}

async function saveStageWeather(stage, data) {
    const saved = await weatherRequest(weatherApi(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tripId: ACTIVE_TRIP,
            stageId: stage.id,
            data: { name: stage.place.name || stage.id, lat: stage.place.lat, lng: stage.place.lng, ...data }
        })
    });
    window.TRIP_WEATHER.stages[stage.id] = saved;
    return saved;
}

async function loadTripWeather(force = false) {
    if (!ACTIVE_TRIP || (!force && WEATHER_TRIP_ID === ACTIVE_TRIP)) return;
    const tripId = ACTIVE_TRIP, token = ++WEATHER_LOAD_TOKEN;
    try {
        const data = await weatherRequest(weatherApi({ tripId }));
        if (token !== WEATHER_LOAD_TOKEN || tripId !== ACTIVE_TRIP) return;
        WEATHER_TRIP_ID = tripId;
        window.TRIP_WEATHER = TripWeather.normalizeTripWeather(data);
    } catch (error) {
        if (token !== WEATHER_LOAD_TOKEN || tripId !== ACTIVE_TRIP) return;
        WEATHER_TRIP_ID = tripId;
        window.TRIP_WEATHER = { stages: {} };
        showToast({ type: 'error', text: `Météo indisponible : ${error.message}` });
    }
    renderWeatherPage();
    if (LOADED) renderTripOutline();
}

function prepareTripWeather(tripId) {
    if (!tripId || WEATHER_TRIP_ID === tripId) return;
    WEATHER_TRIP_ID = '';
    window.TRIP_WEATHER = { stages: {} };
}

async function fetchStageClimate(stage) {
    const response = await weatherRequest(weatherApi(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            mode: 'climate', tripId: ACTIVE_TRIP, stageId: stage.id,
            name: stage.place.name || stage.id, lat: stage.place.lat, lng: stage.place.lng
        })
    });
    window.TRIP_WEATHER.stages[stage.id] = response.stage;
    return response.data;
}

async function fetchStageStay(stage, range) {
    const response = await weatherRequest(weatherApi(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            mode: 'stay', tripId: ACTIVE_TRIP, stageId: stage.id,
            name: stage.place.name || stage.id, lat: stage.place.lat, lng: stage.place.lng,
            startDate: range.startDate, endDate: range.endDate
        })
    });
    window.TRIP_WEATHER.stages[stage.id] = response.stage;
    return response.data;
}

async function mapWithConcurrency(items, limit, callback) {
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            await callback(items[index], index);
        }
    });
    await Promise.all(workers);
}

function setWeatherBusy(button, busy, text) {
    if (!button) return;
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? text : button.dataset.label;
}

async function fillAnnualWeather() {
    const button = $('#weatherFillClimate');
    const status = $('#weatherClimateStatus');
    const allStages = weatherStages().filter(stage => validWeatherCoordinates(stage.place));
    const lastYear = new Date().getUTCFullYear() - 1;
    const expectedPeriod = `${lastYear - 9}-${lastYear}`;
    const stages = allStages.filter(stage => {
        const climate = window.TRIP_WEATHER.stages[stage.id]?.climate;
        return climate?.monthly?.length !== 12 || climate.period !== expectedPeriod;
    });
    if (!allStages.length) {
        showToast({ type: 'warn', text: 'Aucune grande étape avec des coordonnées valides.' });
        return;
    }
    if (!stages.length) {
        showToast({ type: 'info', text: 'Toutes les tendances annuelles sont déjà enregistrées.' });
        return;
    }
    setWeatherBusy(button, true, 'Analyse en cours...');
    let completed = 0;
    try {
        await mapWithConcurrency(stages, 1, async stage => {
            await fetchStageClimate(stage);
            completed += 1;
            if (status) status.textContent = `${allStages.length - stages.length + completed}/${allStages.length} destinations analysées et enregistrées`;
        });
        renderWeatherPage();
        renderTripOutline();
        showToast({ type: 'success', text: 'Tendances météo annuelles enregistrées.' });
    } catch (error) {
        renderWeatherPage();
        renderTripOutline();
        const limit = error.status === 429 ? ' Limite de requêtes atteinte.' : '';
        showToast({ type: 'error', text: `Analyse interrompue : ${error.message}${limit} Les résultats déjà obtenus sont conservés.` });
    } finally {
        setWeatherBusy(button, false);
    }
}

function effectiveStayRange(stage) {
    const tripStart = String(state.planning?.startDate || '');
    const tripEnd = String(state.planning?.endDate || tripStart);
    const startDate = stage.arrivalDate || tripStart;
    const endDate = stage.departureDate || startDate || tripEnd;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
    const range = { startDate: startDate < tripStart ? tripStart : startDate, endDate: tripEnd && endDate > tripEnd ? tripEnd : endDate };
    return range.endDate >= range.startDate ? range : null;
}

function stayWeatherComplete(stage) {
    const range = effectiveStayRange(stage);
    const stay = window.TRIP_WEATHER.stages[stage.id]?.stay;
    if (!range || stay?.startDate !== range.startDate || stay?.endDate !== range.endDate) return false;
    const fetchedAt = Date.parse(stay.fetchedAt || '');
    if (stay.source === 'forecast' && (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt >= 6 * 60 * 60 * 1000)) return false;
    const dates = new Set((stay.daily || []).map(day => day.date));
    return TripWeather.dateRange(range.startDate, range.endDate).every(date => dates.has(date));
}

async function fillStayWeather() {
    const button = $('#weatherFillStay');
    const status = $('#weatherStayStatus');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(state.planning?.startDate || ''))) {
        showToast({ type: 'warn', text: 'Indiquez d’abord la date de début du séjour dans le Planning.' });
        return;
    }
    const allStages = weatherStages().filter(stage => validWeatherCoordinates(stage.place) && effectiveStayRange(stage));
    const stages = allStages.filter(stage => !stayWeatherComplete(stage));
    if (!allStages.length) {
        showToast({ type: 'warn', text: 'Aucune étape datée avec des coordonnées valides.' });
        return;
    }
    if (!stages.length) {
        showToast({ type: 'info', text: 'La météo est déjà enregistrée pour toutes les étapes de ce séjour.' });
        return;
    }
    setWeatherBusy(button, true, 'Récupération en cours...');
    let completed = 0, estimated = 0;
    try {
        await mapWithConcurrency(stages, 1, async stage => {
            const range = effectiveStayRange(stage);
            let stored = window.TRIP_WEATHER.stages[stage.id];
            if (!stored?.climate?.monthly?.length) {
                await fetchStageClimate(stage);
                stored = window.TRIP_WEATHER.stages[stage.id];
            }
            let stay;
            try {
                stay = await fetchStageStay(stage, range);
            } catch (error) {
                if (error.status !== 422) throw error;
                estimated += 1;
                stay = {
                    source: 'climate', fetchedAt: new Date().toISOString(),
                    ...range, daily: TripWeather.estimateStay(stored.climate, range.startDate, range.endDate)
                };
                await saveStageWeather(stage, { stay });
            }
            completed += 1;
            if (status) status.textContent = `${allStages.length - stages.length + completed}/${allStages.length} étapes renseignées et enregistrées`;
        });
        renderWeatherPage();
        renderTripOutline();
        const suffix = estimated ? ` ${estimated} étape${estimated > 1 ? 's' : ''} utilise${estimated > 1 ? 'nt' : ''} une tendance climatique.` : '';
        showToast({ type: 'success', text: `Météo du séjour enregistrée.${suffix}` });
    } catch (error) {
        renderWeatherPage();
        renderTripOutline();
        const limit = error.status === 429 ? ' Limite de requêtes atteinte.' : '';
        showToast({ type: 'error', text: `Météo interrompue : ${error.message}${limit} Les étapes déjà renseignées sont conservées.` });
    } finally {
        setWeatherBusy(button, false);
    }
}

function annualWeatherMarkup(stage) {
    const climate = window.TRIP_WEATHER.stages[stage.id]?.climate;
    if (!climate?.monthly?.length) {
        return '<div class="weather-empty"><strong>Aucune tendance annuelle</strong><span>Utilisez le bouton de remplissage automatique pour analyser les dix dernières années.</span></div>';
    }
    const ranked = climate.monthly.map(month => ({ month, score: TripWeather.monthScore(month) })).filter(item => item.score !== null).sort((a, b) => b.score - a.score).slice(0, 3);
    const recommendations = ranked.map((item, index) => `<div class="weather-best-month"><span>${index + 1}</span><strong>${TripWeather.MONTHS[item.month.month - 1]}</strong><small>indice ${item.score}/100</small></div>`).join('');
    const rows = climate.monthly.map(month => {
        const score = TripWeather.monthScore(month);
        return `<tr>
            <th scope="row">${escapeHtml(TripWeather.MONTHS[month.month - 1])}</th>
            <td>${weatherNumber(month.tempMinC, ' °C')}</td><td><strong>${weatherNumber(month.tempMeanC, ' °C')}</strong></td><td>${weatherNumber(month.tempMaxC, ' °C')}</td>
            <td>${weatherNumber(month.humidityPct, ' %')}</td><td>${weatherNumber(month.precipitationMm, ' mm')}</td><td>${weatherNumber(month.rainyDays, ' j')}</td>
            <td>${weatherNumber(month.snowfallCm, ' cm')}</td><td>${weatherNumber(month.sunshineHours, ' h')}</td><td><span class="weather-score" style="--score:${score || 0}%">${score ?? '—'}</span></td>
        </tr>`;
    }).join('');
    return `<div class="weather-best"><div><span class="eyebrow">FENÊTRES CONSEILLÉES</span><h3>Meilleurs compromis météo</h3></div>${recommendations}</div>
        <div class="weather-table-wrap"><table class="weather-table"><thead><tr><th>Mois</th><th>Min.</th><th>Moy.</th><th>Max.</th><th>Humidité</th><th>Précip.</th><th>Jours pluie</th><th>Neige</th><th>Soleil</th><th>Indice</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="weather-footnote">Moyennes ${escapeHtml(climate.period)} issues d’Open-Meteo/ERA5. L’indice privilégie une température douce et pénalise pluie, forte humidité et neige; adaptez-le aux activités prévues.</p>`;
}

function stayWeatherMarkup() {
    const entries = weatherStages().map(stage => ({ stage, stay: window.TRIP_WEATHER.stages[stage.id]?.stay })).filter(item => item.stay?.daily?.length);
    if (!entries.length) {
        return '<div class="weather-empty"><strong>Aucune météo de séjour</strong><span>Indiquez la date de départ dans le Planning, puis lancez le remplissage.</span></div>';
    }
    return `<div class="stay-weather-grid">${entries.map(({ stage, stay }) => {
        const days = stay.daily.map(day => {
            const info = TripWeather.weatherInfo(day.weatherCode);
            const precipitation = day.precipitationProbabilityPct !== null && day.source === 'forecast'
                ? `${weatherNumber(day.precipitationProbabilityPct, ' %')} · ${weatherNumber(day.precipitationMm, ' mm')}`
                : weatherNumber(day.precipitationMm, ' mm');
            return `<div class="stay-weather-day"><time datetime="${day.date}">${new Date(`${day.date}T12:00:00`).toLocaleDateString('fr-CH', { weekday: 'short', day: 'numeric', month: 'short' })}</time><span class="stay-weather-icon" title="${escapeHtml(info.label)}">${info.icon}</span><strong>${weatherNumber(day.tempMinC, '°')} / ${weatherNumber(day.tempMaxC, '°')}</strong><small>${precipitation}</small></div>`;
        }).join('');
        return `<section class="stay-weather-stage"><div class="stay-weather-stage__head"><div><h3>${escapeHtml(stage.place.name || stage.id)}</h3><span>${escapeHtml(weatherSourceLabel(stay.source))}</span></div><span>${escapeHtml(stay.startDate)} → ${escapeHtml(stay.endDate)}</span></div><div class="stay-weather-days">${days}</div></section>`;
    }).join('')}</div>`;
}

function renderWeatherPage() {
    const selector = $('#weatherStageSelect');
    const annual = $('#weatherAnnualContent');
    const stay = $('#weatherStayContent');
    if (!selector || !annual || !stay) return;
    const stages = weatherStages();
    if (!stages.some(stage => stage.id === WEATHER_STAGE_ID)) WEATHER_STAGE_ID = stages[0]?.id || '';
    selector.innerHTML = stages.map(stage => `<option value="${escapeHtml(stage.id)}" ${stage.id === WEATHER_STAGE_ID ? 'selected' : ''}>${escapeHtml(stage.place.name || stage.id)}</option>`).join('');
    selector.disabled = !stages.length;
    const selected = stages.find(stage => stage.id === WEATHER_STAGE_ID);
    annual.innerHTML = selected ? annualWeatherMarkup(selected) : '<div class="weather-empty">Ajoutez une grande étape au voyage.</div>';
    stay.innerHTML = stayWeatherMarkup();
    const hasStart = /^\d{4}-\d{2}-\d{2}$/.test(String(state.planning?.startDate || ''));
    const stayButton = $('#weatherFillStay');
    if (stayButton) {
        stayButton.disabled = !hasStart;
        stayButton.title = hasStart ? '' : 'Indiquez une date de début dans le Planning';
    }
}

function stageWeatherBadge(stageId, arrivalDate) {
    const stage = window.TRIP_WEATHER.stages?.[stageId];
    const info = TripWeather.stageIcon(stage, arrivalDate);
    if (!info) return '';
    const temperatures = info.day.tempMinC !== null && info.day.tempMaxC !== null ? `, ${weatherNumber(info.day.tempMinC, '°')} / ${weatherNumber(info.day.tempMaxC, '°')}` : '';
    return `<span class="outline-weather" role="img" aria-label="${escapeHtml(info.label)}" title="${escapeHtml(`${info.label}${temperatures} · ${weatherSourceLabel(info.day.source)}`)}">${info.icon}</span>`;
}

function initWeatherUi() {
    const climateButton = $('#weatherFillClimate');
    const stayButton = $('#weatherFillStay');
    const selector = $('#weatherStageSelect');
    if (climateButton) climateButton.onclick = fillAnnualWeather;
    if (stayButton) stayButton.onclick = fillStayWeather;
    if (selector) selector.onchange = event => { WEATHER_STAGE_ID = event.target.value; renderWeatherPage(); };
}
