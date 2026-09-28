import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const runwaysFile = '/tmp/chi-geo/airports.json';
const boundaries = ['/tmp/chi-geo/ord-boundary.json', '/tmp/chi-geo/mdw-boundary.json'];

function keyOf(lat, lon) {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

function stitch(ways) {
  const unused = ways
    .filter((way) => way.geometry && way.geometry.length > 1)
    .map((way) => way.geometry.map((point) => [point.lat, point.lon]));
  const rings = [];

  while (unused.length) {
    let chain = unused.pop();
    for (let guard = 0; guard < 500; guard += 1) {
      const endKey = keyOf(chain.at(-1)[0], chain.at(-1)[1]);
      const startKey = keyOf(chain[0][0], chain[0][1]);
      if (endKey === startKey && chain.length > 3) break;

      let found = -1;
      let reverse = false;
      let attachStart = false;
      for (let i = 0; i < unused.length; i += 1) {
        const next = unused[i];
        const head = keyOf(next[0][0], next[0][1]);
        const tail = keyOf(next.at(-1)[0], next.at(-1)[1]);
        if (head === endKey) { found = i; break; }
        if (tail === endKey) { found = i; reverse = true; break; }
        if (tail === startKey) { found = i; attachStart = true; break; }
        if (head === startKey) { found = i; reverse = true; attachStart = true; break; }
      }
      if (found < 0) break;
      let next = unused.splice(found, 1)[0];
      if (reverse) next = next.slice().reverse();
      chain = attachStart ? next.slice(0, -1).concat(chain) : chain.concat(next.slice(1));
    }
    if (chain.length > 40) rings.push(chain);
  }
  return rings;
}

function lengthMeters(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dLat = (points[i].lat - points[i - 1].lat) * 111320;
    const dLon = (points[i].lon - points[i - 1].lon) * 83000;
    total += Math.hypot(dLat, dLon);
  }
  return total;
}

function normRef(ref) {
  return ref.toUpperCase().replace(/\s+/g, '').replace(/0+(\d)/g, '$1');
}

function round(value) {
  return Math.round(value * 1e5) / 1e5;
}

const runwaySource = JSON.parse(fs.readFileSync(runwaysFile, 'utf8'));
const kept = [];
for (const way of runwaySource.elements || []) {
  const ref = way.tags?.ref;
  if (!ref || !ref.includes('/')) continue;
  const geometry = (way.geometry || []).map((point) => ({ lat: point.lat, lon: point.lon }));
  const length = lengthMeters(geometry);
  if (length < 800) continue;
  const width = Number(way.tags.width) || 45.7;
  const mid = geometry[Math.floor(geometry.length / 2)];
  const duplicate = kept.find((runway) => {
    if (runway.ref !== normRef(ref)) return false;
    const other = runway.p[Math.floor(runway.p.length / 2)];
    return Math.hypot((other[0] - mid.lat) * 111320, (other[1] - mid.lon) * 83000) < 1500;
  });
  const packed = {
    ref: normRef(ref),
    w: Math.round(width),
    p: geometry.map((point) => [round(point.lat), round(point.lon)]),
    length,
  };
  if (!duplicate) kept.push(packed);
  else if (length > duplicate.length) Object.assign(duplicate, packed);
}

const fields = [];
for (const file of boundaries) {
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const ring of stitch(data.elements || [])) {
    fields.push(ring.map(([lat, lon]) => [round(lat), round(lon)]));
  }
}

const payload = {
  fields,
  runways: kept.map(({ w, p }) => ({ w, p })),
};
const target = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/geo/airports.json');
fs.writeFileSync(target, JSON.stringify(payload));
console.log(`fields ${fields.length} (${fields.map((ring) => ring.length).join(', ')} pts), runways ${payload.runways.length}`);
