import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { traceWater } from './trace-water.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/geo/sf');
const tmp = '/tmp/sf-geo';
const ORIGIN = { lat: 37.74, lon: -122.38 };
const HALF_M = 52 * 500;
const M_LAT = 111320;
const M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const BOARD = {
  lat0: ORIGIN.lat - HALF_M / M_LAT,
  lat1: ORIGIN.lat + HALF_M / M_LAT,
  lon0: ORIGIN.lon - HALF_M / M_LON,
  lon1: ORIGIN.lon + HALF_M / M_LON,
};
const KEEP_REFS = new Set(['US 101', 'I 80', 'I 280', 'I 580', 'I 880', 'I 380']);

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(tmp, name), 'utf8'));
}

function round(value) {
  return Math.round(value * 1e5) / 1e5;
}

function meters(a, b) {
  return Math.hypot((b.lat - a.lat) * M_LAT, (b.lon - a.lon) * M_LON);
}

function pathLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += meters(points[i - 1], points[i]);
  return length;
}

function thin(points, spacing) {
  if (points.length < 2) return [];
  const kept = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const last = i === points.length - 1;
    if (last || meters(kept[kept.length - 1], points[i]) >= spacing) kept.push(points[i]);
  }
  return kept.length > 1 ? kept : [];
}

function onBoard(point) {
  return point.lat >= BOARD.lat0 && point.lat <= BOARD.lat1 && point.lon >= BOARD.lon0 && point.lon <= BOARD.lon1;
}

function clipChain(points) {
  const parts = [];
  let current = [];
  for (const point of points) {
    const jump = current.length && meters(current.at(-1), point) > 4000;
    if (!onBoard(point) || jump) {
      if (current.length > 2) parts.push(current);
      current = onBoard(point) && !jump ? [point] : [];
      continue;
    }
    current.push(point);
  }
  if (current.length > 2) parts.push(current);
  return parts;
}

function routeId(way) {
  const primary = (way.tags?.ref || '').split(';')[0].trim();
  if (!KEEP_REFS.has(primary)) return '';
  const name = way.tags?.name || '';
  if (/express/i.test(name)) return '';
  return primary;
}

function bearing(a, b) {
  return Math.atan2((b.lon - a.lon) * M_LON, (b.lat - a.lat) * M_LAT);
}

function turn(a, b) {
  let delta = a - b;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta);
}

function outward(chain, atEnd) {
  if (atEnd) return bearing(chain[Math.max(0, chain.length - 6)], chain.at(-1));
  return bearing(chain[Math.min(5, chain.length - 1)], chain[0]);
}

function routeKey(point) {
  const lat = Math.round(point.lat / 0.0002) * 0.0002;
  const lon = Math.round(point.lon / 0.00025) * 0.00025;
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

function joinRoute(pieces) {
  const items = pieces.map((points) => ({ points, used: false }));
  const at = new Map();
  const add = (key, item, end) => {
    if (!at.has(key)) at.set(key, []);
    at.get(key).push({ item, end });
  };
  for (const item of items) {
    add(routeKey(item.points[0]), item, 'start');
    add(routeKey(item.points.at(-1)), item, 'finish');
  }
  const seeds = [];
  for (const list of at.values()) if (list.length === 1) seeds.push(list[0]);
  for (const item of items) seeds.push({ item, end: 'start' });
  const chains = [];
  for (const seed of seeds) {
    if (seed.item.used) continue;
    seed.item.used = true;
    const chain = seed.end === 'start' ? seed.item.points.slice() : seed.item.points.slice().reverse();
    for (let guard = 0; guard < items.length; guard += 1) {
      const heading = outward(chain, true);
      const options = (at.get(routeKey(chain.at(-1))) || []).filter((option) => !option.item.used);
      if (!options.length) break;
      let best = null;
      let bestTurn = Infinity;
      let bestItem = null;
      for (const option of options) {
        const points = option.end === 'start' ? option.item.points : option.item.points.slice().reverse();
        const delta = turn(heading, bearing(points[0], points[Math.min(6, points.length - 1)]));
        if (delta < bestTurn) {
          bestTurn = delta;
          best = points;
          bestItem = option.item;
        }
      }
      if (!best || bestTurn > 1) break;
      bestItem.used = true;
      chain.push(...best.slice(1));
    }
    chains.push(chain);
  }
  return mergeAligned(chains).filter((chain) => pathLength(chain) >= 1600);
}

function mergeAligned(chains) {
  const list = chains.map((chain) => chain.slice());
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < list.length && !changed; i += 1) {
      for (let j = i + 1; j < list.length && !changed; j += 1) {
        for (const aEnd of [true, false]) {
          for (const bEnd of [true, false]) {
            const aPoint = aEnd ? list[i].at(-1) : list[i][0];
            const bPoint = bEnd ? list[j].at(-1) : list[j][0];
            const gap = meters(aPoint, bPoint);
            if (gap < 12 || gap > 160) continue;
            if (turn(outward(list[i], aEnd), bearing(aPoint, bPoint)) > 0.65) continue;
            if (turn(outward(list[j], bEnd), bearing(bPoint, aPoint)) > 0.65) continue;
            const left = aEnd ? list[i].slice() : list[i].slice().reverse();
            const right = bEnd ? list[j].slice().reverse() : list[j].slice();
            list.splice(j, 1);
            list.splice(i, 1);
            list.push(left.concat(right));
            changed = true;
            break;
          }
          if (changed) break;
        }
      }
    }
  }
  return list;
}

function roadsFrom(data) {
  const byRef = new Map();
  for (const way of data?.elements || []) {
    const id = routeId(way);
    if (!id) continue;
    const points = (way.geometry || []).map((point) => ({ lat: point.lat, lon: point.lon }));
    if (points.length < 2) continue;
    if (!byRef.has(id)) byRef.set(id, []);
    byRef.get(id).push(points);
  }
  const lines = [];
  for (const pieces of byRef.values()) {
    for (const chain of joinRoute(pieces)) {
      for (const part of clipChain(thin(chain, 55))) {
        if (part.length >= 2) lines.push(part.map((point) => [round(point.lat), round(point.lon)]));
      }
    }
  }
  return lines;
}

function buildingsFrom(data, minHeight) {
  const towers = [];
  for (const way of data?.elements || []) {
    const raw = String(way.tags?.height || '').split(';')[0];
    const tagged = Number(raw.replace(/[^\d.]/g, ''));
    const levels = Number(way.tags?.['building:levels']);
    const height = tagged || (Number.isFinite(levels) ? levels * 3.7 : 0);
    if (!height || height < minHeight || height > 450) continue;
    const ring = (way.geometry || []).map((point) => [round(point.lon), round(point.lat)]);
    if (ring.length < 4) continue;
    towers.push({ h: Math.round(height), p: ring });
  }
  return towers;
}

function dedupeTowers(towers) {
  const seen = new Set();
  const unique = [];
  for (const tower of towers) {
    const [lon, lat] = tower.p[0];
    const key = `${lon.toFixed(4)},${lat.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(tower);
  }
  unique.sort((a, b) => b.h - a.h);
  return unique;
}

function landmarkRing(lat, lon) {
  const dLat = 0.00028;
  const dLon = 0.00036;
  return [
    [round(lon - dLon), round(lat - dLat)],
    [round(lon + dLon), round(lat - dLat)],
    [round(lon + dLon), round(lat + dLat)],
    [round(lon - dLon), round(lat + dLat)],
    [round(lon - dLon), round(lat - dLat)],
  ];
}

function nearTower(towers, lat, lon) {
  return towers.some((tower) => tower.p.some(([tLon, tLat]) => Math.hypot((tLat - lat) * M_LAT, (tLon - lon) * M_LON) < 120));
}

function runwaysFrom(data) {
  const runways = [];
  for (const way of data?.elements || []) {
    const geometry = way.geometry || [];
    if (geometry.length < 2) continue;
    const a = geometry[0];
    const b = geometry.at(-1);
    if (meters(a, b) < 900) continue;
    const ident = a.lat < 37.66 ? 'KSFO' : 'KOAK';
    const width = Number(way.tags?.width);
    runways.push({
      ident,
      w: Number.isFinite(width) && width >= 20 ? Math.round(width) : 46,
      p: [[round(a.lat), round(a.lon)], [round(b.lat), round(b.lon)]],
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
    const hull = convexHull(group.flatMap((runway) => runway.p.map(([lat, lon]) => ({ lat, lon }))));
    if (hull.length < 3) continue;
    const center = hull.reduce((sum, point) => ({
      lat: sum.lat + point.lat / hull.length,
      lon: sum.lon + point.lon / hull.length,
    }), { lat: 0, lon: 0 });
    const expanded = hull.map((point) => ({
      lat: center.lat + (point.lat - center.lat) * 1.16,
      lon: center.lon + (point.lon - center.lon) * 1.16,
    }));
    expanded.push(expanded[0]);
    fields.push(expanded.map((point) => [round(point.lat), round(point.lon)]));
  }
  return fields;
}

function convexHull(points) {
  const sorted = points.slice().sort((a, b) => a.lon - b.lon || a.lat - b.lat);
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

const dryProbes = [
  ['salesforce', 37.7897, -122.3969],
  ['city hall', 37.7793, -122.4192],
  ['sfo', 37.6213, -122.379],
  ['oak', 37.712, -122.22],
  ['oakland', 37.8044, -122.2711],
  ['presidio', 37.7989, -122.4662],
  ['treasure', 37.8235, -122.3716],
];
const wetProbes = [
  ['bay', 37.8, -122.35],
  ['south bay', 37.68, -122.3],
  ['pacific', 37.75, -122.6],
  ['golden gate', 37.819, -122.478],
];

const coastsOnly = {
  elements: (readJson('water.json').elements || []).filter((element) => element.tags?.natural === 'coastline'),
};
const traced = traceWater({
  elements: coastsOnly.elements,
  lat0: BOARD.lat0,
  lat1: BOARD.lat1,
  lon0: BOARD.lon0,
  lon1: BOARD.lon1,
  cell: 36,
  seeds: wetProbes.map(([, lat, lon]) => [lat, lon]),
  probes: [
    ...dryProbes.map(([name, lat, lon]) => [name, lat, lon, false]),
    ...wetProbes.map(([name, lat, lon]) => [name, lat, lon, true]),
  ],
  label: 'san francisco',
});
if (traced.leaks?.length) throw new Error('San Francisco shoreline did not hold');

const towers = buildingsFrom(readJson('buildings.json'), 42);
const landmarks = [
  { h: 326, lat: 37.7897, lon: -122.3969 },
  { h: 260, lat: 37.7952, lon: -122.4028 },
].filter((mark) => !nearTower(towers, mark.lat, mark.lon))
  .map((mark) => ({ h: mark.h, p: landmarkRing(mark.lat, mark.lon) }));
const buildings = dedupeTowers([...landmarks, ...towers]);
const roads = roadsFrom(readJson('roads.json'));
const runways = runwaysFrom(readJson('runways.json'));
const fields = fieldFromRunways(runways);

fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'coasts.json'), JSON.stringify(traced.coasts));
fs.writeFileSync(path.join(root, 'waters.json'), JSON.stringify(traced.waters));
fs.writeFileSync(path.join(root, 'roads.json'), JSON.stringify(roads));
fs.writeFileSync(path.join(root, 'buildings.json'), JSON.stringify(buildings));
fs.writeFileSync(path.join(root, 'airports.json'), JSON.stringify({
  fields,
  runways: runways.map(({ w, p }) => ({ w, p })),
}));
const km = roads.reduce((sum, line) => {
  let length = 0;
  for (let i = 1; i < line.length; i += 1) {
    length += Math.hypot((line[i][0] - line[i - 1][0]) * M_LAT, (line[i][1] - line[i - 1][1]) * M_LON);
  }
  return sum + length;
}, 0);
console.log(`roads ${roads.length} (${Math.round(km / 1000)} km), buildings ${buildings.length} (max ${buildings[0]?.h || 0} m), runways ${runways.length}, fields ${fields.length}, waters ${traced.waters.length}`);
