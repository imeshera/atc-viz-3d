import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { riverLines, traceWater } from './trace-water.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/geo');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const chicago = traceWater({
  label: 'chicago',
  elements: readJson('/tmp/chi-geo/lake.json').elements,
  lat0: 41.73,
  lat1: 42.25,
  lon0: -88.2,
  lon1: -87.5,
  cell: 22,
  seeds: [[41.88, -87.55]],
  probes: [
    ['lake', 41.88, -87.55, true],
    ['harbor', 41.891, -87.6, true],
    ['loop', 41.882, -87.628, false],
    ['ord', 41.979, -87.905, false],
    ['mdw', 41.786, -87.752, false],
    ['evanston', 42.045, -87.69, false],
  ],
});

const lax = traceWater({
  label: 'los angeles',
  elements: readJson('/tmp/lax-geo/coast-wide.json').elements,
  lat0: 33.46,
  lat1: 34.44,
  lon0: -118.95,
  lon1: -117.78,
  cell: 30,
  seeds: [[33.9, -118.55]],
  probes: [
    ['pacific', 33.9, -118.55, true],
    ['bay', 33.95, -118.48, true],
    ['long beach harbor', 33.74, -118.22, true],
    ['lax', 33.9425, -118.4081, false],
    ['downtown', 34.05, -118.25, false],
    ['palos verdes', 33.75, -118.35, false],
    ['lgb', 33.817, -118.151, false],
    ['burbank', 34.2, -118.36, false],
  ],
});

if (!chicago.waters.length || chicago.leaks.length) {
  throw new Error('Chicago shoreline did not hold');
}
if (!lax.waters.length || lax.leaks.length) {
  throw new Error('Los Angeles shoreline did not hold');
}

const river = riverLines(readJson('/tmp/chi-geo/river.json').elements, 83000);

fs.writeFileSync(path.join(root, 'coasts.json'), JSON.stringify(chicago.coasts));
fs.writeFileSync(path.join(root, 'waters.json'), JSON.stringify(chicago.waters));
if (river.length) fs.writeFileSync(path.join(root, 'river.json'), JSON.stringify(river));
fs.mkdirSync(path.join(root, 'lax'), { recursive: true });
fs.writeFileSync(path.join(root, 'lax/coasts.json'), JSON.stringify(lax.coasts));
fs.writeFileSync(path.join(root, 'lax/waters.json'), JSON.stringify(lax.waters));
console.log(`chicago river branches ${river.length}`);
