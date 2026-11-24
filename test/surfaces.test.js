import assert from 'node:assert/strict';
import test from 'node:test';
import { surfacePixels } from '../src/surfaces.js';

test('surface maps are repeatable, seed dependent and contain separate scalar detail', () => {
  const first = surfacePixels([59, 62, 64], 42, 26, 32);
  const duplicate = surfacePixels([59, 62, 64], 42, 26, 32);
  assert.deepEqual(first, duplicate);
  assert.notDeepEqual(first, surfacePixels([59, 62, 64], 43, 26, 32));
  assert.equal(first.color.length, 32 * 32 * 4);
  assert.equal(first.height.length, first.color.length);
  for (let i = 0; i < first.height.length; i += 4) {
    assert.equal(first.height[i], first.height[i + 1]);
    assert.equal(first.height[i], first.height[i + 2]);
    assert.equal(first.height[i + 3], 255);
    assert.equal(first.color[i + 3], 255);
  }
  const heights = first.height.filter((_, i) => i % 4 === 0);
  assert.ok(Math.max(...heights) - Math.min(...heights) > 35);
});

test('low frequency surface detail wraps across the edge', () => {
  const size = 64;
  const {color} = surfacePixels([59, 62, 64], 75, 26, size);
  let seam = 0, inside = 0;
  for (let y = 0; y < size; y++) {
    const at = x => color[4 * (y * size + x)];
    seam += Math.abs(at(0) - at(size - 1));
    inside += Math.abs(at(0) - at(1));
  }
  assert.ok(seam <= 1.8 * inside);
});
