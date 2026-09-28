import { boardBox } from '../src/geo/project.js';
import { cityById } from '../src/cities.js';

const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const STATES_URL = 'https://opensky-network.org/api/states/all';
export const POLL_MS = 10_000;

const emptySample = { interval: POLL_MS / 1000, frames: [] };

export function createTrafficSource({
  clientId = '',
  clientSecret = '',
  cityId = 'chicago',
  sample = emptySample,
} = {}) {
  const city = cityById(cityId);
  const box = boardBox(city.anchor, city.half);
  let token = '';
  let tokenExpires = 0;
  let replay = normalizeSample(sample);

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
    if (!replay.frames.length) {
      return { source: 'replay', time: Math.floor(Date.now() / 1000), aircraft: [] };
    }
    const intervalMs = (replay.interval || POLL_MS / 1000) * 1000;
    const index = Math.floor(Date.now() / intervalMs) % replay.frames.length;
    const frame = replay.frames[index];
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

export function normalizeSample(sample) {
  return {
    interval: sample?.interval || POLL_MS / 1000,
    frames: Array.isArray(sample?.frames) ? sample.frames : [],
  };
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
