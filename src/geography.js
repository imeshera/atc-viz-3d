import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import riverLatLon from './geo/river.json';
import roadsLatLon from './geo/roads.json';
import airports from './geo/airports.json';
import buildings from './geo/buildings.json';
import chicagoCoasts from './geo/coasts.json';
import chicagoWaters from './geo/waters.json';
import laxCoasts from './geo/lax/coasts.json';
import laxWaters from './geo/lax/waters.json';
import laxRoadsLatLon from './geo/lax/roads.json';
import laxAirports from './geo/lax/airports.json';
import laxBuildings from './geo/lax/buildings.json';
import nycCoasts from './geo/nyc/coasts.json';
import nycWaters from './geo/nyc/waters.json';
import nycRoads from './geo/nyc/roads.json';
import nycAirports from './geo/nyc/airports.json';
import nycBuildings from './geo/nyc/buildings.json';
import dcCoasts from './geo/dc/coasts.json';
import dcWaters from './geo/dc/waters.json';
import dcRoads from './geo/dc/roads.json';
import dcAirports from './geo/dc/airports.json';
import dcBuildings from './geo/dc/buildings.json';
import phlCoasts from './geo/phl/coasts.json';
import phlWaters from './geo/phl/waters.json';
import phlRoads from './geo/phl/roads.json';
import phlAirports from './geo/phl/airports.json';
import phlBuildings from './geo/phl/buildings.json';
import sfCoasts from './geo/sf/coasts.json';
import sfWaters from './geo/sf/waters.json';
import sfRoads from './geo/sf/roads.json';
import sfAirports from './geo/sf/airports.json';
import sfBuildings from './geo/sf/buildings.json';
import bosCoasts from './geo/bos/coasts.json';
import bosWaters from './geo/bos/waters.json';
import bosRoads from './geo/bos/roads.json';
import bosAirports from './geo/bos/airports.json';
import bosBuildings from './geo/bos/buildings.json';
import atlCoasts from './geo/atl/coasts.json';
import atlWaters from './geo/atl/waters.json';
import atlRoads from './geo/atl/roads.json';
import atlAirports from './geo/atl/airports.json';
import atlBuildings from './geo/atl/buildings.json';
import miaCoasts from './geo/mia/coasts.json';
import miaWaters from './geo/mia/waters.json';
import miaRoads from './geo/mia/roads.json';
import miaAirports from './geo/mia/airports.json';
import miaBuildings from './geo/mia/buildings.json';
import dalCoasts from './geo/dal/coasts.json';
import dalWaters from './geo/dal/waters.json';
import dalRoads from './geo/dal/roads.json';
import dalAirports from './geo/dal/airports.json';
import dalBuildings from './geo/dal/buildings.json';
import seaCoasts from './geo/sea/coasts.json';
import seaWaters from './geo/sea/waters.json';
import seaRoads from './geo/sea/roads.json';
import seaAirports from './geo/sea/airports.json';
import seaBuildings from './geo/sea/buildings.json';
import { METERS_PER_UNIT, clipPolyline, heightUnits, project, shoreXAt } from './geo/project.js';

const CHICAGO_GEO = {
  shore: [],
  coasts: chicagoCoasts,
  waters: chicagoWaters,
  river: riverLatLon,
  roads: roadsLatLon,
  airports,
  buildings,
  water: null,
};

const LAX_GEO = {
  shore: [],
  coasts: laxCoasts,
  waters: laxWaters,
  river: [],
  roads: laxRoadsLatLon,
  airports: laxAirports,
  buildings: laxBuildings,
  water: null,
};

const NYC_GEO = {
  shore: [],
  coasts: nycCoasts,
  waters: nycWaters,
  river: [],
  roads: nycRoads,
  airports: nycAirports,
  buildings: nycBuildings,
  water: null,
};

const PHL_GEO = {
  shore: [],
  coasts: phlCoasts,
  waters: phlWaters,
  river: [],
  roads: phlRoads,
  airports: phlAirports,
  buildings: phlBuildings,
  water: null,
  edgeHeight: 80,
};

const SF_GEO = {
  shore: [],
  coasts: sfCoasts,
  waters: sfWaters,
  river: [],
  roads: sfRoads,
  airports: sfAirports,
  buildings: sfBuildings,
  water: null,
  edgeHeight: 80,
};

const BOS_GEO = {
  shore: [],
  coasts: bosCoasts,
  waters: bosWaters,
  river: [],
  roads: bosRoads,
  airports: bosAirports,
  buildings: bosBuildings,
  water: null,
  edgeHeight: 80,
};

const ATL_GEO = {
  shore: [],
  coasts: atlCoasts,
  waters: atlWaters,
  river: [],
  roads: atlRoads,
  airports: atlAirports,
  buildings: atlBuildings,
  water: null,
  edgeHeight: 80,
};

const MIA_GEO = {
  shore: [],
  coasts: miaCoasts,
  waters: miaWaters,
  river: [],
  roads: miaRoads,
  airports: miaAirports,
  buildings: miaBuildings,
  water: null,
  edgeHeight: 80,
};

const DAL_GEO = {
  shore: [],
  coasts: dalCoasts,
  waters: dalWaters,
  river: [],
  roads: dalRoads,
  airports: dalAirports,
  buildings: dalBuildings,
  water: null,
  edgeHeight: 80,
};

const SEA_GEO = {
  shore: [],
  coasts: seaCoasts,
  waters: seaWaters,
  river: [],
  roads: seaRoads,
  airports: seaAirports,
  buildings: seaBuildings,
  water: null,
  edgeHeight: 80,
};

const DC_GEO = {
  shore: [],
  coasts: dcCoasts,
  waters: dcWaters,
  river: [],
  roads: dcRoads,
  airports: dcAirports,
  buildings: dcBuildings,
  water: null,
  edgeHeight: 80,
};

export const GEOGRAPHY = {
  chicago: CHICAGO_GEO,
  lax: LAX_GEO,
  nyc: NYC_GEO,
  phl: PHL_GEO,
  sf: SF_GEO,
  bos: BOS_GEO,
  atl: ATL_GEO,
  mia: MIA_GEO,
  dal: DAL_GEO,
  sea: SEA_GEO,
  dc: DC_GEO,
};

const WATER_Y = 0;
const GRID_CLEARANCE = 0.045;
const SHORE_Y = 0.09;
const RIVER_Y = 0.1;
const ROAD_Y = 0.065;
const FIELD_Y = 0.02;
const FIELD_OUTLINE_Y = 0.08;
const RUNWAY_Y = 0.058;
const RUNWAY_OUTLINE_Y = 0.09;
const BUILDING_BASE = 0.05;

export function createGeography(anchor, half, geo = CHICAGO_GEO) {
  const shore = (geo.shore || []).map(([lat, lon]) => project(lat, lon, anchor));
  const group = new THREE.Group();
  group.name = 'geography';

  if (geo.water === 'east' || geo.water === 'west') {
    const water = createWater(shore, half, geo.water);
    if (water) group.add(water);
  }

  for (const entry of geo.waters || []) {
    const outer = Array.isArray(entry) ? entry : entry.outer;
    const holes = Array.isArray(entry) ? [] : (entry.holes || []);
    if (!outer?.length) continue;
    const mesh = polygonMesh(
      closeRing(outer.map(([lat, lon]) => project(lat, lon, anchor))),
      WATER_Y,
      0x1b2836,
      0,
      holes.map((hole) => closeRing(hole.map(([lat, lon]) => project(lat, lon, anchor)))),
    );
    if (mesh) group.add(mesh);
  }

  if (shore.length > 1) {
    const shoreLine = createStroke(clipPolyline(shore, half), SHORE_Y, 0xd7e4ee, 1);
    if (shoreLine) group.add(shoreLine);
  }

  const coasts = (geo.coasts || []).map((line) => line.map(([lat, lon]) => project(lat, lon, anchor)));
  const coastLine = createStroke(
    coasts.flatMap((line) => clipPolyline(line, half)),
    SHORE_Y,
    0xd7e4ee,
    1,
  );
  if (coastLine) group.add(coastLine);

  const river = (geo.river || []).map((branch) => branch.map(([lat, lon]) => project(lat, lon, anchor)));
  if (river[0] && shore.length > 1) snapMouth(river[0], shore);
  const riverLine = createStroke(
    river.flatMap((branch) => clipPolyline(branch, half)),
    RIVER_Y,
    0xa9c3d4,
    0.8,
  );
  if (riverLine) group.add(riverLine);

  const roads = geo.roads.map((line) => line.map(([lat, lon]) => project(lat, lon, anchor)));
  const roadLine = createWideStroke(
    roads.flatMap((line) => clipPolyline(line, half)),
    ROAD_Y,
    0xc5d2de,
    0.55,
    2,
  );
  if (roadLine) group.add(roadLine);

  addAirports(group, anchor, half, geo.airports);

  const built = createBuildings(shore, half, anchor, geo.buildings, geo.water, geo.edgeHeight ?? 220);
  if (built.mesh) group.add(built.mesh);
  if (built.edges) group.add(built.edges);

  return { group, gridY: GRID_CLEARANCE };
}

function createWater(shore, half, side = 'east') {
  const positions = [];
  const step = 1.6;
  for (let z = -half; z < half - 0.01; z += step) {
    const z1 = Math.min(z + step, half);
    const x0 = Math.min(Math.max(shoreXAt(shore, z), -half), half);
    const x1 = Math.min(Math.max(shoreXAt(shore, z1), -half), half);
    if (side === 'west') {
      if (x0 <= -half + 0.05 && x1 <= -half + 0.05) continue;
      positions.push(
        -half, WATER_Y, z,
        x0, WATER_Y, z1,
        x0, WATER_Y, z,
        -half, WATER_Y, z,
        -half, WATER_Y, z1,
        x0, WATER_Y, z1,
      );
      continue;
    }
    if (x0 >= half - 0.05 && x1 >= half - 0.05) continue;
    positions.push(
      x0, WATER_Y, z,
      half, WATER_Y, z1,
      half, WATER_Y, z,
      x0, WATER_Y, z,
      x1, WATER_Y, z1,
      half, WATER_Y, z1,
    );
  }
  if (!positions.length) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.MeshBasicMaterial({
    color: 0x1b2836,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 0;
  return mesh;
}

function createWideStroke(chains, y, color, opacity, linewidth) {
  const material = new LineMaterial({
    color,
    transparent: true,
    opacity,
    linewidth,
    depthWrite: false,
    worldUnits: false,
  });
  const applyResolution = () => {
    material.resolution.set(window.innerWidth, window.innerHeight);
  };
  applyResolution();
  window.addEventListener('resize', applyResolution);

  const group = new THREE.Group();
  for (const chain of chains) {
    if (chain.length < 2) continue;
    const positions = [];
    for (const point of chain) positions.push(point.x, y, point.z);
    const geometry = new LineGeometry();
    geometry.setPositions(positions);
    const line = new Line2(geometry, material);
    line.renderOrder = 2;
    group.add(line);
  }
  return group.children.length ? group : null;
}

function createStroke(chains, y, color, opacity) {
  const positions = [];
  for (const chain of chains) {
    for (let i = 0; i < chain.length - 1; i += 1) {
      positions.push(chain[i].x, y, chain[i].z, chain[i + 1].x, y, chain[i + 1].z);
    }
  }
  if (positions.length < 6) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const line = new THREE.LineSegments(geometry, material);
  line.renderOrder = 2;
  return line;
}

function addAirports(group, anchor, half, airports) {
  const fields = airports.fields.map((ring) => closeRing(ring.map(([lat, lon]) => project(lat, lon, anchor))));
  for (const ring of fields) {
    const fill = polygonMesh(ring, FIELD_Y, 0x121a24);
    if (fill) group.add(fill);
  }
  const fieldLine = createStroke(
    fields.map((ring) => clipPolyline(ring, half)).flat(),
    FIELD_OUTLINE_Y,
    0xc5d3e0,
    0.72,
  );
  if (fieldLine) group.add(fieldLine);

  const pads = [];
  const outlines = [];
  for (const runway of airports.runways) {
    const center = runway.p.map(([lat, lon]) => project(lat, lon, anchor));
    const ring = runwayRibbon(center, runway.w / 2 / METERS_PER_UNIT);
    const fill = polygonMesh(ring, RUNWAY_Y, 0x314556);
    if (fill) pads.push(fill);
    outlines.push(ring);
  }
  pads.forEach((pad) => group.add(pad));
  const runwayLine = createStroke(outlines, RUNWAY_OUTLINE_Y, 0xe7eef6, 0.95);
  if (runwayLine) group.add(runwayLine);
}

function closeRing(points) {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.hypot(first.x - last.x, first.z - last.z) > 0.02) return [...points, first];
  return points;
}

function runwayRibbon(center, halfWidth) {
  const left = [];
  const right = [];
  for (let i = 0; i < center.length; i += 1) {
    const prev = center[Math.max(0, i - 1)];
    const next = center[Math.min(center.length - 1, i + 1)];
    let dx = next.x - prev.x;
    let dz = next.z - prev.z;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
    left.push({ x: center[i].x - dz * halfWidth, z: center[i].z + dx * halfWidth });
    right.push({ x: center[i].x + dz * halfWidth, z: center[i].z - dx * halfWidth });
  }
  const ring = [...left, ...right.reverse()];
  ring.push(ring[0]);
  return ring;
}

function openRing(ring) {
  const open = ring.slice();
  if (open.length > 2) {
    const first = open[0];
    const last = open[open.length - 1];
    if (Math.hypot(first.x - last.x, first.z - last.z) < 0.02) open.pop();
  }
  return open;
}

function polygonMesh(ring, y, color, renderOrder = 1, holes = []) {
  const open = openRing(ring);
  if (open.length < 3) return null;
  if (ringArea(open) < 0) open.reverse();
  const holeRings = holes.map((hole) => {
    const opened = openRing(hole);
    if (opened.length < 3) return null;
    if (ringArea(opened) > 0) opened.reverse();
    return opened;
  }).filter(Boolean);

  let faces;
  try {
    faces = THREE.ShapeUtils.triangulateShape(
      open.map((point) => new THREE.Vector2(point.x, point.z)),
      holeRings.map((hole) => hole.map((point) => new THREE.Vector2(point.x, point.z))),
    );
  } catch {
    return null;
  }
  if (!faces?.length) return null;

  const positions = [];
  for (const point of open) positions.push(point.x, y, point.z);
  for (const hole of holeRings) {
    for (const point of hole) positions.push(point.x, y, point.z);
  }
  const indices = [];
  for (const [a, b, c] of faces) indices.push(a, b, c);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthWrite: true }),
  );
  mesh.renderOrder = renderOrder;
  return mesh;
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area / 2;
}

function snapMouth(branch, shore) {
  if (!branch?.length) return;
  const z = branch[0].z;
  branch[0] = { x: shoreXAt(shore, z), z };
}

function createBuildings(shore, half, anchor, buildings, water = 'east', edgeHeight = 220) {
  const geometries = [];
  const edgePositions = [];

  for (const building of buildings) {
    const ring = cleanRing(building.p.map(([lon, lat]) => project(lat, lon, anchor)));
    if (ring.length < 3) continue;
    const center = centroid(ring);
    if (Math.abs(center.x) > half || Math.abs(center.z) > half) continue;
    if ((water === 'east' || water === 'west') && shore.length > 1) {
      const shoreX = shoreXAt(shore, center.z);
      if (shoreX != null) {
        const inWater = water === 'west' ? center.x < shoreX - 0.35 : center.x > shoreX + 0.35;
        if (inWater) continue;
      }
    }
    const footprint = scaleRing(ring, 6);

    const height = Math.max(0.18, heightUnits(building.h));
    const geometry = prismGeometry(footprint, height);
    if (!geometry) continue;
    geometries.push(geometry);

    if (building.h < edgeHeight) continue;
    for (let i = 0; i < footprint.length; i += 1) {
      const a = footprint[i];
      const b = footprint[(i + 1) % footprint.length];
      const top = BUILDING_BASE + height;
      edgePositions.push(a.x, BUILDING_BASE, a.z, a.x, top, a.z);
      edgePositions.push(a.x, top, a.z, b.x, top, b.z);
    }
  }

  if (!geometries.length) return {};

  const merged = mergeGeometries(geometries);
  geometries.forEach((geometry) => geometry.dispose());
  const mesh = new THREE.Mesh(
    merged,
    new THREE.MeshBasicMaterial({
      color: 0x3a4a5c,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  mesh.renderOrder = 1;

  const edgesGeometry = new THREE.BufferGeometry();
  edgesGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
  const edges = new THREE.LineSegments(
    edgesGeometry,
    new THREE.LineBasicMaterial({
      color: 0xd5e0ea,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  edges.renderOrder = 2;
  return { mesh, edges };
}

function cleanRing(points) {
  const ring = [];
  for (const point of points) {
    const previous = ring[ring.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) > 0.03) ring.push(point);
  }
  if (ring.length > 2) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (Math.hypot(first.x - last.x, first.z - last.z) < 0.03) ring.pop();
  }
  if (ring.length > 2 && signedArea(ring) < 0) ring.reverse();
  return ring;
}

function signedArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area / 2;
}

function scaleRing(ring, factor) {
  const center = centroid(ring);
  return ring.map((point) => ({
    x: center.x + (point.x - center.x) * factor,
    z: center.z + (point.z - center.z) * factor,
  }));
}

function centroid(ring) {
  let x = 0;
  let z = 0;
  for (const point of ring) {
    x += point.x;
    z += point.z;
  }
  return { x: x / ring.length, z: z / ring.length };
}

function prismGeometry(ring, height) {
  const contour = ring.map((point) => new THREE.Vector2(point.x, point.z));
  let faces;
  try {
    faces = THREE.ShapeUtils.triangulateShape(contour, []);
  } catch {
    return null;
  }
  if (!faces.length) return null;

  const positions = [];
  const top = BUILDING_BASE + height;
  for (const point of ring) positions.push(point.x, BUILDING_BASE, point.z);
  for (const point of ring) positions.push(point.x, top, point.z);

  const indices = [];
  const count = ring.length;
  for (const [a, b, c] of faces) {
    indices.push(a, c, b);
    indices.push(a + count, b + count, c + count);
  }
  for (let i = 0; i < count; i += 1) {
    const j = (i + 1) % count;
    indices.push(i, j, i + count);
    indices.push(j, j + count, i + count);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function mergeGeometries(geometries) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const geometry of geometries) {
    vertexCount += geometry.attributes.position.count;
    indexCount += geometry.index.count;
  }

  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  let vertexOffset = 0;
  let indexOffset = 0;

  for (const geometry of geometries) {
    const source = geometry.attributes.position.array;
    positions.set(source, vertexOffset * 3);
    const index = geometry.index.array;
    for (let i = 0; i < index.length; i += 1) {
      indices[indexOffset + i] = index[i] + vertexOffset;
    }
    vertexOffset += geometry.attributes.position.count;
    indexOffset += index.length;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}
