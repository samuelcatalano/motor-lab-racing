import assert from 'node:assert/strict';
import test from 'node:test';
import { tireFeedback } from '../src/tire-feedback.js';

test('normal driving and braking at rest do not create tire effects', () => {
  assert.deepEqual(tireFeedback(0, 0, 1, false), {squeal:0, smoke:0, dust:0});
  assert.deepEqual(tireFeedback(18, .16, 0, false), {squeal:0, smoke:0, dust:0});
});

test('hard braking and sideways slip make sound and smoke on asphalt', () => {
  const braking = tireFeedback(22, 0, 1, false);
  assert.ok(braking.squeal > .55 && braking.smoke > .30);
  assert.ok(tireFeedback(18, 1.3, 0, false).squeal > .35);
  assert.equal(braking.dust, 0);
});

test('off-track stress emits dust instead of asphalt smoke', () => {
  const grass = tireFeedback(18, 1.8, .8, true);
  assert.equal(grass.squeal, 0);
  assert.equal(grass.smoke, 0);
  assert.ok(grass.dust > .5);
});
