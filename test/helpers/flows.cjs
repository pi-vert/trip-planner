const fs = require('node:fs');
const path = require('node:path');

// A clone is testable without the surrounding ESP32 Node-RED project.
// Set TRIP_PLANNER_FLOWS to test another export or the running installation.
const file = process.env.TRIP_PLANNER_FLOWS || path.resolve(__dirname, '../../node-red/flows.json');
module.exports = JSON.parse(fs.readFileSync(file, 'utf8'));
