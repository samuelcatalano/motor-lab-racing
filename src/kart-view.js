import * as T from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mountDriverRig } from './driver-rig.js';

const surface = (color, roughness, metalness = 0) =>
  new T.MeshStandardMaterial({ color, roughness, metalness });

function modelPart(parent, geometry, material, x, y, z) {
  const mesh = new T.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function rounded(parent, material, size, position, radius) {
  return modelPart(parent, new RoundedBoxGeometry(...size, 2, radius), material, ...position);
}

function ellipsoid(parent, material, position, scale, geometry = new T.SphereGeometry(1, 24, 16)) {
  const mesh = modelPart(parent, geometry, material, ...position);
  mesh.scale.set(...scale);
  return mesh;
}

function tube(parent, material, radius, coordinates, segments = 20) {
  const curve = new T.CatmullRomCurve3(coordinates.map(point => new T.Vector3(...point)));
  return modelPart(parent, new T.TubeGeometry(curve, segments, radius, 8, false), material, 0, 0, 0);
}

function cylinder(parent, material, radius, width, position, axis, segments = 20) {
  const mesh = modelPart(parent, new T.CylinderGeometry(radius, radius, width, segments), material, ...position);
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  return mesh;
}

// Bake each material of the stationary assemblies into one mesh. Wheel and
// steering transforms remain separate from the kart body.
function batchByMaterial(group) {
  const buckets = new Map();
  for (const mesh of [...group.children]) {
    if (!mesh.isMesh) continue;
    mesh.updateMatrix();
    mesh.geometry.applyMatrix4(mesh.matrix);
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    if (!buckets.has(mesh.material)) buckets.set(mesh.material, []);
    buckets.get(mesh.material).push(geometry);
    if (geometry !== mesh.geometry) mesh.geometry.dispose();
    group.remove(mesh);
  }

  for (const [material, geometries] of buckets) {
    modelPart(group, mergeGeometries(geometries), material, 0, 0, 0);
    for (const geometry of geometries) geometry.dispose();
  }
}

function makeNumberPlate() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#eeb33d';
  ctx.fillRect(0, 0, 128, 96);
  ctx.strokeStyle = '#28241b';
  ctx.lineWidth = 5;
  ctx.strokeRect(4, 4, 120, 88);
  ctx.fillStyle = '#1d2222';
  ctx.font = '900 69px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('27', 64, 52);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  return new T.MeshStandardMaterial({ map, roughness: .73 });
}

function makeSuitName() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffe05c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#b8872c';
  ctx.lineWidth = 4;
  ctx.setLineDash([8, 7]);
  ctx.strokeRect(13, 13, 486, 214);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#624617';
  ctx.lineWidth = 8;
  ctx.lineJoin = 'round';
  ctx.font = 'bold 103px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText('LEANDRO', 256, 67, 446);
  ctx.strokeText('LIPPI', 256, 167, 446);
  ctx.fillText('LEANDRO', 256, 67, 446);
  ctx.fillText('LIPPI', 256, 167, 446);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  return new T.MeshStandardMaterial({map, roughness: .91});
}

function buildWheel(group, side, front, materials) {
  const { rubber, sidewall, wheelEdge, rim, steel } = materials;
  const pivot = new T.Group();
  pivot.position.set(side * .54, .139, front ? .56 : -.57);
  const wheel = new T.Group();
  pivot.add(wheel);
  group.add(pivot);
  const half = front ? .0575 : .0815;
  // A continuous carcass gives the slick a rounded shoulder and sidewall.
  const profile = [
    [.070, -half + .012], [.085, -half], [.111, -half],
    [.128, -half + .008], [.138, -half + .019], [.143, -half + .028],
    [.143, half - .028], [.138, half - .019], [.128, half - .008],
    [.111, half], [.085, half], [.070, half - .012],
  ].map(([radius, offset]) => new T.Vector2(radius, offset));
  const tire = modelPart(wheel, new T.LatheGeometry(profile, 48), rubber, 0, 0, 0);
  tire.rotation.z = Math.PI / 2;
  cylinder(wheel, rim, .076, half * 1.42, [0, 0, 0], 'x');
  const dishProfile = [
    [.077, -.009], [.077, .010], [.075, .013], [.070, .012],
    [.065, .006], [.050, .001], [.035, -.001], [.026, .001],
  ].map(([radius, offset]) => new T.Vector2(radius, offset));
  const dishGeometry = new T.LatheGeometry(dishProfile, 36);
  for (const sign of [-1, 1]) {
    const dish = modelPart(wheel, dishGeometry.clone(), wheelEdge, sign * (half - .015), 0, 0);
    dish.rotation.z = -sign * Math.PI / 2;
    const mould = modelPart(wheel, new T.TorusGeometry(.102, .0009, 4, 36),
      sidewall, sign * half, 0, 0);
    mould.rotation.y = Math.PI / 2;
  }
  dishGeometry.dispose();
  cylinder(wheel, wheelEdge, .026, .013, [side * (half - .002), 0, 0], 'x');
  for (let i = 0; i < 3; i++) {
    const angle = Math.PI * 2 * i / 3;
    cylinder(wheel, steel, .0055, .009, [side * (half - .005), .041 * Math.cos(angle), .041 * Math.sin(angle)], 'x', 6);
  }
  batchByMaterial(wheel);
  return { pivot, wheel, front };
}

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const importedWheelNames = ['FrontLeftWheel', 'FrontRightWheel', 'RearLeftWheel', 'RearRightWheel'];

async function loadMixamoKart(loader, onProgress = () => {}) {
  const asset = localHosts.has(window.location.hostname)
    ? '__mixamo-kart.glb' : 'assets/kart/mixamo-kart.glb';
  const url = import.meta.env.BASE_URL + asset;
  loader.manager.itemStart(url);
  try {
    const response = await fetch(url);
    if (!response.ok || response.status === 204) return null;
    const total = Number(response.headers.get('content-length')) || 0;
    const reader = response.body?.getReader();
    let modelBytes;
    if (reader) {
      const chunks = [];
      let loaded = 0;
      let lastReport = 0;
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        const now = performance.now();
        if (now - lastReport >= 250) {
          onProgress({stage:'kart-download', loaded, total});
          lastReport = now;
        }
      }
      onProgress({stage:'kart-download', loaded, total});
      modelBytes = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        modelBytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    } else {
      modelBytes = new Uint8Array(await response.arrayBuffer());
      onProgress({stage:'kart-download', loaded:modelBytes.byteLength, total:total || modelBytes.byteLength});
    }
    onProgress({stage:'kart-parse'});
    const { scene } = await loader.parseAsync(modelBytes.buffer, '');
    const steering = scene.getObjectByName('ImportedSteering');
    if (scene.getObjectByName('LippiRig')?.userData.assetSource !== 'Adobe Mixamo Racer') {
      throw new Error('O kart Mixamo não contém o piloto Racer');
    }
    if (!steering?.userData.steeringAxis ||
        !(scene.getObjectByName('DriverArms') || scene.getObjectByName('RigSpine')) ||
        importedWheelNames.some(name => !scene.getObjectByName(name))) {
      throw new Error('O kart local não contém as articulações esperadas');
    }
    return scene;
  } catch (error) {
    loader.manager.itemError(url);
    throw error;
  } finally {
    loader.manager.itemEnd(url);
  }
}

export async function loadKartBody(manager, onProgress = () => {}) {
  const loader = new GLTFLoader(manager);
  let scene;
  try {
    scene = await loadMixamoKart(loader, onProgress);
  } catch (error) {
    console.warn('Kart Mixamo indisponível', error);
  }
  try {
    scene ??= (await loader.loadAsync(
      import.meta.env.BASE_URL + 'assets/kart/kart-body.glb'
    )).scene;
    scene.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = node.receiveShadow = true;
    });
    return scene;
  } catch (error) {
    console.warn('Modelo do kart indisponível', error);
    return null;
  }
}

export function driverAttitude(speed, steer, brake) {
  const moving = T.MathUtils.smoothstep(speed, 1, 17);
  return {lean: .062 * steer * moving, pitch: .07 * brake * moving, look: .168 * steer * moving};
}

function mountOriginalSteering(group, materials) {
  const { dark, steel, shell } = materials;
  const steeringMount = new T.Group();
  steeringMount.position.set(0, .491, .244);
  steeringMount.rotation.x = -.62;
  const steering = new T.Group();
  modelPart(steering, new T.TorusGeometry(.115, .015, 8, 28), dark, 0, 0, 0);
  rounded(steering, steel, [.164, .014, .015], [0, 0, .002], .006);
  rounded(steering, steel, [.015, .078, .012], [0, -.047, .002], .005);
  rounded(steering, shell, [.047, .038, .023], [0, 0, .01], .01);
  batchByMaterial(steering);
  steeringMount.add(steering);
  group.add(steeringMount);
  return steering;
}

function mountModelWheels(body) {
  return importedWheelNames.map(name => {
    const pivot = body.getObjectByName(name);
    const wheel = new T.Group();
    wheel.add(...pivot.children);
    pivot.add(wheel);
    return { pivot, wheel, front: name.startsWith('Front') };
  });
}

export function buildKart(scene, authoredBody = null, {presentation = false} = {}) {
  const group = new T.Group();
  const body = new T.Group();
  group.add(body);

  const shell = surface(0x25292a, .65, .13);
  const dark = surface(0x171c1c, .8);
  const steel = surface(0x9ba4a1, .43, .62);
  const rim = surface(0x515657, .49, .50);
  const wheelEdge = surface(0xb7a37a, .33, .66);
  const rubber = surface(0x191a18, .92);
  const sidewall = surface(0x262722, .91);
  if (authoredBody) {
    body.add(authoredBody);
  } else {
    buildProceduralBody(body, {shell, dark, steel, rim});
  }

  const torso = authoredBody?.getObjectByName('DriverTorso');
  const helmet = authoredBody?.getObjectByName('DriverHelmet');
  const modelSteering = authoredBody?.getObjectByName('KartSteering') ??
    authoredBody?.getObjectByName('ImportedSteering');
  const steering = modelSteering ?? mountOriginalSteering(group, { dark, steel, shell });
  const steeringAxis = modelSteering ? new T.Vector3().fromArray(steering.userData.steeringAxis).normalize()
    : new T.Vector3(0, 0, 1);
  const armMeshes = [];
  authoredBody?.getObjectByName('DriverArms')?.traverse(node => {
    if (node.morphTargetDictionary) armMeshes.push(node);
  });
  const wheels = modelSteering ? mountModelWheels(authoredBody) : [];
  if (!modelSteering) {
    const wheelMaterials = { rubber, sidewall, wheelEdge, rim, steel };
    for (const side of [-1, 1]) {
      for (const front of [true, false]) wheels.push(buildWheel(group, side, front, wheelMaterials));
    }
  }
  const rearWheels = wheels.filter(wheel => !wheel.front)
    .map(({pivot}) => group.worldToLocal(pivot.getWorldPosition(new T.Vector3())));
  const poseRig = mountDriverRig(authoredBody, group, steering, {presentation});
  const attitude = {lean:0, pitch:0, look:0, throttle:0, brake:0};

  scene.add(group);
  return {
    group,
    steering,
    rearWheels,
    update(kart, dt, idlePose) {
      group.position.set(kart.x, .014, kart.z);
      group.rotation.y = Math.PI / 2 - kart.angle;
      steering.quaternion.setFromAxisAngle(steeringAxis, kart.steer * .54);
      for (const { morphTargetDictionary: indices, morphTargetInfluences: weights } of armMeshes) {
        weights[indices.SteerNegative] = Math.max(0, -kart.steer);
        weights[indices.SteerPositive] = Math.max(0, kart.steer);
      }
      if (poseRig || (torso && helmet)) {
        const {lean, pitch, look} = idlePose ??
          driverAttitude(kart.speed ?? 0, kart.steer, kart.brake ?? 0);
        const follow = dt === 0 ? 1 : 1 - Math.exp(-Math.max(0, dt ?? 0) * 8);
        attitude.lean = T.MathUtils.lerp(attitude.lean, lean, follow);
        attitude.pitch = T.MathUtils.lerp(attitude.pitch, pitch, follow);
        attitude.look = T.MathUtils.lerp(attitude.look, look, follow);
        if (poseRig) {
          const pedalFollow = dt === 0 ? 1 : 1 - Math.exp(-Math.max(0, dt ?? 0) * 17);
          attitude.throttle = T.MathUtils.lerp(attitude.throttle, kart.throttle ?? 0, pedalFollow);
          attitude.brake = T.MathUtils.lerp(attitude.brake, kart.brake ?? 0, pedalFollow);
          poseRig(attitude.lean, attitude.pitch, attitude.look, attitude.throttle, attitude.brake);
        } else {
          torso.rotation.z = attitude.lean;
          torso.rotation.x = attitude.pitch;
          helmet.rotation.y = -attitude.look;
        }
      }
      for (const { pivot, wheel, front } of wheels) {
        pivot.rotation.y = front ? -kart.steer * .4 : 0;
        wheel.rotation.x = kart.spin;
      }
    },
  };
}

function buildProceduralBody(body, {shell, dark, steel, rim}) {
  const teal = new T.MeshPhysicalMaterial({ color: 0x087c84, roughness: .36, clearcoat: .42, clearcoatRoughness: .32 });
  const gold = new T.MeshPhysicalMaterial({ color: 0xffb637, roughness: .43, clearcoat: .35, clearcoatRoughness: .34 });
  const chassis = surface(0x217379, .48, .36);
  const suit = surface(0xffc532, .85);
  const panel = surface(0xe7a621, .87);
  const liner = surface(0xdacbb0, .81);
  const visor = new T.MeshPhysicalMaterial({ color: 0x293b49, roughness: .17, metalness: .38, clearcoat: .42 });

  rounded(body, shell, [.70, .029, 1.46], [0, .124, .09], .012);
  for (const side of [-1, 1]) {
    tube(body, chassis, .026, [
      [side * .35, .155, -.67], [side * .40, .155, -.49],
      [side * .39, .15, .43], [side * .34, .16, .71], [side * .24, .18, .78],
    ]);
    rounded(body, teal, [.20, .135, .78], [side * .45, .21, -.008], .048);
    rounded(body, shell, [.17, .055, .75], [side * .455, .158, -.008], .024);
    rounded(body, gold, [.018, .029, .61], [side * .543, .227, -.02], .008);
    tube(body, steel, .008, [[side * .10, .20, .35], [side * .34, .18, .51], [side * .47, .16, .56]], 8);
  }

  rounded(body, teal, [.91, .15, .22], [0, .224, .835], .068);
  rounded(body, shell, [.93, .047, .18], [0, .161, .829], .021);
  rounded(body, gold, [.29, .23, .36], [0, .283, .631], .058).rotation.x = -.17;
  tube(body, steel, .026, [
    [-.51, .185, -.62], [-.57, .184, -.72], [-.40, .18, -.87],
    [0, .18, -.889], [.4, .18, -.87], [.57, .184, -.72], [.51, .185, -.62],
  ], 32);
  tube(body, chassis, .018, [[-.44, .187, -.79], [-.29, .198, -.73], [.29, .198, -.73], [.44, .187, -.79]], 15);
  cylinder(body, steel, .019, 1.02, [0, .139, -.57], 'x');
  cylinder(body, rim, .058, .014, [-.26, .142, -.57], 'x');
  cylinder(body, steel, .041, .026, [.265, .142, -.57], 'x');

  rounded(body, dark, [.273, .188, .044], [0, .298, -.805], .018);
  const plate = modelPart(body, new T.PlaneGeometry(.24, .165), makeNumberPlate(), 0, .297, -.829);
  plate.rotation.y = Math.PI;

  rounded(body, rim, [.22, .221, .236], [.338, .273, -.457], .031);
  for (let i = 0; i < 6; i++) {
    rounded(body, steel, [.215, .012, .215], [.337, .302 + i * .024, -.437], .005);
  }
  rounded(body, dark, [.14, .041, .15], [.335, .445, -.435], .014);
  tube(body, steel, .031, [[.36, .33, -.49], [.427, .29, -.51], [.436, .25, -.65]], 10);
  cylinder(body, rim, .050, .29, [.402, .231, -.659], 'z');
  cylinder(body, steel, .053, .025, [.402, .231, -.791], 'z');
  cylinder(body, dark, .034, .006, [.402, .231, -.807], 'z');

  rounded(body, shell, [.433, .083, .382], [0, .213, -.173], .037);
  rounded(body, shell, [.395, .302, .083], [0, .377, -.318], .04).rotation.x = -.30;
  for (const side of [-1, 1]) {
    ellipsoid(body, shell, [side * .186, .367, -.287], [.052, .136, .085]).rotation.x = -.27;
    ellipsoid(body, panel, [side * .108, .262, .214], [.077, .078, .231]).rotation.x = -.19;
  }
  ellipsoid(body, suit, [0, .478, -.154], [.183, .222, .142]).rotation.x = -.20;
  ellipsoid(body, suit, [0, .562, -.123], [.231, .094, .112]);
  rounded(body, suit, [.352, .164, .226], [0, .591, -.205], .024);
  const name = modelPart(body, new T.PlaneGeometry(.307, .129),
    makeSuitName(), 0, .594, -.320);
  name.rotation.y = Math.PI;
  for (const side of [-1, 1]) {
    tube(body, panel, .057, [[side * .174, .557, -.11], [side * .196, .48, .039], [side * .128, .49, .249]], 12);
    tube(body, gold, .012, [[side * .096, .549, -.236], [side * .16, .602, -.181], [side * .185, .595, -.102]], 10);
    ellipsoid(body, dark, [side * .117, .49, .249], [.052, .045, .053]);
  }

  const helmetPaint = new T.MeshPhysicalMaterial({
    color: 0x9f2b68, roughness: .32, clearcoat: .48,
  });
  const helmet = [0, .812, -.153];
  const helmetShell = new T.Group();
  helmetShell.name = 'DriverHelmet';
  body.add(helmetShell);
  ellipsoid(helmetShell, helmetPaint, helmet, [.152, .177, .157]);
  ellipsoid(body, liner, [0, .665, -.143], [.103, .029, .112]);
  ellipsoid(helmetShell, liner, helmet, [.154, .178, .159],
    new T.SphereGeometry(1, 10, 14, 1.45 * Math.PI, .10 * Math.PI, .16, 2.40));
  rounded(helmetShell, helmetPaint, [.216, .080, .124], [0, .736, -.056], .036);
  ellipsoid(helmetShell, visor, helmet, [.156, .18, .165],
    new T.SphereGeometry(1, 19, 8, .19 * Math.PI, .62 * Math.PI, 1.04, .54));

  tube(body, steel, .012, [[0, .230, .398], [0, .349, .309], [0, .492, .242]], 8);
  batchByMaterial(helmetShell);
  batchByMaterial(body);
}
