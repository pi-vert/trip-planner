(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.TripBudget = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const BASE_CURRENCY = 'CHF';

    function normalizeCurrency(value) {
        const currency = String(value || '').trim().toUpperCase();
        return /^[A-Z]{3}$/.test(currency) ? currency : BASE_CURRENCY;
    }

    function normalizeScope(value) {
        return value === 'group' ? 'group' : 'individual';
    }

    function entryFor(id, place, people) {
        const storedAmount = Math.max(0, Number(place?.budget) || 0);
        const free = place?.budgetFree === true;
        const amount = free ? 0 : storedAmount;
        const currency = normalizeCurrency(place?.budgetCurrency);
        const scope = normalizeScope(place?.budgetScope);
        const groupAmount = scope === 'group' ? amount : amount * people;
        return { id, amount, storedAmount, currency, scope, free, groupAmount, perPersonAmount: groupAmount / people };
    }

    function convert(value, from, to, rates) {
        const source = normalizeCurrency(from), target = normalizeCurrency(to);
        if (source === target) return Number(value) || 0;
        const sourceRate = source === BASE_CURRENCY ? 1 : Number(rates?.[source]);
        const targetRate = target === BASE_CURRENCY ? 1 : Number(rates?.[target]);
        if (!(sourceRate > 0) || !(targetRate > 0)) return null;
        return (Number(value) || 0) / sourceRate * targetRate;
    }

    function calculate(itinerary, places, peopleValue, rates = {}) {
        const people = Math.max(1, Number(peopleValue) || 1);
        const entries = (itinerary || []).filter(id => places?.[id]).map(id => entryFor(id, places[id], people));
        const nativeTotals = {};
        for (const entry of entries) {
            if (!entry.free) nativeTotals[entry.currency] = (nativeTotals[entry.currency] || 0) + entry.groupAmount;
        }
        const currencies = Object.keys(nativeTotals);
        const missingCurrencies = currencies.filter(currency => currency !== BASE_CURRENCY && !(Number(rates[currency]) > 0));
        let baseTotal = null;
        const convertedTotals = {};
        if (!missingCurrencies.length) {
            baseTotal = entries.reduce((total, entry) => total + convert(entry.groupAmount, entry.currency, BASE_CURRENCY, rates), 0);
            for (const currency of currencies) convertedTotals[currency] = convert(baseTotal, BASE_CURRENCY, currency, rates);
        } else if (currencies.length === 1) {
            convertedTotals[currencies[0]] = nativeTotals[currencies[0]];
        }
        return { people, entries, currencies, nativeTotals, missingCurrencies, baseTotal, convertedTotals };
    }

    return { BASE_CURRENCY, calculate, convert, entryFor, normalizeCurrency, normalizeScope };
});
