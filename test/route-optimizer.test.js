const test = require('node:test');
const assert = require('node:assert/strict');
const { routeCost, optimizeRoundTrip } = require('../src/route-optimizer.js');

test('optimise une boucle sans déplacer le domicile', () => {
    const matrix = [
        [0, 2, 9, 0],
        [2, 0, 2, 8],
        [9, 2, 0, 2],
        [0, 8, 2, 0]
    ];
    const result = optimizeRoundTrip(matrix);
    assert.deepEqual(result.route, [0, 1, 2, 3]);
    assert.equal(result.cost, 6);
    assert.equal(result.route[0], 0);
    assert.equal(result.route.at(-1), 3);
});

test('améliore un ordre courant et refuse une matrice inaccessible', () => {
    const matrix = [
        [0, 8, 2, 0],
        [8, 0, 2, 2],
        [2, 2, 0, 8],
        [0, 2, 8, 0]
    ];
    const current = [0, 1, 2, 3];
    const result = optimizeRoundTrip(matrix);
    assert.ok(result.cost < routeCost(current, matrix));
    assert.deepEqual(result.route, [0, 2, 1, 3]);
    assert.equal(optimizeRoundTrip([[0, null], [null, 0]]), null);
});
