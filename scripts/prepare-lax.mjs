import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/geo/lax');
const tmp = '/tmp/lax-geo';
const KEEP_REFS = new Set(['I 405', 'I 105', 'I 110', 'I 10', 'I 5']);
const AIRPORTS = new Set(['KLAX', 'KBUR', 'KVNY', 'KSMO', 'KHHR', 'KTOA', 'KLGB', 'KSNA']);

function readJson(name) {
  const file = path.join(tmp, name);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8').trim();
  if (!text.startsWith('{')) return null;
  return JSON.parse(text);
}

function round(value) {
  return Math.round(value * 1e5) / 1e5;
}

function meters(a, b) {
  const dLat = (b.lat - a.lat) * 111320;
  const dLon = (b.lon - a.lon) * 92500;
  return Math.hypot(dLat, dLon);
}

function thin(points) {
  if (points.length < 2) return [];
  const kept = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const last = i === points.length - 1;
    if (last || meters(kept[kept.length - 1], points[i]) >= 45) kept.push(points[i]);
  }
  return kept.length > 1 ? kept : [];
}

function shoreFromCoast(data) {
  const bins = new Map();
  for (const way of data?.elements || []) {
    for (const point of way.geometry || []) {
      const key = Math.round(point.lat * 250) / 250;
      const current = bins.get(key);
      if (!current || point.lon < current.lon) bins.set(key, { lat: point.lat, lon: point.lon });
    }
  }
  return [...bins.values()]
    .sort((a, b) => b.lat - a.lat)
    .map((point) => [round(point.lat), round(point.lon)]);
}

function roadsFrom(data) {
  const lines = [];
  for (const way of data?.elements || []) {
    const ref = way.tags?.ref || '';
    const primary = ref.split(';')[0];
    if (!KEEP_REFS.has(primary)) continue;
    const points = thin((way.geometry || []).map((point) => ({ lat: point.lat, lon: point.lon })));
    if (points.length < 2) continue;
    lines.push(points.map((point) => [round(point.lat), round(point.lon)]));
  }
  return lines;
}

function downtownTowers() {
  const towers = [
    ['Wilshire Grand', 34.0505, -118.2598, 335],
    ['US Bank Tower', 34.0508, -118.2546, 310],
    ['Aon Center', 34.0486, -118.2568, 262],
    ['Two California Plaza', 34.0512, -118.2514, 229],
    ['Gas Company Tower', 34.0507, -118.2551, 228],
    ['Bank of America Plaza', 34.0536, -118.2594, 224],
    ['Wells Fargo Center', 34.0532, -118.2516, 220],
    ['777 Tower', 34.0485, -118.2617, 221],
    ['Figueroa at Wilshire', 34.0503, -118.2591, 218],
    ['City National Tower', 34.0511, -118.2563, 213],
    ['Paul Hastings Tower', 34.0524, -118.2578, 210],
    ['FourFortyFour Flower', 34.052, -118.2566, 191],
    ['One California Plaza', 34.0525, -118.2516, 176],
    ['Union Bank Plaza', 34.0492, -118.2569, 157],
  ];
  return towers.map(([, lat, lon, height]) => {
    const dLat = 0.00022;
    const dLon = 0.00026;
    return {
      h: height,
      p: [
        [round(lon - dLon), round(lat - dLat)],
        [round(lon + dLon), round(lat - dLat)],
        [round(lon + dLon), round(lat + dLat)],
        [round(lon - dLon), round(lat + dLat)],
        [round(lon - dLon), round(lat - dLat)],
      ],
    };
  });
}

function buildingsFrom(data) {
  const towers = [];
  for (const way of data?.elements || []) {
    const levels = Number(way.tags?.['building:levels']);
    const tagged = Number(String(way.tags?.height || '').replace(/[^\d.]/g, ''));
    const height = tagged || levels * 3.7;
    if (!height || height < 50) continue;
    const ring = (way.geometry || []).map((point) => [round(point.lon), round(point.lat)]);
    if (ring.length < 4) continue;
    towers.push({ h: Math.round(height), p: ring });
  }
  towers.sort((a, b) => b.h - a.h);
  return towers.slice(0, 180);
}

function runwaysFromCsv(csv) {
  const lines = csv.trim().split('\n');
  const header = lines[0].split(',').map((name) => name.replace(/^"|"$/g, ''));
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  const runways = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((cell) => cell.replace(/^"|"$/g, ''));
    const ident = cells[index.airport_ident];
    if (!AIRPORTS.has(ident)) continue;
    const lengthFt = Number(cells[index.length_ft]) || 0;
    if (lengthFt < 2500) continue;
    const closed = cells[index.closed];
    if (closed === '1') continue;
    const lat1 = Number(cells[index.le_latitude_deg]);
    const lon1 = Number(cells[index.le_longitude_deg]);
    const lat2 = Number(cells[index.he_latitude_deg]);
    const lon2 = Number(cells[index.he_longitude_deg]);
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) continue;
    const widthFt = Number(cells[index.width_ft]) || 150;
    runways.push({
      ident,
      w: Math.round(widthFt * 0.3048),
      p: [[round(lat1), round(lon1)], [round(lat2), round(lon2)]],
    });
  }
  return runways;
}

function fieldFromRunways(runways) {
  const groups = new Map();
  for (const runway of runways) {
    if (!groups.has(runway.ident)) groups.set(runway.ident, []);
    groups.get(runway.ident).push(runway);
  }
  const fields = [];
  for (const group of groups.values()) {
    const ring = group.length === 1 ? padRunway(group[0]) : hullField(group);
    if (ring.length > 3) fields.push(ring);
  }
  return fields;
}

function hullField(runways) {
  const hull = convexHull(runways.flatMap((runway) => runway.p.map(([lat, lon]) => ({ lat, lon }))));
  if (hull.length < 3) return [];
  const center = hull.reduce((sum, point) => ({
    lat: sum.lat + point.lat / hull.length,
    lon: sum.lon + point.lon / hull.length,
  }), { lat: 0, lon: 0 });
  const expanded = hull.map((point) => ({
    lat: center.lat + (point.lat - center.lat) * 1.16,
    lon: center.lon + (point.lon - center.lon) * 1.16,
  }));
  expanded.push(expanded[0]);
  return expanded.map((point) => [round(point.lat), round(point.lon)]);
}

function padRunway(runway) {
  const [a, b] = runway.p;
  const midLat = (a[0] + b[0]) / 2;
  const mLat = 111320;
  const mLon = 111320 * Math.cos((midLat * Math.PI) / 180);
  const dx = (b[1] - a[1]) * mLon;
  const dy = (b[0] - a[0]) * mLat;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const along = 220;
  const across = 340;
  const corners = [[-along, -across], [len + along, -across], [len + along, across], [-along, across]];
  const ring = corners.map(([s, t]) => [
    round(a[0] + (uy * s + py * t) / mLat),
    round(a[1] + (ux * s + px * t) / mLon),
  ]);
  ring.push(ring[0]);
  return ring;
}

function extendShore(shore) {
  const north = [
    [34.45, -118.95],
    [34.32, -118.88],
    [34.18, -118.78],
    [34.08, -118.72],
  ];
  const south = [
    [33.66, -118.12],
    [33.6, -117.96],
    [33.54, -117.88],
    [33.48, -117.78],
  ];
  const body = shore.filter((point) => point[0] < north.at(-1)[0] && point[0] > south[0][0]);
  return [...north, ...body, ...south];
}

function convexHull(points) {
  const sorted = points
    .slice()
    .sort((a, b) => a.lon - b.lon || a.lat - b.lat);
  const cross = (o, a, b) => (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

const coast = readJson('coast.json');
const roads = readJson('roads.json');
const wideBuildings = readJson('buildings-wide.json');
const buildings = (wideBuildings?.elements?.length || 0) > (readJson('buildings.json')?.elements?.length || 0)
  ? wideBuildings
  : readJson('buildings.json');
const runwayCsv = fs.existsSync(path.join(tmp, 'runways.csv'))
  ? fs.readFileSync(path.join(tmp, 'runways.csv'), 'utf8')
  : '';

const shore = extendShore(shoreFromCoast(coast));
const roadLines = roadsFrom(roads);
const towers = buildingsFrom(buildings).length ? buildingsFrom(buildings) : downtownTowers();
const runways = runwayCsv ? runwaysFromCsv(runwayCsv) : [];
const fields = fieldFromRunways(runways);

fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'shore.json'), JSON.stringify(shore));
fs.writeFileSync(path.join(root, 'roads.json'), JSON.stringify(roadLines));
fs.writeFileSync(path.join(root, 'buildings.json'), JSON.stringify(towers));
fs.writeFileSync(path.join(root, 'airports.json'), JSON.stringify({
  fields,
  runways: runways.map(({ w, p }) => ({ w, p })),
}));
console.log(`shore ${shore.length}, roads ${roadLines.length}, buildings ${towers.length}, runways ${runways.length}, fields ${fields.length}`);
