import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSound, normalizeSettings } from '../src/sound.js';

test('normalizes persisted audio gains and clamps out-of-range values', () => {
  assert.deepEqual(normalizeSettings({master:1.4, music:-1, sfx:.25, ambient:'bad'}), {
    master:1, music:0, sfx:.25, ambient:1, muted:false,
  });
});

test('sound configure persists partial updates and settings returns a copy', () => {
  const values = new Map();
  const storage = {getItem:key => values.get(key) ?? null, setItem:(key, value) => values.set(key, value)};
  const sound = makeSound({storage});
  sound.configure({music:.42, muted:true});
  const snapshot = sound.settings;
  snapshot.music = 0;
  assert.deepEqual(sound.settings, {master:1, music:.42, sfx:1, ambient:1, muted:true});
  assert.deepEqual(JSON.parse(values.get('mlr.sound')), sound.settings);
});

test('one shared audio graph starts menu audio, then ramps it out on race transition', async () => {
  class Param {
    value = 0;
    events = [];
    cancelAndHoldAtTime(time) { this.events.push(['hold', time]); }
    cancelScheduledValues(time) { this.events.push(['cancel', time]); }
    setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
    linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['ramp', value, time]); }
    exponentialRampToValueAtTime(value, time) { this.value = value; this.events.push(['exp', value, time]); }
    setTargetAtTime(value, time, constant) { this.value = value; this.events.push(['target', value, time, constant]); }
  }
  class Node {
    connections = [];
    gain = new Param();
    frequency = new Param();
    detune = new Param();
    pan = new Param();
    Q = new Param();
    events = [];
    connect(node) { this.connections.push(node); return node; }
    start(...args) { this.events.push(['start', ...args]); }
    stop(...args) { this.events.push(['stop', ...args]); }
  }
  class Context {
    static instances = [];
    currentTime = 0;
    sampleRate = 64;
    nodes = [];
    destination = new Node();
    constructor() { Context.instances.push(this); }
    createGain() { return this.node('gain'); }
    createOscillator() { return this.node('oscillator'); }
    createBiquadFilter() { return this.node('filter'); }
    createStereoPanner() { return this.node('panner'); }
    createBufferSource() { return this.node('buffer-source'); }
    createBuffer(_channels, length) {
      const channel = new Float32Array(length);
      return {getChannelData:() => channel};
    }
    async resume() {}
    async suspend() {}
    node(type) { const node = new Node(); node.type = type; this.nodes.push(node); return node; }
  }
  const previous = globalThis.AudioContext;
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  let delayedTick;
  globalThis.AudioContext = Context;
  globalThis.setTimeout = (callback, delay) => {
    if (delay === 45) { delayedTick = callback; return 45; }
    return previousSetTimeout(callback, delay);
  };
  globalThis.clearTimeout = id => id === 45 ? undefined : previousClearTimeout(id);
  try {
    const sound = makeSound({storage:null});
    sound.setWeather(true);
    await sound.activate();
    const context = Context.instances[0];
    assert.ok(context, 'creates a context after activation');
    assert.equal(Context.instances.length, 1, 'shares one context for all audio');
    assert.equal(typeof delayedTick, 'function', 'schedules a menu music lookahead tick');
    assert.ok(context.nodes.some(node => node.type === 'oscillator' && node.events.some(event => event[0] === 'start')),
      'procedural music and garage/race voices start in the graph: ' + JSON.stringify(context.nodes.map(node => [node.type, node.events])));

    const beforeResume = context.nodes.length;
    context.currentTime = 10.6;
    delayedTick();
    const resumedStarts = context.nodes.slice(beforeResume).flatMap(node => node.events
      .filter(event => event[0] === 'start' && typeof event[1] === 'number').map(event => event[1]));
    assert.ok(resumedStarts.length > 0 && resumedStarts.every(time => time >= context.currentTime),
      'a delayed scheduler tick skips missed beats instead of scheduling a backlog: ' + JSON.stringify(resumedStarts));

    sound.setMode('drive');
    sound.setMode('pause');
    sound.configure({master:.2});
    sound.configure({master:.8});
    const bus = context.nodes.find(node => node.type === 'gain' && node.connections.includes(context.destination));
    assert.ok(bus, 'mix buses feed a single master output');
    const masterParam = bus.gain;
    assert.ok(masterParam.events.filter(event => event[0] === 'hold').length >= 3,
      'rapid setting changes hold their current gain before retargeting');
    const routedBuses = context.nodes.filter(node => node.type === 'gain' && node.connections.includes(bus));
    assert.ok(routedBuses.some(node => node.gain.events.some(event => event[0] === 'ramp' && event[1] === .46)
      && node.gain.events.some(event => event[0] === 'ramp' && event[1] === 0)),
    'menu music gain crossfades from its menu level to zero on race transition');
    assert.ok(context.nodes.some(node => node.type === 'gain'
      && node.gain.events.some(event => event[0] === 'ramp' && event[1] === .72)
      && node.gain.events.filter(event => event[0] === 'ramp' && event[1] === 0).length >= 2),
    'the garage ambience submix fades out for both race and pause');
  } finally {
    globalThis.AudioContext = previous;
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
});
