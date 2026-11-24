import assert from 'node:assert/strict';
import test from 'node:test';
import { gridMarkings } from '../src/track-finishes.js';

test('the starting grid is staggered in metres before the timing line', () => {
  for (const length of [564, 920]) {
    const slots = gridMarkings(length);
    assert.equal(slots.length, 7);
    slots.forEach((slot, index) => {
      assert.ok(Math.abs(slot.front * length + 3.5 + index * 3.5) < 1e-9);
      assert.ok(Math.abs((slot.front - slot.back) * length - 1.45) < 1e-9);
      assert.equal(Math.sign(slot.offsetFraction), index % 2 ? -1 : 1);
    });
  }
});
