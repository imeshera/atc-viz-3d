import { cityById } from '../../src/cities.js';
import { createTrafficSource } from '../../server/feed.js';
import chicagoSample from '../../src/data/traffic-sample.json';
import laxSample from '../../src/data/traffic-sample-lax.json';
import nycSample from '../../src/data/traffic-sample-nyc.json';
import dcSample from '../../src/data/traffic-sample-dc.json';
import phlSample from '../../src/data/traffic-sample-phl.json';
import sfSample from '../../src/data/traffic-sample-sf.json';
import bosSample from '../../src/data/traffic-sample-bos.json';
import atlSample from '../../src/data/traffic-sample-atl.json';
import miaSample from '../../src/data/traffic-sample-mia.json';
import dalSample from '../../src/data/traffic-sample-dal.json';
import seaSample from '../../src/data/traffic-sample-sea.json';

const samples = {
  chicago: chicagoSample,
  lax: laxSample,
  nyc: nycSample,
  dc: dcSample,
  phl: phlSample,
  sf: sfSample,
  bos: bosSample,
  atl: atlSample,
  mia: miaSample,
  dal: dalSample,
  sea: seaSample,
};

const sources = new Map();
const fresh = new Map();
const FRESH_MS = 8_000;

function sourceFor(cityId, env) {
  const city = cityById(cityId);
  if (!sources.has(city.id)) {
    sources.set(city.id, createTrafficSource({
      clientId: env.OPENSKY_CLIENT_ID || '',
      clientSecret: env.OPENSKY_CLIENT_SECRET || '',
      cityId: city.id,
      sample: samples[city.id] || chicagoSample,
    }));
  }
  return sources.get(city.id);
}

async function fromHome(city, env) {
  const upstream = String(env.TRAFFIC_UPSTREAM || '').replace(/\/$/, '');
  if (!upstream) return null;
  const response = await fetch(`${upstream}/api/traffic?city=${encodeURIComponent(city)}&mode=live`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const body = await response.json();
  return body?.aircraft ? body : null;
}

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  try {
    const url = new URL(request.url);
    const city = url.searchParams.get('city') || 'chicago';
    const mode = url.searchParams.get('mode') === 'live' ? 'live' : 'replay';
    const attempt = url.searchParams.get('attempt') === '1';
    const cached = fresh.get(`${city}:${mode}`);
    if (!attempt && cached && Date.now() - cached.at < FRESH_MS) {
      return Response.json(cached.body, { headers: { 'Cache-Control': 'no-store' } });
    }
    const source = sourceFor(city, env);
    const body = mode === 'live'
      ? await fromHome(city, env) || await source.snapshot()
      : source.replayFrame();
    fresh.set(`${city}:${mode}`, { at: Date.now(), body });
    return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      { source: 'replay', time: Math.floor(Date.now() / 1000), aircraft: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
