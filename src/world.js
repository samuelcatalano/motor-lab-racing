import * as T from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildKart, loadGarageKartBody, loadKartBody } from './kart-view.js';
import { spawn } from './drive.js';
import { cockpitFov, helmetLayer, makeCockpit } from './cockpit.js';
import { random, surfaceMaps } from './surfaces.js';
import { loadTrackFinishes, gridMarkings } from './track-finishes.js';
import { addWoodland } from './woodland.js';
import { addPaddock } from './paddock-view.js';
import { addTireTrail } from './tire-trail.js';
import { addTracksideDetails } from './trackside-view.js';
import { activeFloodlightCount, addTrackLighting } from './track-lighting.js';
import { addRain, addWaterBeading } from './weather-effects.js';
import { createGaragePreview } from './garage-view.js';
import { createWebGpuRenderer } from './webgpu-renderer.js';
import {
  abs, attribute, cameraPosition, clamp, dFdx, dFdy, dot, exp, float, floor, fract, fwidth,
  length, materialColor, materialEmissive, materialNormal, materialRoughness,
  max, mix, normalize, positionLocal, pow, smoothstep, sin, texture, uniform, uv,
  vec2, vec3,
} from 'three/tsl';

const material = (color, roughness = .8, metalness = 0) =>
  new T.MeshStandardMaterial({color, roughness, metalness});
const box = (parent, mat, size, position) => {
  const mesh = new T.Mesh(new T.BoxGeometry(...size), mat);
  mesh.position.set(...position);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
};
function ribbon(scene, track, mat, a, b, y, from = 0, to = 1, steps = track.count, stripUV = false) {
  const positions = [], uv = [], indices = [];
  for (let i = 0; i <= steps; i++) {
    const u = T.MathUtils.lerp(from, to, i / steps);
    for (const offset of [a, b]) {
      const {point} = track.at(u, offset);
      positions.push(point.x, y, point.z);
      if (stripUV) uv.push(offset === a ? 0 : 1, i / steps);
      else uv.push(point.x / 5, point.z / 5);
    }
    if (i < steps) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new T.Mesh(geometry, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}
function terrain(scene, track, anisotropy, forest, grassMaps, photoHorizon) {
  const rng = random(track.seed);
  const groundMaps = grassMaps ?? surfaceMaps([91, 109, 61], track.seed, 45, anisotropy);
  const repeats = grassMaps ? 550 / 1.4 : 112;
  for (const map of Object.values(groundMaps)) {
    map.wrapS = map.wrapT = T.RepeatWrapping;
    map.repeat.setScalar(repeats);
    map.anisotropy = anisotropy;
  }
  const grass = new T.MeshStandardMaterial({
    ...groundMaps,
    bumpScale: .047,
    normalScale: new T.Vector2(.58, .58),
    roughness: .98,
    vertexColors: true,
  });
  const meadow = new T.PlaneGeometry(550, 550, 80, 80).rotateX(-Math.PI / 2);
  const meadowPositions = meadow.attributes.position;
  const grassColors = [];
  const patchColor = new T.Color();
  for (let i = 0; i < meadowPositions.count; i++) {
    const x = meadowPositions.getX(i), z = meadowPositions.getZ(i);
    const patch = .5 + .23 * Math.sin(x * .11 + z * .034)
      + .18 * Math.cos(z * .14 + x * .084) + .09 * Math.cos((x - z) * .19);
    patchColor.setRGB(.71 + .29 * patch, .65 + .35 * patch, .48 + .39 * patch);
    grassColors.push(patchColor.r, patchColor.g, patchColor.b);
  }
  meadow.setAttribute('color', new T.Float32BufferAttribute(grassColors, 3));
  const ground = new T.Mesh(meadow, grass);
  ground.position.y = -.045;
  ground.receiveShadow = true;
  scene.add(ground);

  if (!photoHorizon) {
    const mountains = new T.PlaneGeometry(1800, 1800, 164, 164);
    mountains.rotateX(-Math.PI / 2);
    const pos = mountains.attributes.position;
    const colors = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const radius = Math.hypot(x * .85, z);
      const angle = Math.atan2(z, x);
      const edge = T.MathUtils.smoothstep(radius, 153, 420);
      const summit = .5 + .23 * Math.sin(angle * 7 + radius * .012)
        + .16 * Math.cos(angle * 13 - radius * .019);
      const foothills = 23 * Math.exp(-(((radius - 247) / 78) ** 2))
        * (.68 + .32 * Math.sin(angle * 5 - 1));
      const ridge = 147 * summit * Math.exp(-(((radius - 415 - 52 * Math.sin(angle * 3)) / 159) ** 2));
      const gullies = 6.5 * Math.sin((x + z) * .052 + Math.cos(z * .024) * 1.7)
        * Math.cos(x * .065 - z * .035);
      const detail = 1.7 * Math.cos((x - z) * .189) * Math.sin(z * .187 + x * .055);
      pos.setY(i, -.25 + edge * (foothills + ridge * .73 + gullies + detail));
      const climate = T.MathUtils.smoothstep(radius, 180, 460);
      const hue = T.MathUtils.lerp(.242, .337, climate);
      const exposure = .46 + .21 * Math.sin(x * .093 + z * .071) + .13 * Math.cos(z * .16 - x * .034);
      const scrub = .5 + .27 * Math.cos(x * .039 - z * .031) * Math.sin(z * .049);
      const color = patchColor.setHSL(hue + (scrub - .5) * .062,
        .26 + scrub * .19, .079 + summit * .042 + exposure * .029 + scrub * .039 + rng() * .012);
      colors.push(color.r, color.g, color.b);
    }
    mountains.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    mountains.computeVertexNormals();
    scene.add(new T.Mesh(mountains, new T.MeshStandardMaterial({vertexColors:true})));
  }

  if (forest) addWoodland(scene, track, forest);
  else addFallbackTrees(scene, track, rng);

  addVerge(scene, track, rng);
}

function addFallbackTrees(scene, track, rng) {
  const trees = [];
  for (let i = 0; i < 1750; i++) {
    const x = (rng() - .5) * 560, z = (rng() - .5) * 500;
    if (Math.hypot(x * .85, z) > 167 || track.nearest(x, z).distance < 13) continue;
    const pad = track.paddock;
    if (pad && Math.abs(z - pad.z) < 24 && x > pad.x - 25 && x < pad.x + 44) continue;
    trees.push({x, z, size: 2.8 + rng() * 5});
  }
  const bark = new T.InstancedMesh(new T.CylinderGeometry(.095, .22, 1, 7),
    material(0x594434), trees.length);
  const crown = new T.IcosahedronGeometry(1, 3);
  const vertices = crown.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
    const scale = 1 + .13 * Math.sin(x * 9 + z * 4) * Math.cos(y * 10 - z * 7)
      + .04 * Math.sin(z * 25 + y * 12);
    vertices.setXYZ(i, x * scale, y * scale, z * scale);
  }
  crown.computeVertexNormals();
  const normals = crown.attributes.normal;
  const radial = new T.Vector3(), normal = new T.Vector3();
  for (let i = 0; i < vertices.count; i++) {
    radial.fromBufferAttribute(vertices, i).normalize();
    normal.fromBufferAttribute(normals, i).lerp(radial, .68).normalize();
    normals.setXYZ(i, normal.x, normal.y, normal.z);
  }
  const leaf = new T.InstancedMesh(crown, material(0xffffff), trees.length * 5);
  const obj = new T.Object3D();
  trees.forEach(({x,z,size}, i) => {
    obj.position.set(x, size * .25, z);
    obj.scale.set(size * .35, size * .5, size * .35);
    obj.updateMatrix();
    bark.setMatrixAt(i, obj.matrix);
    for (let j = 0; j < 5; j++) {
      const offset = j ? (.18 + rng() * .10) * size : 0;
      obj.position.set(x + Math.cos(j * 1.57) * offset,
        size * (j ? .57 + rng() * .19 : .82), z + Math.sin(j * 1.57) * offset);
      const radius = size * (j ? .22 + rng() * .07 : .29);
      obj.scale.set(radius, radius * 1.15, radius * .93);
      obj.rotation.y = rng() * 6;
      obj.updateMatrix();
      leaf.setMatrixAt(i * 5 + j, obj.matrix);
      leaf.setColorAt(i * 5 + j, new T.Color().setHSL(.23 + rng() * .045, .29 + rng() * .16, .105 + rng() * .10));
    }
  });
  bark.castShadow = leaf.castShadow = leaf.receiveShadow = true;
  scene.add(bark, leaf);
}

function addVerge(scene, track, rng) {
  const obj = new T.Object3D();
  const grassBlades = new T.BufferGeometry();
  const blades = [];
  for (let i = 0; i < 9; i++) {
    const x = (rng() - .5) * .17, z = (rng() - .5) * .17;
    const h = .06 + rng() * .18, sweep = (rng() - .5) * .10;
    const dx = (rng() - .5) * .016, dz = (rng() - .5) * .016;
    const rootL = [x - dx, 0, z - dz], rootR = [x + dx, 0, z + dz];
    const foldL = [x + sweep * .35 - dx * .65, h * .64, z - dz * .65];
    const foldR = [x + sweep * .35 + dx * .65, h * .64, z + dz * .65];
    const tip = [x + sweep, h, z + .035];
    blades.push(...rootL,...rootR,...foldL,...foldL,...rootR,...foldR,...foldL,...foldR,...tip);
  }
  grassBlades.setAttribute('position', new T.Float32BufferAttribute(blades, 3));
  grassBlades.computeVertexNormals();
  const bladeMaterial = new T.MeshStandardMaterial({color:0xffffff, side:T.DoubleSide, roughness:1});
  const verge = new T.InstancedMesh(grassBlades, bladeMaterial, 4800);
  for (let i = 0; i < verge.count; i++) {
    const offset = (track.width / 2 + .61 + rng() ** 1.5 * 5) * (i % 2 ? -1 : 1);
    const {point} = track.at(rng(), offset);
    obj.position.copy(point);
    obj.rotation.y = rng() * Math.PI * 2;
    obj.scale.setScalar(.27 + rng() * .60);
    obj.updateMatrix();
    verge.setMatrixAt(i, obj.matrix);
    verge.setColorAt(i, new T.Color().setHSL(.22 + rng() * .045, .25 + rng() * .18, .14 + rng() * .10));
  }
  verge.receiveShadow = true;
  scene.add(verge);
}
function tireBarriers(scene, track) {
  const stacks = [];
  for (const [from, to] of track.curbs ?? []) {
    const middle = (from + to) / 2;
    const a = track.at(middle - .009).tangent;
    const b = track.at(middle + .009).tangent;
    const side = a.x * b.z - a.z * b.x > 0 ? -1 : 1;
    const span = Math.min((to - from) * .54, 26 / track.length);
    const count = Math.ceil(span * track.length / .67);
    for (let i = 0; i < count; i++) {
      const progress = middle - span / 2 + (i + .5) * span / count;
      const {point} = track.at(progress, side * (track.width / 2 + 6.56));
      stacks.push(point);
    }
  }
  if (!stacks.length) return;
  const tire = new T.LatheGeometry([
    new T.Vector2(.163, -.108), new T.Vector2(.28, -.108),
    new T.Vector2(.322, -.08), new T.Vector2(.327, .065),
    new T.Vector2(.29, .105), new T.Vector2(.163, .105),
    new T.Vector2(.163, -.108),
  ], 14);
  const barriers = new T.InstancedMesh(tire, material(0xffffff, .92), stacks.length * 2);
  const obj = new T.Object3D();
  const colors = [new T.Color(0x30312e), new T.Color(0xa4a399), new T.Color(0x8d3428)];
  stacks.forEach((point, i) => {
    for (let row = 0; row < 2; row++) {
      obj.position.set(point.x, .104 + row * .212, point.z);
      obj.updateMatrix();
      const index = i * 2 + row;
      barriers.setMatrixAt(index, obj.matrix);
      barriers.setColorAt(index, colors[row === 0 ? 0 : 1 + Math.floor(i / 5) % 2]);
    }
  });
  barriers.castShadow = barriers.receiveShadow = true;
  scene.add(barriers);
}

// A strip in world coordinates keeps the photographed aggregate at a constant size.
function roadHash(point) {
  return fract(sin(dot(point, vec2(91.7, 278.3))).mul(38761.13));
}

function roadNoise(point) {
  const cell = floor(point);
  const offset = fract(point);
  const smoothed = offset.mul(offset).mul(vec2(3).sub(offset.mul(2)));
  const a = mix(roadHash(cell), roadHash(cell.add(vec2(1, 0))), smoothed.x);
  const b = mix(roadHash(cell.add(vec2(0, 1))), roadHash(cell.add(vec2(1, 1))), smoothed.x);
  return mix(a, b, smoothed.y);
}

export function roadMaterial(track, anisotropy, road, roadDetail, wetness, rainClock, reflections) {
  const maps=road ?? surfaceMaps([62, 62, 60], track.seed + 2, 36, anisotropy);
  for (const map of Object.values(maps)) {
    map.wrapS = map.wrapT = T.RepeatWrapping;
    map.repeat.setScalar(2.45);
    map.anisotropy = anisotropy;
  }
  if (roadDetail) for (const map of Object.values(roadDetail)) {
    map.wrapS = map.wrapT = T.RepeatWrapping;
    map.anisotropy = anisotropy;
  }
  const asphalt = new T.MeshStandardNodeMaterial({
    ...maps, bumpScale:.09, color: 0xe4e9f1, roughness: .94,
    normalScale: new T.Vector2(.74, .74), envMapIntensity: .43,
  });
  const uvRoad = uv();
  const lane = abs(attribute('lane'));
  const broad = roadNoise(uvRoad.mul(.34)).mul(.64).add(roadNoise(uvRoad.mul(1.18)).mul(.36));
  const travelled = float(1).sub(smoothstep(.20, .69, lane));
  const polished = travelled.mul(float(.43).add(broad.mul(.50)));
  const shoulder = smoothstep(.77, 1, lane);
  const spots = roadNoise(uvRoad.mul(2.9));
  let colorFactor = float(.86).add(broad.mul(.32)).sub(polished.mul(.19));
  colorFactor = colorFactor.mul(float(1).sub(smoothstep(.75, .93, spots).mul(.13)));
  colorFactor = mix(colorFactor, colorFactor.mul(vec3(1.14, 1.07, .91)), shoulder.mul(.53));

  if (roadDetail) {
    const wornUv = vec2(
      uvRoad.x.mul(.93).add(uvRoad.y.mul(.37)),
      uvRoad.x.mul(-.37).add(uvRoad.y.mul(.93)),
    ).mul(.092);
    const agedSurface = texture(roadDetail.wear, wornUv).rgb;
    const worn = dot(agedSurface, vec3(.2126, .7152, .0722));
    const aggregateUv = uvRoad.mul(1.84).add(vec2(.12, .36));
    const grain = dot(texture(roadDetail.aggregate, aggregateUv).rgb, vec3(.2126, .7152, .0722));
    colorFactor = colorFactor.mul(mix(.70, 1.25, smoothstep(.075, .22, worn)));
    colorFactor = colorFactor.mul(clamp(float(.78).add(grain.mul(10)), .74, 1.30));
  }

  const roadPosition = positionLocal.xz;
  const terrain = vec2(
    roadPosition.x.mul(.82).add(roadPosition.y.mul(.57)),
    roadPosition.x.mul(-.57).add(roadPosition.y.mul(.82)),
  );
  const seep = roadNoise(terrain.mul(vec2(.21, .51))).mul(.67)
    .add(roadNoise(roadPosition.mul(1.12)).mul(.33));
  const pool = smoothstep(.42, .69, seep.add(shoulder.mul(.08)));
  const water = wetness.mul(float(.46).add(pool.mul(.54)));
  colorFactor = colorFactor.mul(mix(vec3(1), vec3(.49, .55, .61), water));

  const tiles = roadPosition.mul(4);
  const cell = floor(tiles);
  const phase = fract(rainClock.mul(1.76).add(roadHash(cell)));
  const rippleOffset = vec2(
    roadHash(cell.add(vec2(31, 11))),
    roadHash(cell.add(vec2(61, 73))),
  ).mul(.49).add(.26);
  const distance = length(fract(tiles).sub(rippleOffset));
  let ripple = float(1).sub(smoothstep(.011, .044, abs(distance.sub(phase.mul(.28)))))
    .mul(float(1).sub(phase)).mul(pool);
  ripple = ripple.mul(float(1).sub(smoothstep(.045, .18, length(fwidth(tiles)))));

  let sheen = vec3(0);
  const pointOnRoad = vec3(roadPosition.x, .008, roadPosition.y);
  const viewDirection = normalize(cameraPosition.sub(pointOnRoad));
  const mirror = vec3(viewDirection.x.negate(), viewDirection.y, viewDirection.z.negate());
  for (const lamp of reflections.lampPoints.value) {
    const beam = uniform(lamp).sub(pointOnRoad);
    const distanceToLamp = length(beam);
    const source = beam.div(max(distanceToLamp, .001));
    const span = normalize(vec2(source.z, source.x.negate()).add(.00001));
    const sideways = dot(mirror.xz.sub(source.xz), span);
    const vertical = mirror.y.sub(source.y);
    const reflectionGrain = spots.mul(.68).add(ripple.mul(.32));
    let streak = exp(sideways.mul(sideways).mul(float(5700).add(reflectionGrain.mul(6200))).negate()
      .sub(vertical.mul(vertical).mul(float(31).add(reflectionGrain.mul(23)))));
    streak = streak.mul(float(1).sub(smoothstep(27,63,distanceToLamp)));
    sheen = sheen.add(vec3(.52,.66,.85).mul(streak)
      .mul(float(.17).add(reflectionGrain.mul(.24))).mul(water).mul(water));
  }
  sheen = sheen.mul(reflections.lampReflectionNode);

  asphalt.colorNode = materialColor.mul(colorFactor);
  asphalt.roughnessNode = mix(
    clamp(materialRoughness.mul(.77).add(.13).add(spots.mul(.09)).sub(polished.mul(.13)), .55, .99),
    float(.095).add(spots.mul(.13)),
    water.mul(.94),
  );
  asphalt.normalNode = normalize(materialNormal.add(vec3(dFdx(ripple), dFdy(ripple), 0).mul(water).mul(.53)));
  asphalt.emissiveNode = materialEmissive.add(sheen);
  return asphalt;
}

function cornerWear(seed) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const rng = random(seed + 31);
  // Narrow, irregular streaks overlap, leaving gaps where rubber hasn't built up.
  for (let i = 0; i < 95; i++) {
    const x = 9 + rng() * 46, y = -26 + rng() * 154;
    const width = 1 + rng() * 5, length = 12 + rng() * 55;
    const fade = ctx.createLinearGradient(0,y,0,y+length);
    fade.addColorStop(0,'rgba(18,16,14,0)');
    fade.addColorStop(.35,'rgba(18,16,14,.13)');
    fade.addColorStop(.68,'rgba(18,16,14,.19)');
    fade.addColorStop(1,'rgba(18,16,14,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(x,y,width,length);
  }
  ctx.globalCompositeOperation = 'destination-in';
  const falloff = ctx.createLinearGradient(0,0,0,128);
  falloff.addColorStop(0,'#0000');
  falloff.addColorStop(.24,'#000');
  falloff.addColorStop(.78,'#000');
  falloff.addColorStop(1,'#0000');
  ctx.fillStyle = falloff;
  ctx.fillRect(0,0,64,128);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  return new T.MeshStandardMaterial({ map, transparent:true, depthWrite:false, roughness:.97 });
}

function wornRoadPaint(seed, anisotropy) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f9f7ee';
  ctx.fillRect(0,0,128,128);
  const rng = random(seed + 628);
  for (let i = 0; i < 890; i++) {
    ctx.fillStyle = rng() > .25 ? '#4b494522' : '#302e2857';
    ctx.fillRect(rng()*128,rng()*128,.5+rng()*2,.5+rng()*2.8);
  }
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.wrapS = map.wrapT = T.RepeatWrapping;
  map.repeat.setScalar(6);
  map.anisotropy = anisotropy;
  return map;
}

function circuit(scene, track, anisotropy, road, roadDetail, wetness, rainClock, reflections) {
  const half = track.width / 2;
  const asphalt = ribbon(scene, track,
    roadMaterial(track, anisotropy, road, roadDetail, wetness, rainClock, reflections), -half, half, .008);
  const lane = new Float32Array(asphalt.geometry.attributes.position.count);
  for (let i = 0; i < lane.length; i++) lane[i] = i % 2 ? 1 : -1;
  asphalt.geometry.setAttribute('lane', new T.BufferAttribute(lane,1));
  const edgeGravel = new T.MeshStandardMaterial({
    ...surfaceMaps([107, 101, 80], track.seed + 59, 45, anisotropy),
    bumpScale: .057, roughness:.98,
  });
  for (const side of [-1, 1]) {
    const a = half * side;
    const b = (half + .23) * side;
    ribbon(scene, track, edgeGravel, Math.min(a,b), Math.max(a,b), -.012);
  }
  const rubber = cornerWear(track.seed);
  const markings = new T.Group();
  const paintWear = wornRoadPaint(track.seed, anisotropy);
  const white = new T.MeshStandardMaterial({color:0xe7e6dd,map:paintWear,roughness:.92});
  const red = new T.MeshStandardMaterial({color:0xa72b24,map:paintWear,roughness:.89});
  for (const side of [-1, 1]) {
    const a = side * (half - .16);
    ribbon(markings, track, white, Math.min(a, a + side * .08),
      Math.max(a, a + side * .08), .018);
    for (const [from, to] of track.curbs ?? []) {
      const count = Math.ceil((to - from) * track.length / 2.35);
      for (let i = 0; i < count; i++) {
        const b = side * (half + .48);
        ribbon(markings, track, i % 2 ? red : white, Math.min(side * half, b),
          Math.max(side * half, b), .027, from + (to - from) * i / count,
          from + (to - from) * (i + 1) / count, 2);
      }
    }
  }
  const charcoal = material(0x252629);
  for (let i = 0; i < 16; i++) {
    const a = -half + i * track.width / 16;
    for (let row = 0; row < 2; row++) {
      ribbon(markings, track, (i + row) % 2 ? white : charcoal, a,
        a + track.width / 16, .02, row * .48 / track.length,
        (row + 1) * .48 / track.length, 1);
    }
  }

  for (const [from, to] of track.curbs ?? []) {
    const middle = (from + to) / 2;
    const a = track.at(middle - .008).tangent, b = track.at(middle + .008).tangent;
    const lane = (a.x * b.z - a.z * b.x > 0 ? 1 : -1) * track.width * .175;
    for (const center of [lane - .50, lane + .50]) {
      ribbon(markings, track, rubber, center - .40, center + .40, .013,
        from, to, 40, true);
    }
  }
  if (track.paddock) {
    for (const slot of gridMarkings(track.length)) {
      const center = slot.offsetFraction * track.width;
      for (const edge of [center - .88, center + .80]) {
        ribbon(markings, track, white, edge, edge + .08, .019, slot.back, slot.front, 3);
      }
      ribbon(markings, track, white, center - .88, center + .88, .019,
        slot.back, slot.back + .08 / track.length, 1);
    }
  }
  for (const mat of [white, red, charcoal, rubber]) {
    const parts = markings.children.filter(mesh => mesh.material === mat).map(mesh => mesh.geometry);
    if (!parts.length) continue;
    const combined = new T.Mesh(mergeGeometries(parts), mat);
    combined.receiveShadow = true;
    scene.add(combined);
    parts.forEach(geometry => geometry.dispose());
  }

  const steel = material(0x646a64, .5, .25);
  const amount = Math.ceil(track.length / 3);
  const posts = new T.InstancedMesh(new T.BoxGeometry(.14, 1.08, .15), steel, amount * 2);
  const rails = new T.InstancedMesh(new T.BoxGeometry(1, .21, .14), steel, amount * 2);
  const obj = new T.Object3D(), offset = half + 6.87;
  for (const side of [-1, 1]) {
    for (let i = 0; i < amount; i++) {
      const id = (side === 1 ? amount : 0) + i;
      const a = track.at(i / amount, offset * side).point;
      const b = track.at((i + 1) / amount, offset * side).point;
      obj.position.set(a.x, .51, a.z);
      obj.rotation.y = 0;
      obj.scale.set(1, 1, 1);
      obj.updateMatrix();
      posts.setMatrixAt(id, obj.matrix);
      obj.position.set((a.x + b.x) * .5, .72, (a.z + b.z) * .5);
      obj.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      obj.scale.x = a.distanceTo(b) + .03;
      obj.updateMatrix();
      rails.setMatrixAt(id, obj.matrix);
    }
  }
  posts.castShadow = rails.castShadow = rails.receiveShadow = true;
  scene.add(posts, rails);
  tireBarriers(scene, track);

  const gantry = new T.Group();
  const {point, tangent} = track.at(0);
  gantry.position.copy(point);
  gantry.rotation.y = Math.atan2(tangent.x, tangent.z);
  scene.add(gantry);
  for (const side of [-1, 1]) {
    box(gantry, steel, [.32, 4.5, .42], [side * (half + .8), 2.25, 0]);
    box(gantry, charcoal, [.8, .3, .8], [side * (half + .8), .15, 0]);
  }
  const sign = document.createElement('canvas');
  sign.width = 1024;
  sign.height = 128;
  const ctx = sign.getContext('2d');
  ctx.fillStyle = '#172725';
  ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = '#ffcf61';
  ctx.fillRect(0, 0, 20, 128);
  ctx.fillRect(1004, 0, 20, 128);
  ctx.font = 'bold 68px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(track.name.toUpperCase(), 512, 69);
  const map = new T.CanvasTexture(sign);
  map.colorSpace = T.SRGBColorSpace;
  const face = new T.MeshStandardMaterial({map});
  const board = box(gantry, charcoal, [track.width + 2, 1.15, .34], [0, 4.47, 0]);
  board.material = [charcoal, charcoal, charcoal, charcoal, face, face];

  addPaddock(scene, track);
  addTracksideDetails(scene, track);
  return asphalt.material;
}

function makeContactShadow() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 3, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(15, 18, 14, 0.64)');
  gradient.addColorStop(.57, 'rgba(15, 18, 14, 0.31)');
  gradient.addColorStop(1, 'rgba(15, 18, 14, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  for (const x of [15, 49]) for (const y of [19, 45]) {
    ctx.save();
    ctx.translate(x,y);
    ctx.scale(.65,.48);
    const wheelContact = ctx.createRadialGradient(0,0,1,0,0,11);
    wheelContact.addColorStop(0,'rgba(10, 12, 10, .42)');
    wheelContact.addColorStop(1,'rgba(10, 12, 10, 0)');
    ctx.fillStyle = wheelContact;
    ctx.fillRect(-11,-11,22,22);
    ctx.restore();
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  const mesh = new T.Mesh(new T.PlaneGeometry(2.02, 2.78),
    new T.MeshBasicMaterial({map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1}));
  mesh.rotation.order = 'YXZ';
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

export async function createWorld(canvas, track, {
  onProgress = () => {}, garageCanvas, onGarageReady = () => {},
  initialHour = 'day', initialWet = false,
} = {}) {
  const manager = new T.LoadingManager();
  let loadingAssets = true;
  const assetProgress = (_url, loaded, total) => {
    if (loadingAssets) onProgress({stage:'assets', loaded, total});
  };
  manager.onStart = manager.onProgress = assetProgress;
  onProgress({stage:'renderer'});
  const rendererPromise = createWebGpuRenderer(canvas).then(renderer => {
    onProgress({stage:'webgpu-ready'});
    return renderer;
  });
  const kartBodyPromise = loadKartBody(manager, onProgress).then(kartBody => {
    onProgress({stage:'models-ready'});
    return kartBody;
  });
  const sceneAssets = Promise.all([loadTrackFinishes(manager), kartBodyPromise, rendererPromise]);
  const garageManager = new T.LoadingManager();
  const garageBodyPromise = garageCanvas ? loadGarageKartBody(garageManager) : Promise.resolve(null);
  let garage;
  try {
    const garageReady = Promise.all([rendererPromise, garageBodyPromise]).then(([renderer, garageBody]) => {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFShadowMap;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.06;
      if (!garageCanvas || !loadingAssets) return;
      try {
        garage = createGaragePreview(renderer, garageCanvas, garageBody, makeContactShadow(), initialHour, initialWet);
        garage.render(performance.now());
        onGarageReady(garage);
      } catch (error) {
        garage?.dispose();
        garage = undefined;
        console.warn('Não foi possível exibir a garagem', error);
      }
    });
    await Promise.all([sceneAssets, garageReady]);
  } catch (error) {
    garage?.dispose();
    throw error;
  } finally {
    loadingAssets = false;
  }
  const [{road, sky: panorama, forest, grass, roadDetail}, kartBody, renderer] = await sceneAssets;
  garage?.setPanorama(panorama?.photo);
  onProgress({stage:'scene'});
  // Give the scene stage a paint before synchronous geometry construction.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const scene = new T.Scene();
  const lighting=addTrackLighting(scene,renderer,track,panorama);
  const wetness={value:0}, rainClock={value:0};
  const wetnessNode=uniform(0), rainClockNode=uniform(0);
  const anisotropy = Math.min(8, renderer.getMaxAnisotropy());
  terrain(scene, track, anisotropy, forest, grass, Boolean(panorama?.photo));
  const asphalt=circuit(scene,track,anisotropy,road,roadDetail,wetnessNode,rainClockNode,lighting.reflections);
  const contact = makeContactShadow();
  scene.add(contact);
  const kartView = buildKart(scene, kartBody);
  const cockpit = makeCockpit(kartView);
  addWaterBeading(kartView.group,wetnessNode);
  const rain=addRain(scene,track.seed);
  const tireTrail = addTireTrail(scene, track, kartView.rearWheels);
  const camera = new T.PerspectiveCamera(56, 1, .07, 1800);
  const eye = new T.Vector3(), target = new T.Vector3(), look = new T.Vector3();
  const lastKartPosition = new T.Vector3(), kartMovement = new T.Vector3();
  function resize() {
    const {clientWidth, clientHeight} = canvas;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / Math.max(1, clientHeight);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  const view = {kart:spawn(track), mode:0, lapTime:'—'};
  function updateView(kart, dt, mode, snap, lapTime) {
    view.kart = kart;
    view.mode = mode;
    view.lapTime = lapTime;
    kartView.update(kart, dt);
    tireTrail.update(kart, dt, camera);
    contact.position.set(kart.x, .034, kart.z);
    contact.rotation.y = Math.PI / 2 - kart.angle;
    // Pull back as the viewport narrows so the rear wheels stay in frame.
    const narrow = 1 - T.MathUtils.smoothstep(camera.aspect, .58, 1.28);
    const firstPerson = mode === 2;
    const fov = firstPerson ? cockpitFov + narrow * 9 : 56;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.near = firstPerson ? .028 : .07;
      camera.updateProjectionMatrix();
    }
    cockpit.show(firstPerson, kart.speed, lapTime);
    if (firstPerson) {
      camera.layers.disable(helmetLayer);
      cockpit.frame(eye, target, narrow);
      camera.position.copy(eye);
      look.copy(target);
    } else {
      camera.layers.enable(helmetLayer);
      const x = Math.cos(kart.angle), z = Math.sin(kart.angle);
      const distance = mode === 1 ? 5.05 : 2.67 + narrow * 1.43 + Math.min(kart.speed * .009, .23);
      const height = mode === 1 ? 2.53 : 1.12 + narrow * .25;
      const lookAhead = mode === 1 ? 5.4 : 4.8;
      const lookHeight = mode === 1 ? .73 : .56;
      eye.set(kart.x - x * distance, height, kart.z - z * distance);
      target.set(kart.x + x * lookAhead, lookHeight, kart.z + z * lookAhead);
      // Follow translation immediately and smooth only changes in heading/framing.
      if (!snap) {
        kartMovement.set(kart.x - lastKartPosition.x, 0, kart.z - lastKartPosition.z);
        camera.position.add(kartMovement);
        look.add(kartMovement);
      }
      const blend = snap ? 1 : 1 - Math.exp(-10 * dt);
      camera.position.lerp(eye, blend);
      look.lerp(target, blend);
    }
    lastKartPosition.set(kart.x, 0, kart.z);
    camera.lookAt(look);
    rainClock.value+=dt;
    rainClockNode.value=rainClock.value;
    lighting.update(kart,camera,dt);
    rain.update(kart,dt);
  }
  return {
    setConditions(hour,wet){
      wetness.value=Number(wet);
      wetnessNode.value=Number(wet);
      asphalt.envMapIntensity=wet ? .81 : .43;
      contact.material.opacity=wet ? .86 : 1;
      lighting.set(hour,wet);
      rain.set(hour,wet);
    },
    clearTireTrail() { tireTrail.reset(); },
    async prepareConditions(hour, wet, onProgress = () => {}, nextView = view) {
      this.setConditions(hour, wet);
      updateView(nextView.kart, 0, nextView.mode, true, nextView.lapTime);
      onProgress({stage:'pipelines'});
      let active = true;
      try {
        await renderer.compileAsync(scene, camera, null, ({loaded, total}) => {
          if (active) onProgress({stage:'pipelines', progress:loaded, total});
        });
      } finally {
        active = false;
      }
    },
    render(kart, dt, mode, snap = false, lapTime = '—') {
      updateView(kart, dt, mode, snap, lapTime);
      renderer.render(scene, camera);
    },
  };
}
