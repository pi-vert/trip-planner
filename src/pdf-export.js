(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.TripPdfExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const PAGE_WIDTH = 595.28;
    const PAGE_HEIGHT = 841.89;
    const MARGIN = 42;
    const BODY_BOTTOM = 790;
    const COLORS = {
        ink: [0.08, 0.12, 0.2],
        muted: [0.35, 0.4, 0.48],
        brand: [0.13, 0.28, 0.55],
        accent: [0.86, 0.48, 0.16],
        pale: [0.92, 0.95, 0.99],
        warning: [0.62, 0.2, 0.12],
        white: [1, 1, 1]
    };
    const CP1252 = {
        0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
        0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
        0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
        0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
        0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
        0x017E: 0x9E, 0x0178: 0x9F
    };
    const KIND_LABELS = {
        activity: 'Visite / activité', meal: 'Restaurant / repas', lodging: 'Hôtel / hébergement',
        travel: 'Transport réservé', other: 'Autre contrainte', fixed: 'Date fixe'
    };
    const MEAL_LABELS = { breakfast: 'Petit déjeuner', lunch: 'Déjeuner', dinner: 'Dîner' };
    const SLOT_LABELS = { morning: 'Matin', midday: 'Midi', afternoon: 'Après-midi', evening: 'Soir', night: 'Nuit' };
    const DAY_LABELS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

    function cp1252Char(character) {
        if (character === '→') return '>';
        if (character === '←') return '<';
        if (character === '↔') return '-';
        const code = character.codePointAt(0);
        if (code <= 0x7F || (code >= 0xA0 && code <= 0xFF)) return String.fromCharCode(code);
        return String.fromCharCode(CP1252[code] || 0x3F);
    }

    function toPdfText(value) {
        return Array.from(String(value ?? '').replace(/[\r\n\t]+/g, ' '), cp1252Char).join('');
    }

    function pdfLiteral(value) {
        return toPdfText(value).replace(/([\\()])/g, '\\$1');
    }

    function number(value) {
        return Math.round(value * 100) / 100;
    }

    function colorCommand(color, stroke = false) {
        return `${color.map(number).join(' ')} ${stroke ? 'RG' : 'rg'}`;
    }

    function characterWidth(character, bold) {
        if (character === ' ') return 0.28;
        if (/[iIl.,:;!'|]/.test(character)) return 0.27;
        if (/[ftr()\[\]]/.test(character)) return 0.38;
        if (/[MW@%&]/.test(character)) return 0.88;
        if (/[A-Z]/.test(character)) return bold ? 0.7 : 0.67;
        if (/[0-9]/.test(character)) return 0.56;
        return bold ? 0.57 : 0.53;
    }

    function textWidth(value, fontSize, bold) {
        return Array.from(String(value ?? '')).reduce((total, character) => total + characterWidth(character, bold), 0) * fontSize;
    }

    function splitLongWord(word, maxWidth, fontSize, bold) {
        const chunks = [];
        let chunk = '';
        for (const character of Array.from(word)) {
            if (chunk && textWidth(chunk + character, fontSize, bold) > maxWidth) {
                chunks.push(chunk);
                chunk = character;
            } else chunk += character;
        }
        if (chunk) chunks.push(chunk);
        return chunks;
    }

    function wrapText(value, maxWidth, fontSize, bold = false) {
        const paragraphs = String(value ?? '').split(/\r?\n/);
        const lines = [];
        for (const paragraph of paragraphs) {
            const words = paragraph.trim().split(/\s+/).filter(Boolean);
            if (!words.length) { lines.push(''); continue }
            let line = '';
            for (const sourceWord of words) {
                const pieces = textWidth(sourceWord, fontSize, bold) > maxWidth
                    ? splitLongWord(sourceWord, maxWidth, fontSize, bold) : [sourceWord];
                for (const word of pieces) {
                    const candidate = line ? `${line} ${word}` : word;
                    if (line && textWidth(candidate, fontSize, bold) > maxWidth) {
                        lines.push(line);
                        line = word;
                    } else line = candidate;
                }
            }
            if (line) lines.push(line);
        }
        return lines;
    }

    function binaryStringToBytes(value) {
        const bytes = new Uint8Array(value.length);
        for (let index = 0; index < value.length; index++) bytes[index] = value.charCodeAt(index) & 0xFF;
        return bytes;
    }

    function buildPdfFile(pages, metadata) {
        const pageWidth = metadata.pageWidth || PAGE_WIDTH;
        const pageHeight = metadata.pageHeight || PAGE_HEIGHT;
        const fontRegularId = 3 + pages.length * 2;
        const fontBoldId = fontRegularId + 1;
        const infoId = fontBoldId + 1;
        const images = metadata.images || [];
        const imageResources = images.map((_, index) => `/Im${index + 1} ${infoId + index + 1} 0 R`).join(' ');
        const objects = [];
        objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        const kids = pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ');
        objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
        pages.forEach((commands, index) => {
            const pageId = 3 + index * 2;
            const contentId = pageId + 1;
            const stream = commands.join('\n') + '\n';
            objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> /XObject << ${imageResources} >> >> /Contents ${contentId} 0 R >>`;
            objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
        });
        objects[fontRegularId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
        objects[fontBoldId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
        objects[infoId] = `<< /Title (${pdfLiteral(metadata.title)}) /Author (Trip Planner) /Subject (${pdfLiteral(metadata.subject || 'Carnet de route hors ligne')}) /Creator (Trip Planner) >>`;
        images.forEach((image, index) => {
            let data = '';
            for (let offset = 0; offset < image.bytes.length; offset += 8192) data += String.fromCharCode(...image.bytes.subarray(offset, offset + 8192));
            objects[infoId + index + 1] = `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n${data}\nendstream`;
        });

        let output = '%PDF-1.4\n%âãÏÓ\n';
        const offsets = [0];
        for (let id = 1; id < objects.length; id++) {
            offsets[id] = output.length;
            output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
        }
        const xrefOffset = output.length;
        output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
        for (let id = 1; id < objects.length; id++) output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
        output += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
        return binaryStringToBytes(output);
    }

    class PdfLayout {
        constructor(title, documentLabel = 'CARNET DE ROUTE', options = {}) {
            this.title = title;
            this.documentLabel = documentLabel;
            this.pageWidth = options.pageWidth || PAGE_WIDTH;
            this.pageHeight = options.pageHeight || PAGE_HEIGHT;
            this.margin = options.margin || MARGIN;
            this.bodyBottom = options.bodyBottom || BODY_BOTTOM;
            this.pageTop = options.pageTop || 58;
            this.pages = [];
            this.pageIndex = -1;
            this.y = MARGIN;
            this.addPage();
        }

        addPage() {
            this.pages.push([]);
            this.pageIndex++;
            this.y = this.pageTop;
        }

        command(value) {
            this.pages[this.pageIndex].push(value);
        }

        ensureSpace(height) {
            if (this.y + height > this.bodyBottom) this.addPage();
        }

        text(value, x, top, options = {}) {
            const size = options.size || 9.5;
            const font = options.bold ? 'F2' : 'F1';
            const color = options.color || COLORS.ink;
            const baseline = this.pageHeight - top - size;
            this.command(`${colorCommand(color)} BT /${font} ${number(size)} Tf 1 0 0 1 ${number(x)} ${number(baseline)} Tm (${pdfLiteral(value)}) Tj ET`);
        }

        rectangle(x, top, width, height, color) {
            this.command(`${colorCommand(color)} ${number(x)} ${number(this.pageHeight - top - height)} ${number(width)} ${number(height)} re f`);
        }

        strokeRectangle(x, top, width, height, color = COLORS.muted, lineWidth = 0.6) {
            this.command(`${colorCommand(color, true)} ${number(lineWidth)} w ${number(x)} ${number(this.pageHeight - top - height)} ${number(width)} ${number(height)} re S`);
        }

        line(x1, top, x2, color = COLORS.pale) {
            const y = number(this.pageHeight - top);
            this.command(`${colorCommand(color, true)} 0.7 w ${number(x1)} ${y} m ${number(x2)} ${y} l S`);
        }

        paragraph(value, options = {}) {
            const text = String(value ?? '').trim();
            if (!text && !options.showEmpty) return;
            const size = options.size || 9.5;
            const lineHeight = options.lineHeight || size * 1.38;
            const indent = options.indent || 0;
            const available = this.pageWidth - this.margin * 2 - indent;
            const lines = wrapText(text || 'À compléter', available, size, Boolean(options.bold));
            for (const line of lines) {
                this.ensureSpace(lineHeight);
                this.text(line || ' ', this.margin + indent, this.y, options);
                this.y += lineHeight;
            }
            this.y += options.spaceAfter == null ? 3 : options.spaceAfter;
        }

        field(label, value, options = {}) {
            const normalized = value == null || String(value).trim() === '' ? 'À compléter' : String(value);
            this.paragraph(`${label} : ${normalized}`, { ...options, showEmpty: true });
        }

        section(title) {
            this.ensureSpace(34);
            this.y += 8;
            this.rectangle(this.margin, this.y, 5, 18, COLORS.accent);
            this.text(String(title).toUpperCase(), this.margin + 13, this.y + 1, { size: 12, bold: true, color: COLORS.brand });
            this.y += 28;
        }

        subheading(title) {
            this.ensureSpace(24);
            this.text(title, this.margin, this.y, { size: 10.5, bold: true, color: COLORS.brand });
            this.y += 17;
        }

        divider() {
            this.ensureSpace(10);
            this.line(this.margin, this.y + 2, this.pageWidth - this.margin);
            this.y += 10;
        }

        addPageFurniture(generatedLabel, options = {}) {
            const total = this.pages.length;
            this.pages.forEach((commands, index) => {
                if (index > 0 && options.header !== false) {
                    const header = `${this.title} · ${this.documentLabel}`;
                    commands.push(`${colorCommand(COLORS.muted)} BT /F2 7.5 Tf 1 0 0 1 ${this.margin} ${this.pageHeight - 27} Tm (${pdfLiteral(header)}) Tj ET`);
                    commands.push(`${colorCommand(COLORS.pale, true)} 0.7 w ${this.margin} ${this.pageHeight - 34} m ${this.pageWidth - this.margin} ${this.pageHeight - 34} l S`);
                }
                const footer = `${generatedLabel} · Page ${index + 1}/${total}`;
                commands.push(`${colorCommand(COLORS.pale, true)} 0.7 w ${this.margin} 31 m ${this.pageWidth - this.margin} 31 l S`);
                commands.push(`${colorCommand(COLORS.muted)} BT /F1 7.5 Tf 1 0 0 1 ${this.margin} 18 Tm (${pdfLiteral(footer)}) Tj ET`);
            });
        }
    }

    function validDate(value) {
        const date = value instanceof Date ? value : new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function formatDate(value, withTime = false) {
        const date = validDate(value);
        if (!date) return 'À compléter';
        const options = { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' };
        if (withTime) Object.assign(options, { hour: '2-digit', minute: '2-digit' });
        return date.toLocaleString('fr-CH', options);
    }

    function formatTime(value) {
        const date = validDate(value);
        return date ? date.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' }) : '??:??';
    }

    function formatDurationMinutes(minutes) {
        const total = Math.max(0, Math.round(Number(minutes) || 0));
        const hours = Math.floor(total / 60);
        const remainder = total % 60;
        if (!hours) return `${remainder} min`;
        return remainder ? `${hours} h ${String(remainder).padStart(2, '0')}` : `${hours} h`;
    }

    function eventDuration(event) {
        return formatDurationMinutes((validDate(event.end) - validDate(event.start)) / 60000);
    }

    function formatMoney(value, currency = 'CHF') {
        const code = /^[A-Z]{3}$/.test(String(currency || '').trim().toUpperCase()) ? String(currency).trim().toUpperCase() : 'CHF';
        try {
            return new Intl.NumberFormat('fr-CH', { style: 'currency', currency: code, currencyDisplay: 'code' }).format(Number(value) || 0);
        } catch (_) {
            return `${code} ${(Number(value) || 0).toFixed(2)}`;
        }
    }

    function formatCoordinates(place) {
        if (place?.lat == null || place?.lng == null || place.lat === '' || place.lng === '') return 'À compléter';
        const lat = Number(place?.lat), lng = Number(place?.lng);
        return Number.isFinite(lat) && Number.isFinite(lng) ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : 'À compléter';
    }

    function formatRatings(ratings) {
        const entries = Object.entries(ratings || {});
        return entries.length ? entries.map(([name, score]) => `${name}: ${score}/6`).join(' · ') : 'Aucune note';
    }

    function formatClosedDays(days) {
        return Array.isArray(days) && days.length ? days.map(day => DAY_LABELS[Number(day)] || day).join(', ') : 'Aucun jour indiqué';
    }

    function eventLabel(event) {
        if (event.kind === 'meal') return event.label || MEAL_LABELS[event.meal] || 'Repas';
        if (event.kind === 'travel') return event.fixed ? 'Transport réservé' : 'Trajet';
        if (event.fixedType === 'lodging') return 'Hébergement';
        if (event.fixed && event.fixedType) return KIND_LABELS[event.fixedType] || 'Date fixe';
        return event.fixed ? 'Date fixe' : 'Activité';
    }

    function haversine(a, b) {
        if ([a?.lat, a?.lng, b?.lat, b?.lng].some(value => value == null || value === '')) return null;
        const lat1 = Number(a?.lat), lng1 = Number(a?.lng), lat2 = Number(b?.lat), lng2 = Number(b?.lng);
        if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
        const rad = value => value * Math.PI / 180;
        const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
        return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)) * 10) / 10;
    }

    function placeReference(place) {
        if (!place) return 'Lieu non associé';
        return `${place.name || place.id || 'Lieu sans nom'} · GPS ${formatCoordinates(place)}`;
    }

    function itemPlaceIds(item) {
        if (Array.isArray(item?.placeIds) && item.placeIds.length) return item.placeIds;
        return item?.placeId ? [item.placeId] : [];
    }

    function addPlaceFacts(layout, place, people, options = {}) {
        if (!place) {
            layout.paragraph('Lieu associé : À compléter', { color: COLORS.warning });
            return;
        }
        layout.field('Description', place.desc);
        layout.field('Coordonnées GPS', formatCoordinates(place));
        layout.field('Durée prévue', place.durationH != null ? `${place.durationH} h` : null);
        const budget = Number(place.budget) || 0;
        const currency = place.budgetCurrency || 'CHF';
        const groupBudget = place.budgetScope === 'group' ? budget : budget * people;
        layout.field('Budget', place.budgetFree === true ? 'Gratuit' : `${formatMoney(groupBudget / people, currency)} /pers · ${formatMoney(groupBudget, currency)} pour ${people} personne(s)`);
        layout.field('Tags', Array.isArray(place.tags) && place.tags.length ? place.tags.join(', ') : null);
        layout.field('Créneau préféré', SLOT_LABELS[place.slot] || place.slot || null);
        layout.field('Jours fermés', formatClosedDays(place.closedDays));
        layout.field('Notes voyageurs', formatRatings(place.ratings));
        layout.field('Groupe alternatif', place.optionGroup || null);
        layout.field('Lien d’information', place.url || null);
        if (!options.omitImage) {
            const image = String(place.image || '');
            layout.field('Image', image.startsWith('data:') ? 'Image intégrée dans l’application' : image || null);
        }
    }

    function addEvent(layout, event, places, people) {
        layout.ensureSpace(48);
        const flags = [event.fixed ? (event.dateMode === 'stage' ? 'RELATIF À L’ÉTAPE' : 'FIXE') : '', event.closed ? 'FERMÉ CE JOUR' : '', event.conflict ? 'CONFLIT' : '', event.continued ? 'SUR PLUSIEURS CRÉNEAUX' : ''].filter(Boolean);
        layout.paragraph(`${formatTime(event.start)}–${formatTime(event.end)} · ${eventLabel(event)} · ${eventDuration(event)}`, { bold: true, size: 10.5, color: event.conflict ? COLORS.warning : COLORS.ink, spaceAfter: 1 });
        layout.paragraph(event.title || 'À compléter', { bold: true, size: 11, color: COLORS.brand, spaceAfter: 2 });
        if (flags.length) layout.paragraph(`Statut : ${flags.join(' · ')}`, { bold: true, size: 8.5, color: COLORS.warning });
        if (event.kind === 'travel') {
            const from = places[event.fromId];
            const to = places[event.placeId];
            layout.field('Départ', placeReference(from));
            layout.field('Arrivée', placeReference(to));
            const distance = Number(event.km);
            layout.field('Distance', Number.isFinite(distance) ? `${distance} km (${event.estimated ? 'estimée' : 'donnée réelle'})` : null);
        }
        if (event.notes) layout.field('Informations / réservation', event.notes);
        const placeIds = itemPlaceIds(event);
        if (placeIds.length > 1) layout.field('Étapes du créneau', placeIds.map(id => places[id]?.name || id).join(' → '));
        if (event.kind !== 'travel') placeIds.forEach((placeId, index) => {
            if (placeIds.length > 1) layout.subheading(`${index + 1}. ${places[placeId]?.name || placeId}`);
            addPlaceFacts(layout, places[placeId], people, { omitImage: true });
        });
        layout.divider();
    }

    function segmentInfo(fromId, toId, places, edges, speedKmh) {
        const edge = edges?.[`${fromId}|${toId}`] || {};
        const estimatedKm = haversine(places[fromId], places[toId]);
        const km = edge.realKm != null && Number.isFinite(Number(edge.realKm)) ? Number(edge.realKm) : estimatedKm;
        const minutes = edge.realMin != null && Number.isFinite(Number(edge.realMin))
            ? Number(edge.realMin)
            : km == null ? null : Math.round(km / Math.max(1, Number(speedKmh) || 60) * 60);
        return { km, minutes, real: edge.realKm != null || edge.realMin != null };
    }

    function slug(value) {
        return String(value || 'voyage').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'voyage';
    }

    function collectRouteSegments(input) {
        const places = input?.places || {};
        if (input?.result?.days?.length) {
            return input.result.days.flatMap(day => (day.events || []).filter(event => event.kind === 'travel').map(event => {
                const ids = itemPlaceIds(event);
                const fromId = event.fromId || (event.fixed && ids.length > 1 ? ids[0] : '');
                const toId = event.endPlaceId || ids.at(-1) || event.placeId || '';
                return { fromId, toId, date: day.date, start: event.start, end: event.end,
                    title: event.title || `${places[fromId]?.name || 'Départ'} → ${places[toId]?.name || 'Arrivée'}`,
                    km: event.km == null ? null : Number(event.km),
                    minutes: (validDate(event.end) - validDate(event.start)) / 60000,
                    estimated: Boolean(event.estimated), fixed: Boolean(event.fixed) };
            }));
        }
        const itinerary = input?.itinerary || [];
        return itinerary.slice(0, -1).flatMap((fromId, index) => {
            const toId = itinerary[index + 1];
            if (fromId === toId) return [];
            const info = segmentInfo(fromId, toId, places, input.edges, input.planning?.speedKmh);
            return [{ fromId, toId, itineraryIndex: index + 1, title: `${places[fromId]?.name || fromId} → ${places[toId]?.name || toId}`,
                km: info.km, minutes: info.minutes, estimated: !info.real, fixed: false }];
        });
    }

    function collectStageRoutes(input) {
        const structure = input?.structure || { stages: [], assignments: {} };
        const places = input?.places || {};
        const itinerary = input?.itinerary || [];
        const segments = input?.segments || collectRouteSegments(input);
        const hotelIds = new Set((input?.planning?.reservations || []).filter(item => item.kind === 'lodging').flatMap(itemPlaceIds));
        for (const [id, place] of Object.entries(places)) {
            if ((place.tags || []).some(tag => /^(hôtel|hotel|hébergement|hebergement)$/i.test(tag))) hotelIds.add(id);
        }
        const mainIndexes = itinerary.map((id, index) => structure.assignments?.[id]?.stageType === 'main' ? index : -1).filter(index => index >= 0);
        const groups = (structure.stages || []).map((stage, index) => ({ ...stage,
            key: `${stage.id}:${index}`, title: places[stage.id]?.name || stage.id,
            itineraryIndex: mainIndexes[index] ?? index, segments: []
        }));
        const parentId = id => structure.assignments?.[id]?.parentStageId || id;
        function chooseOccurrence(candidates, segment) {
            if (!candidates.length) return null;
            if (segment.date) {
                const at = validDate(segment.end || `${segment.date}T12:00:00`);
                const distance = group => {
                    const start = validDate(`${group.arrivalDate}T${group.arrivalTime || '00:00'}`);
                    const end = validDate(`${group.departureDate}T${group.departureTime || '23:59'}`);
                    if (!at || !start || !end) return Infinity;
                    return at < start ? start - at : at > end ? at - end : 0;
                };
                return candidates.slice().sort((a, b) => distance(a) - distance(b) || String(b.arrivalDate).localeCompare(String(a.arrivalDate)))[0];
            }
            const position = segment.itineraryIndex ?? 0;
            const preceding = candidates.filter(group => group.itineraryIndex <= position);
            return preceding.sort((a, b) => b.itineraryIndex - a.itineraryIndex)[0] || candidates[0];
        }
        for (const segment of segments) {
            // Hotel returns belong to the visited stage, even when the hotel is reused elsewhere.
            const fromParent = parentId(segment.fromId), toParent = parentId(segment.toId);
            const morningHotel = input?.result?.days?.find(day => day.date === segment.date)?.morningLodging?.placeId;
            const sharedHotel = (input?.planning?.reservations || []).some(item => item.kind === 'lodging' && item.stageId === fromParent && itemPlaceIds(item).includes(segment.toId));
            const returningToHotel = hotelIds.has(segment.toId) && segment.fromId && !hotelIds.has(segment.fromId)
                && (fromParent === toParent || morningHotel === segment.toId || sharedHotel);
            const ownerId = parentId(returningToHotel ? segment.fromId : segment.toId);
            let candidates = groups.filter(group => group.id === ownerId);
            if (hotelIds.has(segment.toId) && hotelIds.has(segment.fromId) && segment.date && !candidates.some(group => group.arrivalDate <= segment.date && group.departureDate >= segment.date)) {
                const dated = groups.filter(group => group.arrivalDate <= segment.date && group.departureDate >= segment.date);
                if (dated.length) candidates = dated;
            }
            let group = chooseOccurrence(candidates, segment);
            if (!group && segment.date) group = chooseOccurrence(groups.filter(item => item.arrivalDate <= segment.date && item.departureDate >= segment.date), segment);
            if (!group) {
                group = groups.find(item => item.key === 'unassigned');
                if (!group) {
                    group = { key: 'unassigned', title: groups.length ? 'Trajets non rattachés à une étape' : (input?.tripName || 'Voyage'), segments: [] };
                    groups.push(group);
                }
            }
            group.segments.push(segment);
        }
        return groups.map(group => {
            const ids = group.segments.flatMap(segment => [segment.fromId, segment.toId]).filter(Boolean);
            if (!ids.length) ids.push(...[group.id, ...(group.lodgings || []).flatMap(itemPlaceIds)].filter(id => itinerary.includes(id)));
            return { ...group, stops: [...new Set(ids)].map((id, index) => ({ id, number: index + 1, title: places[id]?.name || id, hotel: hotelIds.has(id) })) };
        });
    }

    function createStageRoutesPdf(input) {
        const stages = input?.stages || collectStageRoutes(input);
        if (!stages.length) throw new Error('Aucune étape à exporter.');
        const tripName = String(input?.tripName || 'Voyage');
        const width = PAGE_HEIGHT, height = PAGE_WIDTH, margin = 32;
        const layout = new PdfLayout(tripName, 'PLANS DES ÉTAPES', { pageWidth: width, pageHeight: height, margin, bodyBottom: height - 45 });
        const images = [];
        const color = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
        stages.forEach((stage, index) => {
            if (index) layout.addPage();
            layout.rectangle(0, 0, width, 95, COLORS.brand);
            layout.text(`ÉTAPE ${index + 1}/${stages.length} · PLAN COMPLET`, margin, 16, { size: 10, bold: true, color: COLORS.white });
            wrapText(stage.title, width - margin * 2, 19, true).slice(0, 2).forEach((line, i) => layout.text(line, margin, 36 + i * 23, { size: 19, bold: true, color: COLORS.white }));
            layout.text(wrapText(tripName, width - margin * 2, 8)[0], margin, 82, { size: 8, color: COLORS.white });
            const distance = stage.segments.reduce((sum, segment) => sum + (Number(segment.km) || 0), 0);
            const minutes = stage.segments.reduce((sum, segment) => sum + (Number(segment.minutes) || 0), 0);
            const period = stage.arrivalDate ? `${stage.arrivalDate} → ${stage.departureDate || stage.arrivalDate} · ` : '';
            const partial = stage.segments.some(segment => segment.km == null || segment.minutes == null) ? ' · données partielles' : '';
            const estimated = stage.segments.some(segment => segment.estimated) ? ' · estimations incluses' : '';
            layout.text(`${period}${stage.segments.length} trajet(s) · ${number(distance)} km · ${formatDurationMinutes(minutes)}${partial}${estimated}`, margin, 106, { size: 9, bold: true });
            const map = stage.map, mapTop = 132, mapWidth = 540, mapHeight = 360;
            if (map?.image?.bytes?.length) {
                images.push(map.image);
                const scale = Math.min(mapWidth / map.image.width, mapHeight / map.image.height);
                const w = map.image.width * scale, h = map.image.height * scale;
                layout.command(`q ${number(w)} 0 0 ${number(h)} ${margin} ${number(height - mapTop - h)} cm /Im${images.length} Do Q`);
            } else {
                layout.rectangle(margin, mapTop, mapWidth, mapHeight, COLORS.pale);
                layout.text('Carte indisponible : coordonnées à compléter.', margin + 18, mapTop + 170, { size: 11, color: COLORS.warning });
            }
            wrapText(map?.caption || 'Carte non disponible', mapWidth, 8).slice(0, 3).forEach((line, i) => layout.text(line, margin, 500 + i * 10, { size: 8, color: COLORS.muted }));
            layout.text(map?.attribution || '', margin, 535, { size: 7, color: COLORS.muted });
            const legend = [];
            const append = (text, options = {}) => wrapText(text, 200, 8.5, options.bold).forEach(line => legend.push({ text: line, ...options }));
            append('REPÈRES DU PLAN', { bold: true });
            for (const stop of stage.stops || []) append(`${stop.number}. ${stop.title}${stop.hotel ? ' · Hôtel' : ''}${stop.missingCoordinates ? ' · GPS à compléter' : ''}`);
            append('PARCOURS', { bold: true });
            for (const day of stage.routeDays || []) append(day.label, { color: color(day.color), bold: true });
            const stopNumbers = new Map((stage.stops || []).map(stop => [stop.id, stop.number]));
            for (const [i, segment] of stage.segments.entries()) {
                const day = segment.date ? `${segment.date.slice(8, 10)}/${segment.date.slice(5, 7)} · ` : '';
                const timing = segment.start ? `${formatTime(segment.start)} · ` : '';
                append(`${i + 1}) ${day}${timing}${stopNumbers.get(segment.fromId) || '?'} → ${stopNumbers.get(segment.toId) || '?'}${segment.fixed ? ' · transport réservé' : ''}`, { color: segment.color ? color(segment.color) : COLORS.ink });
            }
            if (!stage.segments.length) append('Aucun déplacement planifié pour cette étape.');
            const capacity = 32;
            const firstCount = legend.length > capacity ? capacity - 1 : capacity;
            legend.slice(0, firstCount).forEach((line, i) => layout.text(line.text, 590, mapTop + i * 12, { size: 8.5, bold: line.bold, color: line.color || COLORS.ink }));
            if (legend.length > capacity) {
                layout.text('Légende et parcours : suite page suivante.', 590, mapTop + firstCount * 12, { size: 8, color: COLORS.brand });
                layout.addPage();
                layout.section(`${stage.title} · légende et parcours (suite)`);
                for (const line of legend.slice(firstCount)) layout.paragraph(line.text, { size: 9, bold: line.bold, color: line.color || COLORS.ink, spaceAfter: 1 });
            }
        });
        layout.addPageFurniture(`Généré le ${formatDate(validDate(input?.generatedAt) || new Date(), true)}`, { header: false });
        return buildPdfFile(layout.pages, { title: `${tripName} · Plans complets par étape`, subject: 'Tous les trajets de chaque grande étape sur une même carte', pageWidth: width, pageHeight: height, images });
    }

    function createRoutesPdf(input) {
        const segments = input?.segments || collectRouteSegments(input);
        if (!segments.length) throw new Error('Aucun trajet à exporter.');
        const tripName = String(input?.tripName || 'Voyage');
        const places = input?.places || {};
        const width = PAGE_HEIGHT, height = PAGE_WIDTH, margin = 32;
        const layout = new PdfLayout(tripName, 'TRAJETS ET CARTES', { pageWidth: width, pageHeight: height, margin, bodyBottom: height - 40 });
        const images = [];
        const imageIds = new Map();
        segments.forEach((segment, index) => {
            if (index) layout.addPage();
            layout.rectangle(0, 0, width, 95, COLORS.brand);
            const dayLabel = segment.date ? formatDate(`${segment.date}T12:00:00`) : 'Ordre de l’itinéraire';
            layout.text(`TRAJET ${index + 1}/${segments.length} · ${dayLabel}`, margin, 16, { size: 10, bold: true, color: COLORS.white });
            wrapText(segment.title, width - margin * 2, 19, true).slice(0, 2).forEach((line, lineIndex) => {
                layout.text(line, margin, 36 + lineIndex * 23, { size: 19, bold: true, color: COLORS.white });
            });
            layout.text(wrapText(tripName, width - margin * 2, 8)[0], margin, 82, { size: 8, color: COLORS.white });
            const halfWidth = (width - margin * 2) / 2;
            for (const [offset, label, id] of [[0, 'A · Départ', segment.fromId], [halfWidth, 'B · Arrivée', segment.toId]]) {
                const place = places[id];
                wrapText(`${label} : ${place?.name || id || 'Lieu à préciser'}`, halfWidth - 12, 10, true).slice(0, 2).forEach((line, lineIndex) => {
                    layout.text(line, margin + offset, 105 + lineIndex * 13, { size: 10, bold: true });
                });
                layout.text(`GPS : ${formatCoordinates(place)}`, margin + offset, 134, { size: 8, color: COLORS.muted });
            }
            const timing = segment.start ? `${formatTime(segment.start)}–${formatTime(segment.end)} · ` : '';
            const distance = segment.km == null ? 'Distance à compléter' : `${number(segment.km)} km${segment.estimated ? ' estimés' : ''}`;
            const duration = segment.minutes == null ? 'Durée à compléter' : formatDurationMinutes(segment.minutes);
            layout.text(`${timing}${distance} · ${duration}${segment.fixed ? ' · Transport réservé' : ''}`, margin, 155, { size: 10, bold: true });

            const map = segment.map;
            const mapTop = 181, mapHeight = 320, mapWidth = width - margin * 2;
            if (map?.image?.bytes?.length) {
                if (!imageIds.has(map.image)) { images.push(map.image); imageIds.set(map.image, images.length); }
                const scale = Math.min(mapWidth / map.image.width, mapHeight / map.image.height);
                const imageWidth = map.image.width * scale, imageHeight = map.image.height * scale;
                layout.command(`q ${number(imageWidth)} 0 0 ${number(imageHeight)} ${number(margin + (mapWidth - imageWidth) / 2)} ${number(height - mapTop - imageHeight)} cm /Im${imageIds.get(map.image)} Do Q`);
            } else {
                layout.rectangle(margin, mapTop, mapWidth, mapHeight, COLORS.pale);
                layout.text('Carte indisponible : coordonnées du départ ou de l’arrivée à compléter.', margin + 20, mapTop + 140, { size: 11, color: COLORS.warning });
            }
            layout.text(map?.caption || 'Carte non disponible', margin, 511, { size: 8, color: COLORS.muted });
            layout.text(map?.attribution || '', margin, 525, { size: 8, color: COLORS.muted });
        });
        layout.addPageFurniture(`Généré le ${formatDate(validDate(input?.generatedAt) || new Date(), true)}`, { header: false });
        return buildPdfFile(layout.pages, { title: `${tripName} · Trajets et cartes`, subject: 'Trajets du voyage avec une carte par segment', pageWidth: width, pageHeight: height, images });
    }

    const PLANNING_SLOTS = [
        ['07:00', '09:00'], ['09:00', '12:00'], ['12:00', '14:00'],
        ['14:00', '16:00'], ['16:00', '19:00'], ['19:00', '22:00']
    ];

    function planningCellLines(day, slot, places, includeLodging) {
        const slotStart = validDate(`${day.date}T${slot[0]}:00`);
        const slotEnd = validDate(`${day.date}T${slot[1]}:00`);
        const events = (day.events || []).filter(event => validDate(event.start) < slotEnd && validDate(event.end) > slotStart);
        const lines = [];
        events.forEach(event => {
            const title = event.title || 'À compléter';
            const flags = [event.fixed ? (event.dateMode === 'stage' ? 'RELATIF' : 'FIXE') : '', event.closed ? 'FERMÉ' : '', event.conflict ? 'CONFLIT' : ''].filter(Boolean);
            lines.push(`${formatTime(event.start)}–${formatTime(event.end)}`);
            lines.push(`${eventLabel(event)} : ${title}${flags.length ? ` [${flags.join(', ')}]` : ''}`);
            const placeIds = itemPlaceIds(event);
            if (placeIds.length > 1) lines.push(`Étapes : ${placeIds.map(id => places[id]?.name || id).join(' → ')}`);
            if (event.kind === 'travel' && Number.isFinite(Number(event.km))) lines.push(`${event.km} km${event.estimated ? ' estimés' : ''}`);
            if (event.notes) lines.push(event.notes);
        });
        if (includeLodging) {
            lines.push(`Hébergement : ${day.lodging?.title || 'À compléter'}`);
            if (day.lodging?.notes) lines.push(day.lodging.notes);
        }
        return lines.length ? lines : ['—'];
    }

    function planningTableCellLines(values, width, maxLines = 10) {
        const lines = values.flatMap(value => wrapText(value, width - 10, 7, false));
        if (lines.length <= maxLines) return lines;
        return lines.slice(0, maxLines - 1).concat('…');
    }

    function createPlanningPdf(input) {
        const tripName = String(input?.tripName || 'Voyage');
        const planning = input?.planning || {};
        const result = input?.result || { days: [], conflicts: [], unscheduled: [] };
        const places = input?.places && typeof input.places === 'object' ? input.places : {};
        const generatedAt = validDate(input?.generatedAt) || new Date();
        const landscapeWidth = PAGE_HEIGHT;
        const landscapeHeight = PAGE_WIDTH;
        const margin = 26;
        const dayColumnWidth = 98;
        const slotWidth = (landscapeWidth - margin * 2 - dayColumnWidth) / PLANNING_SLOTS.length;
        const headerHeight = 34;
        const lineHeight = 8.5;
        const layout = new PdfLayout(tripName, 'PLANNING', {
            pageWidth: landscapeWidth,
            pageHeight: landscapeHeight,
            margin,
            bodyBottom: landscapeHeight - 42,
            pageTop: 82
        });

        function drawPageHeader() {
            layout.rectangle(0, 0, landscapeWidth, 66, COLORS.brand);
            layout.text('PLANNING DU VOYAGE', margin, 17, { size: 9, bold: true, color: COLORS.white });
            layout.text(tripName, margin, 34, { size: 18, bold: true, color: COLORS.white });
            layout.text(`${planning.startDate || 'Date à compléter'} → ${planning.endDate || 'Date à compléter'}`, 330, 21, { size: 9, bold: true, color: COLORS.white });
            const status = `${result.conflicts?.length || 0} point(s) à vérifier · ${result.unscheduled?.length || 0} activité(s) à placer`;
            layout.text(status, 330, 39, { size: 8, color: COLORS.white });
            let x = margin;
            layout.rectangle(x, 82, dayColumnWidth, headerHeight, COLORS.pale);
            layout.strokeRectangle(x, 82, dayColumnWidth, headerHeight, COLORS.muted);
            layout.text('JOUR', x + 6, 94, { size: 8, bold: true, color: COLORS.brand });
            x += dayColumnWidth;
            PLANNING_SLOTS.forEach(slot => {
                layout.rectangle(x, 82, slotWidth, headerHeight, COLORS.pale);
                layout.strokeRectangle(x, 82, slotWidth, headerHeight, COLORS.muted);
                layout.text(`${slot[0]}–${slot[1]}`, x + 6, 94, { size: 8, bold: true, color: COLORS.brand });
                x += slotWidth;
            });
            layout.y = 82 + headerHeight;
        }

        function drawCell(x, top, width, height, lines, options = {}) {
            if (options.fill) layout.rectangle(x, top, width, height, options.fill);
            layout.strokeRectangle(x, top, width, height, options.border || COLORS.muted);
            lines.forEach((line, index) => layout.text(line, x + 5, top + 6 + index * lineHeight, {
                size: index === 0 && options.boldFirst ? 7.5 : 7,
                bold: Boolean(index === 0 && options.boldFirst),
                color: options.color || COLORS.ink
            }));
        }

        drawPageHeader();
        (result.days || []).forEach((day, dayIndex) => {
            const date = validDate(`${day.date}T12:00:00`);
            const dayLines = [
                `JOUR ${String(dayIndex + 1).padStart(2, '0')}`,
                date ? date.toLocaleDateString('fr-CH', { weekday: 'short', day: '2-digit', month: '2-digit' }) : day.date
            ];
            if (day.conflicts?.length) dayLines.push('CONFLIT');
            const slotLines = PLANNING_SLOTS.map((slot, index) => planningTableCellLines(planningCellLines(day, slot, places, index === PLANNING_SLOTS.length - 1), slotWidth));
            const maxLines = Math.max(dayLines.length, ...slotLines.map(lines => lines.length));
            const rowHeight = Math.max(44, 12 + maxLines * lineHeight);
            if (layout.y + rowHeight > layout.bodyBottom) {
                layout.addPage();
                drawPageHeader();
            }
            let x = margin;
            drawCell(x, layout.y, dayColumnWidth, rowHeight, dayLines, { fill: COLORS.pale, boldFirst: true, color: day.conflicts?.length ? COLORS.warning : COLORS.brand });
            x += dayColumnWidth;
            slotLines.forEach((lines, index) => {
                const hasContent = lines.length !== 1 || lines[0] !== '—';
                drawCell(x, layout.y, slotWidth, rowHeight, lines, { fill: hasContent ? [0.97, 0.98, 1] : COLORS.white, boldFirst: hasContent });
                x += slotWidth;
            });
            layout.y += rowHeight;
        });

        const generatedLabel = `Généré le ${formatDate(generatedAt, true)}`;
        layout.addPageFurniture(generatedLabel, { header: false });
        return buildPdfFile(layout.pages, {
            title: `${tripName} · Planning`,
            subject: 'Planning du voyage en grille horaire',
            pageWidth: landscapeWidth,
            pageHeight: landscapeHeight
        });
    }

    function createTripPdf(input) {
        const tripName = String(input?.tripName || 'Voyage');
        const planning = input?.planning || {};
        const result = input?.result || { days: [], conflicts: [], unscheduled: [] };
        const itinerary = Array.isArray(input?.itinerary) ? input.itinerary : [];
        const places = input?.places && typeof input.places === 'object' ? input.places : {};
        const edges = input?.edges && typeof input.edges === 'object' ? input.edges : {};
        const people = Math.max(1, Number(input?.people) || 1);
        const generatedAt = validDate(input?.generatedAt) || new Date();
        const layout = new PdfLayout(tripName);
        const perPersonBudget = itinerary.reduce((total, id) => total + (Number(places[id]?.budget) || 0), 0);
        const segments = itinerary.slice(0, -1).map((fromId, index) => ({ fromId, toId: itinerary[index + 1], ...segmentInfo(fromId, itinerary[index + 1], places, edges, planning.speedKmh) }));
        const totalKm = segments.reduce((total, segment) => total + (Number(segment.km) || 0), 0);
        const totalMinutes = segments.reduce((total, segment) => total + (Number(segment.minutes) || 0), 0);

        layout.rectangle(0, 0, PAGE_WIDTH, 160, COLORS.brand);
        layout.text('CARNET DE ROUTE HORS LIGNE', MARGIN, 39, { size: 10, bold: true, color: COLORS.white });
        const titleLines = wrapText(tripName, PAGE_WIDTH - MARGIN * 2, 27, true).slice(0, 2);
        titleLines.forEach((line, index) => layout.text(line, MARGIN, 62 + index * 31, { size: 27, bold: true, color: COLORS.white }));
        layout.text(`${formatDate(`${planning.startDate}T12:00:00`)} → ${formatDate(`${planning.endDate}T12:00:00`)}`, MARGIN, 132, { size: 9.5, color: COLORS.white });
        layout.y = 183;

        layout.section('Synthèse pratique');
        layout.field('Voyageurs', `${people} personne(s)`);
        layout.field('Journées', result.days?.length || 0);
        layout.field('Horaires', `départ du séjour ${planning.startTime || 'À compléter'} · journées ${planning.dayStart || 'À compléter'}–${planning.dayEnd || 'À compléter'}`);
        layout.field('Itinéraire', itinerary.map(id => places[id]?.name || id).join(' → ') || null);
        layout.field('Déplacements', `${number(totalKm)} km · environ ${formatDurationMinutes(totalMinutes)}`);
        layout.field('Budget des étapes', `${formatMoney(perPersonBudget)} /pers · ${formatMoney(perPersonBudget * people)} au total`);
        layout.paragraph('Les budgets n’incluent que les montants saisis pour les étapes. Les réservations sans prix structuré ne sont pas ajoutées.', { size: 8, color: COLORS.muted });

        layout.section('Points à vérifier avant le départ');
        if (result.conflicts?.length) result.conflicts.forEach(message => layout.paragraph(`• ${message}`, { color: COLORS.warning }));
        else layout.paragraph('Aucun conflit détecté dans le planning.');
        if (result.unscheduled?.length) {
            layout.subheading('Activités non placées');
            result.unscheduled.forEach(item => layout.paragraph(`• ${item.title || item.id} · ${formatDurationMinutes(item.remainingMin)} restantes`, { color: COLORS.warning }));
        }

        for (let dayIndex = 0; dayIndex < (result.days || []).length; dayIndex++) {
            const day = result.days[dayIndex];
            layout.addPage();
            layout.rectangle(0, 0, PAGE_WIDTH, 88, COLORS.brand);
            layout.text(`JOUR ${String(dayIndex + 1).padStart(2, '0')}`, MARGIN, 25, { size: 10, bold: true, color: COLORS.white });
            layout.text(formatDate(`${day.date}T12:00:00`), MARGIN, 44, { size: 19, bold: true, color: COLORS.white });
            layout.y = 108;
            if (!day.events?.length) layout.paragraph('Aucun événement planifié pour cette journée.', { color: COLORS.warning });
            for (const event of day.events || []) addEvent(layout, event, places, people);
            layout.subheading('Hébergement de la nuit');
            if (day.lodging) {
                layout.field('Établissement', day.lodging.title);
                layout.field('Informations', day.lodging.notes);
                itemPlaceIds(day.lodging).forEach(placeId => addPlaceFacts(layout, places[placeId], people, { omitImage: true }));
            } else layout.paragraph('À compléter', { color: COLORS.warning });
            if (day.conflicts?.length) {
                layout.subheading('Conflits de la journée');
                day.conflicts.forEach(message => layout.paragraph(`• ${message}`, { color: COLORS.warning }));
            }
        }

        layout.addPage();
        layout.y = 52;
        layout.section('Segments de l’itinéraire');
        if (!segments.length) layout.paragraph('Aucun segment enregistré.');
        segments.forEach((segment, index) => {
            const from = places[segment.fromId], to = places[segment.toId];
            layout.subheading(`${index + 1}. ${from?.name || segment.fromId} → ${to?.name || segment.toId}`);
            layout.field('Départ', placeReference(from));
            layout.field('Arrivée', placeReference(to));
            layout.field('Distance', segment.km == null ? null : `${segment.km} km`);
            layout.field('Durée', segment.minutes == null ? null : `${formatDurationMinutes(segment.minutes)} · ${segment.real ? 'donnée réelle disponible' : `estimation à ${planning.speedKmh || 60} km/h`}`);
            layout.divider();
        });

        layout.section('Réservations et contraintes horaires');
        const reservations = Array.isArray(planning.reservations) ? planning.reservations.slice().sort((a, b) => String(a.start || a.startTime).localeCompare(String(b.start || b.startTime))) : [];
        if (!reservations.length) layout.paragraph('Aucune réservation enregistrée.');
        reservations.forEach((reservation, index) => {
            layout.subheading(`${index + 1}. ${reservation.title || 'Réservation sans titre'}`);
            layout.field('Type', KIND_LABELS[reservation.kind] || reservation.kind);
            if (reservation.kind === 'meal') layout.field('Repas', MEAL_LABELS[reservation.meal] || reservation.meal);
            layout.field('Mode de date', reservation.dateMode === 'stage' ? 'Créneau relatif à l’étape' : 'Date fixe');
            if (reservation.dateMode === 'stage') {
                layout.field('Créneau', `${reservation.relativeDay === 'departure' ? 'Jour de départ' : 'Jour d’arrivée'} · ${reservation.startTime || 'À compléter'}–${reservation.endTime || 'À compléter'}`);
                const resolved = result.events.filter(event => event.id === reservation.id || event.reservationId === reservation.id);
                const resolvedStart = resolved.length ? new Date(Math.min(...resolved.map(event => validDate(event.start).getTime()))) : null;
                const resolvedEnd = resolved.length ? new Date(Math.max(...resolved.map(event => validDate(event.end).getTime()))) : null;
                layout.field('Date calculée', resolvedStart && resolvedEnd ? `${formatDate(resolvedStart, true)} → ${formatDate(resolvedEnd, true)}` : null);
            } else {
                layout.field('Début', formatDate(reservation.start, true));
                layout.field('Fin', formatDate(reservation.end, true));
            }
            const reservationPlaceIds = itemPlaceIds(reservation);
            layout.field('Lieux associés', reservationPlaceIds.length ? reservationPlaceIds.map(id => placeReference(places[id])).join(' → ') : null);
            layout.field('Informations / référence', reservation.notes);
            if (reservationPlaceIds.some(id => !itinerary.includes(id))) layout.paragraph('Attention : certains lieux associés sont optionnels et ne sont pas intégrés au planning calculé.', { color: COLORS.warning });
            layout.divider();
        });

        layout.addPage();
        layout.y = 52;
        layout.section('Fiches détaillées des étapes');
        const uniqueItinerary = [...new Set(itinerary)];
        if (!uniqueItinerary.length) layout.paragraph('Aucune étape dans l’itinéraire.');
        uniqueItinerary.forEach((id, index) => {
            const place = places[id];
            layout.subheading(`${index + 1}. ${place?.name || id}`);
            layout.field('Identifiant', id);
            addPlaceFacts(layout, place, people);
            layout.divider();
        });

        const completedIds = Object.keys(places).filter(id => places[id]?.completed);
        if (completedIds.length) {
            layout.section('Visites déjà réalisées');
            completedIds.forEach(id => layout.paragraph(`• ${places[id]?.name || id} · Réalisé, retiré du planning restant`));
        }
        const optionalIds = Object.keys(places).filter(id => !itinerary.includes(id) && !places[id]?.completed);
        layout.section('Lieux optionnels hors planning');
        if (!optionalIds.length) layout.paragraph('Aucun lieu optionnel enregistré.');
        optionalIds.forEach((id, index) => {
            const place = places[id];
            layout.subheading(`${index + 1}. ${place?.name || id}`);
            layout.field('Identifiant', id);
            addPlaceFacts(layout, place, people);
            layout.divider();
        });

        const generatedLabel = `Généré le ${formatDate(generatedAt, true)}`;
        layout.addPageFurniture(generatedLabel);
        return buildPdfFile(layout.pages, { title: `${tripName} · Carnet de route` });
    }

    function downloadPdf(input, builder, suffix) {
        if (typeof Blob === 'undefined' || typeof document === 'undefined' || typeof URL === 'undefined') throw new Error('Le téléchargement PDF n’est pas pris en charge par ce navigateur.');
        const bytes = builder(input);
        const filename = `${slug(input?.tripName)}-${suffix}.pdf`;
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        return filename;
    }

    function downloadTripPdf(input) {
        return downloadPdf(input, createTripPdf, 'carnet-de-route');
    }

    function downloadPlanningPdf(input) {
        return downloadPdf(input, createPlanningPdf, 'planning');
    }

    function downloadRoutesPdf(input) {
        return downloadPdf(input, createRoutesPdf, 'trajets-cartes');
    }

    function downloadStageRoutesPdf(input) {
        return downloadPdf(input, createStageRoutesPdf, 'plans-etapes');
    }

    return { createTripPdf, createPlanningPdf, createRoutesPdf, createStageRoutesPdf, collectRouteSegments, collectStageRoutes, downloadTripPdf, downloadPlanningPdf, downloadRoutesPdf, downloadStageRoutesPdf, wrapText, toPdfText };
});
