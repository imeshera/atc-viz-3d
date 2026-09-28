import { createFlightLookup } from '../../server/flight.js';

const lookups = new Map();

function lookupFor(env) {
  const key = `${env.OPENSKY_CLIENT_ID || ''}:${env.OPENSKY_CLIENT_SECRET || ''}`;
  if (!lookups.has(key)) lookups.set(key, createFlightLookup(env));
  return lookups.get(key);
}

const empty = { type: null, registration: null, from: null, to: null, airports: [] };

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  try {
    const url = new URL(request.url);
    const icao24 = (url.searchParams.get('icao24') || '').trim().toLowerCase();
    const callsign = (url.searchParams.get('callsign') || '').trim().toUpperCase();
    const value = /^[0-9a-f]{6}$/.test(icao24)
      ? await lookupFor(env)(icao24, callsign)
      : empty;
    return Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(empty, { headers: { 'Cache-Control': 'no-store' } });
  }
}
