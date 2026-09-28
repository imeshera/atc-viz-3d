export const METERS_PER_UNIT = 500;
export const HEIGHT_SCALE = 8;
export const ORD = { lat: 41.9786, lon: -87.9048 };

const METERS_PER_DEG_LAT = 111320;

function originOf(anchor) {
  return anchor.origin || ORD;
}

function metersPerDegLon(origin) {
  return METERS_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
}

export function project(lat, lon, anchor) {
  const origin = originOf(anchor);
  return {
    x: anchor.x + ((lon - origin.lon) * metersPerDegLon(origin)) / METERS_PER_UNIT,
    z: anchor.z + ((origin.lat - lat) * METERS_PER_DEG_LAT) / METERS_PER_UNIT,
  };
}

const FEET_PER_METER = 3.280839895;
const KNOTS_PER_MPS = 1.943844;

export function heightUnits(meters) {
  return (meters * HEIGHT_SCALE) / METERS_PER_UNIT;
}

export function metersToFeet(meters) {
  return meters * FEET_PER_METER;
}

export function metersPerSecondToKnots(mps) {
  return mps * KNOTS_PER_MPS;
}

export function visualAltitude(meters) {
  const feet = Math.max(0, meters) * FEET_PER_METER;
  const floorY = 0.4;
  const patternFeet = 8000;
  const patternY = 28;
  const ceilingFeet = 45000;
  const ceilingY = 40;
  if (feet <= patternFeet) {
    return floorY + (feet / patternFeet) * (patternY - floorY);
  }
  const t = Math.min((feet - patternFeet) / (ceilingFeet - patternFeet), 1);
  return patternY + (1 - (1 - t) ** 0.85) * (ceilingY - patternY);
}

export function unproject(x, z, anchor) {
  const origin = originOf(anchor);
  return {
    lat: origin.lat - ((z - anchor.z) * METERS_PER_UNIT) / METERS_PER_DEG_LAT,
    lon: origin.lon + ((x - anchor.x) * METERS_PER_UNIT) / metersPerDegLon(origin),
  };
}

export function boardBox(anchor, half) {
  const southWest = unproject(-half, half, anchor);
  const northEast = unproject(half, -half, anchor);
  return {
    lamin: southWest.lat,
    lomin: southWest.lon,
    lamax: northEast.lat,
    lomax: northEast.lon,
  };
}

export function shoreXAt(points, z) {
  if (points.length < 2) return null;
  if (z <= points[0].z) {
    return extrapolate(points[0], points[1], z);
  }
  const last = points.length - 1;
  if (z >= points[last].z) {
    return extrapolate(points[last - 1], points[last], z);
  }
  for (let i = 0; i < last; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (z < a.z || z > b.z) continue;
    const span = b.z - a.z || 1;
    return a.x + ((z - a.z) / span) * (b.x - a.x);
  }
  return points[last].x;
}

function extrapolate(a, b, z) {
  const span = b.z - a.z || 1;
  return a.x + ((z - a.z) / span) * (b.x - a.x);
}

export function clipPolyline(points, half) {
  const chains = [];
  let chain = [];

  for (let i = 0; i < points.length - 1; i += 1) {
    const segment = clipSegment(points[i], points[i + 1], half);
    if (!segment) {
      if (chain.length) chains.push(chain);
      chain = [];
      continue;
    }
    const gap = chain.length
      && Math.hypot(chain[chain.length - 1].x - segment[0].x, chain[chain.length - 1].z - segment[0].z) > 0.05;
    if (!chain.length || gap) {
      if (chain.length) chains.push(chain);
      chain = [segment[0]];
    }
    chain.push(segment[1]);
  }

  if (chain.length) chains.push(chain);
  return chains;
}

function clipSegment(a, b, half) {
  const minX = -half;
  const maxX = half;
  const minZ = -half;
  const maxZ = half;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const edges = [
    [-dx, a.x - minX],
    [dx, maxX - a.x],
    [-dz, a.z - minZ],
    [dz, maxZ - a.z],
  ];

  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }

  return [
    { x: a.x + t0 * dx, z: a.z + t0 * dz },
    { x: a.x + t1 * dx, z: a.z + t1 * dz },
  ];
}
