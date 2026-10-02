#!/usr/bin/env node
'use strict';

// Export the Trip Planner flow and data independently from the other Node-RED apps.
const fs = require('node:fs');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function argument(name, fallback) {
    const index = args.indexOf(name);
    return index < 0 ? fallback : args[index + 1];
}
const source = argument('--flows', path.resolve(project, '../../flows.json'));
const dataDirectory = argument('--data', '/home/pi/trips');
const all = JSON.parse(fs.readFileSync(source, 'utf8'));
const ui = all.find(node => node.type === 'uibuilder' && node.url === 'trip_planner');
if (!ui) throw new Error('Le flow source ne contient pas l’application trip_planner.');
const selected = all.filter(node => node.id === ui.z || node.z === ui.z);
const selectedIds = new Set(selected.map(node => node.id));
const configuration = all.filter(node => !node.z && node.type !== 'tab' && !selectedIds.has(node.id));
function references(value, id) {
    if (typeof value === 'string') return value === id || value === `subflow:${id}`;
    if (Array.isArray(value)) return value.some(item => references(item, id));
    return value && typeof value === 'object' && Object.values(value).some(item => references(item, id));
}
let added;
do {
    added = false;
    for (const node of configuration) {
        if (!selectedIds.has(node.id) && selected.some(item => references(item, node.id))) {
            selected.push(node);
            selectedIds.add(node.id);
            added = true;
        }
    }
} while (added);

const dangling = selected.flatMap(node => (node.wires || []).flat().filter(id => !selectedIds.has(id)).map(id => ({ from: node.id, to: id })));
const modules = [...new Set(selected.flatMap(node => (node.libs || []).map(lib => lib.module)))];
const absolutePaths = [...new Set(JSON.stringify(selected).match(/\/home\/[a-zA-Z0-9_./-]+/g) || [])];
function fileManifest(directory, relative = '') {
    return fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).flatMap(entry => {
        if (entry.name.startsWith('.') || ['save', 'node_modules'].includes(entry.name) || /\.(save|old|bak|backup)$/.test(entry.name)) return [];
        const name = path.join(relative, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Lien symbolique non pris en charge : ${name}`);
        if (entry.isDirectory()) return fileManifest(directory, name);
        if (!/\.(ya?ml|json|gpx|txt)$/i.test(entry.name)) return [];
        return [{ name, bytes: fs.statSync(path.join(directory, name)).size }];
    });
}
const files = fileManifest(dataDirectory);
console.log(JSON.stringify({ flowNodes: selected.length, types: [...new Set(selected.map(node => node.type))], modules, absolutePaths, dangling, dataFiles: files.length, dataBytes: files.reduce((sum, file) => sum + file.bytes, 0), largestFiles: [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 10) }, null, 2));
if (args.includes('--inspect')) {
    console.log(JSON.stringify(selected.map(node => ({ id: node.id, type: node.type, name: node.name, command: node.command, imports: [node.func, node.initialize].filter(Boolean).flatMap(code => code.split('\n').filter(line => /require|createRequire|env\.get|global\.get/.test(line))) })), null, 2));
    process.exit(0);
}
if (dangling.length) throw new Error('Le flow contient des liens vers des nœuds hors du projet.');
for (const node of selected) {
    delete node.credentials;
    if (node.type === 'uibuilder') node.editurl = '';
    if (node.initialize) {
        node.initialize = node.initialize.replace(
            /moduleLoader\.createRequire\('[^']+\/flows\.json'\)\('\.\/uibuilder\/trip_planner\/([^']+)'\)/g,
            "moduleLoader.createRequire((env.get('TRIP_PLANNER_APP_DIR') || '/home/pi/.node-red/uibuilder/trip_planner') + '/package.json')('./$1')"
        );
    }
}
fs.mkdirSync(path.join(project, 'node-red'), { recursive: true });
fs.writeFileSync(path.join(project, 'node-red/flows.json'), `${JSON.stringify(selected, null, 2)}\n`);
for (const companion of selected.filter(node => node.type === 'uibuilder' && node.url !== 'trip_planner')) {
    if (!/^[a-zA-Z0-9_-]+$/.test(companion.url)) throw new Error('Nom d’application compagnon invalide.');
    const from = path.resolve(project, '..', companion.url);
    const to = path.join(project, 'node-red/companions', companion.url);
    fs.mkdirSync(to, { recursive: true });
    for (const name of ['src', 'package.json', 'LICENSE', 'README.md']) {
        if (fs.existsSync(path.join(from, name))) fs.cpSync(path.join(from, name), path.join(to, name), { recursive: true });
    }
}
if (args.includes('--include-data')) {
    const destination = path.join(project, 'data/trips');
    fs.mkdirSync(destination, { recursive: true });
    for (const file of files) {
        const target = path.join(destination, file.name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(dataDirectory, file.name), target);
    }
    // Remove stale files only inside the generated snapshot, never in the live data.
    const current = new Set(files.map(file => file.name));
    for (const file of fileManifest(destination)) {
        if (!current.has(file.name)) fs.unlinkSync(path.join(destination, file.name));
    }
}
console.log('Snapshot ready. Review git diff before committing.');
