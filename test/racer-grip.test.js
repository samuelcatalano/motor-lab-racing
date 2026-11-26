import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Scene, Vector3} from 'three/webgpu';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {buildKart} from '../src/kart-view.js';
import {addClosedGloves} from '../src/closed-gloves.js';

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
    if (presentation) addClosedGloves(kart.group, wheel);
    const gloveVertices = [];
    const gloveFaces = [];
    if (presentation) {
      body.traverse(mesh => {
        const closed = mesh.userData.closedGlove;
        if (!mesh.isSkinnedMesh && !closed) return;
        const {skinIndex, skinWeight, position} = mesh.geometry.attributes;
        const rendered = new Set(mesh.geometry.index?.array ?? Array.from({length:position.count}, (_, index) => index));
        const selected = new Set();
        for (let index = 0; index < position.count; index++) {
          if (!rendered.has(index)) continue;
          let handWeight = closed ? 1 : 0;
          for (let slot = 0; slot < (closed ? 0 : 4); slot++) {
            const name = mesh.skeleton.bones[skinIndex.getComponent(index, slot)].name;
            if (/^RigHand[LR]$|Hand(Index|Middle|Ring|Pinky|Thumb)[1-4]$/.test(name)) {
              handWeight += skinWeight.getComponent(index, slot);
            }
          }
          if (handWeight > .5) {
            gloveVertices.push({mesh, index});
            selected.add(index);
          }
        }
        const indices = mesh.geometry.index;
        const count = indices?.count ?? position.count;
        for (let index = 0; index < count; index += 3) {
          const triangle = [0, 1, 2].map(offset => indices ? indices.getX(index + offset) : index + offset);
          if (triangle.every(vertex => selected.has(vertex))) gloveFaces.push({mesh, triangle});
        }
      });
      assert.ok(gloveVertices.length > 3000, 'inspect the actual glove mesh, including palms and fingertips');
    }
    function assertGloveClearance() {
      const point = new Vector3();
      function assertClearance(point, label) {
        const radial = Math.hypot(point.x, point.dot(up));
        const rimDepth = .092 * .14175 * point.dot(up) / radial;
        const clearance = Math.hypot(radial - .14175, point.dot(normal) - rimDepth) - .01575;
        assert.ok(clearance >= 0, label + ' penetrates the rim by ' + (-clearance * 1000) + ' mm');
      }
      for (const {mesh, index} of gloveVertices) {
        mesh.getVertexPosition(index, point);
        wheel.worldToLocal(mesh.localToWorld(point));
        assertClearance(point, mesh.name + ' vertex ' + index);
      }
      for (const {mesh, triangle} of gloveFaces) {
        const corners = triangle.map(index =>
          wheel.worldToLocal(mesh.localToWorld(mesh.getVertexPosition(index, new Vector3()))));
        point.copy(corners[0]).add(corners[1]).add(corners[2]).divideScalar(3);
        assertClearance(point, mesh.name + ' face ' + triangle[0]);
        for (let edge = 0; edge < 3; edge++) {
          point.copy(corners[edge]).lerp(corners[(edge + 1) % 3], .5);
          assertClearance(point, mesh.name + ' edge ' + triangle[edge]);
        }
      }
    }
    assertGloveClearance();
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
      assertGloveClearance();
    }
  });

}
