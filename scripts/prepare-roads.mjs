import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const sources = process.argv.slice(2);
const files = sources.length ? sources : ['/tmp/chi-geo/roads.json', '/tmp/chi-geo/lsd.json'];
const MIN_STEP_M = 45;

function meters(a, b) {
  const dLat = (b.lat - a.lat) * 111320;
  const dLon = (b.lon - a.lon) * 83000;
  return Math.hypot(dLat, dLon);
}

function thin(points) {
  if (points.length < 2) return [];
  const kept = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const last = i === points.length - 1;
    if (last || meters(kept[kept.length - 1], points[i]) >= MIN_STEP_M) kept.push(points[i]);
  }
  return kept.length > 1 ? kept : [];
}

function round(value) {
  return Math.round(value * 1e5) / 1e5;
}

const lines = [];
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const way of data.elements || []) {
    const geometry = way.geometry || [];
    if (geometry.length < 2) continue;
    const points = thin(geometry.map((point) => ({ lat: point.lat, lon: point.lon })));
    if (points.length < 2) continue;
    if (meters(points[0], points[points.length - 1]) < 120 && points.length < 4) continue;
    lines.push(points.map((point) => [round(point.lat), round(point.lon)]));
  }
}

const target = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/geo/roads.json');
fs.writeFileSync(target, JSON.stringify(lines));
console.log(`wrote ${lines.length} road segments`);
