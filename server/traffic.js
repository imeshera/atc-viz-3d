import { existsSync, readFileSync } from 'node:fs';
import { cityById } from '../src/cities.js';
import { createFlightHandler } from './flight.js';
import { POLL_MS, createTrafficSource as createSource, normalizeSample } from './feed.js';

export { POLL_MS };

export function createTrafficSource({
  clientId = '',
  clientSecret = '',
  cityId = 'chicago',
  sample,
} = {}) {
  const city = cityById(cityId);
  const loaded = sample || readSample(new URL(`../src/data/${city.sample}`, import.meta.url));
  return createSource({ clientId, clientSecret, cityId: city.id, sample: loaded });
}

export function createTrafficHandler(env = {}) {
  const sources = new Map();

  function sourceFor(cityId) {
    const city = cityById(cityId);
    if (!sources.has(city.id)) {
      sources.set(city.id, createTrafficSource({
        clientId: env.OPENSKY_CLIENT_ID || '',
        clientSecret: env.OPENSKY_CLIENT_SECRET || '',
        cityId: city.id,
      }));
    }
    return sources.get(city.id);
  }

  return async function trafficHandler(req, res) {
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.end();
      return;
    }
    const url = new URL(req.url || '/', 'http://localhost');
    const source = sourceFor(url.searchParams.get('city'));
    const body = url.searchParams.get('mode') === 'live'
      ? await source.snapshot()
      : source.replayFrame();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };
}

export function trafficPlugin(env) {
  const handler = createTrafficHandler(env);
  const flightHandler = createFlightHandler(env);
  const attach = (middlewares) => {
    middlewares.use('/api/traffic', (req, res) => {
      handler(req, res).catch(() => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ source: 'replay', time: Math.floor(Date.now() / 1000), aircraft: [] }));
      });
    });
    middlewares.use('/api/flight', (req, res) => {
      flightHandler(req, res).catch(() => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ type: null, registration: null, from: null, to: null, airports: [] }));
      });
    });
  };

  return {
    name: 'traffic-api',
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}

function readSample(samplePath) {
  if (!existsSync(samplePath)) return normalizeSample(null);
  try {
    return normalizeSample(JSON.parse(readFileSync(samplePath, 'utf8')));
  } catch {
    return normalizeSample(null);
  }
}
