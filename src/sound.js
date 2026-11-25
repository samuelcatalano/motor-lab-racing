const SETTING_KEY = 'mlr.sound';
const DEFAULT_SETTINGS = Object.freeze({master:1, music:1, sfx:1, ambient:1, muted:false});
const clamp = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : null;

export function normalizeSettings(value = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => {
    if (key === 'muted') return [key, typeof value?.muted === 'boolean' ? value.muted : fallback];
    return [key, clamp(value?.[key]) ?? fallback];
  }));
}

function parameter(param, value, now, duration = .08) {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, duration);
}

function envelope(ctx, node, bus, start, peak, attack = .008, release = .12) {
  const level = ctx.createGain();
  level.gain.setValueAtTime(0, start);
  level.gain.linearRampToValueAtTime(peak, start + attack);
  level.gain.setValueAtTime(peak, start + Math.max(attack, release * .35));
  level.gain.exponentialRampToValueAtTime(.0001, start + release);
  node.connect(level).connect(bus);
  node.start(start);
  node.stop(start + release + .02);
}

function tireVoice(ctx, noise, bus, side) {
  const tone = ctx.createOscillator();
  tone.type = 'triangle';
  const overtone = ctx.createOscillator();
  const overtoneLevel = ctx.createGain();
  overtoneLevel.gain.value = .16;
  const scrape = ctx.createBufferSource();
  scrape.buffer = noise;
  scrape.loop = true;
  const rubber = ctx.createBiquadFilter();
  rubber.type = 'bandpass';
  rubber.Q.value = .85;
  const scrapeLevel = ctx.createGain();
  scrapeLevel.gain.value = 1.35;
  const level = ctx.createGain();
  level.gain.value = 0;
  const pan = ctx.createStereoPanner();
  pan.pan.value = side * .46;
  tone.connect(level);
  overtone.connect(overtoneLevel).connect(level);
  scrape.connect(rubber).connect(scrapeLevel).connect(level);
  level.connect(pan).connect(bus);
  tone.start();
  overtone.start();
  scrape.start(0, side < 0 ? .21 : .69);
  let previous = 0;
  return (squeal, speed, steer, time) => {
    const pitch = (825 + squeal * 360 + speed * 7) * (1 + .029 * side)
      + Math.sin(time * 46 + side) * 24 + Math.sin(time * 91 - side) * 10;
    const grip = squeal * (1 - steer * side * .26);
    const volume = .135 * grip ** 1.25 * (1 + .14 * Math.sin(time * 54 + side));
    tone.frequency.setTargetAtTime(pitch, time, .015);
    overtone.frequency.setTargetAtTime(pitch * 2.06, time, .015);
    rubber.frequency.setTargetAtTime(1260 + speed * 29, time, .05);
    level.gain.setTargetAtTime(volume, time, volume > previous ? .018 : .052);
    previous = volume;
  };
}

function menuMusic(ctx, bus) {
  const bpm = 132;
  const eighth = 60 / bpm / 2;
  const chords = [
    [55, 65.41, 82.41], [49, 58.27, 73.42], [43.65, 55, 65.41], [49, 58.27, 73.42],
  ];
  const bass = [55, 0, 55, 82.41, 0, 55, 49, 0, 49, 73.42, 0, 49, 43.65, 0, 55, 65.41,
    49, 0, 49, 73.42, 0, 49, 58.27, 0, 43.65, 0, 43.65, 65.41, 0, 55, 49, 0];
  const bars = [0, 1, 2, 1];
  let nextStep = 0;
  let nextTime = 0;
  let timer = null;
  let running = false;
  const tone = (frequency, start, length, type, peak, filterHz, detune = 0) => {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterHz;
    osc.type = type;
    osc.frequency.value = frequency;
    osc.detune.value = detune;
    const level = ctx.createGain();
    level.gain.setValueAtTime(.0001, start);
    level.gain.exponentialRampToValueAtTime(peak, start + .025);
    level.gain.setTargetAtTime(.0001, start + length * .38, length * .24);
    osc.connect(filter).connect(level).connect(bus);
    osc.start(start);
    osc.stop(start + length);
  };
  const metallic = (start, peak = .014) => {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const level = ctx.createGain();
    filter.type = 'highpass';
    filter.frequency.value = 2450;
    osc.type = 'triangle';
    osc.frequency.value = 1320;
    osc.detune.value = 9;
    level.gain.setValueAtTime(0, start);
    level.gain.linearRampToValueAtTime(peak, start + .004);
    level.gain.exponentialRampToValueAtTime(.0001, start + .095);
    osc.connect(filter).connect(level).connect(bus);
    osc.start(start);
    osc.stop(start + .115);
  };
  const tick = () => {
    if (!running) return;
    const now = ctx.currentTime;
    if (now - nextTime > .05) {
      const skipped = Math.ceil((now - nextTime) / eighth);
      nextStep += skipped;
      nextTime = Math.max(now, nextTime + skipped * eighth);
    }
    const horizon = now + .14;
    while (nextTime < horizon) {
      const index = nextStep % 32;
      const start = nextTime;
      const bar = Math.floor(index / 8);
      if (index % 8 === 0) {
        for (const [i, hz] of chords[bars[bar]].entries()) tone(hz, start, eighth * 7.7, 'sawtooth', .026, 560, i % 2 ? -4 : 4);
      }
      const bassNote = bass[index];
      if (bassNote) tone(bassNote, start, eighth * .82, 'triangle', .072, 185);
      if (index % 8 === 0 || index % 8 === 4) tone(index % 8 ? 58 : 46, start, .18, 'sine', .045, 100);
      if (index % 8 === 2 || index % 8 === 6) metallic(start, index % 8 ? .008 : .013);
      if (index % 4 === 3) metallic(start, .006);
      nextStep++;
      nextTime += eighth;
    }
    timer = setTimeout(tick, 45);
  };
  return {
    start() { if (running) return; running = true; nextStep = 0; nextTime = ctx.currentTime; tick(); },
    stop() { running = false; clearTimeout(timer); },
  };
}

export function makeSound(options = {}) {
  let storage = options.storage;
  if (!Object.hasOwn(options, 'storage')) {
    try { storage = globalThis.localStorage; } catch { storage = null; }
  }
  let ctx, engine, engineLevel, filter, tires, rainLevel, rainTone, masterBus, musicBus, sfxBus, ambientBus, garageBus, garageTone, garageLevel, garageRainLevel, music;
  let settings = normalizeSettings();
  let mode = 'menu';
  let wet = false;
  try { const saved = storage?.getItem(SETTING_KEY); if (saved) settings = normalizeSettings(JSON.parse(saved)); } catch { /* Audio preferences are optional. */ }

  function ramp(param, value, now = ctx?.currentTime ?? 0, seconds = .16) {
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
    else {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
    param.linearRampToValueAtTime(value, now + seconds);
  }
  function applySettings() {
    if (!ctx) return;
    const now = ctx.currentTime;
    ramp(masterBus.gain, settings.muted ? 0 : settings.master, now, .12);
    ramp(musicBus.gain, settings.music * (mode === 'menu' ? .46 : 0), now);
    ramp(sfxBus.gain, settings.sfx * .72, now);
    ramp(ambientBus.gain, settings.ambient * (mode === 'menu' ? .7 : .55), now);
    ramp(garageBus.gain, mode === 'menu' ? .72 : 0, now);
  }
  function persist() {
    try { storage?.setItem(SETTING_KEY, JSON.stringify(settings)); } catch { /* Audio preferences are optional. */ }
  }
  function createAudio() {
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) return;
    ctx = new Audio();
    masterBus = ctx.createGain();
    musicBus = ctx.createGain();
    sfxBus = ctx.createGain();
    ambientBus = ctx.createGain();
    garageBus = ctx.createGain();
    for (const bus of [musicBus, sfxBus, ambientBus]) bus.connect(masterBus);
    garageBus.connect(ambientBus);
    masterBus.connect(ctx.destination);
    masterBus.gain.value = 0;
    musicBus.gain.value = 0;
    sfxBus.gain.value = 0;
    ambientBus.gain.value = 0;
    garageBus.gain.value = 0;

    engine = ctx.createOscillator();
    filter = ctx.createBiquadFilter();
    engineLevel = ctx.createGain();
    engine.type = 'sawtooth';
    filter.type = 'lowpass';
    engineLevel.gain.value = 0;
    engine.connect(filter).connect(engineLevel).connect(sfxBus);
    engine.start();

    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    tires = [-1, 1].map(side => tireVoice(ctx, noise, sfxBus, side));
    const rain = ctx.createBufferSource();
    rain.buffer = noise;
    rain.loop = true;
    rainTone = ctx.createBiquadFilter();
    rainTone.type = 'lowpass';
    rainLevel = ctx.createGain();
    rainLevel.gain.value = 0;
    rain.connect(rainTone).connect(rainLevel).connect(ambientBus);
    rain.start();

    const garageNoise = ctx.createBufferSource();
    garageNoise.buffer = noise;
    garageNoise.loop = true;
    const garageFilter = ctx.createBiquadFilter();
    garageFilter.type = 'lowpass';
    garageFilter.frequency.value = 260;
    garageLevel = ctx.createGain();
    garageLevel.gain.value = wet ? .006 : .012;
    garageTone = ctx.createOscillator();
    garageTone.type = 'sine';
    garageTone.frequency.value = 48;
    const humLevel = ctx.createGain();
    humLevel.gain.value = .012;
    garageNoise.connect(garageFilter).connect(garageLevel).connect(garageBus);
    garageTone.connect(humLevel).connect(garageBus);
    garageNoise.start();
    garageTone.start();

    const garageRain = ctx.createBufferSource();
    garageRain.buffer = noise;
    garageRain.loop = true;
    const garageRainFilter = ctx.createBiquadFilter();
    garageRainFilter.type = 'lowpass';
    garageRainFilter.frequency.value = 1250;
    garageRainLevel = ctx.createGain();
    garageRainLevel.gain.value = wet ? .012 : 0;
    garageRain.connect(garageRainFilter).connect(garageRainLevel).connect(garageBus);
    garageRain.start();

    music = menuMusic(ctx, musicBus);
    applySettings();
  }
  function setMode(nextMode) {
    if (!['menu', 'drive', 'pause'].includes(nextMode)) return;
    mode = nextMode;
    if (mode === 'menu') music?.start();
    else music?.stop();
    applySettings();
  }
  const visibility = () => {
    if (!ctx) return;
    if (globalThis.document?.hidden) void ctx.suspend?.().catch?.(() => {});
    else void ctx.resume?.().catch?.(() => {});
  };
  globalThis.document?.addEventListener?.('visibilitychange', visibility);

  const sound = {
    get enabled() { return !settings.muted; },
    get settings() { return {...settings}; },
    async activate() {
      try {
        if (!ctx) createAudio();
        if (!ctx) return;
        await ctx.resume();
        if (mode === 'menu') music?.start();
        applySettings();
      } catch { /* Driving works without audio. */ }
    },
    configure(partial = {}) {
      settings = normalizeSettings({...settings, ...partial});
      persist();
      applySettings();
      return {...settings};
    },
    toggle() { return this.configure({muted:!settings.muted}); },
    setMode,
    setWeather(value) {
      wet = Boolean(value);
      if (garageLevel && ctx) {
        parameter(garageLevel.gain, wet ? .006 : .012, ctx.currentTime, .2);
        parameter(garageRainLevel.gain, wet ? .012 : 0, ctx.currentTime, .35);
      }
    },
    playUiCue(name = 'select') {
      if (!ctx || settings.muted || !settings.sfx) return;
      const now = ctx.currentTime;
      const cue = {
        select:[880, .035, 'triangle'], toggle:[640, .055, 'sine'], start:[440, .16, 'triangle'],
        pause:[330, .13, 'sine'], confirm:[660, .11, 'triangle'],
      }[name] || [880, .035, 'triangle'];
      const osc = ctx.createOscillator();
      osc.type = cue[2];
      osc.frequency.setValueAtTime(cue[0], now);
      if (name === 'start') osc.frequency.linearRampToValueAtTime(990, now + .14);
      envelope(ctx, osc, sfxBus, now, .045, .006, cue[1]);
    },
    update(active, speed, throttle, squeal = 0, steer = 0, wetness = 0) {
      if (!rainLevel) return;
      const time = ctx.currentTime;
      engine.frequency.setTargetAtTime(43 + speed * 5.9 + throttle * 17, time, .075);
      filter.frequency.setTargetAtTime(130 + speed * 16 + throttle * 230, time, .09);
      engineLevel.gain.setTargetAtTime(active && !settings.muted ? .029 + throttle * .036 : 0, time, .075);
      const stress = !settings.muted && active ? squeal : 0;
      for (const updateTire of tires) updateTire(stress, speed, steer, time);
      rainTone.frequency.setTargetAtTime(870 + speed * 60, time, .19);
      rainLevel.gain.setTargetAtTime(!settings.muted && active ? wetness * (.105 + speed * .004) : 0, time, .14);
    },
  };
  const firstGesture = () => {
    globalThis.document?.removeEventListener?.('pointerdown', firstGesture);
    globalThis.document?.removeEventListener?.('keydown', firstGesture);
    void sound.activate();
  };
  globalThis.document?.addEventListener?.('pointerdown', firstGesture, {once:true, passive:true});
  globalThis.document?.addEventListener?.('keydown', firstGesture, {once:true});
  return sound;
}
