export const GRID_HALF = 52;

export const CITY_ORDER = ['chicago', 'nyc', 'dc', 'lax'];

export const CITIES = {
  chicago: {
    id: 'chicago',
    name: 'Chicago',
    title: 'Chicago — Airspace',
    href: '/',
    anchor: { x: -8, z: 2, origin: { lat: 41.9786, lon: -87.9048 } },
    half: GRID_HALF,
    label: 'Chicago',
    labelAt: [8, 16, -14],
    camera: { position: [10, 32, 88], target: [24, 3, 16] },
    water: 'east',
    sample: 'traffic-sample.json',
  },
  lax: {
    id: 'lax',
    name: 'Los Angeles',
    title: 'Los Angeles — Airspace',
    href: '/lax.html',
    anchor: { x: -8, z: 2, origin: { lat: 33.9425, lon: -118.4081 } },
    half: 100,
    divisions: 50,
    maxDistance: 280,
    label: 'Los Angeles',
    labelAt: [-18, 18, -18],
    camera: { position: [20, 40, 92], target: [12, 3, 2] },
    water: 'west',
    sample: 'traffic-sample-lax.json',
  },
  dc: {
    id: 'dc',
    name: 'Washington',
    title: 'Washington — Airspace',
    href: '/dc.html',
    anchor: { x: 0, z: 0, origin: { lat: 38.9, lon: -77.04 } },
    half: 96,
    divisions: 48,
    maxDistance: 280,
    label: 'Washington',
    labelAt: [-20, 20, -78],
    camera: { position: [8, 52, 108], target: [2, 2, -4] },
    water: null,
    sample: 'traffic-sample-dc.json',
  },
  nyc: {
    id: 'nyc',
    name: 'New York',
    title: 'New York — Airspace',
    href: '/nyc.html',
    anchor: { x: 0, z: 0, origin: { lat: 40.7, lon: -74 } },
    half: 48,
    divisions: 24,
    maxDistance: 240,
    label: 'New York',
    labelAt: [-18, 17, -26],
    camera: { position: [8, 46, 102], target: [6, 2, -1] },
    water: null,
    sample: 'traffic-sample-nyc.json',
  },
};

export function cityById(id) {
  return CITIES[id] || CITIES.chicago;
}
