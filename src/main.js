import { tracks, makeTrack, makeTimer } from './track.js';
import { drive, spawn } from './drive.js';
import { createWorld } from './world.js';
import { WebGPUUnavailableError } from './webgpu-renderer.js';
import { makeSound } from './sound.js';
import { times } from './conditions.js';

const get = id => document.getElementById(id);
if (location.search) history.replaceState(history.state, '', location.pathname + location.hash);
const definition = tracks[0];
const track = makeTrack(definition);
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const readChoice = key => { try { return storage?.getItem('mlr.' + key); } catch { return null; } };
const saveChoice = (key, value) => { try { storage?.setItem('mlr.' + key, value); } catch { /* Storage is optional. */ } };
const weatherControl = get('weather'), hourControl = get('hour');
let wet = readChoice('weather') === 'rain';
const savedTime = readChoice('period');
let hour = Object.hasOwn(times, savedTime) ? savedTime : 'day';
let timer = makeTimer(track, storage, wet);
const periodNames = {day:'Dia', dusk:'Final da tarde', night:'Noite'};
let openPicker = null;
let conditionsBusy = true;
function makePicker(trigger) {
  const box = trigger.closest('.picker');
  const list = get(trigger.getAttribute('aria-controls'));
  const options = [...list.querySelectorAll('[role="option"]')];
  const close = restoreFocus => {
    if (list.hidden) return;
    list.hidden = true;
    box.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    if (openPicker?.trigger === trigger) openPicker = null;
    if (restoreFocus) trigger.focus();
  };
  const open = () => {
    if (trigger.disabled) return;
    openPicker?.close(false);
    list.hidden = false;
    box.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    openPicker = {trigger, close};
    options.find(option => option.dataset.value === trigger.value)?.focus();
  };
  const set = (value, notify = false) => {
    const selected = options.find(option => option.dataset.value === value);
    if (!selected) return;
    trigger.value = value;
    trigger.querySelector('.picker-value').textContent = selected.dataset.label;
    for (const option of options) {
      option.setAttribute('aria-selected', String(option === selected));
    }
    if (notify) trigger.dispatchEvent(new Event('change', {bubbles:true}));
  };
  trigger.addEventListener('click', () => list.hidden ? open() : close(true));
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open();
    } else if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  });
  list.addEventListener('keydown', event => {
    const index = options.indexOf(document.activeElement);
    const next = {ArrowDown:(index + 1) % options.length,
      ArrowUp:(index - 1 + options.length) % options.length,
      Home:0, End:options.length - 1}[event.key];
    if (next !== undefined) {
      event.preventDefault();
      options[next].focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') close(false);
  });
  for (const option of options) option.addEventListener('click', () => {
    if (trigger.disabled) return;
    close(true);
    set(option.dataset.value, true);
  });
  document.addEventListener('pointerdown', event => {
    if (!box.contains(event.target)) close(false);
  });
  return {set};
}
const weatherPicker = makePicker(weatherControl), hourPicker = makePicker(hourControl);
function syncPickers() {
  weatherPicker.set(wet ? 'rain' : 'clear');
  hourPicker.set(hour);
}
syncPickers();
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
function reset(nextKart = spawn(track)) {
  kart = nextKart;
  timer.reset();
  world?.clearTireTrail();
  snap = true;
  accumulator = 0;
}
function applyConditions() {
  world?.setConditions(hour, wet);
  setText('conditions-hud', periodNames[hour] + ' · ' + (wet ? 'Chuva' : 'Céu aberto'));
  setText('menu-best', timer.best ? format(timer.best) : 'Sem volta registrada');
  snap = true;
}
function rememberConditions() {
  saveChoice('weather', wet ? 'rain' : 'clear');
  saveChoice('period', hour);
}
const afterPaint = () => new Promise(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(resolve)));
function updateLoading(message, {error = false, progress = null, detail = ''} = {}) {
  const status = get('loading-status');
  const track = get('loading-track');
  status.hidden = false;
  status.dataset.error = String(error);
  setText('loading-copy', message);
  setText('loading-value', detail);
  const determinate = Number.isFinite(progress);
  track.dataset.indeterminate = String(!determinate);
  if (determinate) {
    const value = Math.max(0, Math.min(100, progress));
    track.setAttribute('aria-valuenow', String(Math.round(value)));
    track.setAttribute('aria-valuetext', detail || Math.round(value) + '%');
    get('loading-progress').style.width = value + '%';
  } else {
    track.removeAttribute('aria-valuenow');
    track.removeAttribute('aria-valuetext');
  }
}
function showLoading(message, error = false) {
  const main = document.querySelector('main');
  main.dataset.loading = 'true';
  main.dataset.ready = 'false';
  get('loading-track').hidden = false;
  updateLoading(message, {error});
}
function showPreGridReady() {
  const main = document.querySelector('main');
  main.dataset.loading = 'true';
  main.dataset.ready = 'true';
  world?.setKartVisible(false);
  if (world) world.render(kart, 0, camera, true, format(timer.elapsed(time)));
  updateLoading('Kart e piloto prontos. Entre na pista quando quiser.', {progress:100, detail:'PRONTO'});
  get('loading-track').hidden = true;
}
function megabytes(bytes) { return (bytes / 1_048_576).toFixed(1); }
function loadingProgress({stage, loaded, total, progress}, preparing = 'Preparando cena') {
  if (stage === 'assets') updateLoading('Carregando arquivos: ' + loaded + ' de ' + total);
  else if (stage === 'kart-download') {
    const detail = total > 0 ? Math.round(loaded / total * 100) + '%' : megabytes(loaded) + ' MB';
    updateLoading(total > 0
      ? 'Baixando kart e piloto · ' + megabytes(loaded) + ' / ' + megabytes(total) + ' MB'
      : 'Baixando kart e piloto · ' + megabytes(loaded) + ' MB',
    {progress:total > 0 ? loaded / total * 100 : null, detail});
  }
  else if (stage === 'kart-parse') updateLoading('Montando modelo 3D…');
  else if (stage === 'renderer') updateLoading('Inicializando WebGPU…');
  else if (stage === 'scene') updateLoading('Montando circuito…');
  else if (stage === 'pipelines') updateLoading(Number.isFinite(progress) && Number.isFinite(total)
    ? preparing + ' · ' + progress + ' de ' + total + ' pipelines' : preparing + '…',
    {progress:Number.isFinite(progress) && Number.isFinite(total) && total > 0
      ? progress / total * 100 : null,
    detail:Number.isFinite(progress) && Number.isFinite(total) && total > 0
      ? Math.round(progress / total * 100) + '%' : ''});
}
function setConditionsBusy(busy) {
  conditionsBusy = busy;
  if (busy) openPicker?.close(false);
  get('conditions').setAttribute('aria-busy', String(busy));
  weatherControl.disabled = hourControl.disabled = busy;
  get('start').disabled = get('restart').disabled = busy;
}
async function changeConditions(nextHour, nextWet, preparing) {
  syncPickers();
  if (!world || conditionsBusy || (nextHour === hour && nextWet === wet)) return;
  const previous = {hour, wet, kart, timer};
  const weatherChanged = nextWet !== wet;
  const candidateKart = weatherChanged ? spawn(track) : kart;
  const focusedControl = document.activeElement;
  setConditionsBusy(true);
  world.setKartVisible(false);
  document.querySelector('main').dataset.loading = 'true';
  showLoading(preparing + '…');
  try {
    await afterPaint();
    await world.prepareConditions(nextHour, nextWet, progress => loadingProgress(progress, preparing), {
      kart:candidateKart, mode:camera, lapTime:weatherChanged ? '—' : format(timer.elapsed(time)),
    });
    hour = nextHour;
    wet = nextWet;
    if (weatherChanged) {
      timer = makeTimer(track, storage, wet);
      reset(candidateKart);
    }
    applyConditions();
    world.render(kart, 0, camera, true, format(timer.elapsed(time)));
    snap = false;
    syncPickers();
    rememberConditions();
    await afterPaint();
    showPreGridReady();
  } catch (error) {
    ({hour, wet, kart, timer} = previous);
    applyConditions();
    syncPickers();
    try {
      world.render(kart, 0, camera, true, format(timer.elapsed(time)));
      snap = false;
    } catch (restoreError) {
      console.error('Não foi possível redesenhar a condição anterior', restoreError);
    }
    showLoading('Não foi possível preparar a condição. A seleção anterior foi mantida. Tente novamente.', true);
    document.querySelector('main').dataset.ready = 'true';
    get('loading-track').hidden = true;
    console.error(error);
  } finally {
    setConditionsBusy(false);
    if ((focusedControl === weatherControl || focusedControl === hourControl) &&
        document.activeElement === document.body) focusedControl.focus({preventScroll:true});
  }
}
weatherControl.addEventListener('change', () => {
  const rain = weatherControl.value === 'rain';
  void changeConditions(hour, rain, rain ? 'Preparando chuva' : 'Preparando pista seca');
});
hourControl.addEventListener('change', () => {
  void changeConditions(hourControl.value, wet, 'Preparando iluminação');
});
function mode(next) {
  if (next === 'drive' && conditionsBusy) return;
  state = next;
  const playing = next === 'drive';
  if (playing) {
    document.querySelector('main').removeAttribute('data-loading');
    document.querySelector('main').removeAttribute('data-ready');
    get('loading-status').hidden = true;
    world?.setKartVisible(true);
  }
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
function requestLandscapeOnMobile() {
  if (!matchMedia('(pointer: coarse)').matches) return;
  const orientation = screen.orientation;
  if (typeof orientation?.lock !== 'function') return;
  try { void orientation.lock('landscape').catch(() => {}); } catch { /* Portrait gate remains if locking is unavailable. */ }
}
get('start').addEventListener('click', () => {
  if (conditionsBusy) return;
  if (state === 'menu') reset();
  requestLandscapeOnMobile();
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
  if (conditionsBusy) return;
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
    if (snap && !conditionsBusy) {
      world.render(kart, 0, camera, true, format(timer.elapsed(time)));
      snap = false;
    }
  }
  requestAnimationFrame(frame);
}

async function startGame() {
  try {
    setConditionsBusy(true);
    world = await createWorld(get('scene'), track, {onProgress:loadingProgress});
    get('renderer-status').hidden = false;
    showLoading('Preparando cena…');
    await afterPaint();
    await world.prepareConditions(hour, wet, loadingProgress);
    applyConditions();
    world.render(kart, 0, camera, true);
    snap = false;
    setText('circuit-name', track.name);
    setText('summary', Math.round(track.length) + ' m de circuito · sessão solo');
    setText('menu-best', timer.best ? format(timer.best) : 'Sem volta registrada');
    await afterPaint();
    showPreGridReady();
    setConditionsBusy(false);
    window.addEventListener('resize', () => { snap = true; });
    requestAnimationFrame(frame);
  } catch (error) {
    setText('summary', 'Inicialização interrompida');
    get('reload').hidden = false;
    showLoading(error instanceof WebGPUUnavailableError
      ? error.message
      : 'Não foi possível iniciar a cena 3D. Verifique se o navegador pode usar WebGPU e recarregue o jogo.', true);
    console.error(error);
  }
}
void startGame();
