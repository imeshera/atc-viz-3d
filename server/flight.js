const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const FLIGHTS_URL = 'https://opensky-network.org/api/flights/aircraft';
const AIRCRAFT_URL = 'https://api.adsb.lol/v2/hex';
const ROUTE_URL = 'https://vrs-standing-data.adsb.lol/routes';
const CACHE_MS = 10 * 60 * 1000;

export function createFlightLookup(env = {}) {
  const cache = new Map();
  let token = '';
  let tokenExpires = 0;
  const clientId = env.OPENSKY_CLIENT_ID || '';
  const clientSecret = env.OPENSKY_CLIENT_SECRET || '';

  async function lookup(icao24, callsign) {
    const key = icao24.toLowerCase();
    const cached = cache.get(key);
    if (cached && cached.until > Date.now()) return cached.value;

    const aircraft = await lookupAircraft(key);
    const route = await lookupRoute(key, callsign || aircraft.callsign);
    const value = {
      type: aircraft.type,
      registration: aircraft.registration,
      from: route.from,
      to: route.to,
      airports: route.airports,
    };
    cache.set(key, { until: Date.now() + CACHE_MS, value });
    return value;
  }

  async function lookupAircraft(icao24) {
    try {
      const response = await fetch(`${AIRCRAFT_URL}/${icao24}`, {
        headers: { 'User-Agent': 'atc-viz-3d' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return { type: null, registration: null };
      const body = await response.json();
      const aircraft = body.ac?.[0];
      if (!aircraft) return { type: null, registration: null };
      return {
        type: aircraft.t || null,
        registration: aircraft.r || null,
        callsign: (aircraft.flight || '').trim(),
      };
    } catch {
      return { type: null, registration: null, callsign: '' };
    }
  }

  async function lookupRoute(icao24, callsign) {
    const standing = await lookupStandingRoute(callsign);
    const live = await lookupLiveRoute(icao24);
    if (live.from || live.to) return live;
    return standing;
  }

  async function lookupStandingRoute(callsign) {
    const empty = { from: null, to: null, airports: [] };
    const url = standingRouteUrl(callsign);
    if (!url) return empty;
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'atc-viz-3d', Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return empty;
      const body = await response.json();
      const airports = routeCodes(body);
      return {
        from: airports[0] || null,
        to: airports.length > 1 ? airports[airports.length - 1] : null,
        airports,
      };
    } catch {
      return empty;
    }
  }

  async function lookupLiveRoute(icao24) {
    if (!clientId || !clientSecret) return { from: null, to: null, airports: [] };
    try {
      const end = Math.floor(Date.now() / 1000);
      const begin = end - 12 * 60 * 60;
      const params = new URLSearchParams({ icao24, begin: String(begin), end: String(end) });
      const response = await fetch(`${FLIGHTS_URL}?${params}`, {
        headers: { Authorization: `Bearer ${await getToken()}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return { from: null, to: null, airports: [] };
      const flights = await response.json();
      if (!Array.isArray(flights) || !flights.length) return { from: null, to: null, airports: [] };
      const latest = flights.reduce((best, flight) => (
        (flight.lastSeen || 0) > (best.lastSeen || 0) ? flight : best
      ));
      const from = latest.estDepartureAirport || null;
      const to = latest.estArrivalAirport || null;
      return { from, to, airports: [from, to].filter(Boolean) };
    } catch {
      return { from: null, to: null, airports: [] };
    }
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
    if (!response.ok) throw new Error(`OpenSky auth responded ${response.status}`);
    const json = await response.json();
    token = json.access_token;
    tokenExpires = Date.now() + Math.max(30, (json.expires_in || 1800) - 60) * 1000;
    return token;
  }

  return lookup;
}

export function createFlightHandler(env = {}) {
  const lookup = createFlightLookup(env);

  return async function flightHandler(req, res) {
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.end();
      return;
    }
    const url = new URL(req.url || '/', 'http://localhost');
    const icao24 = (url.searchParams.get('icao24') || '').trim().toLowerCase();
    const callsign = (url.searchParams.get('callsign') || '').trim().toUpperCase();
    const value = /^[0-9a-f]{6}$/.test(icao24)
      ? await lookup(icao24, callsign)
      : { type: null, registration: null, from: null, to: null, airports: [] };
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(value));
  };
}

function standingRouteUrl(callsign) {
  const match = String(callsign || '').trim().toUpperCase().match(/^([A-Z]{3})(\d{1,4}[A-Z]?)$/);
  if (!match) return '';
  return `${ROUTE_URL}/${match[1].slice(0, 2)}/${match[1]}${match[2]}.json`;
}

function routeCodes(body) {
  const iata = typeof body?._airport_codes_iata === 'string' ? body._airport_codes_iata : '';
  const icao = typeof body?.airport_codes === 'string' ? body.airport_codes : '';
  const raw = iata.includes('-') ? iata : icao;
  return raw.split('-').map((code) => code.trim()).filter(Boolean);
}
