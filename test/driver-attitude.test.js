import assert from 'node:assert/strict';
import test from 'node:test';
import { driverAttitude } from '../src/kart-view.js';

test('driver holds a neutral pose at rest', () => {
  assert.deepEqual(driverAttitude(0, 1, 1), {lean:0, pitch:0, look:0});
});
test('driver turns his helmet toward the corner and braces under braking', () => {
  const right = driverAttitude(18, 1, 0);
  const left = driverAttitude(18, -1, 0);
  assert.equal(right.look, -left.look);
  assert.equal(right.lean, -left.lean);
  assert.ok(right.look > .08 && right.look < .25);
  assert.ok(driverAttitude(18, 0, 1).pitch > .02);
});
