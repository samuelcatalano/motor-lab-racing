import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Scene, Vector3} from 'three/webgpu';
import {buildKart} from '../src/kart-view.js';

test('garage grip keeps wrists near neutral, mirrors both hands and keeps palms on the rim', async () => {
  const bytes = await readFile(new URL('../public/assets/kart/garage-kart.glb', import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({name:'geometry-only', loadTexture:() => Promise.resolve(null)}));
  const {scene:body} = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const scene = new Scene(), kart = buildKart(scene, body), wheel = kart.steering;
  const normal = new Vector3().fromArray(wheel.userData.steeringAxis).negate().normalize();
  const up = new Vector3(1, 0, 0).cross(normal);
  const radius = p => Math.hypot(p.x, p.dot(up));
  const clearance = p => {
    const r = radius(p);
    return Math.hypot(r - .14175, p.dot(normal) - .092 * .14175 * p.dot(up) / r) - .01575;
  };
  kart.update({x:3, z:8, angle:.4, steer:0, spin:0}, 0, {lean:0, pitch:0, look:.101});
  scene.updateMatrixWorld(true);
  const world = name => body.getObjectByName(name).getWorldPosition(new Vector3());
  const angles = {};
  for (const [side, letter] of [['Left', 'L'], ['Right', 'R']]) {
    const forearm = world('RigForearm' + letter), hand = world('RigHand' + letter);
    const knuckle = world('mixamorig6' + side + 'HandMiddle1');
    const bend = hand.clone().sub(forearm).normalize().angleTo(knuckle.clone().sub(hand).normalize());
    assert.ok(bend * 180 / Math.PI < 20, side + ' wrist bends ' + (bend * 180 / Math.PI).toFixed(1) + ' degrees');
    const local = wheel.worldToLocal(knuckle);
    angles[side] = Math.atan2(local.dot(up), local.x) * 180 / Math.PI;
  }
  // Mirror across the wheel's vertical axis: 8.5 deg and 171.5 deg sum to 180.
  assert.ok(Math.abs(angles.Left + angles.Right - 180) < 1, 'hands are not mirrored on the rim');
  let handVertices = 0, touching = 0;
  body.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const {skinIndex, skinWeight} = mesh.geometry.attributes;
    for (let i = 0; i < skinIndex.count; i++) {
      let weight = 0;
      for (let j = 0; j < 4; j++) {
        if (/Hand/.test(mesh.skeleton.bones[skinIndex.getComponent(i, j)].name)) weight += skinWeight.getComponent(i, j);
      }
      if (weight <= .6) continue;
      handVertices++;
      if (clearance(wheel.worldToLocal(mesh.localToWorld(mesh.getVertexPosition(i, new Vector3())))) < .002) touching++;
    }
  });
  // Measured 25% at the current pose; the previous hovering pose measured 11% and must fail this.
  assert.ok(touching / handVertices > .15, 'only ' + (100 * touching / handVertices).toFixed(1) + '% of glove vertices touch the rim');
});
