import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/geo/nyc');
const tmp = '/tmp/nyc-geo';
const KEEP_REFS = new Set([
  'I 95', 'I 278', 'I 78', 'I 495', 'I 678', 'I 87', 'I 280', 'I 295', 'I 80',
  'GSP', 'BP', 'GCP', 'FDR', 'HH', 'CI', 'HR', 'BR', 'JR', 'NJ 3', 'NJ 495', 'NY 440',
]);
const AIRPORTS = new Set(['KEWR', 'KJFK', 'KLGA']);

const WATERS = [
  [
    [40.702, -74.017],
    [40.73, -74.011],
    [40.76, -74.001],
    [40.8, -73.978],
    [40.85, -73.948],
    [40.85, -73.968],
    [40.8, -74.0],
    [40.76, -74.028],
    [40.73, -74.038],
    [40.702, -74.042],
  ],
  [
    [40.701, -74.013],
    [40.72, -73.986],
    [40.75, -73.97],
    [40.78, -73.942],
    [40.8, -73.928],
    [40.8, -73.948],
    [40.78, -73.958],
    [40.75, -73.986],
    [40.72, -74.002],
    [40.701, -74.02],
  ],
  [
    [40.698, -74.04],
    [40.698, -74.016],
    [40.66, -74.04],
    [40.62, -74.055],
    [40.6, -74.03],
    [40.63, -73.97],
    [40.67, -74.01],
  ],
  [
    [40.64, -74.15],
    [40.64, -74.09],
    [40.7, -74.075],
    [40.73, -74.11],
    [40.71, -74.155],
  ],
  [
    [40.618, -73.89],
    [40.575, -73.87],
    [40.555, -73.8],
    [40.575, -73.74],
    [40.62, -73.75],
    [40.624, -73.84],
  ],
  [
    [40.786, -73.89],
    [40.805, -73.87],
    [40.808, -73.845],
    [40.786, -73.84],
    [40.778, -73.87],
  ],
];

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
  const dLon = (b.lon - a.lon) * 84400;
  return Math.hypot(dLat, dLon);
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

function pathLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += meters(points[i - 1], points[i]);
  return length;
}

function endpointKey(point) {
  return `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`;
}

function coastsFrom(data) {
  const pieces = [];
  for (const way of data?.elements || []) {
    const points = (way.geometry || []).map((point) => ({ lat: point.lat, lon: point.lon }));
    if (points.length < 2) continue;
    const length = pathLength(points);
    if (length < 280) continue;
    const closed = endpointKey(points[0]) === endpointKey(points.at(-1));
    pieces.push({ points, length, closed });
  }

  const open = pieces.filter((piece) => !piece.closed);
  const byEnd = new Map();
  for (const piece of open) {
    for (const end of [endpointKey(piece.points[0]), endpointKey(piece.points.at(-1))]) {
      if (!byEnd.has(end)) byEnd.set(end, []);
      byEnd.get(end).push(piece);
    }
  }

  const used = new Set();
  const chains = [];
  for (const piece of open) {
    if (used.has(piece)) continue;
    used.add(piece);
    let points = piece.points.slice();
    let grew = true;
    while (grew) {
      grew = false;
      for (const atStart of [false, true]) {
        const tip = atStart ? points[0] : points.at(-1);
        const next = (byEnd.get(endpointKey(tip)) || [])
          .filter((candidate) => !used.has(candidate))
          .sort((a, b) => b.length - a.length)[0];
        if (!next) continue;
        used.add(next);
        let extra = next.points.slice();
        if (endpointKey(extra[0]) !== endpointKey(tip)) extra.reverse();
        points = atStart ? extra.slice(0, -1).concat(points) : points.concat(extra.slice(1));
        grew = true;
      }
    }
    if (pathLength(points) >= 700) chains.push(points);
  }

  for (const piece of pieces) {
    if (piece.closed && piece.length >= 800) chains.push(piece.points);
  }

  return chains
    .map((points) => thin(points, 28))
    .filter((points) => points.length > 1)
    .map((points) => points.map((point) => [round(point.lat), round(point.lon)]));
}

function ringAreaKm(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += (a.lon * 84400) * (b.lat * 111320) - (b.lon * 84400) * (a.lat * 111320);
  }
  return Math.abs(sum) / 2 / 1e6;
}

function watersFrom(data) {
  const rings = [];
  for (const way of data?.elements || []) {
    const points = (way.geometry || []).map((point) => ({ lat: point.lat, lon: point.lon }));
    if (points.length < 4) continue;
    if (endpointKey(points[0]) !== endpointKey(points.at(-1))) continue;
    const area = ringAreaKm(points);
    if (area < 0.12 || area > 80) continue;
    const simplified = thin(points, 32);
    if (simplified.length < 4) continue;
    rings.push(simplified.map((point) => [round(point.lat), round(point.lon)]));
  }
  return rings;
}

function traceShore(data) {
  const empty = { coasts: [], waters: [] };
  const ways = [];
  for (const way of data?.elements || []) {
    const points = (way.geometry || []).map((point) => ({ lat: point.lat, lon: point.lon }));
    if (points.length >= 2) ways.push(points);
  }
  if (!ways.length) return empty;

  const lat0 = 40.48;
  const lat1 = 40.92;
  const lon0 = -74.29;
  const lon1 = -73.72;
  const cell = 20;
  const dLat = cell / 111320;
  const dLon = cell / 84400;
  const cols = Math.ceil((lon1 - lon0) / dLon);
  const rows = Math.ceil((lat1 - lat0) / dLat);
  const mask = new Uint8Array(cols * rows);
  const at = (i, j) => j * cols + i;
  const plot = (i, j) => {
    if (i < 0 || j < 0 || i >= cols || j >= rows) return;
    mask[at(i, j)] = 1;
  };
  const toCell = (lat, lon) => [
    Math.round((lon - lon0) / dLon),
    Math.round((lat - lat0) / dLat),
  ];
  const stroke = (points) => {
    for (let i = 1; i < points.length; i += 1) {
      const [x0, y0] = toCell(points[i - 1].lat, points[i - 1].lon);
      const [x1, y1] = toCell(points[i].lat, points[i].lon);
      drawLine(x0, y0, x1, y1, plot);
    }
  };
  for (const points of ways) stroke(points);
  for (const points of sealChains(ways, lat0, lat1, lon0, lon1)) stroke(points);
  const barrier = mask.slice();
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      if (mask[at(i, j)] !== 1) continue;
      if (i > 0 && mask[at(i - 1, j)] === 0) barrier[at(i - 1, j)] = 1;
      if (i + 1 < cols && mask[at(i + 1, j)] === 0) barrier[at(i + 1, j)] = 1;
      if (j > 0 && mask[at(i, j - 1)] === 0) barrier[at(i, j - 1)] = 1;
      if (j + 1 < rows && mask[at(i, j + 1)] === 0) barrier[at(i, j + 1)] = 1;
    }
  }
  barrier.forEach((value, index) => {
    mask[index] = value;
  });

  const floodFrom = (lat, lon) => {
    const [seedI, seedJ] = toCell(lat, lon);
    if (seedI < 0 || seedJ < 0 || seedI >= cols || seedJ >= rows || mask[at(seedI, seedJ)] !== 0) return 0;
    const stack = [seedI, seedJ];
    const queued = new Uint8Array(cols * rows);
    queued[at(seedI, seedJ)] = 1;
    let filled = 0;
    for (let n = 0; n < stack.length; n += 2) {
      const i = stack[n];
      const j = stack[n + 1];
      mask[at(i, j)] = 2;
      filled += 1;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = i + di;
        const y = j + dj;
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        const index = at(x, y);
        if (mask[index] !== 0 || queued[index]) continue;
        queued[index] = 1;
        stack.push(x, y);
      }
    }
    return filled;
  };
  floodFrom(40.75, -74.015);

  const probes = [
    ['hudson', 40.75, -74.015, true],
    ['east river', 40.735, -73.973, true],
    ['east lower', 40.708, -73.99, true],
    ['jamaica', 40.6, -73.83, true],
    ['newark bay', 40.67, -74.14, true],
    ['flushing', 40.78, -73.855, true],
    ['upper bay', 40.66, -74.04, true],
    ['empire', 40.7484, -73.9857, false],
    ['ewr', 40.6895, -74.1745, false],
    ['jfk', 40.6413, -73.7781, false],
    ['lga', 40.7772, -73.8726, false],
    ['lga field', 40.774, -73.885, false],
    ['jersey', 40.717, -74.043, false],
    ['roosevelt', 40.762, -73.95, false],
    ['governors', 40.69, -74.016, false],
    ['brooklyn', 40.693, -73.987, false],
  ];
  const leaks = [];
  for (const [name, lat, lon, expectWater] of probes) {
    const [i, j] = toCell(lat, lon);
    const wet = i >= 0 && j >= 0 && i < cols && j < rows && mask[at(i, j)] === 2;
    if (wet !== expectWater) leaks.push(`${name} ${wet ? 'water' : 'land'}`);
  }
  if (leaks.length) console.log(`shore leaks: ${leaks.join(', ')}`);

  const loops = boundaryLoops(mask, cols, rows);
  const rings = loops.map((loop) => thin(loop.map(([x, y]) => ({
    lat: lat0 + y * dLat,
    lon: lon0 + x * dLon,
  })), 24)).filter((points) => points.length >= 4 && ringAreaKm(points) >= 0.03);

  const outers = [];
  const pending = rings.map((points) => ({
    points,
    area: ringAreaKm(points),
    center: points.reduce((sum, point) => ({
      lat: sum.lat + point.lat / points.length,
      lon: sum.lon + point.lon / points.length,
    }), { lat: 0, lon: 0 }),
  })).sort((a, b) => b.area - a.area);

  for (const ring of pending) {
    const parent = outers.find((outer) => contains(outer.points, ring.center));
    if (!parent) {
      outers.push({ points: ring.points, holes: [] });
      continue;
    }
    if (parent.holes.some((hole) => contains(hole, ring.center))) continue;
    parent.holes.push(ring.points);
  }

  const waters = outers
    .filter((outer) => ringAreaKm(outer.points) >= 0.2)
    .map((outer) => ({
      outer: outer.points.map((point) => [round(point.lat), round(point.lon)]),
      holes: outer.holes.map((hole) => hole.map((point) => [round(point.lat), round(point.lon)])),
    }));
  const coasts = [];
  for (const water of waters) {
    coasts.push(water.outer);
    coasts.push(...water.holes);
  }
  return { coasts, waters };
}

function sealChains(ways, lat0, lat1, lon0, lon1) {
  const key = (point) => `${point.lon.toFixed(4)},${point.lat.toFixed(4)}`;
  const byStart = new Map();
  for (const points of ways) {
    const start = key(points[0]);
    if (!byStart.has(start)) byStart.set(start, []);
    byStart.get(start).push(points);
  }
  const used = new Set();
  const extra = [];
  for (const points of ways) {
    if (used.has(points)) continue;
    const chain = [...points];
    used.add(points);
    let current = points;
    for (;;) {
      const next = (byStart.get(key(current.at(-1))) || []).find((candidate) => !used.has(candidate));
      if (!next) break;
      used.add(next);
      chain.push(...next.slice(1));
      current = next;
    }
    if (key(chain[0]) === key(chain.at(-1))) continue;
    extra.push(extendToBorder(chain[0], lat0, lat1, lon0, lon1));
    extra.push(extendToBorder(chain.at(-1), lat0, lat1, lon0, lon1));
  }
  return extra.filter((points) => points.length > 1);
}

function extendToBorder(end, lat0, lat1, lon0, lon1) {
  if (end.lat <= lat0 || end.lat >= lat1 || end.lon <= lon0 || end.lon >= lon1) return [end];
  const options = [
    { lat: lat0, lon: end.lon, meters: (end.lat - lat0) * 111320 },
    { lat: lat1, lon: end.lon, meters: (lat1 - end.lat) * 111320 },
    { lat: end.lat, lon: lon0, meters: (end.lon - lon0) * 84400 },
    { lat: end.lat, lon: lon1, meters: (lon1 - end.lon) * 84400 },
  ].sort((a, b) => a.meters - b.meters);
  if (options[0].meters > 8000) return [end];
  return [end, { lat: options[0].lat, lon: options[0].lon }];
}

function drawLine(x0, y0, x1, y1, plot) {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  plot(x, y);
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    const stepX = e2 >= dy;
    const stepY = e2 <= dx;
    if (stepX) {
      err += dy;
      x += sx;
    }
    if (stepY) {
      err += dx;
      y += sy;
    }
    if (stepX && stepY) plot(x - sx, y);
    plot(x, y);
  }
}

function boundaryLoops(mask, cols, rows) {
  const wet = (i, j) => i >= 0 && j >= 0 && i < cols && j < rows && mask[j * cols + i] === 2;
  const adj = new Map();
  const add = (ax, ay, bx, by) => {
    const a = `${ax},${ay}`;
    const b = `${bx},${by}`;
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  };
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      if (!wet(i, j)) continue;
      if (!wet(i - 1, j)) add(i, j, i, j + 1);
      if (!wet(i + 1, j)) add(i + 1, j, i + 1, j + 1);
      if (!wet(i, j - 1)) add(i, j, i + 1, j);
      if (!wet(i, j + 1)) add(i, j + 1, i + 1, j + 1);
    }
  }
  const used = new Set();
  const loops = [];
  for (const [start, neighbors] of adj) {
    for (const next of neighbors) {
      const firstStep = `${start}>${next}`;
      if (used.has(firstStep)) continue;
      const loop = [start.split(',').map(Number)];
      used.add(firstStep);
      let prev = start;
      let cur = next;
      let guard = 0;
      while (cur !== start && guard < adj.size + 2) {
        guard += 1;
        loop.push(cur.split(',').map(Number));
        const options = (adj.get(cur) || []).filter((candidate) => !used.has(`${cur}>${candidate}`));
        if (!options.length) break;
        const choice = options.find((candidate) => candidate !== prev) || options[0];
        used.add(`${cur}>${choice}`);
        prev = cur;
        cur = choice;
      }
      if (cur === start && loop.length >= 4) {
        loops.push(loop);
        for (let k = 0; k < loop.length; k += 1) {
          const a = loop[k].join(',');
          const b = loop[(k + 1) % loop.length].join(',');
          used.add(`${b}>${a}`);
        }
      }
    }
  }
  return loops;
}

function contains(ring, point) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const intersect = ((a.lat > point.lat) !== (b.lat > point.lat))
      && (point.lon < ((b.lon - a.lon) * (point.lat - a.lat)) / ((b.lat - a.lat) || 1e-12) + a.lon);
    if (intersect) inside = !inside;
  }
  return inside;
}

function roadsFrom(data) {
  const byRef = new Map();
  for (const way of data?.elements || []) {
    const primary = (way.tags?.ref || '').split(';')[0].trim();
    if (!KEEP_REFS.has(primary)) continue;
    const points = (way.geometry || []).map((point) => ({ lat: point.lat, lon: point.lon }));
    if (points.length < 2) continue;
    if (!byRef.has(primary)) byRef.set(primary, []);
    byRef.get(primary).push(points);
  }
  const lines = [];
  for (const pieces of byRef.values()) {
    for (const chain of joinRoute(pieces)) {
      const points = thin(chain, 55);
      if (points.length < 2) continue;
      lines.push(points.map((point) => [round(point.lat), round(point.lon)]));
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
  return Math.atan2((b.lon - a.lon) * 84400, (b.lat - a.lat) * 111320);
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
  const merged = mergeAligned(chains);
  return merged.filter((chain) => pathLength(chain) >= 1600);
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
    if (!height || height < minHeight || height > 600) continue;
    const ring = (way.geometry || []).map((point) => [round(point.lon), round(point.lat)]);
    if (ring.length < 4) continue;
    towers.push({ h: Math.round(height), p: ring });
  }
  return towers;
}

const LANDMARKS = [
  [40.7168, -74.0334, 271],
  [40.7146, -74.0332, 238],
  [40.6906, -73.9824, 325],
  [40.7471, -73.9444, 206],
  [40.7506, -73.9376, 237],
];

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

function towerCenter(tower) {
  const lon = tower.p.reduce((sum, point) => sum + point[0], 0) / tower.p.length;
  const lat = tower.p.reduce((sum, point) => sum + point[1], 0) / tower.p.length;
  return { lat, lon };
}

function landmarksMissingFrom(towers) {
  return LANDMARKS.filter(([lat, lon]) => !towers.some((tower) => {
    const center = towerCenter(tower);
    return meters(center, { lat, lon }) < 120;
  })).map(([lat, lon, height]) => ({ h: height, p: landmarkRing(lat, lon) }));
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
  return unique.slice(0, 1000);
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

const traced = traceShore(readJson('coast.json'));
const coasts = traced.coasts.length ? traced.coasts : coastsFrom(readJson('coast.json'));
const waters = traced.waters.length ? traced.waters : WATERS;
const roadLines = roadsFrom(readJson('roads.json'));
const surveyed = dedupeTowers([
  ...buildingsFrom(readJson('buildings.json'), 60),
  ...buildingsFrom(readJson('buildings-gap.json'), 60),
  ...buildingsFrom(readJson('buildings-jersey.json'), 55),
  ...buildingsFrom(readJson('buildings-battery.json'), 55),
  ...buildingsFrom(readJson('buildings-east.json'), 60),
  ...buildingsFrom(readJson('buildings-brooklyn.json'), 55),
  ...buildingsFrom(readJson('buildings-williamsburg.json'), 50),
  ...buildingsFrom(readJson('buildings-lic.json'), 50),
  ...buildingsFrom(readJson('buildings-hoboken.json'), 50),
]);
const towers = dedupeTowers([...surveyed, ...landmarksMissingFrom(surveyed)]);
const runwayCsv = fs.existsSync(path.join(tmp, 'runways.csv'))
  ? fs.readFileSync(path.join(tmp, 'runways.csv'), 'utf8')
  : '';
const runways = runwayCsv ? runwaysFromCsv(runwayCsv) : [];
const fields = fieldFromRunways(runways);

fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'coasts.json'), JSON.stringify(coasts));
fs.writeFileSync(path.join(root, 'waters.json'), JSON.stringify(waters));
fs.writeFileSync(path.join(root, 'roads.json'), JSON.stringify(roadLines));
fs.writeFileSync(path.join(root, 'buildings.json'), JSON.stringify(towers));
fs.writeFileSync(path.join(root, 'airports.json'), JSON.stringify({
  fields,
  runways: runways.map(({ w, p }) => ({ w, p })),
}));
console.log(`coasts ${coasts.length}, waters ${waters.length}, roads ${roadLines.length}, buildings ${towers.length}, runways ${runways.length}, fields ${fields.length}`);
