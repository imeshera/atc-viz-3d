const METERS_PER_DEG_LAT = 111320;

function round(value) {
  return Math.round(value * 1e5) / 1e5;
}

function meters(a, b, metersPerDegLon) {
  return Math.hypot((b.lat - a.lat) * METERS_PER_DEG_LAT, (b.lon - a.lon) * metersPerDegLon);
}

function pathLength(points, metersPerDegLon) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += meters(points[i - 1], points[i], metersPerDegLon);
  return length;
}

function thin(points, spacing, metersPerDegLon) {
  if (points.length < 2) return [];
  const kept = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const last = i === points.length - 1;
    if (last || meters(kept[kept.length - 1], points[i], metersPerDegLon) >= spacing) kept.push(points[i]);
  }
  return kept.length > 1 ? kept : [];
}

function ringAreaKm(points, metersPerDegLon) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    area += (points[j].lon * metersPerDegLon) * (points[i].lat * METERS_PER_DEG_LAT);
    area -= (points[i].lon * metersPerDegLon) * (points[j].lat * METERS_PER_DEG_LAT);
  }
  return Math.abs(area) / 2 / 1e6;
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

function sealChains(ways, lat0, lat1, lon0, lon1) {
  const key = (point) => `${point.lon.toFixed(4)},${point.lat.toFixed(4)}`;
  const items = ways.map((points) => ({ points, used: false }));
  const at = new Map();
  const add = (id, item) => {
    if (!at.has(id)) at.set(id, []);
    at.get(id).push(item);
  };
  for (const item of items) {
    add(key(item.points[0]), item);
    add(key(item.points.at(-1)), item);
  }
  const extra = [];
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
    if (key(chain[0]) === key(chain.at(-1))) continue;
    extra.push(extendToBorder(chain[0], lat0, lat1, lon0, lon1));
    extra.push(extendToBorder(chain.at(-1), lat0, lat1, lon0, lon1));
  }
  return extra.filter((points) => points.length > 1);
}

function extendToBorder(end, lat0, lat1, lon0, lon1) {
  if (end.lat <= lat0 || end.lat >= lat1 || end.lon <= lon0 || end.lon >= lon1) return [end];
  const options = [
    { lat: lat0, lon: end.lon, meters: (end.lat - lat0) * METERS_PER_DEG_LAT },
    { lat: lat1, lon: end.lon, meters: (lat1 - end.lat) * METERS_PER_DEG_LAT },
    { lat: end.lat, lon: lon0, meters: (end.lon - lon0) * 84000 },
    { lat: end.lat, lon: lon1, meters: (lon1 - end.lon) * 84000 },
  ].sort((a, b) => a.meters - b.meters);
  if (options[0].meters > 8000) return [end];
  return [end, { lat: options[0].lat, lon: options[0].lon }];
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

export function traceWater({
  elements,
  lat0,
  lat1,
  lon0,
  lon1,
  cell = 22,
  seeds,
  probes = [],
  label = 'water',
}) {
  const empty = { coasts: [], waters: [] };
  const ways = [];
  for (const way of elements || []) {
    const points = (way.geometry || []).map((point) => ({ lat: point.lat, lon: point.lon }));
    if (points.length >= 2) ways.push(points);
  }
  if (!ways.length) return empty;

  const midLat = (lat0 + lat1) / 2;
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  const dLat = cell / METERS_PER_DEG_LAT;
  const dLon = cell / metersPerDegLon;
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
    if (seedI < 0 || seedJ < 0 || seedI >= cols || seedJ >= rows || mask[at(seedI, seedJ)] !== 0) return;
    const stack = [seedI, seedJ];
    const queued = new Uint8Array(cols * rows);
    queued[at(seedI, seedJ)] = 1;
    for (let n = 0; n < stack.length; n += 2) {
      const i = stack[n];
      const j = stack[n + 1];
      mask[at(i, j)] = 2;
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
  };
  for (const [lat, lon] of seeds) floodFrom(lat, lon);

  const leaks = [];
  for (const [name, lat, lon, expectWater] of probes) {
    const [i, j] = toCell(lat, lon);
    const wet = i >= 0 && j >= 0 && i < cols && j < rows && mask[at(i, j)] === 2;
    if (wet !== expectWater) leaks.push(`${name} ${wet ? 'water' : 'land'}`);
  }
  if (leaks.length) console.log(`${label} leaks: ${leaks.join(', ')}`);

  const loops = boundaryLoops(mask, cols, rows);
  const rings = loops.map((loop) => thin(loop.map(([x, y]) => ({
    lat: lat0 + y * dLat,
    lon: lon0 + x * dLon,
  })), Math.max(24, cell), metersPerDegLon)).filter((points) => points.length >= 4 && ringAreaKm(points, metersPerDegLon) >= 0.03);

  const outers = [];
  const pending = rings.map((points) => ({
    points,
    area: ringAreaKm(points, metersPerDegLon),
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
    .filter((outer) => ringAreaKm(outer.points, metersPerDegLon) >= 0.2)
    .map((outer) => ({
      outer: outer.points.map((point) => [round(point.lat), round(point.lon)]),
      holes: outer.holes.map((hole) => hole.map((point) => [round(point.lat), round(point.lon)])),
    }));
  const coasts = [];
  for (const water of waters) {
    coasts.push(water.outer);
    coasts.push(...water.holes);
  }
  console.log(`${label} grid ${cols}x${rows} coasts ${coasts.length} waters ${waters.length} leaks ${leaks.length}`);
  return { coasts, waters, leaks };
}

export function riverLines(elements, metersPerDegLon) {
  const pieces = [];
  for (const way of elements || []) {
    if (way.tags?.waterway !== 'river') continue;
    const points = (way.geometry || []).map((point) => ({ lat: point.lat, lon: point.lon }));
    if (points.length >= 2) pieces.push(points);
  }
  const key = (point) => `${point.lon.toFixed(4)},${point.lat.toFixed(4)}`;
  const byStart = new Map();
  for (const points of pieces) {
    const start = key(points[0]);
    if (!byStart.has(start)) byStart.set(start, []);
    byStart.get(start).push(points);
  }
  const used = new Set();
  const lines = [];
  for (const points of pieces) {
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
    if (pathLength(chain, metersPerDegLon) < 700) continue;
    const thinned = thin(chain, 40, metersPerDegLon);
    if (thinned.length >= 2) lines.push(thinned.map((point) => [round(point.lat), round(point.lon)]));
  }
  return lines;
}
