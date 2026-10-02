const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate, normalizeCurrency, normalizeScope } = require('../src/budget.js');

test('calcule les totaux par devise en distinguant les coûts individuels et de groupe', () => {
    const places = {
        museum: { budget: 25, budgetCurrency: 'EUR', budgetScope: 'individual' },
        hotel: { budget: 180, budgetCurrency: 'EUR', budgetScope: 'group' },
        train: { budget: 40, budgetCurrency: 'CHF', budgetScope: 'individual' }
    };

    const result = calculate(['museum', 'hotel', 'train'], places, 2);

    assert.deepEqual(result.nativeTotals, { EUR: 230, CHF: 80 });
    assert.equal(result.entries[0].groupAmount, 50);
    assert.equal(result.entries[1].perPersonAmount, 90);
});

test('les anciens budgets restent des coûts individuels en CHF', () => {
    const result = calculate(['legacy'], { legacy: { budget: 12 } }, 3);

    assert.deepEqual(result.nativeTotals, { CHF: 36 });
    assert.equal(result.entries[0].scope, 'individual');
    assert.equal(normalizeCurrency('eur'), 'EUR');
    assert.equal(normalizeCurrency('invalide'), 'CHF');
    assert.equal(normalizeScope('inconnu'), 'individual');
});

test('une étape marquée gratuite conserve son coût mais ne contribue pas aux totaux', () => {
    const result = calculate(['free', 'paid'], {
        free: { budget: 80, budgetCurrency: 'EUR', budgetScope: 'group', budgetFree: true },
        paid: { budget: 10, budgetCurrency: 'CHF', budgetScope: 'individual' }
    }, 2);

    assert.deepEqual(result.nativeTotals, { CHF: 20 });
    assert.equal(result.entries[0].storedAmount, 80);
    assert.equal(result.entries[0].amount, 0);
    assert.equal(result.entries[0].free, true);
});
