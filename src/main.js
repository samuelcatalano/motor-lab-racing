import { tracks, makeTrack, makeTimer } from './track.js';
import { drive, spawn } from './drive.js';
import { createWorld } from './world.js';
import { WebGPUUnavailableError } from './webgpu-renderer.js';
import { makeSound } from './sound.js';
import { times } from './conditions.js';

const get = id => document.getElementById(id);
const trackId = new URLSearchParams(location.search).get('pista');
const definition = tracks.find(track => track.id === trackId) ?? tracks[0];
const track = makeTrack(definition);
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const weatherControl = get('weather'), hourControl = get('hour');
let wet = new URLSearchParams(location.search).get('clima') === 'chuva';
const requestedTime = new URLSearchParams(location.search).get('hora');
let hour = Object.hasOwn(times, requestedTime) ? requestedTime : 'day';
let timer = makeTimer(track, storage, wet);
weatherControl.value = wet ? 'rain' : 'clear';
hourControl.value = hour;
const sound = makeSound();
let kart = spawn(track), camera = 0, time = 0, accumulator = 0;
let state = 'menu', previous = 0, snap = true;
const down = new Set();
const touch = new Map();
const step = 1 / 120;
const hud = document.querySelector('.hud');
let world;

const format = value => {
  if (value === null || value === 0) return '—';
  const ms = Math.max(0, Math.floor(value * 1000));
  return String(Math.floor(ms / 60000)).padStart(2, '0') + ':'
    + String(Math.floor(ms / 1000) % 60).padStart(2, '0') + '.'
    + String(ms % 1000).padStart(3, '0');
};
function setText(id, value) {
  const element = get(id);
  if (element.textContent !== value) element.textContent = value;
}
function reset() {
  kart = spawn(track);
  timer.reset();
  world?.clearTireTrail();
  snap = true;
  accumulator = 0;
}
function applyConditions() {
  world?.setConditions(hour, wet);
  setText('conditions-hud', times[hour].hour + ' · ' + (wet ? 'Chuva' : 'Céu aberto'));
  setText('menu-best', timer.best ? format(timer.best) : 'Sem volta registrada');
  snap = true;
}
weatherControl.addEventListener('change', () => {
  const rain = weatherControl.value === 'rain';
  if (rain === wet) return;
  wet = rain;
  timer = makeTimer(track, storage, wet);
  reset();
  applyConditions();
});
hourControl.addEventListener('change', () => {
  hour = hourControl.value;
  applyConditions();
});
function mode(next) {
  state = next;
  const playing = next === 'drive';
  down.clear();
  touch.clear();
  accumulator = 0;
  get('menu').hidden = playing;
  hud.hidden = !playing;
  get('pause').hidden = !playing;
  get('camera').hidden = !playing;
  get('touch').hidden = !playing;
  get('restart').hidden = next !== 'pause';
  if (next === 'pause') {
    setText('mode', 'Pausado');
    get('start').firstChild.textContent = 'Voltar à pista ';
    setText('menu-best', timer.best ? format(timer.best) : 'Sem volta registrada');
    get('start').focus();
  } else if (playing) {
    get('scene').focus({preventScroll:true});
  }
}
function syncSound() {
  setText('sound', sound.enabled ? 'Som ligado' : 'Som desligado');
  get('sound').setAttribute('aria-pressed', String(sound.enabled));
}
syncSound();
get('sound').addEventListener('click', () => {
  sound.toggle();
  if (sound.enabled && state === 'drive') void sound.activate();
  syncSound();
});
get('scene').tabIndex = -1;
get('start').addEventListener('click', () => {
  if (state === 'menu') reset();
  void sound.activate();
  mode('drive');
});
get('pause').addEventListener('click', () => mode('pause'));
function changeCamera() {
  camera = (camera + 1) % 3;
  const names = ['Traseira próxima', 'Traseira ampla', 'Visão do piloto'];
  get('camera').setAttribute('aria-label', 'Câmera atual: ' + names[camera] + '. Alternar câmera');
  snap = true;
}
get('camera').addEventListener('click', () => {
  changeCamera();
  get('scene').focus({preventScroll:true});
});
get('restart').addEventListener('click', () => {
  reset();
  mode('drive');
});
const drivingKeys = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);
window.addEventListener('keydown', e => {
  if (e.altKey || e.metaKey || e.ctrlKey) return;
  if (state === 'drive' && drivingKeys.has(e.code)) {
    e.preventDefault();
    down.add(e.code);
  }
  if (e.repeat) return;
  if (e.code === 'Escape' && state !== 'menu') {
    e.preventDefault();
    mode(state === 'pause' ? 'drive' : 'pause');
  }
  if (state === 'drive' && e.code === 'KeyC') changeCamera();
  if (state === 'drive' && e.code === 'KeyR') reset();
});
window.addEventListener('keyup', e => down.delete(e.code));
function autoPause() { if (state === 'drive') mode('pause'); }
window.addEventListener('blur', autoPause);
document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
for (const button of document.querySelectorAll('[data-key]')) {
  button.addEventListener('pointerdown', e => {
    button.setPointerCapture(e.pointerId);
    touch.set(e.pointerId, button.dataset.key);
  });
  for (const event of ['pointerup','pointercancel','lostpointercapture']) {
    button.addEventListener(event, e => touch.delete(e.pointerId));
  }
}
function readInput() {
  const held = (a, b) => down.has(a) || down.has(b) || [...touch.values()].includes(b);
  const pads = navigator.getGamepads?.() ?? [];
  const pad = Array.from(pads).find(p => p?.mapping === 'standard');
  const stick = pad?.axes[0] ?? 0;
  return {
    throttle: Math.max(Number(held('KeyW','ArrowUp')), pad?.buttons[7]?.value ?? 0),
    brake: Math.max(Number(held('KeyS','ArrowDown')), pad?.buttons[6]?.value ?? 0),
    steer: Number(held('KeyD','ArrowRight')) - Number(held('KeyA','ArrowLeft'))
      || (Math.abs(stick) > .13 ? stick : 0),
  };
}

const map = get('map');
const ctx = map.getContext('2d');
const xs = track.samples.map(p => p.x), zs = track.samples.map(p => p.z);
const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
const scale = Math.min(224 / (maxX - minX), 117 / (maxZ - minZ));
const mapX = x => 128 + (x - (minX + maxX) / 2) * scale;
const mapY = z => 75.5 + (z - (minZ + maxZ) / 2) * scale;
const route = new Path2D();
track.samples.forEach((p, i) => {
  if (i === 0) route.moveTo(mapX(p.x), mapY(p.z));
  else route.lineTo(mapX(p.x), mapY(p.z));
});
route.closePath();
function dashboard() {
  const elapsed = timer.elapsed(time);
  const lapTime = format(elapsed);
  setText('current', lapTime);
  setText('last', format(timer.last));
  setText('best', format(timer.best));
  setText('speed', String(Math.round(kart.speed * 3.6)).padStart(3, '0'));
  setText('status', timer.invalid ? 'Volta inválida · passe pela linha para tentar de novo'
    : elapsed === null ? 'Cruze a linha para iniciar a volta'
      : timer.record && elapsed < 4 ? 'Novo recorde pessoal' : '');
  ctx.clearRect(0, 0, 256, 151);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 11;
  ctx.strokeStyle = '#101817da';
  ctx.stroke(route);
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#f4f0d6';
  ctx.stroke(route);
  const {point} = track.checkpoints[0];
  ctx.fillStyle = '#fff';
  ctx.fillRect(mapX(point.x) - 4, mapY(point.z) - 4, 8, 8);
  ctx.fillStyle = '#ffcf61';
  ctx.beginPath();
  ctx.arc(mapX(kart.x), mapY(kart.z), 6, 0, Math.PI * 2);
  ctx.fill();
  return lapTime;
}
function frame(now) {
  const dt = previous ? Math.min(.075, (now - previous) / 1000) : 0;
  previous = now;
  if (state === 'drive') {
    const input = readInput();
    accumulator += dt;
    while (accumulator >= step) {
      const before = drive(kart, input, track, step, Number(wet));
      time += step;
      timer.update(before, kart, time, step, before.offTrack);
      accumulator -= step;
    }
    sound.update(true, kart.speed, input.throttle, kart.squeal, kart.steer, wet ? 1 : 0);
    const lapTime = dashboard();
    world.render(kart, dt, camera, snap, lapTime);
    snap = false;
  } else {
    sound.update(false, 0, 0);
    if (snap) {
      world.render(kart, 0, camera, true, format(timer.elapsed(time)));
      snap = false;
    }
  }
  requestAnimationFrame(frame);
}

async function startGame() {
  try {
    world = await createWorld(get('scene'), track);
    applyConditions();
    world.render(kart, 0, camera, true);
    snap = false;
    setText('title', track.name);
    setText('summary', Math.round(track.length) + ' m de circuito · sessão solo');
    setText('menu-best', timer.best ? format(timer.best) : 'Sem volta registrada');
    get('start').disabled = false;
    weatherControl.disabled = hourControl.disabled = false;
    window.addEventListener('resize', () => { snap = true; });
    requestAnimationFrame(frame);
  } catch (error) {
    setText('summary', error instanceof WebGPUUnavailableError
      ? error.message
      : 'Não foi possível iniciar a cena 3D. Verifique se o navegador pode usar WebGPU.');
    console.error(error);
  }
}
void startGame();
