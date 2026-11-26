import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Scene, Vector3} from 'three/webgpu';
import {buildKart} from '../src/kart-view.js';

test('Blender garage gloves enclose the rim without crossing its surface during menu movement', async () => {
  const bytes = await readFile(new URL('../public/assets/kart/garage-kart.glb', import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({name:'geometry-only', loadTexture:() => Promise.resolve(null)}));
  const {scene:body} = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  assert.equal(body.getObjectByName('LippiRig').userData.garageGripAuthored, true);
  const scene = new Scene(), kart = buildKart(scene, body), wheel = kart.steering;
  const normal = new Vector3().fromArray(wheel.userData.steeringAxis).negate().normalize();
  const up = new Vector3(1, 0, 0).cross(normal);
  const radius = p => Math.hypot(p.x, p.dot(up));
  const clearance = p => {
    const r = radius(p);
    return Math.hypot(r - .14175, p.dot(normal) - .092 * .14175 * p.dot(up) / r) - .01575;
  };
  const meshes = [];
  body.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const {skinIndex, skinWeight} = mesh.geometry.attributes;
    const handVertices = [];
    for (let i = 0; i < skinIndex.count; i++) {
      let weight = 0;
      for (let j = 0; j < 4; j++) {
        if (/Hand/.test(mesh.skeleton.bones[skinIndex.getComponent(i, j)].name)) weight += skinWeight.getComponent(i, j);
      }
      if (weight > .6) handVertices.push(i);
    }
    if (handVertices.length) meshes.push({mesh, handVertices});
  });
  let samples = 0;
  for (const sign of [-1, 0, 1]) {
    kart.update({x:3, z:8, angle:.4, steer:sign * .035, spin:0}, 0,
      {lean:sign * .024, pitch:sign * .015, look:.101});
    // This also refreshes SkinnedMesh.bindMatrixInverse, as the renderer does.
    scene.updateMatrixWorld(true);
    for (const side of ['Left', 'Right']) {
      const point = name => wheel.worldToLocal(body.getObjectByName('mixamorig6' + side + 'Hand' + name).getWorldPosition(new Vector3()));
      const knuckle = point('Middle1');
      assert.ok(radius(point('Thumb4')) < radius(knuckle) - .025, side + ' thumb opposes from inside');
      for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
        assert.ok(radius(point(finger + '4')) < radius(point(finger + '1')) - .02, side + finger + ' closes around the rim');
      }
    }
    for (const {mesh, handVertices} of meshes) {
      const points = new Map(handVertices.map(i => [i, wheel.worldToLocal(mesh.localToWorld(mesh.getVertexPosition(i, new Vector3())))]));
      const index = mesh.geometry.index;
      for (let i = 0; i < index.count; i += 3) {
        const vertices = [0, 1, 2].map(j => points.get(index.getX(i + j)));
        if (vertices.some(v => !v)) continue;
        const [a, b, c] = vertices;
        for (const p of [a, b, c, a.clone().lerp(b, .5), a.clone().lerp(c, .5), b.clone().lerp(c, .5), a.clone().add(b).add(c).divideScalar(3)]) {
          assert.ok(clearance(p) >= 0, mesh.name + ' glove surface crosses the rim');
          samples++;
        }
      }
    }
  }
  assert.ok(samples > 100000, 'check glove triangle interiors as well as vertices');
});
