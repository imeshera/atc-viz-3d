import { cityById } from '../../src/cities.js';
import { createTrafficSource } from '../../server/feed.js';
import chicagoSample from '../../src/data/traffic-sample.json';
import laxSample from '../../src/data/traffic-sample-lax.json';
import nycSample from '../../src/data/traffic-sample-nyc.json';
import dcSample from '../../src/data/traffic-sample-dc.json';

const samples = {
  chicago: chicagoSample,
  lax: laxSample,
  nyc: nycSample,
  dc: dcSample,
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

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  try {
    const city = new URL(request.url).searchParams.get('city') || 'chicago';
    const cached = fresh.get(city);
    if (cached && Date.now() - cached.at < FRESH_MS) {
      return Response.json(cached.body, { headers: { 'Cache-Control': 'no-store' } });
    }
    const body = await sourceFor(city, env).snapshot();
    fresh.set(city, { at: Date.now(), body });
    return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      { source: 'replay', time: Math.floor(Date.now() / 1000), aircraft: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
