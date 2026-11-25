import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Scene, Vector3} from 'three/webgpu';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {buildKart} from '../src/kart-view.js';

for (const presentation of [false, true]) {
  test('Racer keeps the ' + (presentation ? 'garage' : 'driving') + ' grip attached through full steering travel', async () => {
    const bytes = await readFile(new URL('../.local-assets/mixamo-kart.glb', import.meta.url));
    const loader = new GLTFLoader();
    loader.register(() => ({name:'geometry-only', loadTexture:() => Promise.resolve(null)}));
    const {scene:body} = await loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '',
    );
    const kart = buildKart(new Scene(), body, {presentation});
    const wheel = kart.steering;
    const normal = new Vector3().fromArray(wheel.userData.steeringAxis).negate();
    const up = new Vector3(1, 0, 0).cross(normal);
    const frame = {x:0, z:0, angle:Math.PI / 2, steer:0, spin:0};
    kart.update(frame, 0);
    const anchors = [];
    for (const side of ['Left', 'Right']) {
      const middle = body.getObjectByName('mixamorig6' + side + 'HandMiddle1');
      const thumb = body.getObjectByName('mixamorig6' + side + 'HandThumb4');
      const knuckle = wheel.worldToLocal(middle.getWorldPosition(new Vector3()));
      const tip = wheel.worldToLocal(thumb.getWorldPosition(new Vector3()));
      const radialDistance = point => Math.hypot(point.x, point.dot(up));
      assert.ok(Math.abs(knuckle.x) > .14, side + ' palm stays on the lateral grip');
      assert.ok(radialDistance(tip) < radialDistance(knuckle) - .015, side + ' thumb opposes the fingers inside the rim');
      assert.ok(tip.dot(up) > knuckle.dot(up), side + ' thumb rests above the grip');
      for (const finger of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) {
        const bone = body.getObjectByName('mixamorig6' + side + 'Hand' + finger + '4');
        anchors.push({bone, point:wheel.worldToLocal(bone.getWorldPosition(new Vector3()))});
      }
    }
    for (const steer of [-1, -.5, .5, 1]) {
      kart.update({...frame, x:3, z:8, angle:.17, steer}, 0, {lean:steer * .048, pitch:.025, look:.08});
      for (const {bone, point} of anchors) {
        const moved = wheel.worldToLocal(bone.getWorldPosition(new Vector3()));
        assert.ok(moved.distanceTo(point) < 1e-5, bone.name + ' follows the rim through steering and body movement');
      }
    }
  });

}
