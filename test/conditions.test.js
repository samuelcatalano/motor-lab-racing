import assert from 'node:assert/strict';
import test from 'node:test';
import { drive } from '../src/drive.js';
import { makeTimer } from '../src/track.js';

const straight = {width:8.5, nearest:() => ({distance:0})};
function simulate(wet, steer, brake, steps) {
  const kart = {x:0,z:0,angle:0,vx:18,vz:0,speed:18,steer:0,spin:0};
  for (let i = 0; i < steps; i++) {
    drive(kart, {throttle:0,steer,brake}, straight, 1/120, wet);
  }
  return kart;
}

test('wet asphalt extends braking and sustains more lateral slip', () => {
  const dry = simulate(0, 0, 1, 120);
  const wet = simulate(1, 0, 1, 120);
  assert.ok(wet.x > dry.x + 2 && wet.speed > dry.speed);
  assert.equal(dry.spray, 0);
  assert.ok(wet.spray > 0);
  assert.equal(wet.smoke, 0);
  const sideslip = kart => Math.abs(-kart.vx * Math.sin(kart.angle) + kart.vz * Math.cos(kart.angle));
  assert.ok(sideslip(simulate(1, 1, 0, 75)) > sideslip(simulate(0, 1, 0, 75)) * 1.2);
});

test('existing dry records and wet records are independent', () => {
  const storage = new Map([['motor-lab:best:circuit','31.4'], ['motor-lab:best:circuit:wet','38.6']]);
  const track = {id:'circuit'};
  assert.equal(makeTimer(track, {getItem:key => storage.get(key)}).best, 31.4);
  assert.equal(makeTimer(track, {getItem:key => storage.get(key)}, true).best, 38.6);
});
