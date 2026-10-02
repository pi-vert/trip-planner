const test = require('node:test');
const assert = require('node:assert/strict');
const { commonsFileTitle, findImage, needsImage } = require('../src/wikimedia-images.js');

function jsonResponse(data) {
    return { ok: true, json: async () => data };
}

test('reconnaît les pages de fichier Commons à convertir', () => {
    assert.equal(
        commonsFileTitle('https://commons.wikimedia.org/wiki/File:Blue_Lagoon.jpg'),
        'File:Blue Lagoon.jpg'
    );
    assert.equal(commonsFileTitle('https://upload.wikimedia.org/image.jpg'), '');
    assert.equal(needsImage({ image: 'https://commons.wikimedia.org/wiki/File:Blue_Lagoon.jpg' }), true);
    assert.equal(needsImage({ image: 'https://upload.wikimedia.org/image.jpg' }), false);
});

test('convertit directement une page Commons en miniature', async () => {
    const calls = [];
    const image = await findImage({ image: 'https://commons.wikimedia.org/wiki/File:Blue_Lagoon.jpg' }, {
        fetchImpl: async url => {
            calls.push(url);
            return jsonResponse({ query: { pages: [{ imageinfo: [{ thumburl: 'https://upload.wikimedia.org/blue-lagoon-960.jpg' }] }] } });
        }
    });

    assert.equal(image, 'https://upload.wikimedia.org/blue-lagoon-960.jpg');
    assert.equal(new URL(calls[0]).searchParams.get('titles'), 'File:Blue Lagoon.jpg');
});

test('privilégie l’image Wikidata associée au résultat Nominatim', async () => {
    const calls = [];
    const image = await findImage({ name: 'Tour Eiffel', wikidataId: 'Q243' }, {
        fetchImpl: async url => {
            calls.push(url);
            const parsed = new URL(url);
            if (parsed.hostname === 'www.wikidata.org') {
                return jsonResponse({ claims: { P18: [{ mainsnak: { datavalue: { value: 'Tour Eiffel Wikimedia Commons.jpg' } } }] } });
            }
            return jsonResponse({ query: { pages: [{ imageinfo: [{ thumburl: 'https://upload.wikimedia.org/eiffel-960.jpg' }] }] } });
        }
    });

    assert.equal(image, 'https://upload.wikimedia.org/eiffel-960.jpg');
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[1]).searchParams.get('titles'), 'File:Tour Eiffel Wikimedia Commons.jpg');
});

test('utilise Wikipédia puis Commons en repli', async () => {
    const calls = [];
    const image = await findImage({ name: 'Lieu rare', country: 'France' }, {
        fetchImpl: async url => {
            calls.push(url);
            const parsed = new URL(url);
            if (parsed.hostname === 'fr.wikipedia.org') return jsonResponse({ query: { pages: [] } });
            return jsonResponse({ query: { pages: [{ index: 1, imageinfo: [{ thumburl: 'https://upload.wikimedia.org/lieu-rare.jpg' }] }] } });
        }
    });

    assert.equal(image, 'https://upload.wikimedia.org/lieu-rare.jpg');
    assert.equal(new URL(calls[0]).searchParams.get('gsrsearch'), '"Lieu rare" France');
    assert.equal(new URL(calls[1]).hostname, 'commons.wikimedia.org');
});

test('utilise les coordonnées pour distinguer deux lieux homonymes', async () => {
    const calls = [];
    const image = await findImage({ name: 'Saint-Denis', lat: -20.88, lng: 55.45 }, {
        fetchImpl: async url => {
            calls.push(url);
            return jsonResponse({ query: { pages: [
                { title: 'Lieu voisin', index: 0, thumbnail: { source: 'https://upload.wikimedia.org/voisin.jpg' } },
                { title: 'Saint-Denis (La Réunion)', index: 1, thumbnail: { source: 'https://upload.wikimedia.org/saint-denis-reunion.jpg' } }
            ] } });
        }
    });

    assert.equal(image, 'https://upload.wikimedia.org/saint-denis-reunion.jpg');
    assert.equal(new URL(calls[0]).searchParams.get('ggscoord'), '-20.88|55.45');
});

test('garde le filtre géographique lors des recherches de repli pour éviter les homonymes éloignés', async () => {
    const calls = [];
    const image = await findImage({ name: 'Église Saint-Matthias', lat: 47.502, lng: 19.034 }, {
        fetchImpl: async url => {
            calls.push(new URL(url));
            return jsonResponse({ query: { pages: [] } });
        }
    });
    assert.equal(image, '');
    assert.equal(calls.length, 3);
    assert.equal(calls[1].searchParams.get('gsrsearch'), '"Église Saint-Matthias" nearcoord:10km,47.502,19.034');
    assert.equal(calls[2].searchParams.get('gsrsearch'), '"Église Saint-Matthias" nearcoord:10km,47.502,19.034');
});
