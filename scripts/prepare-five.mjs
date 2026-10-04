import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { traceWater } from './trace-water.mjs';

const geoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/geo');
const M_LAT = 111320;

let M_LON = M_LAT;
let BOARD = null;
let KEEP_REFS = new Set();

function begin(origin, halfUnits) {
  M_LON = M_LAT * Math.cos((origin.lat * Math.PI) / 180);
  const halfM = halfUnits * 500;
  BOARD = {
    lat0: origin.lat - halfM / M_LAT,
    lat1: origin.lat + halfM / M_LAT,
    lon0: origin.lon - halfM / M_LON,
    lon1: origin.lon + halfM / M_LON,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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
  if (/express/i.test(way.tags?.name || '')) return '';
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

function stitchChains(pieces, joinMeters) {
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

function covered(waters, lat, lon) {
  return waters.some((entry) => pointInRing(entry.outer, lat, lon) && !entry.holes.some((hole) => pointInRing(hole, lat, lon)));
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

function riverChains(elements, nameRe) {
  const pieces = [];
  const take = (geometry) => {
    const points = geometry.map((point) => ({ lat: point.lat, lon: point.lon }));
    if (points.length < 2 || meters(points[0], points.at(-1)) < 120) return;
    pieces.push(points);
  };
  for (const element of elements || []) {
    if (!nameRe.test(element.tags?.name || '')) continue;
    if (element.type === 'way' && element.tags?.waterway === 'river') take(element.geometry || []);
    if (element.type === 'relation' && element.tags?.waterway === 'river') {
      for (const member of element.members || []) {
        if (member.role === 'outer' || member.role === 'inner') continue;
        take(member.geometry || []);
      }
    }
  }
  return stitchChains(pieces, 120);
}

function ribbonWaters(chains, halfMeters) {
  const waters = [];
  for (const chain of chains) {
    for (const part of clipChain(thin(chain, 80))) {
      let start = 0;
      while (start < part.length - 1) {
        let end = start + 1;
        let length = 0;
        while (end < part.length - 1 && length < 1600) {
          length += meters(part[end - 1], part[end]);
          end += 1;
        }
        const slice = part.slice(start, Math.min(part.length, end + 1));
        if (pathLength(slice) >= 350) {
          const ring = clipRing(ribbon(slice, halfMeters));
          if (ring.length > 4) waters.push({ outer: ring, holes: [] });
        }
        if (end >= part.length - 1) break;
        start = end - 1;
      }
    }
  }
  return waters;
}

function asWays(elements) {
  const ways = [];
  for (const element of elements || []) {
    if (element.geometry?.length > 1) ways.push({ geometry: element.geometry });
    for (const member of element.members || []) {
      if (member.geometry?.length > 1) ways.push({ geometry: member.geometry });
    }
  }
  return ways;
}

function traceBody(elements, seeds, dryProbes, wetProbes, label) {
  const usable = seeds.filter(([lat, lon]) => onBoard({ lat, lon }));
  if (!elements.length || !usable.length) return [];
  const traced = traceWater({
    elements,
    lat0: BOARD.lat0,
    lat1: BOARD.lat1,
    lon0: BOARD.lon0,
    lon1: BOARD.lon1,
    cell: 40,
    seeds: usable,
    probes: [
      ...dryProbes.map(([name, lat, lon]) => [name, lat, lon, false]),
      ...wetProbes.map(([name, lat, lon]) => [name, lat, lon, true]),
    ],
    label,
  });
  if (traced.leaks?.length) return [];
  return traced.waters || [];
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

function runwaysFrom(data, identFor) {
  const runways = [];
  for (const way of data?.elements || []) {
    const geometry = way.geometry || [];
    if (geometry.length < 2) continue;
    const a = geometry[0];
    const b = geometry.at(-1);
    if (meters(a, b) < 900) continue;
    const raw = String(way.tags?.width || '');
    const parsed = parseFloat(raw);
    const metersWide = /ft|feet|'/i.test(raw) ? parsed * 0.3048 : parsed;
    runways.push({
      ident: identFor(a),
      w: Number.isFinite(metersWide) && metersWide >= 20 && metersWide <= 100 ? Math.round(metersWide) : 46,
      p: [[round(a.lat), round(a.lon)], [round(b.lat), round(b.lon)]],
    });
  }
  return runways;
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

function fieldFromRunways(runways) {
  const groups = new Map();
  for (const runway of runways) {
    if (!groups.has(runway.ident)) groups.set(runway.ident, []);
    groups.get(runway.ident).push(runway);
  }
  const fields = [];
  for (const group of groups.values()) {
    let points = group.flatMap((runway) => runway.p.map(([lat, lon]) => ({ lat, lon })));
    if (group.length === 1) {
      const [a, b] = group[0].p;
      const dx = (b[1] - a[1]) * M_LON;
      const dy = (b[0] - a[0]) * M_LAT;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const px = -uy;
      const py = ux;
      points = [];
      for (const [lat, lon, along] of [[a[0], a[1], -120], [b[0], b[1], 120]]) {
        for (const side of [-280, 280]) {
          points.push({
            lat: lat + ((uy * along) + (py * side)) / M_LAT,
            lon: lon + ((ux * along) + (px * side)) / M_LON,
          });
        }
      }
    }
    const hull = convexHull(points);
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

function finish(id, waters, dryProbes, wetProbes, roads, buildings, runways) {
  const safe = waters.filter((entry) => !dryProbes.some(([, lat, lon]) => covered([entry], lat, lon)));
  const leaks = [];
  for (const [name, lat, lon] of dryProbes) if (covered(safe, lat, lon)) leaks.push(`${name} water`);
  for (const [name, lat, lon] of wetProbes) if (!covered(safe, lat, lon)) leaks.push(`${name} land`);
  if (leaks.length) {
    console.log(`${id} leaks: ${leaks.join(', ')}`);
    throw new Error(`${id} shoreline did not hold`);
  }
  const coasts = safe.flatMap((entry) => [entry.outer, ...entry.holes]);
  const fields = fieldFromRunways(runways);
  const root = path.join(geoRoot, id);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'coasts.json'), JSON.stringify(coasts));
  fs.writeFileSync(path.join(root, 'waters.json'), JSON.stringify(safe));
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
  console.log(`${id} roads ${roads.length} (${Math.round(km / 1000)} km), buildings ${buildings.length} (max ${buildings[0]?.h || 0} m), runways ${runways.length}, fields ${fields.length}, waters ${safe.length}`);
}

function named(elements, nameRe) {
  return (elements || []).filter((element) => nameRe.test(element.tags?.name || ''));
}

function towers(file, marks) {
  const found = buildingsFrom(readJson(file), 42);
  const extra = marks.filter((mark) => !nearTower(found, mark.lat, mark.lon))
    .map((mark) => ({ h: mark.h, p: landmarkRing(mark.lat, mark.lon) }));
  return dedupeTowers([...extra, ...found]);
}

function dallas() {
  begin({ lat: 32.84, lon: -97 }, 72);
  KEEP_REFS = new Set(['I 35E', 'I 35W', 'I 30', 'I 20', 'I 635', 'I 820', 'I 45', 'US 75']);
  const water = readJson('/tmp/dal-geo/water.json').elements;
  const dry = [
    ['downtown', 32.781, -96.797],
    ['fort worth', 32.755, -97.331],
    ['dfw', 32.899, -97.04],
    ['love', 32.847, -96.852],
  ];
  const wet = [
    ['trinity', 32.7705, -96.8178],
    ['white rock', 32.837, -96.72],
    ['grapevine', 32.97, -97.06],
  ];
  const rivers = ribbonWaters(riverChains(water, /Trinity/i), 150);
  const lakes = [
    ...traceBody(asWays(named(water, /^White Rock Lake$/)), [[32.837, -96.72]], dry, [['white rock', 32.837, -96.72]], 'white rock'),
    ...traceBody(asWays(named(water, /^Mountain Creek Lake$/)), [[32.715, -96.966]], dry, [], 'mountain creek'),
    ...traceBody(asWays(named(water, /^Grapevine Lake$/)), [[32.97, -97.06]], dry, [['grapevine', 32.97, -97.06]], 'grapevine'),
    ...traceBody(asWays(named(water, /^Joe Pool Lake$/)), [[32.63, -97.0]], dry, [], 'joe pool'),
  ];
  finish(
    'dal',
    [...rivers, ...lakes],
    dry,
    wet,
    roadsFrom(readJson('/tmp/dal-geo/roads.json')),
    towers('/tmp/dal-geo/buildings.json', []),
    runwaysFrom(readJson('/tmp/dal-geo/runways.json'), (end) => (end.lon < -96.95 ? 'KDFW' : 'KDAL')),
  );
}

function atlanta() {
  begin({ lat: 33.72, lon: -84.4 }, 52);
  KEEP_REFS = new Set(['I 285', 'I 75', 'I 85', 'I 20', 'GA 400']);
  const water = readJson('/tmp/atl-geo/water.json').elements;
  const dry = [
    ['downtown', 33.749, -84.388],
    ['midtown', 33.781, -84.383],
    ['atl', 33.641, -84.428],
  ];
  const rivers = ribbonWaters(riverChains(water, /Chattahoochee/i), 140);
  finish(
    'atl',
    rivers,
    dry,
    [['chattahoochee', 33.8596, -84.4542]],
    roadsFrom(readJson('/tmp/atl-geo/roads.json')),
    towers('/tmp/atl-geo/buildings.json', []),
    runwaysFrom(readJson('/tmp/atl-geo/runways.json'), () => 'KATL'),
  );
}

function miami() {
  begin({ lat: 25.78, lon: -80.22 }, 40);
  KEEP_REFS = new Set(['I 95', 'I 75', 'I 195', 'I 395', 'US 1', 'SR 836 Toll', 'SR 112 Toll']);
  const water = readJson('/tmp/mia-geo/water.json').elements.filter((element) => element.tags?.natural === 'coastline');
  const dry = [
    ['downtown', 25.774, -80.189],
    ['brickell', 25.766, -80.191],
    ['beach', 25.79, -80.13],
    ['key biscayne', 25.694, -80.162],
    ['mia', 25.796, -80.287],
  ];
  const wet = [
    ['bay', 25.77, -80.18],
    ['atlantic', 25.8, -80.08],
  ];
  const traced = traceWater({
    elements: water,
    lat0: BOARD.lat0,
    lat1: BOARD.lat1,
    lon0: BOARD.lon0,
    lon1: BOARD.lon1,
    cell: 36,
    seeds: wet.map(([, lat, lon]) => [lat, lon]),
    probes: [
      ...dry.map(([name, lat, lon]) => [name, lat, lon, false]),
      ...wet.map(([name, lat, lon]) => [name, lat, lon, true]),
    ],
    label: 'miami',
  });
  if (traced.leaks?.length) throw new Error('miami shoreline did not hold');
  finish(
    'mia',
    traced.waters,
    dry,
    wet,
    roadsFrom(readJson('/tmp/mia-geo/roads.json')),
    towers('/tmp/mia-geo/buildings.json', []),
    runwaysFrom(readJson('/tmp/mia-geo/runways.json'), () => 'KMIA'),
  );
}

function boston() {
  begin({ lat: 42.355, lon: -71.085 }, 18);
  KEEP_REFS = new Set(['I 93', 'I 90', 'I 95', 'US 1']);
  const water = readJson('/tmp/bos-geo/water.json').elements;
  const dry = [
    ['downtown', 42.358, -71.057],
    ['back bay', 42.35, -71.081],
    ['cambridge', 42.373, -71.119],
    ['logan', 42.363, -71.01],
  ];
  const harborWet = [
    ['inner harbor', 42.353, -71.03],
  ];
  const coasts = water.filter((element) => element.tags?.natural === 'coastline');
  const traced = traceWater({
    elements: coasts,
    lat0: BOARD.lat0,
    lat1: BOARD.lat1,
    lon0: BOARD.lon0,
    lon1: BOARD.lon1,
    cell: 24,
    seeds: harborWet.map(([, lat, lon]) => [lat, lon]),
    probes: [
      ...dry.map(([name, lat, lon]) => [name, lat, lon, false]),
      ...harborWet.map(([name, lat, lon]) => [name, lat, lon, true]),
    ],
    label: 'boston',
  });
  if (traced.leaks?.length) throw new Error('boston shoreline did not hold');
  const charles = ribbonWaters(riverChains(water, /^Charles River$/), 90);
  const mystic = ribbonWaters(riverChains(water, /^Mystic River$/), 50);
  finish(
    'bos',
    [...traced.waters, ...charles, ...mystic],
    dry,
    [...harborWet, ['charles', 42.3601, -71.1166]],
    roadsFrom(readJson('/tmp/bos-geo/roads.json')),
    towers('/tmp/bos-geo/buildings.json', []),
    runwaysFrom(readJson('/tmp/bos-geo/runways.json'), () => 'KBOS'),
  );
}

function seattle() {
  begin({ lat: 47.54, lon: -122.32 }, 44);
  KEEP_REFS = new Set(['I 5', 'I 90', 'I 405', 'SR 99', 'SR 520', 'SR 518']);
  const water = readJson('/tmp/sea-geo/water.json').elements;
  const union = readJson('/tmp/sea-geo/union.json').elements;
  const dry = [
    ['downtown', 47.606, -122.332],
    ['capitol hill', 47.625, -122.321],
    ['bellevue', 47.61, -122.201],
    ['mercer', 47.571, -122.222],
    ['sea', 47.45, -122.309],
    ['bfi', 47.53, -122.302],
  ];
  const soundWet = [
    ['sound', 47.55, -122.45],
    ['elliott', 47.605, -122.36],
  ];
  const coasts = water.filter((element) => element.tags?.natural === 'coastline');
  const traced = traceWater({
    elements: coasts,
    lat0: BOARD.lat0,
    lat1: BOARD.lat1,
    lon0: BOARD.lon0,
    lon1: BOARD.lon1,
    cell: 36,
    seeds: soundWet.map(([, lat, lon]) => [lat, lon]),
    probes: [
      ...dry.map(([name, lat, lon]) => [name, lat, lon, false]),
      ...soundWet.map(([name, lat, lon]) => [name, lat, lon, true]),
    ],
    label: 'seattle',
  });
  if (traced.leaks?.length) throw new Error('seattle shoreline did not hold');
  const lake = traceBody(asWays(named(water, /^Lake Washington$/)), [[47.62, -122.25]], dry, [['lake', 47.62, -122.25]], 'lake washington');
  const lakeUnion = traceBody(asWays(union), [[47.64, -122.335]], dry, [['union', 47.64, -122.335]], 'lake union');
  finish(
    'sea',
    [...traced.waters, ...lake, ...lakeUnion],
    dry,
    [...soundWet, ['lake', 47.62, -122.25], ['union', 47.64, -122.335]],
    roadsFrom(readJson('/tmp/sea-geo/roads.json')),
    towers('/tmp/sea-geo/buildings.json', [{ h: 284, lat: 47.6045, lon: -122.3301 }]),
    runwaysFrom(readJson('/tmp/sea-geo/runways.json'), (end) => (end.lat > 47.5 ? 'KBFI' : 'KSEA')),
  );
}

dallas();
atlanta();
miami();
boston();
seattle();
