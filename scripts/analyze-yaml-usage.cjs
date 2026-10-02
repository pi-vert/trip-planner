// Read-only audit of registered trips; backups and ignored files are excluded.
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const directory = process.argv[2] || '/home/pi/trips';
const registry = JSON.parse(fs.readFileSync(path.join(directory, 'trips.json'), 'utf8'));
const fields = {};
const trips = [];
const meaningful = value => Array.isArray(value) ? value.length > 0
    : value && typeof value === 'object' ? Object.keys(value).length > 0
        : typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
const defaults = { duration_h: 2, budgetCurrency: 'CHF', budgetScope: 'individual' };
for (const trip of registry.trips) {
    const document = yaml.load(fs.readFileSync(trip.file, 'utf8')) || {};
    const places = Object.entries(document.places || {});
    const used = new Set();
    const custom = new Set();
    for (const [, place] of places) {
        for (const [key, value] of Object.entries(place)) {
            const field = fields[key] ||= { populatedPlaces: 0, populatedTrips: 0, nonDefaultPlaces: 0, nonDefaultTrips: 0 };
            if (!meaningful(value)) continue;
            field.populatedPlaces += 1;
            used.add(key);
            if (!(key in defaults) || value !== defaults[key]) {
                field.nonDefaultPlaces += 1;
                custom.add(key);
            }
        }
    }
    used.forEach(key => { fields[key].populatedTrips += 1; });
    custom.forEach(key => { fields[key].nonDefaultTrips += 1; });
    const planning = document.planning || {};
    trips.push({
        name: trip.name,
        places: places.length,
        itinerary: document.itinerary?.length || 0,
        candidates: places.filter(([id]) => !(document.itinerary || []).includes(id)).length,
        dates: Boolean(planning.startDate && planning.endDate),
        notes: meaningful(document.notes),
        people: document.people ?? 2,
        reservations: (planning.reservations || []).reduce((counts, item) => {
            const kind = item.kind || 'other';
            counts[kind] = (counts[kind] || 0) + 1;
            return counts;
        }, {}),
        customRhythm: (planning.speedKmh != null && planning.speedKmh !== 60)
            || (planning.dayStart != null && planning.dayStart !== '07:00')
            || (planning.dayEnd != null && planning.dayEnd !== '22:00')
            || Object.entries(planning.meals || {}).some(([meal, value]) => value.at !== ({ breakfast: '07:00', lunch: '12:00', dinner: '19:00' })[meal] || value.durationMin !== 60)
    });
}
console.log(JSON.stringify({ totalTrips: trips.length, totalPlaces: trips.reduce((sum, trip) => sum + trip.places, 0), defaults, fields, trips }, null, 2));
