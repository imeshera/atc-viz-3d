import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GEOGRAPHY, createGeography } from './geography.js';
import { createTraffic, TRAIL_SAMPLES } from './traffic.js';
import { CITY_ORDER, CITIES, cityById } from './cities.js';
import { detailLabel, routeLabel } from './flight-info.js';

const city = cityById(document.body.dataset.city);
const anchor = city.anchor;
const GRID_SIZE = city.half * 2;
const GRID_DIVISIONS = city.divisions || 26;

const LOW = new THREE.Color('#ff4a1a');
const MID = new THREE.Color('#d6f542');
const HIGH = new THREE.Color('#3ae7ff');
const WHITE = new THREE.Color('#ffffff');

const HOME = {
  position: new THREE.Vector3(...city.camera.position),
  target: new THREE.Vector3(...city.camera.target),
};

document.title = city.title;

const switches = document.querySelector('.switches');
for (const id of CITY_ORDER) {
  const entry = CITIES[id];
  const anchorLink = document.createElement('a');
  anchorLink.className = 'switch';
  anchorLink.href = entry.href;
  anchorLink.textContent = entry.name;
  if (entry.id === city.id) {
    anchorLink.classList.add('is-on');
    anchorLink.setAttribute('aria-current', 'page');
  }
  switches?.append(anchorLink);
}

const canvas = document.querySelector('#view');
const tip = document.querySelector('.tip');
const tipCs = document.querySelector('.tip-cs');
const tipSub = document.querySelector('.tip-sub');
const tipMeta = document.querySelector('.tip-meta');
const tipRoute = document.querySelector('.tip-route');
const countEl = document.querySelector('.count');
const modesEl = document.querySelector('.modes');
const modeButtons = {};
for (const id of ['live', 'replay']) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mode';
  button.textContent = id === 'live' ? 'Live' : 'Replay';
  button.setAttribute('aria-pressed', id === 'live' ? 'true' : 'false');
  if (id === 'live') button.classList.add('is-on');
  if (id === 'replay') button.hidden = true;
  modesEl?.append(button);
  modeButtons[id] = button;
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.copy(HOME.position);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME.target);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.rotateSpeed = 0.55;
controls.zoomSpeed = 0.7;
controls.minDistance = 24;
controls.maxDistance = city.maxDistance || 190;
controls.minPolarAngle = 0.28;
controls.maxPolarAngle = Math.PI / 2.08;
controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
controls.autoRotateSpeed = 0.35;
controls.update();

const geography = createGeography(anchor, city.half, GEOGRAPHY[city.id]);
scene.add(geography.group);
const grid = createGrid(GRID_SIZE, GRID_DIVISIONS);
grid.position.y = geography.gridY;
scene.add(grid);

const projected = new THREE.Vector3();
const scratchColor = new THREE.Color();

const glowTexture = createGlowTexture();
const flights = new Map();
const traffic = createTraffic({
  anchor,
  half: city.half,
  cityId: city.id,
  onStatus({ mode, source }) {
    paintMode(mode, source);
  },
});

function paintMode(mode, source) {
  const missed = mode === 'live' && source !== 'live';
  const showingReplay = mode === 'replay' || missed;
  if (modeButtons.replay) modeButtons.replay.hidden = !showingReplay;
  modeButtons.live?.classList.toggle('is-on', !showingReplay);
  modeButtons.live?.classList.toggle('is-miss', missed);
  modeButtons.live?.setAttribute('aria-pressed', !showingReplay ? 'true' : 'false');
  modeButtons.replay?.classList.toggle('is-on', showingReplay);
  modeButtons.replay?.setAttribute('aria-pressed', showingReplay ? 'true' : 'false');
  if (modeButtons.live) {
    modeButtons.live.title = missed ? 'Live feed did not answer. Click to try again.' : 'Try the live feed';
  }
}

modeButtons.replay?.addEventListener('click', () => {
  paintMode('replay', 'replay');
  traffic.setMode('replay');
});
modeButtons.live?.addEventListener('click', () => {
  paintMode('live', 'live');
  traffic.setMode('live');
});
countEl.textContent = '0 tracks';

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerActive = false;
let dragging = false;
let hovered = null;

canvas.addEventListener('pointermove', (event) => {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  pointerActive = true;
});

canvas.addEventListener('pointerleave', () => {
  pointerActive = false;
  hovered = null;
});

controls.addEventListener('start', () => {
  dragging = true;
  controls.autoRotate = false;
  hovered = null;
});

controls.addEventListener('end', () => {
  dragging = false;
});

document.querySelector('.reset').addEventListener('click', () => {
  camera.position.copy(HOME.position);
  controls.target.copy(HOME.target);
  controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  controls.update();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'r' || event.key === 'R') {
    document.querySelector('.reset').click();
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function frame() {
  syncFlights(performance.now());
  if (pointerActive && !dragging) pickFlight();
  updateTooltip();
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

Promise.race([
  document.fonts.load('700 180px Inter'),
  new Promise((resolve) => setTimeout(resolve, 1200)),
]).then(() => {
  scene.add(createLabel(city.label, city.labelAt, city.labelScale));
  traffic.start();
  frame();
});

function syncFlights(now) {
  const poses = traffic.poses(now);
  const live = new Set();
  for (const pose of poses) {
    live.add(pose.id);
    let flight = flights.get(pose.id);
    if (!flight) {
      flight = createFlight(glowTexture);
      flight.id = pose.id;
      flights.set(pose.id, flight);
      scene.add(flight.group);
    }
    flight.apply(pose);
  }
  for (const [id, flight] of flights) {
    if (live.has(id)) continue;
    if (hovered === flight) hovered = null;
    scene.remove(flight.group);
    flight.dispose();
    flights.delete(id);
  }
  countEl.textContent = `${flights.size} tracks`;
}

function pickFlight() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([...flights.values()].map((flight) => flight.hit), false);
  hovered = hits.length ? hits[0].object.userData.flight : null;
  canvas.style.cursor = hovered ? 'pointer' : '';
}

function updateTooltip() {
  if (!hovered || dragging) {
    tip.hidden = true;
    return;
  }

  projected.copy(hovered.head).project(camera);
  if (projected.z > 1) {
    tip.hidden = true;
    return;
  }

  const x = (projected.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-projected.y * 0.5 + 0.5) * window.innerHeight;
  const left = Math.min(Math.max(12, x + 16), window.innerWidth - 240);
  const top = Math.min(Math.max(12, y - 28), window.innerHeight - 96);

  tip.hidden = false;
  tip.style.transform = `translate(${left}px, ${top}px)`;
  tip.style.setProperty('--c', `#${hovered.color.getHexString()}`);
  tipCs.textContent = hovered.callsign;
  const detail = detailLabel(hovered.callsign, hovered.info);
  tipSub.hidden = !detail;
  tipSub.textContent = detail;
  const climb = formatVerticalSpeed(hovered.vs);
  tipMeta.textContent = `${formatAltitude(hovered.feet)}  ·  ${Math.round(hovered.knots)} kt  ·  ${formatHeading(hovered.heading)}${climb}`;
  const route = routeLabel(hovered.info?.from, hovered.info?.to, hovered.info?.airports);
  tipRoute.hidden = !route;
  tipRoute.textContent = route;
  if (hovered.infoId !== hovered.id) loadFlightInfo(hovered);
}

function createGrid(size, divisions) {
  const half = size / 2;
  const step = size / divisions;
  const positions = [];

  for (let i = 0; i <= divisions; i += 1) {
    const p = -half + i * step;
    positions.push(-half, 0, p, half, 0, p, p, 0, -half, p, 0, half);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: 0xa8b7c9,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const grid = new THREE.LineSegments(geometry, material);
  grid.position.y = 0;
  return grid;
}

function createLabel(text, at, scale = 1) {
  const font = '700 180px Inter, "SF Pro Display", "Helvetica Neue", sans-serif';
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const metrics = measure.measureText(text);
  const ascent = metrics.actualBoundingBoxAscent || 140;
  const descent = metrics.actualBoundingBoxDescent || 36;
  const width = Math.ceil(metrics.width);
  const height = Math.ceil(ascent + descent);
  const pixelScale = 3;

  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = width * pixelScale;
  labelCanvas.height = height * pixelScale;
  const ctx = labelCanvas.getContext('2d');
  ctx.scale(pixelScale, pixelScale);
  ctx.font = font;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 0, ascent);

  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.35,
    depthWrite: true,
  });
  const sprite = new THREE.Sprite(material);
  const worldHeight = 7.6 * scale;
  sprite.scale.set(worldHeight * (width / height), worldHeight, 1);
  sprite.center.set(0.5, 0);
  sprite.position.set(at[0], at[1], at[2]);
  return sprite;
}

function createGlowTexture() {
  const size = 128;
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = size;
  glowCanvas.height = size;
  const ctx = glowCanvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.42, 'rgba(255,255,255,0.28)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(glowCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createFlight(texture) {
  const positions = new Float32Array(TRAIL_SAMPLES * 3);
  const colors = new Float32Array(TRAIL_SAMPLES * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  line.frustumCulled = false;

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 16, 16),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );

  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(2.1, 10, 10),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    }),
  );

  const group = new THREE.Group();
  group.add(line, core, glow, hit);

  const flight = {
    id: '',
    callsign: '',
    group,
    hit,
    head: new THREE.Vector3(),
    color: new THREE.Color(),
    feet: 0,
    knots: 0,
    heading: 0,
    apply(pose) {
      this.callsign = pose.callsign;
      this.feet = pose.feet;
      this.knots = pose.knots;
      this.heading = pose.heading;
      this.vs = pose.vs;

      for (let i = 0; i < TRAIL_SAMPLES; i += 1) {
        const point = pose.trail[i];
        positions[i * 3] = point.x;
        positions[i * 3 + 1] = point.y;
        positions[i * 3 + 2] = point.z;
        altitudeColor(point.y, scratchColor);
        const fade = Math.pow(i / (TRAIL_SAMPLES - 1), 1.2) * pose.visibility;
        colors[i * 3] = scratchColor.r * fade;
        colors[i * 3 + 1] = scratchColor.g * fade;
        colors[i * 3 + 2] = scratchColor.b * fade;
      }

      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;

      const tipPoint = pose.trail[TRAIL_SAMPLES - 1];
      this.head.set(tipPoint.x, tipPoint.y, tipPoint.z);
      altitudeColor(this.head.y, this.color);
      core.position.copy(this.head);
      glow.position.copy(this.head);
      hit.position.copy(this.head);
      const closeness = 1 - Math.min(this.head.y / 28, 1);
      glow.scale.setScalar(2.1 + closeness * 1.2);
      core.material.color.copy(this.color).lerp(WHITE, 0.28);
      core.material.opacity = pose.visibility;
      glow.material.color.copy(this.color);
      glow.material.opacity = 0.95 * pose.visibility;
    },
    dispose() {
      geometry.dispose();
      line.material.dispose();
      core.geometry.dispose();
      core.material.dispose();
      glow.material.dispose();
      hit.geometry.dispose();
      hit.material.dispose();
    },
  };

  flight.hit.userData.flight = flight;
  return flight;
}

function altitudeColor(y, out) {
  if (y < 7) out.copy(LOW).lerp(MID, y / 7);
  else if (y < 26) out.copy(MID);
  else out.copy(MID).lerp(HIGH, THREE.MathUtils.clamp((y - 26) / 16, 0, 1));
  return out;
}

const flightInfo = new Map();

function loadFlightInfo(flight) {
  if (flight.info) return;
  const cached = flightInfo.get(flight.id);
  if (cached) {
    flight.info = cached;
    return;
  }
  if (flight.infoId === flight.id) return;
  flight.infoId = flight.id;
  const id = flight.id;
  const callsign = encodeURIComponent(flight.callsign || '');
  fetch(`/api/flight?icao24=${id}&callsign=${callsign}`)
    .then((response) => (response.ok ? response.json() : null))
    .then((info) => {
      if (!info) {
        flight.infoId = '';
        return;
      }
      flightInfo.set(id, info);
      flight.info = info;
    })
    .catch(() => {
      flight.infoId = '';
    });
}

function formatVerticalSpeed(fpm) {
  if (fpm == null || Math.abs(fpm) < 400) return '';
  const rounded = Math.round(Math.abs(fpm) / 100) * 100;
  return `  ·  ${fpm > 0 ? '↑' : '↓'} ${rounded.toLocaleString('en-US')} ft/min`;
}

function formatAltitude(feet) {
  if (feet >= 18000) return `FL${String(Math.round(feet / 100)).padStart(3, '0')}`;
  return `${Math.round(feet / 100) * 100} ft`;
}

function formatHeading(heading) {
  const degrees = Math.round(((heading % 360) + 360) % 360);
  return `${String(degrees).padStart(3, '0')}°`;
}
