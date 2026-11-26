import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {PerspectiveCamera, Scene, Vector3} from 'three/webgpu';
import {buildKart} from '../src/kart-view.js';
import {cockpitFov, makeCockpit} from '../src/cockpit.js';

test('cockpit shows the road ahead and the whole steering rim together', async () => {
  const bytes = await readFile(new URL('../.local-assets/mixamo-kart.glb', import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({name:'geometry-only', loadTexture:() => Promise.resolve(null)}));
  const {scene:body} = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const scene = new Scene(), kart = buildKart(scene, body);
  kart.update({x:0,z:0,angle:Math.PI/2,steer:0,spin:0}, 0);
  scene.updateMatrixWorld(true);
  const previousDocument = globalThis.document;
  globalThis.document = {createElement:() => ({getContext:() => ({})})};
  let cockpit;
  try { cockpit = makeCockpit(kart); }
  finally { globalThis.document = previousDocument; }
  const eye = new Vector3(), target = new Vector3();
  cockpit.frame(eye, target, 0);
  const camera = new PerspectiveCamera(cockpitFov, 2560/1319, .028, 200);
  camera.position.copy(eye);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  for (const distance of [30, 80]) {
    const road = new Vector3(0, .03, distance).project(camera);
    assert.ok(road.y > 0 && road.y < .75, 'distant road must be visible above the screen centre');
  }
  const positions = kart.steering.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const rim = kart.steering.localToWorld(new Vector3().fromBufferAttribute(positions, i)).project(camera);
    assert.ok(rim.y > -1 && rim.y < 0, 'whole steering wheel must remain in the lower half');
  }
});
