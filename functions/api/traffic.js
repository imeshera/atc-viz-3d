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
    const city = new URL(request.url).searchParams.get('city');
    const body = await sourceFor(city, env).snapshot();
    return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      { source: 'replay', time: Math.floor(Date.now() / 1000), aircraft: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
