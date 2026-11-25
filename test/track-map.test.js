import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTrack, makeTrackMap, tracks } from '../src/track.js';

test('projects the racing line and the finish onto the same map', () => {
  const track = makeTrack(tracks[0]);
  const map = makeTrackMap(track);
  const finish = map.project(track.checkpoints[0].point);
  assert.deepEqual(finish, map.project(track.samples[0]));
  assert.match(map.path, /^M[\d.]+ [\d.]+ L.* Z$/);

  const points = track.samples.map(map.project);
  assert.ok(points.every(({x, y}) =>
    x >= 15.999 && x <= 240.001 && y >= 16.999 && y <= 134.001));
  const width = Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x));
  const height = Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y));
  assert.ok(Math.abs(width - 224) < .001 || Math.abs(height - 117) < .001);
});
