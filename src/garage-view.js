import * as T from 'three/webgpu';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { dot, float, mix, reflector, smoothstep, texture, uniform, uv, vec2, vec3 } from 'three/tsl';
import { buildKart } from './kart-view.js';
import { random, surfaceMaps } from './surfaces.js';
import { times } from './conditions.js';

const portalZ = -3.65;
const floorWidth = 13;
const bayDepth = 12.5;
const lookAt = new T.Vector3(0, .83, 0);
const lerp = T.MathUtils.lerp;

function standard(color, roughness = .72, metalness = 0) {
  return new T.MeshStandardMaterial({color, roughness, metalness});
}

function paintTexture(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d'));
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  return map;
}

// HDR strip fixtures, doorway and dark workshop walls give the kart coherent reflections.
function workshopEnvironment() {
  const width = 256, height = 128;
  const data = new Uint16Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const elevation = Math.PI * (row / height - .5);
    const y = Math.sin(elevation);
    const horizontal = Math.cos(elevation);
    for (let column = 0; column < width; column++) {
      const turn = (column / width - .5) * 2 * Math.PI;
      const x = horizontal * Math.cos(turn), z = horizontal * Math.sin(turn);
      const ceilingDistance = y > .01 ? 2.95 / y : Infinity;
      const meetsStrip = ceilingDistance < 16 && Math.abs(z * ceilingDistance) < 4.3 &&
        Math.min(Math.abs(x * ceilingDistance - 1.5), Math.abs(x * ceilingDistance + 2.3)) < .12;
      const opening = z < -.6 && x > -.34 && y > -.12 && y < .54;
      const led = meetsStrip ? 6.5 : 0;
      const outside = opening ? .58 : 0;
      const matte = y > 0 ? .072 + .13 * y : .033;
      const offset = (row * width + column) * 4;
      data[offset] = T.DataUtils.toHalfFloat(matte + led + outside * .72);
      data[offset + 1] = T.DataUtils.toHalfFloat(matte * 1.07 + led * .92 + outside * .87);
      data[offset + 2] = T.DataUtils.toHalfFloat(matte * 1.04 + led * .79 + outside);
      data[offset + 3] = T.DataUtils.toHalfFloat(1);
    }
  }
  const map = new T.DataTexture(data, width, height, T.RGBAFormat, T.HalfFloatType);
  map.mapping = T.EquirectangularReflectionMapping;
  map.colorSpace = T.LinearSRGBColorSpace;
  map.needsUpdate = true;
  return map;
}

function floorPaint() {
  return paintTexture(1024, 1024, ctx => {
    const rng = random(1729);
    // The floor texture includes the brushed-in markings, joints and rubber left by the kart.
    const px = x => (x / floorWidth + .5) * 1024;
    const py = z => (z - portalZ) / bayDepth * 1024;
    function stripe(x1, z1, x2, z2, color, width) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(px(x1), py(z1));
      ctx.lineTo(px(x2), py(z2));
      ctx.stroke();
    }
    for (const x of [-4.1, -2.8, 2.6, 4.1]) stripe(x, portalZ, x, 8.7, '#242927ac', 2);
    for (const z of [-2.1, 1.9, 5.7]) stripe(-6.5, z, 6.5, z, '#22282592', 2);
    const p = '#eeb84ddb';
    for (const x of [-1.61, 2.12]) {
      stripe(x, -2.42, x, 2.63, p, 7);
      stripe(x, -2.42, x + (x < 0 ? .6 : -.6), -2.42, p, 7);
    }
    stripe(-1.61, 2.63, -.87, 2.63, p, 7);
    stripe(2.12, 2.63, 1.38, 2.63, p, 7);
    for (let x = -1.69; x < 4.4; x += .29) stripe(x, -3.56, x + .15, -3.32, p, 5);
    ctx.font = 'bold 67px sans-serif';
    ctx.fillStyle = '#d3d2bb9f';
    ctx.fillText('17', px(.66), py(2.49));
    for (let stroke = 0; stroke < 100; stroke++) {
      const x = (rng() - .48) * 4, z = rng() * 5 - 2;
      ctx.strokeStyle = 'rgba(29, 31, 29,' + (.025 + rng() * .10) + ')';
      ctx.lineWidth = .4 + rng() * 1.2;
      ctx.beginPath();
      ctx.moveTo(px(x), py(z));
      ctx.quadraticCurveTo(px(x + .18), py(z + .32), px(x + .5), py(z + .71));
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#0006';
    for (let i = 0; i < 9200; i++) ctx.fillRect(rng() * 1024, rng() * 1024, 1 + rng() * 3, 1 + rng() * 3);
  });
}

function buildWorkshop(scene, renderer) {
  const dark = standard(0x272c2c, .68, .32);
  const steel = standard(0x5f6764, .67, .48);
  const fastener = standard(0x8f938a, .42, .65);
  const green = standard(0x233c33, .69, .14);
  const cabinet = standard(0x3e5749, .68, .23);
  const ceiling = standard(0x343736, .90);
  const plaster = standard(0x70736a, .88);
  const yellow = standard(0xce9e42, .69, .08);
  const tire = standard(0x242521, .88);
  const fixture = new T.MeshBasicMaterial({color:0xfff0d1, toneMapped:false});
  const taskLight = new T.MeshBasicMaterial({color:0xcfdbca});
  const faces = new Map();
  function box(material, x, y, z, width, height, depth) {
    if (!faces.has(material)) faces.set(material, []);
    faces.get(material).push([x, y, z, width, height, depth]);
  }
  const anisotropy = Math.min(4, renderer.getMaxAnisotropy());
  const concrete = surfaceMaps([87, 88, 82], 17, 40, anisotropy);
  concrete.map.repeat.set(8, 8);
  concrete.bumpMap.repeat.copy(concrete.map.repeat);
  const floor = standard(0xffffff, .73, .08);
  Object.assign(floor, concrete, {bumpScale:.008});
  box(floor, 0, -.12, portalZ + bayDepth / 2, floorWidth, .24, bayDepth);
  const lanePaint = new T.Mesh(
    new T.PlaneGeometry(floorWidth, bayDepth),
    new T.MeshStandardMaterial({map:floorPaint(), transparent:true, depthWrite:false, roughness:.84}),
  );
  lanePaint.rotation.x = -Math.PI / 2;
  lanePaint.position.set(0, .003, portalZ + bayDepth / 2);
  lanePaint.receiveShadow = true;
  scene.add(lanePaint);

  box(ceiling, 0, 3.45, .6, 13, .26, 8.5);
  box(plaster, -6.45, 1.72, .6, .23, 3.45, 8.5);
  box(plaster, 6.45, 1.72, .6, .23, 3.45, 8.5);
  box(green, -6.31, .59, .6, .07, 1.18, 8.5);
  box(green, 6.31, .59, .6, .07, 1.18, 8.5);
  box(plaster, -4.10, 1.7, portalZ, 4.8, 3.4, .26);
  box(plaster, 5.46, 1.70, portalZ, 2.25, 3.4, .26);
  box(green, -4.10, .56, portalZ + .15, 4.71, 1.12, .07);
  box(green, 5.46, .56, portalZ + .15, 2.2, 1.12, .07);
  box(dark, 1.31, 3.02, portalZ, 6.65, .83, .48);
  box(steel, 1.31, 2.60, portalZ + .17, 6.65, .061, .22);
  for (const x of [-1.78, 4.37]) {
    box(dark, x, 1.61, portalZ + .12, .26, 3.22, .37);
    box(steel, x - .017, 1.61, portalZ + .31, .15, 3.11, .036);
    box(yellow, x, .25, portalZ + .43, .17, .50, .19);
    for (let y = .09; y < .46; y += .17) box(dark, x, y, portalZ + .54, .174, .077, .022);
  }
  for (let y = 2.69; y < 3.41; y += .062) box(steel, 1.3, y, portalZ + .247, 5.91, .013, .023);
  for (const z of [-3.26, -.79, 1.66, 4.1]) {
    box(dark, 0, 3.24, z, 12.65, .24, .19);
    box(steel, 0, 3.12, z, 12.65, .033, .25);
  }
  for (const x of [-2.3, 1.52]) {
    box(dark, x, 3.04, -.03, .24, .12, 6.04);
    for (const z of [-2.03, -.04, 1.95]) box(fixture, x, 2.973, z, .105, .024, 1.84);
  }
  box(dark, .48, 2.62, portalZ + .30, 3.9, .068, .14);
  box(fixture, .48, 2.593, portalZ + .36, 3.83, .020, .019);
  for (let x = -6.1; x < -1.9; x += .62) box(steel, x, 1.72, portalZ + .14, .024, 3.4, .025);

  // Garage equipment is located along the wall, with the kart's working lane kept clear.
  box(dark, -3.76, .45, -3.21, 2.7, .78, .55);
  box(steel, -3.76, .86, -3.2, 2.85, .08, .67);
  for (let y = .2; y < .8; y += .14) {
    for (const x of [-4.41, -3.09]) {
      box(cabinet, x, y, -2.91, 1.29, .12, .05);
      box(steel, x, y + .035, -2.865, .66, .025, .053);
    }
  }
  const pegboardMap = paintTexture(384, 96, ctx => {
    ctx.fillStyle = '#373e3b';
    ctx.fillRect(0, 0, 384, 96);
    for (let x = 8; x < 384; x += 10) for (let y = 7; y < 96; y += 10) {
      ctx.fillStyle = '#4a504b';
      ctx.fillRect(x - 2, y + 1, 4, 2);
      ctx.fillStyle = '#1d2220';
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, 2 * Math.PI);
      ctx.fill();
    }
  });
  const pegboard = new T.Mesh(
    new T.PlaneGeometry(2.68, .70),
    new T.MeshStandardMaterial({map:pegboardMap, roughness:.87}),
  );
  pegboard.position.set(-3.76, 1.27, -3.425);
  scene.add(pegboard);
  box(dark, -3.76, 1.63, -3.39, 2.73, .061, .183);
  box(taskLight, -3.76, 1.592, -3.344, 2.37, .019, .049);
  box(steel, -3.76, .91, -3.40, 2.73, .036, .07);
  const socketHead = new T.RingGeometry(.022, .038, 12);
  for (let i = 0; i < 6; i++) {
    const x = -4.78 + i * .14, height = .19 + i * .019;
    const wrench = new T.Mesh(socketHead, fastener);
    wrench.position.set(x, 1.445, -3.365);
    scene.add(wrench);
    box(fastener, x, 1.412 - height / 2, -3.378, .027, height, .025);
    const jaw = new T.Mesh(socketHead, fastener);
    jaw.position.set(x, 1.42 - height, -3.36);
    jaw.scale.setScalar(.8);
    scene.add(jaw);
  }
  const screwdriverHandle = new T.CylinderGeometry(.022, .027, .101, 8);
  for (const [i, x] of [-3.65, -3.52, -3.39, -3.26].entries()) {
    const driver = new T.Mesh(screwdriverHandle, i % 2 ? green : yellow);
    driver.position.set(x, 1.325 + (i % 2) * .034, -3.366);
    scene.add(driver);
    box(fastener, x, 1.226 + (i % 2) * .034, -3.369, .015, .108, .014);
  }
  box(yellow, -2.86, .97, -3.24, .32, .15, .30);
  box(dark, -2.86, 1.054, -3.24, .33, .031, .31);
  box(steel, -2.86, 1.08, -3.24, .115, .04, .043);
  box(dark, 5.25, .52, -2.53, .72, .81, .55);
  box(steel, 5.25, .955, -2.53, .78, .057, .61);
  for (let y = .22; y < .85; y += .142) {
    box(cabinet, 5.25, y, -2.23, .67, .114, .05);
    box(steel, 5.25, y + .031, -2.19, .51, .023, .04);
  }
  for (const x of [4.93, 5.56]) box(tire, x, .05, -2.38, .091, .12, .35);
  const slick = new T.TorusGeometry(.181, .061, 10, 28);
  for (let i = 0; i < 4; i++) {
    const wheel = new T.Mesh(slick, tire);
    wheel.position.set(4.72 + i * .013, .063 + i * .114, -1.72 + (i % 2) * .018);
    wheel.rotation.x = -Math.PI / 2;
    wheel.castShadow = wheel.receiveShadow = true;
    scene.add(wheel);
  }

  const signage = paintTexture(1024, 512, ctx => {
    ctx.fillStyle = '#263a32';
    ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = '#ffc55e';
    ctx.fillRect(0, 0, 16, 512);
    ctx.fillRect(0, 456, 1024, 5);
    ctx.font = 'italic 900 347px sans-serif';
    ctx.fillText('17', 52, 323);
    ctx.fillStyle = '#e9e5d8';
    ctx.font = 'bold 55px sans-serif';
    ctx.fillText('MOTOR LAB', 504, 187);
    ctx.font = 'bold 40px monospace';
    ctx.fillText('P I T   B A Y', 504, 258);
    ctx.font = 'bold 23px monospace';
    ctx.fillText('VALE DO CEDRO  /  BR', 57, 420);
    ctx.fillStyle = '#56685b';
    for (const x of [36, 988]) for (const y of [27, 485]) ctx.fillRect(x, y, 8, 8);
  });
  const board = new T.Mesh(
    new T.PlaneGeometry(2.14, 1.07),
    new T.MeshStandardMaterial({map:signage, roughness:.78, emissive:0x555653, emissiveMap:signage, emissiveIntensity:.27}),
  );
  board.position.set(-3.36, 2.15, portalZ + .19);
  scene.add(board);

  // Group the repeated architecture by material and keep the static transforms on the GPU.
  const unit = new T.BoxGeometry(1, 1, 1);
  const transform = new T.Object3D();
  for (const [material, boxes] of faces) {
    const batch = new T.InstancedMesh(unit, material, boxes.length);
    boxes.forEach(([x, y, z, width, height, depth], i) => {
      transform.position.set(x, y, z);
      transform.scale.set(width, height, depth);
      transform.updateMatrix();
      batch.setMatrixAt(i, transform.matrix);
    });
    batch.receiveShadow = material !== fixture;
    scene.add(batch);
  }
  return floor;
}

function buildApron(scene) {
  const high = uniform(new T.Color(0x7b92a5));
  const low = uniform(new T.Color(0xd7dbd4));
  const condition = uniform(0), precipitation = uniform(0);
  const sky = new T.MeshBasicNodeMaterial({fog:false});
  sky.colorNode = mix(low, high, smoothstep(.42, .91, uv().y));
  const backdrop = new T.Mesh(new T.PlaneGeometry(144, 40), sky);
  backdrop.position.set(-3.5, 12, -46);
  scene.add(backdrop);

  const ranges = [];
  const rng = random(841);
  for (const [z, scale, tint] of [[-41, 1.31, 0x72887d], [-34, .83, 0x4f6b55], [-27, .60, 0x334837]]) {
    const outline = new T.Shape();
    outline.moveTo(-65, -1);
    for (let x = -65; x <= 65; x += .47) {
      const rolling = 2.8 + Math.sin(x * .081 + z) * 1.45 + Math.sin(x * .173 + z) * .8;
      outline.lineTo(x, (rolling + rng() * .65) * scale);
    }
    outline.lineTo(65, -1);
    outline.closePath();
    const material = new T.MeshBasicMaterial({color:tint});
    const mountain = new T.Mesh(new T.ShapeGeometry(outline), material);
    mountain.position.z = z;
    scene.add(mountain);
    ranges.push({mountain, material, base:new T.Color(tint)});
  }

  const aggregate = surfaceMaps([72, 76, 76], 144, 50, 4);
  aggregate.map.repeat.set(18, 10);
  aggregate.bumpMap.repeat.copy(aggregate.map.repeat);
  const pavement = new T.MeshStandardNodeMaterial({...aggregate, bumpScale:.016, roughness:.87});
  const distance = 23;
  const asphalt = new T.Mesh(new T.PlaneGeometry(44, distance), pavement);
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set(0, -.012, portalZ - distance / 2);
  asphalt.receiveShadow = true;
  scene.add(asphalt);

  const reflection = reflector({resolutionScale:.33, bounces:false, samples:0});
  const sheen = uniform(0);
  const wet = new T.MeshBasicNodeMaterial({transparent:true, depthWrite:false});
  wet.colorNode = reflection.rgb;
  wet.opacityNode = sheen.mul(float(1).sub(smoothstep(.32, .97, uv().y))).mul(.52);
  const damp = new T.Mesh(new T.PlaneGeometry(26, 12), wet);
  damp.rotation.x = -Math.PI / 2;
  damp.position.set(0, -.006, portalZ - 6);
  damp.add(reflection.target);
  scene.add(damp);

  function box(material, x, y, z, width, height, depth) {
    const mesh = new T.Mesh(new T.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    return mesh;
  }
  const concrete = standard(0x77796e);
  const steel = standard(0x555f60, .64, .52);
  const painted = standard(0x856844, .81);
  const glass = new T.MeshBasicMaterial({color:0xffedc7, toneMapped:false});
  for (let x = -23; x <= 10; x += 4.2) {
    box(steel, x, 1.28, -20, .051, 1.88, .051);
    box(Math.floor((x + 23) / 4.2) % 2 ? painted : concrete, x, .21, -19.9, 4.12, .43, .52);
  }
  for (const y of [.84, 1.27, 1.71, 2.16]) box(steel, -6.4, y, -20, 42, .021, .023);
  const line = standard(0xc7c8af);
  box(line, 0, -.008, -5.58, 31, .003, .086);
  box(line, 0, -.008, -9.35, 31, .003, .047);
  for (const x of [-15.4, -4.8, 7.2]) {
    box(steel, x, 2.08, -15.3, .076, 4.16, .076);
    box(steel, x, 4.18, -15.05, .65, .095, .48);
    box(glass, x, 4.179, -14.798, .54, .052, .032);
  }

  const count = 1720;
  const drops = new Float32Array(count * 3);
  const geometry = new T.BufferGeometry();
  const positions = new T.BufferAttribute(new Float32Array(count * 6), 3);
  positions.setUsage(T.DynamicDrawUsage);
  geometry.setAttribute('position', positions);
  for (let i = 0; i < drops.length; i += 3) {
    drops[i] = rng() * 17 - 11.5;
    drops[i + 1] = rng() * 5;
    drops[i + 2] = -3.9 - rng() * 9.6;
  }
  const streaks = new T.LineBasicMaterial({color:0xb7cbd6, transparent:true, depthWrite:false, toneMapped:false});
  const rain = new T.LineSegments(geometry, streaks);
  rain.frustumCulled = false;
  scene.add(rain);

  const emit = new T.PointLight(0xffe1b5, 0, 14, 2);
  emit.position.set(-4.8, 3.91, -14.9);
  scene.add(emit);
  const fogTint = new T.Color();
  return {
    reflection,
    usePanorama(map) {
      if (!map) return;
      for (const {mountain} of ranges) mountain.visible = false;
      const photo = texture(map, vec2(uv().x.mul(.54).add(.19), uv().y.sub(.20).mul(.35).add(.505))).rgb;
      const dusk = smoothstep(0, 1, condition);
      const night = smoothstep(1, 2, condition);
      const brightness = dot(photo, vec3(.22, .71, .07));
      const cloudy = vec3(.44, .52, .60).mul(brightness).add(vec3(.035, .047, .062));
      const daylight = mix(photo.mul(.61), cloudy, precipitation.mul(.87));
      const sunset = mix(daylight, daylight.mul(vec3(.71, .51, .42)).add(vec3(.056, .026, .016)), dusk);
      sky.colorNode = mix(sunset, photo.mul(vec3(.03, .045, .085)).add(vec3(.004, .008, .020)), night);
      sky.needsUpdate = true;
    },
    update(delta, wetness, light, animate) {
      high.value.copy(light.skyTop);
      low.value.copy(light.skyBase);
      condition.value = light.phase;
      precipitation.value = wetness;
      const sun = light.outside;
      for (const {material, base} of ranges) {
        fogTint.copy(base).multiplyScalar(.21 + sun * .31);
        material.color.copy(fogTint).lerp(light.skyBase, wetness * .27);
      }
      emit.intensity = 75 * light.night;
      glass.color.copy(light.fixture);
      damp.visible = wetness > .012;
      sheen.value = wetness;
      pavement.roughness = lerp(.87, .34, wetness);
      rain.visible = damp.visible;
      streaks.opacity = wetness * (.19 + light.night * .105);
      if (rain.visible) {
        const vertices = positions.array;
        for (let i = 0, j = 0; i < drops.length; i += 3, j += 6) {
          const x = drops[i], z = drops[i + 2];
          const height = drops[i + 1] - (animate ? delta * (7.6 + i % 5 * .14) : 0);
          const y = drops[i + 1] = (height + 5) % 5;
          const length = .115 + (i % 7) * .013;
          vertices[j] = x;
          vertices[j + 1] = y;
          vertices[j + 2] = z;
          vertices[j + 3] = x + length * .14;
          vertices[j + 4] = y + length;
          vertices[j + 5] = z + length * .08;
        }
        positions.needsUpdate = true;
      }
    },
  };
}

function collectResources(root, materials, geometries, textures, objects) {
  root?.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
    if (node.isSkinnedMesh) objects.add(node.skeleton);
    if (node.isInstancedMesh) objects.add(node);
  });
}

const moods = [
  {sky:[0x7898b8, 0xd3e3e6], rim:0xd9edff, outside:2.45, night:0},
  {sky:[0x586887, 0xdca980], rim:0xffb77d, outside:1.85, night:.42},
  {sky:[0x111c36, 0x455273], rim:0x819fcf, outside:.34, night:1},
];

export function createGaragePreview(renderer, canvas, kartBody, contact, initialHour, initialWet) {
  const target = new T.CanvasTarget(canvas);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(36, 1, .04, 100);
  scene.background = new T.Color(0x343c40);
  scene.environment = workshopEnvironment();

  const floor = buildWorkshop(scene, renderer);
  const exterior = buildApron(scene);
  const key = new T.SpotLight(0xffedcf, 143, 16, .74, .62, 2);
  key.position.set(1.55, 3.22, 2.58);
  key.target.position.set(0, .15, -.05);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.normalBias = .022;
  key.shadow.bias = -.00023;
  key.shadow.intensity = .63;
  const bounce = new T.HemisphereLight(0xe7ecdf, 0x686857, .67);
  const rim = new T.DirectionalLight();
  rim.position.set(3.25, 2.75, -4.75);
  const benchLight = new T.SpotLight(0xd6e6d0, 15, 10, .77, .76, 2);
  benchLight.position.set(-3.35, 3.04, -.91);
  benchLight.target.position.set(-3.36, 1.4, -3.2);
  scene.add(key, key.target, bounce, rim, benchLight, benchLight.target);

  const group = buildKart(scene, kartBody && clone(kartBody), {presentation:true});
  const parked = {x:0, z:0, angle:Math.PI / 2 + .40, steer:0, spin:0};
  const idle = {lean:0, pitch:0, look:0};
  contact.position.y = .015;
  contact.rotation.y = Math.PI / 2 - parked.angle;
  scene.add(contact);

  const resourceSets = () => [new Set(), new Set(), new Set(), new Set()];
  const shared = resourceSets();
  collectResources(kartBody, ...shared);
  const owned = resourceSets();
  collectResources(scene, ...owned);
  owned[2].add(scene.environment);

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const light = {skyTop:new T.Color(), skyBase:new T.Color(), fixture:new T.Color(), phase:0, night:0, outside:0};
  const stormTop = new T.Color(0x435465), stormBase = new T.Color(0xa0afb4);
  const clearTop = new T.Color(), clearBase = new T.Color();
  const nightFixture = new T.Color(0xffdfa8), dayFixture = new T.Color(0x696354);
  const warmKey = new T.Color(0xffefcf), nightKey = new T.Color(0xffdaad);
  let desiredPhase = times[initialHour].phase, desiredWet = Number(initialWet);
  let phase = desiredPhase, wetness = desiredWet;
  let width = 0, height = 0, lastFrame = 0, clock = 0;
  let disposed = false, dirty = true, previousMotion = motion.matches;
  return {
    setPanorama(map) {
      if (disposed) return;
      exterior.usePanorama(map);
      dirty = true;
    },
    setConditions(hour, wet) {
      desiredPhase = times[hour].phase;
      desiredWet = Number(wet);
      dirty = true;
    },
    render(now) {
      if (disposed || (lastFrame && document.hidden)) return;
      const nextWidth = canvas.clientWidth || window.innerWidth;
      const nextHeight = canvas.clientHeight || window.innerHeight;
      const resized = width !== nextWidth || height !== nextHeight;
      const reducedMotion = motion.matches;
      if (!dirty && !resized && reducedMotion === previousMotion &&
          (reducedMotion || now - lastFrame < 1000 / 60 - 1)) return;
      previousMotion = reducedMotion;
      const dt = lastFrame ? Math.min(.065, (now - lastFrame) / 1000) : 0;
      lastFrame = now;
      const animate = !reducedMotion;
      const blend = animate ? 1 - Math.exp(-dt * 4.3) : 1;
      phase = lerp(phase, desiredPhase, blend);
      wetness = lerp(wetness, desiredWet, blend);
      light.phase = phase;
      const segment = Math.min(1, Math.floor(phase)), amount = phase - segment;
      const from = moods[segment], to = moods[segment + 1];
      light.outside = lerp(from.outside, to.outside, amount) * (1 - wetness * .42);
      light.night = lerp(from.night, to.night, amount);
      light.fixture.copy(dayFixture).lerp(nightFixture, light.night);
      light.skyTop.set(from.sky[0]).lerp(clearTop.set(to.sky[0]), amount).lerp(stormTop, wetness * (1 - .85 * light.night));
      light.skyBase.set(from.sky[1]).lerp(clearBase.set(to.sky[1]), amount).lerp(stormBase, wetness * (1 - .85 * light.night));
      rim.color.set(from.rim).lerp(clearTop.set(to.rim), amount).lerp(stormBase, wetness * .25);
      rim.intensity = light.outside * .74 + light.night * .47;
      key.color.copy(warmKey).lerp(nightKey, light.night);
      key.intensity = 153 + light.night * 27;
      bounce.intensity = .57 + .18 * (1 - light.night);
      scene.environmentIntensity = .81 + light.night * .19;
      floor.roughness = lerp(.73, .65, wetness);
      exterior.update(dt, wetness, light, animate);
      if (animate) clock += dt;
      idle.lean = animate ? Math.sin(clock * .45) * .018 + Math.sin(clock * 1.61) * .006 : 0;
      idle.pitch = animate ? Math.sin(clock * 1.61 - .65) * .015 : 0;
      idle.look = animate ? Math.sin(clock * .63) * .046 + Math.sin(clock * .31) * .055 : 0;
      parked.steer = animate ? Math.sin(clock * .69) * .035 : 0;
      group.update(parked, resized || !animate ? 0 : dt, idle);
      const slide = animate ? Math.sin(clock * .29) * .13 : 0;
      camera.position.set(2.36 + slide, 1.23 + slide * .10, 3.57 - slide * .37);
      camera.lookAt(lookAt);
      const mainTarget = renderer.getCanvasTarget();
      renderer.setCanvasTarget(target);
      try {
        if (resized) {
          width = nextWidth;
          height = nextHeight;
          const ratio = Math.min(window.devicePixelRatio, 1.4, 2600 / width);
          target.setDrawingBufferSize(width, height, ratio);
          camera.fov = lerp(36, 34, T.MathUtils.smoothstep(width / height, 1.8, 2.39));
          camera.setViewOffset(width, height, -width * .173, height * .016, width, height);
        }
        renderer.render(scene, camera);
      } finally {
        renderer.setCanvasTarget(mainTarget);
      }
      dirty = false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      exterior.reflection.dispose();
      key.shadow.dispose();
      owned.forEach((items, i) => {
        for (const item of items) if (!shared[i].has(item)) item.dispose();
      });
      scene.clear();
      target.dispose();
      if (canvas.dataset.engine) canvas.getContext('webgpu')?.unconfigure();
    },
  };
}
