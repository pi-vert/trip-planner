(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.TripWikimediaImages = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
    const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

    function apiUrl(base, params) {
        const query = new URLSearchParams({ ...params, format: 'json', origin: '*' });
        return `${base}?${query}`;
    }

    async function request(base, params, fetchImpl) {
        const response = await fetchImpl(apiUrl(base, params), {
            headers: { Accept: 'application/json' },
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined
        });
        if (!response.ok) throw new Error(`Wikimedia HTTP ${response.status}`);
        return response.json();
    }

    function imageFromPages(data) {
        const pages = Array.isArray(data?.query?.pages) ? data.query.pages : Object.values(data?.query?.pages || {});
        const page = pages.sort((a, b) => (a.index || 0) - (b.index || 0)).find(item =>
            item?.thumbnail?.source || item?.original?.source || item?.imageinfo?.[0]?.thumburl || item?.imageinfo?.[0]?.url
        );
        return page?.thumbnail?.source || page?.original?.source || page?.imageinfo?.[0]?.thumburl || page?.imageinfo?.[0]?.url || '';
    }

    function normalizedName(value) {
        return String(value || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function matchingImageFromPages(data, name) {
        const target = normalizedName(name);
        const pages = Array.isArray(data?.query?.pages) ? data.query.pages : Object.values(data?.query?.pages || {});
        const matching = pages.find(page => {
            const title = normalizedName(page?.title);
            return title && target && (title === target || title.startsWith(`${target} `));
        });
        return matching ? imageFromPages({ query: { pages: [matching] } }) : '';
    }

    function commonsFileTitle(value) {
        try {
            const url = new URL(String(value || ''));
            if (!/(^|\.)commons\.wikimedia\.org$/i.test(url.hostname)) return '';
            const match = decodeURIComponent(url.pathname).match(/\/wiki\/(File|Fichier):(.+)$/i);
            return match ? `File:${match[2].replace(/_/g, ' ')}` : '';
        } catch (_) {
            return '';
        }
    }

    function needsImage(place) {
        return !String(place?.image || '').trim() || Boolean(commonsFileTitle(place.image));
    }

    async function resolveCommonsFile(title, fetchImpl) {
        if (!title) return '';
        const data = await request(COMMONS_API, {
            action: 'query',
            prop: 'imageinfo',
            iiprop: 'url',
            iiurlwidth: '960',
            titles: title.startsWith('File:') ? title : `File:${title}`,
            formatversion: '2'
        }, fetchImpl);
        return imageFromPages(data);
    }

    async function wikidataImage(wikidataId, fetchImpl) {
        if (!/^Q\d+$/i.test(String(wikidataId || ''))) return '';
        const data = await request(WIKIDATA_API, {
            action: 'wbgetclaims',
            entity: String(wikidataId).toUpperCase(),
            property: 'P18'
        }, fetchImpl);
        const filename = data?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
        return filename ? resolveCommonsFile(filename, fetchImpl) : '';
    }

    function locationFilter(place) {
        const { lat, lng } = place || {};
        if (lat == null || lng == null || lat === '' || lng === '') return '';
        if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) || Math.abs(Number(lat)) > 90 || Math.abs(Number(lng)) > 180) return '';
        return `nearcoord:10km,${Number(lat)},${Number(lng)}`;
    }

    async function wikipediaImage(place, fetchImpl) {
        if (!place?.name) return '';
        const search = [`"${String(place.name).replace(/"/g, '')}"`, place.country, locationFilter(place)].filter(Boolean).join(' ');
        if (!search) return '';
        const data = await request('https://fr.wikipedia.org/w/api.php', {
            action: 'query',
            generator: 'search',
            gsrsearch: search,
            gsrnamespace: '0',
            gsrlimit: '3',
            prop: 'pageimages',
            piprop: 'thumbnail|original',
            pithumbsize: '960',
            formatversion: '2'
        }, fetchImpl);
        return imageFromPages(data);
    }

    async function nearbyWikipediaImage(name, lat, lng, fetchImpl) {
        if (!name || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return '';
        const data = await request('https://fr.wikipedia.org/w/api.php', {
            action: 'query',
            generator: 'geosearch',
            ggsprimary: 'all',
            ggsnamespace: '0',
            ggsradius: '10000',
            ggslimit: '50',
            ggscoord: `${Number(lat)}|${Number(lng)}`,
            prop: 'pageimages',
            piprop: 'thumbnail|original',
            pithumbsize: '960',
            formatversion: '2'
        }, fetchImpl);
        return matchingImageFromPages(data, name);
    }

    async function commonsSearch(place, fetchImpl) {
        if (!place?.name) return '';
        const search = [`"${String(place.name).replace(/"/g, '')}"`, place.country, locationFilter(place)].filter(Boolean).join(' ');
        if (!search) return '';
        const data = await request(COMMONS_API, {
            action: 'query',
            generator: 'search',
            gsrsearch: search,
            gsrnamespace: '6',
            gsrlimit: '5',
            prop: 'imageinfo',
            iiprop: 'url',
            iiurlwidth: '960',
            formatversion: '2'
        }, fetchImpl);
        return imageFromPages(data);
    }

    async function findImage(place, options = {}) {
        const fetchImpl = options.fetchImpl || globalThis.fetch;
        if (typeof fetchImpl !== 'function') throw new Error('Fetch indisponible');

        async function attempt(search) {
            try {
                return await search();
            } catch (_) {
                return '';
            }
        }

        const existingFile = commonsFileTitle(place?.image);
        if (existingFile) {
            const resolved = await attempt(() => resolveCommonsFile(existingFile, fetchImpl));
            if (resolved) return resolved;
        }

        const byEntity = await attempt(() => wikidataImage(place?.wikidataId, fetchImpl));
        if (byEntity) return byEntity;

        const byLocation = await attempt(() => nearbyWikipediaImage(place?.name, place?.lat, place?.lng, fetchImpl));
        if (byLocation) return byLocation;

        const byArticle = await attempt(() => wikipediaImage(place, fetchImpl));
        if (byArticle) return byArticle;

        return attempt(() => commonsSearch(place, fetchImpl));
    }

    return { commonsFileTitle, findImage, needsImage };
});
