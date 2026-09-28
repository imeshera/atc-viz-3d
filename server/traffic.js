import { existsSync, readFileSync } from 'node:fs';
import { boardBox } from '../src/geo/project.js';
import { cityById } from '../src/cities.js';
import { createFlightHandler } from './flight.js';

const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const STATES_URL = 'https://opensky-network.org/api/states/all';
export const POLL_MS = 10_000;

export function createTrafficSource({
  clientId = '',
  clientSecret = '',
  cityId = 'chicago',
} = {}) {
  const city = cityById(cityId);
  const box = boardBox(city.anchor, city.half);
  const samplePath = new URL(`../src/data/${city.sample}`, import.meta.url);
  let token = '';
  let tokenExpires = 0;
  let sample = readSample(samplePath);

  async function fetchLive() {
    const authed = Boolean(clientId && clientSecret);
    let response = await requestStates(authed ? await getToken() : '');
    if (response.status === 401 && authed) {
      token = '';
      response = await requestStates(await getToken());
    }
    if (!response.ok) {
      const error = new Error(`OpenSky responded ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const body = await response.json();
    return {
      source: 'live',
      time: body.time,
      aircraft: normalizeStates(body.states),
    };
  }

  async function snapshot() {
    try {
      return await fetchLive();
    } catch {
      return replayFrame();
    }
  }

  function replayFrame() {
    if (!sample.frames.length) sample = readSample(samplePath);
    if (!sample.frames.length) {
      return { source: 'replay', time: Math.floor(Date.now() / 1000), aircraft: [] };
    }
    const intervalMs = (sample.interval || POLL_MS / 1000) * 1000;
    const index = Math.floor(Date.now() / intervalMs) % sample.frames.length;
    const frame = sample.frames[index];
    return { source: 'replay', time: frame.time, aircraft: frame.aircraft };
  }

  async function getToken() {
    if (token && Date.now() < tokenExpires) return token;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      const error = new Error(`OpenSky auth responded ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const json = await response.json();
    token = json.access_token;
    tokenExpires = Date.now() + Math.max(30, (json.expires_in || 1800) - 60) * 1000;
    return token;
  }

  async function requestStates(accessToken) {
    const params = new URLSearchParams({
      lamin: String(box.lamin),
      lomin: String(box.lomin),
      lamax: String(box.lamax),
      lomax: String(box.lomax),
    });
    const headers = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(`${STATES_URL}?${params}`, { headers });
  }

  return { fetchLive, snapshot, replayFrame, box };
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
    const body = await sourceFor(url.searchParams.get('city')).snapshot();
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
  if (!existsSync(samplePath)) return { interval: POLL_MS / 1000, frames: [] };
  try {
    const parsed = JSON.parse(readFileSync(samplePath, 'utf8'));
    return {
      interval: parsed.interval || POLL_MS / 1000,
      frames: Array.isArray(parsed.frames) ? parsed.frames : [],
    };
  } catch {
    return { interval: POLL_MS / 1000, frames: [] };
  }
}

function normalizeStates(states) {
  if (!Array.isArray(states)) return [];
  const aircraft = [];
  for (const row of states) {
    const lat = row[6];
    const lon = row[5];
    if (lat == null || lon == null) continue;
    const callsign = typeof row[1] === 'string' ? row[1].trim() : '';
    aircraft.push({
      id: row[0],
      callsign,
      lat,
      lon,
      altM: row[7],
      gs: row[9] ?? 0,
      track: row[10] ?? 0,
      vs: row[11],
      onGround: Boolean(row[8]),
    });
  }
  return aircraft;
}
