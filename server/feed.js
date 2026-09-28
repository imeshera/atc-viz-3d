import { boardBox, unproject } from '../src/geo/project.js';
import { cityById } from '../src/cities.js';

const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const STATES_URL = 'https://opensky-network.org/api/states/all';
const FEEDS = [
  (lat, lon, nm) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}`,
  (lat, lon, nm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}`,
];
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
    if (clientId && clientSecret) {
      try {
        const live = await fetchOpenSky();
        if (live.aircraft.some((aircraft) => !aircraft.onGround && aircraft.altM != null)) return live;
      } catch {
        // A signed-in OpenSky account is optional. The public feed below is the current sky.
      }
    }
    return fetchAdsb();
  }

  async function fetchOpenSky() {
    const authed = Boolean(clientId && clientSecret);
    let response = await requestStates(authed ? await getToken() : '', AbortSignal.timeout(4000));
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

  async function fetchAdsb() {
    const center = unproject(0, 0, city.anchor);
    const radiusNm = Math.max(10, Math.ceil((city.half * 500 * Math.SQRT2) / 1852));
    const lat = center.lat.toFixed(4);
    const lon = center.lon.toFixed(4);
    let lastError = new Error('live feed unavailable');
    for (const urlFor of FEEDS) {
      try {
        const response = await fetch(urlFor(lat, lon, radiusNm), {
          headers: { 'User-Agent': 'atc-viz-3d', Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          lastError = new Error(`live feed responded ${response.status}`);
          continue;
        }
        const body = await response.json();
        const rows = body.aircraft || body.ac || [];
        const aircraft = rows.map(normalizeAdsb).filter((item) => (
          item && item.lat >= box.lamin && item.lat <= box.lamax && item.lon >= box.lomin && item.lon <= box.lomax
        ));
        const now = Number(body.now) || Date.now();
        return {
          source: 'live',
          time: Math.floor(now > 1e12 ? now / 1000 : now),
          aircraft,
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async function snapshot() {
    try {
      return await fetchLive();
    } catch (error) {
      console.log(`live feed failed: ${error?.message || error}`);
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

  async function requestStates(accessToken, signal) {
    const params = new URLSearchParams({
      lamin: String(box.lamin),
      lomin: String(box.lomin),
      lamax: String(box.lamax),
      lomax: String(box.lomax),
    });
    const headers = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(`${STATES_URL}?${params}`, { headers, signal });
  }

  return { fetchLive, snapshot, replayFrame, box };
}

export function normalizeSample(sample) {
  return {
    interval: sample?.interval || POLL_MS / 1000,
    frames: Array.isArray(sample?.frames) ? sample.frames : [],
  };
}

function normalizeAdsb(aircraft) {
  if (aircraft?.lat == null || aircraft?.lon == null || !aircraft.hex) return null;
  const ground = aircraft.alt_baro === 'ground' || aircraft.alt_baro == null;
  const altFeet = ground ? null : Number(aircraft.alt_baro);
  return {
    id: aircraft.hex,
    callsign: String(aircraft.flight || '').trim(),
    lat: aircraft.lat,
    lon: aircraft.lon,
    altM: altFeet == null || !Number.isFinite(altFeet) ? null : altFeet / 3.280839895,
    gs: Number(aircraft.gs || 0) / 1.943844,
    track: Number(aircraft.track || 0),
    vs: aircraft.baro_rate == null ? null : Number(aircraft.baro_rate) / 196.85,
    onGround: ground || altFeet == null,
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
