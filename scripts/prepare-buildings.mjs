import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const source = process.argv[2] || '/tmp/chi-geo/buildings.json';
const raw = JSON.parse(fs.readFileSync(source, 'utf8'));
const METERS_PER_STORY = 3.7;
const EPSILON = 0.00011;

function distanceToSegment(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  return Math.abs((point[0] - a[0]) * dy - (point[1] - a[1]) * dx) / length;
}

function simplify(points, epsilon) {
  if (points.length < 3) return points;
  let maxDistance = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = distanceToSegment(points[i], points[0], points[points.length - 1]);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance <= epsilon) return [points[0], points[points.length - 1]];
  const left = simplify(points.slice(0, index + 1), epsilon);
  const right = simplify(points.slice(index), epsilon);
  return left.slice(0, -1).concat(right);
}

function round(value) {
  return Math.round(value * 1e5) / 1e5;
}

const buildings = [];
for (const record of raw) {
  const stories = Number(record.stories);
  if (!Number.isFinite(stories) || stories < 15) continue;
  const ring = record.the_geom?.coordinates?.[0]?.[0];
  if (!ring || ring.length < 4) continue;
  const open = ring.slice(0, -1).map(([lon, lat]) => [lon, lat]);
  const simplified = simplify(open, EPSILON).map(([lon, lat]) => [round(lon), round(lat)]);
  if (simplified.length < 3) continue;
  buildings.push({
    h: Math.round(stories * METERS_PER_STORY),
    p: simplified,
  });
}

buildings.sort((a, b) => b.h - a.h);
const target = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/geo/buildings.json');
fs.writeFileSync(target, JSON.stringify(buildings));
console.log(`wrote ${buildings.length} buildings`);
