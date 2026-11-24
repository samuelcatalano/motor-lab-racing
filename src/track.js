import * as T from 'three';

export const tracks = [{
  id: 'vale-do-cedro-v1',
  name: 'Vale do Cedro',
  width: 8.5,
  seed: 42361,
  gates: [0, .18, .39, .61, .82],
  curbs: [[.12, .20], [.28, .33], [.45, .53], [.65, .72], [.81, .88]],
  paddock: {x: 13, z: -72},
  // X and Z in metres, ordered in the direction of travel.
  points: [[0, -56], [47, -56], [79, -47], [96, -22], [88, 2],
    [65, 9], [47, 2], [29, 12], [28, 37], [8, 55], [-25, 53],
    [-43, 35], [-40, 15], [-55, 7], [-78, 21], [-98, 12], [-108, -17],
    [-96, -44], [-65, -56], [-32, -56]],
}];

export function makeTrack(definition) {
  const curve = new T.CatmullRomCurve3(
    definition.points.map(([x, z]) => new T.Vector3(x, 0, z)), true
  );
  curve.arcLengthDivisions = 4000;
  const length = curve.getLength();
  const count = Math.ceil(length / .8);
  const samples = Array.from({length: count}, (_, i) => curve.getPointAt(i / count));
  const at = (progress, offset = 0) => {
    const u = ((progress % 1) + 1) % 1;
    const point = curve.getPointAt(u);
    const tangent = curve.getTangentAt(u);
    point.x -= tangent.z * offset;
    point.z += tangent.x * offset;
    return { point, tangent };
  };
  function nearest(x, z) {
    let index = 0, distance = Infinity;
    for (let i = 0; i < count; i++) {
      const p = samples[i];
      const squared = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (squared < distance) {
        index = i;
        distance = squared;
      }
    }
    return { distance: Math.sqrt(distance), progress: index / count };
  }
  return {...definition, count, length, at, nearest, samples,
    checkpoints: definition.gates.map(progress => at(progress))};
}

export function makeTimer(track, storage, wet = false) {
  const key = 'motor-lab:best:' + track.id + (wet ? ':wet' : '');
  let best;
  try { best = Number(storage.getItem(key)); } catch { best = 0; }
  if (!Number.isFinite(best) || best <= 0) best = 0;
  let start = null, next = 0, last = 0, record = false, invalid = false;
  function cross(gate, before, after) {
    const {point, tangent} = gate;
    const a = (before.x - point.x) * tangent.x + (before.z - point.z) * tangent.z;
    const b = (after.x - point.x) * tangent.x + (after.z - point.z) * tangent.z;
    if (a >= 0 || b < 0) return null;
    const fraction = a / (a - b);
    const x = before.x + (after.x - before.x) * fraction;
    const z = before.z + (after.z - before.z) * fraction;
    return Math.abs((x - point.x) * tangent.z - (z - point.z) * tangent.x) <= track.width / 2
      ? fraction : null;
  }
  return {
    get best() { return best; }, get last() { return last; },
    get record() { return record; }, get invalid() { return invalid; },
    elapsed(time) { return start === null ? null : time - start; },
    reset() { start = null; next = 0; record = false; invalid = false; },
    update(before, after, time, dt, offTrack) {
      if (start !== null && offTrack) invalid = true;
      const finish = cross(track.checkpoints[0], before, after);
      if (finish !== null) {
        const crossingTime = time - dt * (1 - finish);
        if (start !== null && next === track.checkpoints.length && !invalid) {
          last = crossingTime - start;
          record = !best || last < best;
          if (record) {
            best = last;
            try { storage.setItem(key, String(best)); } catch { /* session record remains available */ }
          }
        } else {
          record = false;
        }
        start = crossingTime;
        invalid = false;
        next = 1;
      } else if (start !== null && next < track.checkpoints.length &&
          cross(track.checkpoints[next], before, after) !== null) {
        next++;
      }
    },
  };
}
