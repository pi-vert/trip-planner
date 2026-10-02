(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.TripRouteOptimizer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function routeCost(route, matrix) {
        let total = 0;
        for (let i = 0; i < route.length - 1; i++) {
            const raw = matrix[route[i]]?.[route[i + 1]];
            const value = Number(raw);
            if (raw == null || !Number.isFinite(value)) return Infinity;
            total += value;
        }
        return total;
    }

    function nearestNeighbor(matrix) {
        const count = matrix.length;
        if (count < 2 || matrix.some(row => !Array.isArray(row) || row.length !== count)) return null;
        const remaining = new Set(Array.from({ length: Math.max(0, count - 2) }, (_, index) => index + 1));
        const route = [0];
        let current = 0;
        while (remaining.size) {
            let next = null;
            let best = Infinity;
            for (const candidate of remaining) {
                const raw = matrix[current][candidate];
                const value = Number(raw);
                if (raw != null && Number.isFinite(value) && value < best) {
                    best = value;
                    next = candidate;
                }
            }
            if (next == null) return null;
            route.push(next);
            remaining.delete(next);
            current = next;
        }
        route.push(count - 1);
        return Number.isFinite(routeCost(route, matrix)) ? route : null;
    }

    function improveTwoOpt(route, matrix) {
        let bestRoute = route.slice();
        let bestCost = routeCost(bestRoute, matrix);
        let improved = true;
        while (improved) {
            improved = false;
            for (let start = 1; start < bestRoute.length - 2; start++) {
                for (let end = start + 1; end < bestRoute.length - 1; end++) {
                    const candidate = bestRoute.slice();
                    candidate.splice(start, end - start + 1, ...bestRoute.slice(start, end + 1).reverse());
                    const cost = routeCost(candidate, matrix);
                    if (cost + 0.001 < bestCost) {
                        bestRoute = candidate;
                        bestCost = cost;
                        improved = true;
                    }
                }
            }
        }
        return { route: bestRoute, cost: bestCost };
    }

    function optimizeRoundTrip(matrix) {
        const initial = nearestNeighbor(matrix);
        if (!initial) return null;
        return improveTwoOpt(initial, matrix);
    }

    return { routeCost, nearestNeighbor, improveTwoOpt, optimizeRoundTrip };
});
