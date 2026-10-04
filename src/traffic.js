import { project, metersPerSecondToKnots, metersToFeet, visualAltitude } from './geo/project.js';

const POLL_MS = 10_000;
const HISTORY_MS = 90_000;
const STALE_MS = 25_000;
const FADE_MS = 10_000;
export const TRAIL_SAMPLES = 36;

export function createTraffic({ anchor, half, cityId = 'chicago', onStatus }) {
  const tracks = new Map();
  let timer = 0;
  let ticket = 0;
  let mode = 'live';
  let shown = '';

  async function poll(attempt = false) {
    if (document.hidden) return;
    const mine = ++ticket;
    const requested = mode;
    const started = performance.now();
    try {
      const params = new URLSearchParams({ city: cityId, mode: requested });
      if (attempt) params.set('attempt', '1');
      const response = await fetch(`/api/traffic?${params}`);
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json();
      if (mine !== ticket) return;
      const source = body.source === 'live' ? 'live' : 'replay';
      if (shown && shown !== source) tracks.clear();
      shown = source;
      ingest(body);
      onStatus?.({ mode: requested, source });
    } catch {
      if (mine !== ticket) return;
      onStatus?.({ mode: requested, source: 'replay' });
    }
    if (mine !== ticket || document.hidden) return;
    const wait = Math.max(0, POLL_MS - (performance.now() - started));
    timer = window.setTimeout(() => poll(false), wait);
  }

  function setMode(next) {
    const requested = next === 'live' ? 'live' : 'replay';
    if (requested === mode && requested !== 'live') return;
    mode = requested;
    tracks.clear();
    shown = '';
    window.clearTimeout(timer);
    poll(requested === 'live');
  }

  function start() {
    document.addEventListener('visibilitychange', () => {
      window.clearTimeout(timer);
      if (!document.hidden) poll(false);
    });
    poll(true);
  }

  function ingest(body) {
    const now = performance.now();
    const seen = new Set();
    for (const aircraft of body.aircraft || []) {
      if (aircraft.onGround || aircraft.altM == null) continue;
      if (aircraft.lat == null || aircraft.lon == null) continue;
      const { x, z } = project(aircraft.lat, aircraft.lon, anchor);
      if (Math.abs(x) > half || Math.abs(z) > half) continue;

      const fix = {
        x,
        y: visualAltitude(aircraft.altM),
        z,
        feet: metersToFeet(aircraft.altM),
        knots: metersPerSecondToKnots(aircraft.gs || 0),
        heading: aircraft.track || 0,
        vs: verticalSpeed(aircraft.vs),
        callsign: labelFor(aircraft),
      };
      seen.add(aircraft.id);

      let track = tracks.get(aircraft.id);
      if (!track) {
        track = {
          id: aircraft.id,
          born: now,
          missingSince: 0,
          from: fix,
          to: fix,
          fromT: now,
          toT: now,
          history: [],
          callsign: fix.callsign,
          feet: fix.feet,
          knots: fix.knots,
          heading: fix.heading,
          vs: fix.vs,
        };
        tracks.set(aircraft.id, track);
      }

      if (fix.vs == null && now - track.fromT > 1000) {
        const minutes = (now - track.fromT) / 60000;
        fix.vs = (fix.feet - track.feet) / minutes;
      }

      const current = interpolate(track, now);
      track.history.push({ t: now, x: current.x, y: current.y, z: current.z });
      track.from = current;
      track.to = fix;
      track.fromT = now;
      track.toT = now + POLL_MS;
      track.missingSince = 0;
      track.callsign = fix.callsign;
      track.feet = fix.feet;
      track.knots = fix.knots;
      track.heading = fix.heading;
      track.vs = fix.vs;
      const cutoff = now - HISTORY_MS;
      while (track.history.length > 1 && track.history[0].t < cutoff) track.history.shift();
    }

    for (const track of tracks.values()) {
      if (!seen.has(track.id) && !track.missingSince) track.missingSince = now;
    }
  }

  function poses(now) {
    const list = [];
    for (const track of tracks.values()) {
      const missing = track.missingSince ? now - track.missingSince : 0;
      if (missing > STALE_MS) {
        tracks.delete(track.id);
        continue;
      }
      const fadeIn = Math.min((now - track.born) / 1000, 1);
      const fadeOut = missing <= STALE_MS - FADE_MS
        ? 1
        : 1 - (missing - (STALE_MS - FADE_MS)) / FADE_MS;
      const visibility = fadeIn * Math.max(0, fadeOut);
      if (visibility <= 0) continue;
      const head = interpolate(track, now);
      const points = track.history.map((point) => ({ x: point.x, y: point.y, z: point.z }));
      points.push(head);
      list.push({
        id: track.id,
        callsign: track.callsign,
        feet: track.feet,
        knots: track.knots,
        heading: track.heading,
        vs: track.vs,
        visibility,
        head,
        trail: resample(points, TRAIL_SAMPLES),
      });
    }
    return list;
  }

  return { start, poses, setMode };
}

function interpolate(track, now) {
  const span = track.toT - track.fromT;
  const u = span <= 0 ? 1 : Math.min(Math.max((now - track.fromT) / span, 0), 1);
  return {
    x: track.from.x + (track.to.x - track.from.x) * u,
    y: track.from.y + (track.to.y - track.from.y) * u,
    z: track.from.z + (track.to.z - track.from.z) * u,
  };
}

function resample(points, count) {
  if (!points.length) {
    return Array.from({ length: count }, () => ({ x: 0, y: 0, z: 0 }));
  }
  if (points.length === 1) {
    return Array.from({ length: count }, () => ({ ...points[0] }));
  }
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const f = (i / (count - 1)) * (points.length - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(i0 + 1, points.length - 1);
    const u = f - i0;
    const a = points[i0];
    const b = points[i1];
    out.push({
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      z: a.z + (b.z - a.z) * u,
    });
  }
  return out;
}

function verticalSpeed(metersPerSecond) {
  if (metersPerSecond == null || Number.isNaN(metersPerSecond)) return null;
  return metersPerSecond * 196.85;
}

function labelFor(aircraft) {
  const callsign = (aircraft.callsign || '').trim();
  if (callsign) return callsign;
  return String(aircraft.id || '').toUpperCase();
}
