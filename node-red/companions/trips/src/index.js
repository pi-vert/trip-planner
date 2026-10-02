/* Trips Overview
   Expects:
     GET /trips.json  -> { active, trips:[{id,name,file}] }
     GET /trips-meta.json -> { meta: { [id]: {country,capital:{name,lat,lng}, months:[{tMin,tMax,rainMm,season}*12] } } }
*/

const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

function $(sel) { return document.querySelector(sel); }
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
function clamp01(x) { x = Number(x); return isFinite(x) ? Math.max(0, Math.min(1, x)) : 0; }

function seasonColor(season) {
    // 0 => green (120), 1 => red (0)
    const s = clamp01(season);
    const hue = 120 - (120 * s);
    const base = `hsl(${hue} 80% ${s > 0.7 ? 42 : 35}%)`;
    // add a subtle “gradient” overlay so it looks like a gradient tile
    return `linear-gradient(135deg, rgba(255,255,255,.18), rgba(0,0,0,.18)), ${base}`;
}

let MAP = null;
let MARKERS = [];

function initMap() {
    MAP = L.map('map', { worldCopyJump: true }).setView([20, 0], 2);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 8,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(MAP);
}

function clearMarkers() {
    for (const m of MARKERS) try { m.remove(); } catch { }
    MARKERS = [];
}

function addMarker(trip, meta) {
    const cap = meta?.capital;
    if (!cap || cap.lat == null || cap.lng == null) return;

    const name = meta?.country ? `${trip.name} — ${meta.country}` : trip.name;
    const popup = `
    <b>${escapeHtml(name)}</b><br/>
    ${escapeHtml(cap.name || 'Capitale')}
  `;
    const marker = L.marker([Number(cap.lat), Number(cap.lng)]).addTo(MAP).bindPopup(popup);
    MARKERS.push(marker);
}

function fitMarkers() {
    if (!MARKERS.length) return;
    const group = L.featureGroup(MARKERS);
    MAP.fitBounds(group.getBounds().pad(0.25));
}

function buildTable(trips, metaById) {
    const tbl = $('#tbl');
    if (!tbl) return;

    const head = `
    <thead>
      <tr>
        <th>Voyage</th>
        ${MONTHS.map(m => `<th>${m}</th>`).join('')}
      </tr>
    </thead>
  `;

    const rows = trips.map(t => {
        const meta = metaById?.[t.id] || {};
        const months = Array.isArray(meta.months) ? meta.months : [];

        const cells = MONTHS.map((_, i) => {
            const m = months[i] || null;
            if (!m) {
                return `<td><div class="cell muted">—</div></td>`;
            }
            const tMin = (m.tMin ?? '');
            const tMax = (m.tMax ?? '');
            const rain = (m.rainMm ?? '');
            const season = clamp01(m.season);

            return `
        <td>
          <div class="cell" style="background:${seasonColor(season)}">
            <div class="t">${escapeHtml(tMin)}–${escapeHtml(tMax)}°</div>
            <div class="r">${escapeHtml(rain)} mm</div>
          </div>
        </td>
      `;
        }).join('');

        const left = `
      <td class="trip">
        <div><b>${escapeHtml(t.name || t.id)}</b></div>
        <div class="muted small">${escapeHtml(meta.country || '')}</div>
        <div class="muted small">${escapeHtml(meta.capital?.name || '')}</div>
      </td>
    `;

        return `<tr>${left}${cells}</tr>`;
    }).join('');

    tbl.innerHTML = `${head}<tbody>${rows}</tbody>`;
}

async function loadJson(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
    return await r.json();
}

async function loadAll() {
    $('#status').textContent = 'Chargement…';

    const reg = await loadJson('/trips.json');

    let meta = { meta: {} };
    try { meta = await loadJson('/trips-meta.json'); }
    catch { meta = { meta: {} }; }

    const trips = Array.isArray(reg.trips) ? reg.trips : [];
    const metaById = (meta && meta.meta && typeof meta.meta === 'object') ? meta.meta : {};

    // map
    clearMarkers();
    for (const t of trips) addMarker(t, metaById[t.id]);
    fitMarkers();

    // table
    buildTable(trips, metaById);

    $('#status').textContent = `OK — ${trips.length} voyage(s)`;
}

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    $('#reloadBtn')?.addEventListener('click', () => loadAll().catch(e => {
        console.error(e);
        $('#status').textContent = 'Erreur (voir console)';
    }));
    loadAll().catch(e => {
        console.error(e);
        $('#status').textContent = 'Erreur (voir console)';
    });
});