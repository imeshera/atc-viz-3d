import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/geo/phl');
const tmp = '/tmp/phl-geo';
const ORIGIN = { lat: 39.91, lon: -75.18 };
const HALF_M = 64 * 500;
const M_LAT = 111320;
const M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const BOARD = {
  lat0: ORIGIN.lat - HALF_M / M_LAT,
  lat1: ORIGIN.lat + HALF_M / M_LAT,
  lon0: ORIGIN.lon - HALF_M / M_LON,
  lon1: ORIGIN.lon + HALF_M / M_LON,
};
const KEEP_REFS = new Set(['I 95', 'I 76', 'I 676', 'I 476', 'I 295']);

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
      const points = thin(chain, 55);
      if (points.length >= 2) lines.push(points.map((point) => [round(point.lat), round(point.lon)]));
    }
  }
  return lines;
}

function stitchChains(pieces, joinMeters = 50) {
  const items = pieces.map((points) => ({ points, used: false }));
  const chains = [];
  for (const item of items) {
    if (item.used) continue;
    item.used = true;
    const chain = item.points.slice();
    for (let guard = 0; guard < items.length; guard += 1) {
      let grew = false;
      for (const atEnd of [true, false]) {
        const tip = atEnd ? chain.at(-1) : chain[0];
        let best = null;
        let bestGap = joinMeters;
        for (const candidate of items) {
          if (candidate.used) continue;
          for (const end of [0, candidate.points.length - 1]) {
            const gap = meters(tip, candidate.points[end]);
            if (gap < bestGap) {
              bestGap = gap;
              best = { candidate, end };
            }
          }
        }
        if (!best) continue;
        best.candidate.used = true;
        const points = best.candidate.points.slice();
        if (best.end !== 0) points.reverse();
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

function intersect(a, b, inside) {
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 24; step += 1) {
    const mid = (lo + hi) / 2;
    const point = [a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid];
    if (inside(point) === inside(a)) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function clipEdge(points, inside) {
  if (points.length < 3) return [];
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const previous = points[(i + points.length - 1) % points.length];
    const currentIn = inside(current);
    const previousIn = inside(previous);
    if (currentIn) {
      if (!previousIn) out.push(intersect(previous, current, inside));
      out.push(current);
    } else if (previousIn) out.push(intersect(previous, current, inside));
  }
  return out;
}

function clipRing(points) {
  let ring = points.map((point) => [point.lat, point.lon]);
  if (ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring = ring.slice(0, -1);
  const edges = [
    (point) => point[0] >= BOARD.lat0,
    (point) => point[0] <= BOARD.lat1,
    (point) => point[1] >= BOARD.lon0,
    (point) => point[1] <= BOARD.lon1,
  ];
  for (const inside of edges) ring = clipEdge(ring, inside);
  if (ring.length < 4) return [];
  ring.push(ring[0]);
  return ring.map((point) => [round(point[0]), round(point[1])]);
}

function pointInRing(ring, lat, lon) {
  let crossings = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const yi = ring[i][0];
    const yj = ring[j][0];
    const xi = ring[i][1];
    const xj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi) crossings += 1;
  }
  return crossings % 2 === 1;
}

function ribbon(points, halfMeters) {
  const left = [];
  const right = [];
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = (next.lon - prev.lon) * M_LON;
    const dy = (next.lat - prev.lat) * M_LAT;
    const length = Math.hypot(dx, dy) || 1;
    const px = -dy / length;
    const py = dx / length;
    left.push({
      lat: points[i].lat + (py * halfMeters) / M_LAT,
      lon: points[i].lon + (px * halfMeters) / M_LON,
    });
    right.push({
      lat: points[i].lat - (py * halfMeters) / M_LAT,
      lon: points[i].lon - (px * halfMeters) / M_LON,
    });
  }
  return [...left, ...right.reverse()];
}

function relationRings(relation) {
  const pieces = (role) => (relation.members || [])
    .filter((member) => member.role === role && member.geometry?.length > 1)
    .map((member) => member.geometry.map((point) => ({ lat: point.lat, lon: point.lon })));
  const stitched = stitchChains(pieces('outer'), 80);
  const closed = [];
  const open = [];
  for (const chain of stitched) {
    if (chain.length < 8) continue;
    if (meters(chain[0], chain.at(-1)) < 90) closed.push(chain);
    else open.push(chain);
  }
  const spare = open.slice();
  while (spare.length >= 2) {
    const chain = spare.shift();
    let match = null;
    let best = 1800;
    for (const other of spare) {
      const gap = Math.min(
        meters(chain[0], other[0]) + meters(chain.at(-1), other.at(-1)),
        meters(chain[0], other.at(-1)) + meters(chain.at(-1), other[0]),
      );
      if (gap < best) {
        best = gap;
        match = other;
      }
    }
    if (!match) continue;
    spare.splice(spare.indexOf(match), 1);
    const other = meters(chain.at(-1), match[0]) < meters(chain.at(-1), match.at(-1))
      ? match
      : match.slice().reverse();
    closed.push(chain.concat(other));
  }
  return closed.map((chain) => clipRing(thin(chain, 45))).filter((ring) => ring.length > 4);
}

function centerline(relationId) {
  const relation = readJson('water.json').elements.find((element) => element.id === relationId);
  const pieces = (relation?.members || [])
    .filter((member) => member.role === 'main_stream' && member.geometry?.length > 1)
    .map((member) => member.geometry.map((point) => ({ lat: point.lat, lon: point.lon })));
  return stitchChains(pieces, 120)
    .flatMap((chain) => clipChain(thin(chain, 70)))
    .filter((chain) => pathLength(chain) > 1500);
}

function covered(waters, lat, lon) {
  return waters.some((entry) => pointInRing(entry.outer, lat, lon) && !entry.holes.some((hole) => pointInRing(hole, lat, lon)));
}

const dryProbes = [
  ['city hall', 39.9524, -75.1635],
  ['comcast', 39.9548, -75.1685],
  ['art museum', 39.9656, -75.1809],
  ['phl', 39.876, -75.242],
  ['pne', 40.0819, -75.0106],
  ['university city', 39.9522, -75.193],
  ['camden', 39.9455, -75.119],
  ['navy yard', 39.895, -75.18],
  ['stadiums', 39.901, -75.167],
];

const polygons = readJson('banks.json').elements
  .filter((element) => element.type === 'relation' && element.tags?.water === 'river')
  .flatMap((relation) => relationRings(relation))
  .filter((ring) => !dryProbes.some(([, lat, lon]) => pointInRing(ring, lat, lon)))
  .map((outer) => ({ outer, holes: [] }));

const wetProbes = [
  ['delaware', 39.945, -75.136],
  ['schuylkill', 39.969, -75.188],
  ['delaware south', 39.89, -75.14],
];

const ribbons = [];
if (!covered(polygons, 39.945, -75.136) || !covered(polygons, 39.89, -75.14)) {
  ribbons.push(...centerline(371307).map((chain) => ({ outer: asRing(ribbon(chain, 400)), holes: [] })));
}
if (!covered(polygons, 39.969, -75.188)) {
  ribbons.push(...centerline(4264719).map((chain) => ({ outer: asRing(ribbon(chain, 110)), holes: [] })));
}
const waters = [...polygons, ...ribbons].filter((entry) => !dryProbes.some(([, lat, lon]) => pointInRing(entry.outer, lat, lon)));

const leaks = [];
for (const [name, lat, lon] of dryProbes) {
  if (covered(waters, lat, lon)) leaks.push(`${name} water`);
}
for (const [name, lat, lon] of wetProbes) {
  if (!covered(waters, lat, lon)) leaks.push(`${name} land`);
}
if (leaks.length) {
  console.log(`philadelphia leaks: ${leaks.join(', ')}`);
  throw new Error('Philadelphia shoreline did not hold');
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
    const ident = a.lat > 39.98 ? 'KPNE' : 'KPHL';
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

const towers = buildingsFrom(readJson('buildings.json'), 42);
const landmarks = [
  { h: 342, lat: 39.9545, lon: -75.1692 },
  { h: 297, lat: 39.9544, lon: -75.1684 },
  { h: 167, lat: 39.9526, lon: -75.1636 },
].filter((mark) => !nearTower(towers, mark.lat, mark.lon))
  .map((mark) => ({ h: mark.h, p: landmarkRing(mark.lat, mark.lon) }));
const buildings = dedupeTowers([...landmarks, ...towers]);
const roads = roadsFrom(readJson('roads.json'));
const runways = runwaysFrom(readJson('runways.json'));
const fields = fieldFromRunways(runways);
const coasts = waters.flatMap((entry) => [entry.outer, ...entry.holes]);

fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'coasts.json'), JSON.stringify(coasts));
fs.writeFileSync(path.join(root, 'waters.json'), JSON.stringify(waters));
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
console.log(`roads ${roads.length} (${Math.round(km / 1000)} km), buildings ${buildings.length} (max ${buildings[0]?.h || 0} m), runways ${runways.length}, fields ${fields.length}, waters ${waters.length}`);
