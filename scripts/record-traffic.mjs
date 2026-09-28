import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnv } from 'vite';
import { POLL_MS, createTrafficSource } from '../server/traffic.js';
import { cityById } from '../src/cities.js';

const FRAMES = 18;
const city = cityById(process.argv[2] || 'chicago');
const env = loadEnv('development', process.cwd(), '');
const source = createTrafficSource({
  clientId: env.OPENSKY_CLIENT_ID || '',
  clientSecret: env.OPENSKY_CLIENT_SECRET || '',
  cityId: city.id,
});

const frames = [];
for (let i = 0; i < FRAMES; i += 1) {
  const frame = await source.fetchLive();
  frames.push({ time: frame.time, aircraft: frame.aircraft });
  console.log(`${i + 1}/${FRAMES} ${frame.aircraft.length} aircraft`);
  if (i < FRAMES - 1) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

const directory = new URL('../src/data/', import.meta.url);
await mkdir(directory, { recursive: true });
const file = new URL(city.sample, directory);
await writeFile(file, JSON.stringify({ interval: POLL_MS / 1000, frames }));
console.log(`wrote ${frames.length} frames`);
