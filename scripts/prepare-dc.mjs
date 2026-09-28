import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/geo/dc');
const tmp = '/tmp/dc-geo';
const KEEP_REFS = new Set([
  'I 95', 'I 495', 'I 66', 'I 270', 'I 395', 'I 295', 'DC 295',
  'I 695', 'I 83', 'I 895', 'VA 267', 'MD 295',
]);
const AIRPORTS = new Set(['KDCA', 'KIAD', 'KBWI']);

function readJson(name) {
  const file = path.join(tmp, name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function round(value) {
  return Math.round(value * 1e5) / 1e5;
}

function meters(a, b) {
  return Math.hypot((b.lat - a.lat) * 111320, (b.lon - a.lon) * 86600);
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

function routeId(way) {
  const primary = (way.tags?.ref || '').split(';')[0].trim();
  if (KEEP_REFS.has(primary)) return primary;
  if (way.tags?.name === 'George Washington Memorial Parkway') return 'GWMP';
  return '';
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
      const points = thin(chain, 55);
      if (points.length >= 2) lines.push(points.map((point) => [round(point.lat), round(point.lon)]));
    }
  }
  return lines;
}

function routeKey(point) {
  const lat = Math.round(point.lat / 0.0002) * 0.0002;
  const lon = Math.round(point.lon / 0.00025) * 0.00025;
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

function bearing(a, b) {
  return Math.atan2((b.lon - a.lon) * 86600, (b.lat - a.lat) * 111320);
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

function buildingsFrom(data, minHeight) {
  const towers = [];
  for (const way of data?.elements || []) {
    const raw = String(way.tags?.height || '').split(';')[0];
    const tagged = Number(raw.replace(/[^\d.]/g, ''));
    const levels = Number(way.tags?.['building:levels']);
    const height = tagged || (Number.isFinite(levels) ? levels * 3.7 : 0);
    if (!height || height < minHeight || height > 400) continue;
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
    if (cells[index.closed] === '1') continue;
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
  const corners = [[-220, -340], [len + 220, -340], [len + 220, 340], [-220, 340]];
  const ring = corners.map(([s, t]) => [
    round(a[0] + (uy * s + py * t) / mLat),
    round(a[1] + (ux * s + px * t) / mLon),
  ]);
  ring.push(ring[0]);
  return ring;
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

function stitchChains(pieces) {
  const key = (point) => `${point.lon.toFixed(5)},${point.lat.toFixed(5)}`;
  const items = pieces.map((points) => ({ points, used: false }));
  const at = new Map();
  const add = (id, item) => {
    if (!at.has(id)) at.set(id, []);
    at.get(id).push(item);
  };
  for (const item of items) {
    add(key(item.points[0]), item);
    add(key(item.points.at(-1)), item);
  }
  const chains = [];
  for (const item of items) {
    if (item.used) continue;
    item.used = true;
    const chain = item.points.slice();
    for (let guard = 0; guard < items.length; guard += 1) {
      let grew = false;
      for (const atEnd of [true, false]) {
        const tip = atEnd ? chain.at(-1) : chain[0];
        const next = (at.get(key(tip)) || []).find((candidate) => !candidate.used);
        if (!next) continue;
        next.used = true;
        const points = next.points.slice();
        if (key(points[0]) !== key(tip)) points.reverse();
        if (atEnd) chain.push(...points.slice(1));
        else chain.unshift(...points.slice(0, -1));
        grew = true;
        break;
      }
      if (!grew) break;
    }
    chains.push(chain);
  }
  return chains;
}

function asRing(points) {
  const ring = points.map((point) => [round(point.lat), round(point.lon)]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  return ring;
}

function relationWater(relationFile, waysFile) {
  const relation = readJson(relationFile).elements.find((element) => element.type === 'relation');
  const byId = new Map(readJson(waysFile).elements.filter((element) => element.type === 'way').map((way) => [way.id, way]));
  const pieces = (role) => relation.members
    .filter((member) => member.role === role && byId.get(member.ref)?.geometry?.length > 1)
    .map((member) => byId.get(member.ref).geometry.map((point) => ({ lat: point.lat, lon: point.lon })));
  const outers = stitchChains(pieces('outer')).filter((chain) => chain.length > 10);
  const holes = stitchChains(pieces('inner')).filter((chain) => pathLength(chain) > 400 && meters(chain[0], chain.at(-1)) < 80);
  return outers.map((outer) => {
    const ring = asRing(outer);
    return {
      outer: ring,
      holes: holes
        .filter((hole) => {
          const lat = hole.reduce((sum, point) => sum + point.lat, 0) / hole.length;
          const lon = hole.reduce((sum, point) => sum + point.lon, 0) / hole.length;
          return pointInRing(ring, lat, lon);
        })
        .map((hole) => asRing(hole)),
    };
  });
}

function ribbon(points, halfMeters) {
  const left = [];
  const right = [];
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = (next.lon - prev.lon) * 86600;
    const dy = (next.lat - prev.lat) * 111320;
    const length = Math.hypot(dx, dy) || 1;
    const px = -dy / length;
    const py = dx / length;
    left.push({
      lat: points[i].lat + (py * halfMeters) / 111320,
      lon: points[i].lon + (px * halfMeters) / 86600,
    });
    right.push({
      lat: points[i].lat - (py * halfMeters) / 111320,
      lon: points[i].lon - (px * halfMeters) / 86600,
    });
  }
  return asRing([...left, ...right.reverse()]);
}

function pointInRing(ring, lat, lon) {
  let crossings = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const yi = ring[i][0];
    const yj = ring[j][0];
    const xi = ring[i][1];
    const xj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) crossings += 1;
  }
  return crossings % 2 === 1;
}

const anacostia = readJson('channels.json')?.elements?.find((element) => element.id === 51858784);
const BOARD = { lat0: 38.46, lat1: 39.34, lon0: -77.6, lon1: -76.48 };

function onBoard(point) {
  return point.lat >= BOARD.lat0 && point.lat <= BOARD.lat1 && point.lon >= BOARD.lon0 && point.lon <= BOARD.lon1;
}

function clipChain(points) {
  const parts = [];
  let current = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
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

const centerline = stitchChains(
  (readJson('centerline.json')?.elements || [])
    .filter((way) => way.tags?.name === 'Potomac River' && way.geometry?.length > 2)
    .map((way) => way.geometry.map((point) => ({ lat: point.lat, lon: point.lon }))),
).flatMap((chain) => clipChain(chain)).filter((chain) => pathLength(chain) > 1500);

const waters = [
  ...relationWater('potomac-meta.json', 'potomac-rel.json'),
  ...relationWater('potomac2.json', 'potomac2-ways.json'),
  ...(anacostia ? [{ outer: asRing(anacostia.geometry), holes: [] }] : []),
  ...centerline.map((chain) => ({ outer: ribbon(chain, 560), holes: [] })),
];

const probes = [
  ['potomac', 38.86, -77.03, true],
  ['georgetown', 38.888, -77.055, true],
  ['anacostia', 38.865, -77.006, true],
  ['white house', 38.8977, -77.0365, false],
  ['capitol', 38.8899, -77.009, false],
  ['dca', 38.852, -77.04, false],
  ['iad', 38.944, -77.456, false],
  ['bwi', 39.175, -76.668, false],
  ['rosslyn', 38.896, -77.071, false],
  ['tysons', 38.918, -77.222, false],
];
const leaks = [];
for (const [name, lat, lon, expectWater] of probes) {
  const wet = waters.some((entry) => pointInRing(entry.outer, lat, lon) && !entry.holes.some((hole) => pointInRing(hole, lat, lon)));
  if (wet !== expectWater) leaks.push(`${name} ${wet ? 'water' : 'land'}`);
}
if (leaks.length) {
  console.log(`washington leaks: ${leaks.join(', ')}`);
  throw new Error('Washington shoreline did not hold');
}

const coasts = waters.flatMap((entry) => [entry.outer, ...entry.holes]);

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

const roads = roadsFrom(readJson('roads.json'));
const towers = dedupeTowers([
  { h: 88, p: landmarkRing(38.8899, -77.0091) },
  ...buildingsFrom(readJson('buildings-rosslyn.json'), 42),
  ...buildingsFrom(readJson('buildings-tysons.json'), 42),
  ...buildingsFrom(readJson('buildings-bethesda.json'), 42),
  ...buildingsFrom(readJson('buildings-baltimore.json'), 42),
]);
const runwayFile = fs.existsSync('/tmp/lax-geo/runways.csv') ? '/tmp/lax-geo/runways.csv' : '';
const runways = runwayFile ? runwaysFromCsv(fs.readFileSync(runwayFile, 'utf8')) : [];
const fields = fieldFromRunways(runways);

fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'coasts.json'), JSON.stringify(coasts));
fs.writeFileSync(path.join(root, 'waters.json'), JSON.stringify(waters));
fs.writeFileSync(path.join(root, 'roads.json'), JSON.stringify(roads));
fs.writeFileSync(path.join(root, 'buildings.json'), JSON.stringify(towers));
fs.writeFileSync(path.join(root, 'airports.json'), JSON.stringify({
  fields,
  runways: runways.map(({ w, p }) => ({ w, p })),
}));
console.log(`roads ${roads.length}, buildings ${towers.length}, runways ${runways.length}, fields ${fields.length}`);
