import * as T from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { random } from './surfaces.js';

// Rectangles in the 512 px RGBA leaf atlas, inset into transparent gutters.
const leaves = [
  [4, 4, 77, 264], [79, 4, 179, 210], [180, 8, 251, 193],
  [258, 15, 339, 193], [350, 4, 422, 217], [4, 316, 93, 510],
  [103, 291, 187, 509], [207, 301, 295, 510],
];

function branch(parts, start, end, lower, upper) {
  const length = start.distanceTo(end);
  const geometry = new T.CylinderGeometry(upper, lower, length, 8, 1, true);
  const axis = end.clone().sub(start).normalize();
  geometry.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), axis));
  const middle = start.clone().lerp(end, .5);
  geometry.translate(middle.x, middle.y, middle.z);
  parts.push(geometry);
}

function treeGeometry(seed, leafCount, habit) {
  const rng = random(seed), wood = [], tips = [];
  const v = (x, y, z) => new T.Vector3(x, y, z);
  const trunk = [v(0,0,0), v(-.018,.22,.013), v(.025,.41,.004),
    v(.053,.62,-.037), v(.031,.81,-.063), v(.09,.98,-.055)];
  const radii = [.044,.032,.027,.017,.011,.003];
  for (let i = 1; i < trunk.length; i++) {
    branch(wood, trunk[i - 1], trunk[i], radii[i - 1], radii[i]);
  }
  for (let i = 0; i < 13; i++) {
    const tier = Math.floor(i / 4) + 1;
    const origin = trunk[tier].clone().lerp(trunk[tier + 1], .23 + rng() * .31);
    const angle = i * 2.39996 + rng() * .32;
    const reach = (.21 + rng() * .15) * (1 - tier * .105) * habit;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const elbow = origin.clone().add(v(dx * reach * .47, .12 + rng() * .05, dz * reach * .47));
    const end = elbow.clone().add(v(dx * reach * .57, .085 + rng() * .09, dz * reach * .57));
    branch(wood, origin, elbow, .017 - tier * .0027, .010 - tier * .0011);
    branch(wood, elbow, end, .010 - tier * .0011, .0018);
    for (const side of [-1, 1]) {
      const fork = elbow.clone().lerp(end, .38 + rng() * .33);
      const twig = fork.clone().add(v(-dz * side * reach * .39 + dx * reach * .28,
        .064 + rng() * .06, dx * side * reach * .39 + dz * reach * .28));
      branch(wood, fork, twig, .0045, .0012);
      tips.push({point: twig, radius: .071 + rng() * .034});
      tips.push({point: fork, radius: .062 + rng() * .026});
    }
    tips.push({point:end, radius:.079 + rng() * .037});
  }
  tips.push({point:trunk.at(-1),radius:.115});

  const positions = [], colors = [], normals = [], uv = [], indices = [];
  const center = new T.Vector3(), horizontal = new T.Vector3(), vertical = new T.Vector3();
  const vertex = new T.Vector3(), normal = new T.Vector3();
  for (let i = 0; i < leafCount; i++) {
    const {point, radius} = tips[i % tips.length];
    const phi = rng() * Math.PI * 2, lift = rng() * 2 - 1;
    const spread = radius * Math.cbrt(rng());
    const radial = Math.sqrt(1 - lift * lift);
    center.copy(point).add(v(Math.cos(phi) * radial * spread, lift * spread * .94,
      Math.sin(phi) * radial * spread));
    const swing = rng() * Math.PI * 2;
    const tilt = .20 + rng() * 1.18;
    const halfWidth = (.018 + rng() * .014) * (leafCount < 1000 ? 1.5 : 1);
    const halfHeight = halfWidth * (1.15 + rng() * .7);
    horizontal.set(Math.cos(swing), 0, Math.sin(swing)).multiplyScalar(halfWidth);
    vertical.set(-Math.sin(swing) * Math.cos(tilt), Math.sin(tilt),
      Math.cos(swing) * Math.cos(tilt)).multiplyScalar(halfHeight);
    normal.crossVectors(horizontal, vertical).normalize();
    const [x0,y0,x1,y1] = leaves[Math.floor(rng() * leaves.length)];
    const u0 = x0 / 512, u1 = x1 / 512, v0 = 1 - y1 / 512, v1 = 1 - y0 / 512;
    const shade = .61 + rng() * .38;
    const begin = positions.length / 3;
    for (const [x,y,u,w] of [[-1,-1,u0,v0],[1,-1,u1,v0],[1,1,u1,v1],[-1,1,u0,v1],
      [0,0,(u0+u1)/2,(v0+v1)/2]]) {
      vertex.copy(center).addScaledVector(horizontal, x).addScaledVector(vertical, y);
      if (!x) vertex.addScaledVector(normal, halfWidth * .26);
      positions.push(vertex.x, vertex.y, vertex.z);
      normals.push(normal.x, normal.y, normal.z);
      colors.push(shade, shade * (.96 + .06 * lift), shade * .87);
      uv.push(u,w);
    }
    for (let corner = 0; corner < 4; corner++) {
      indices.push(begin + corner, begin + (corner + 1) % 4, begin + 4);
    }
  }
  const foliage = new T.BufferGeometry();
  foliage.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  foliage.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  foliage.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  foliage.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  foliage.setIndex(indices);
  const branches = mergeGeometries(wood);
  wood.forEach(piece => piece.dispose());
  return {foliage, branches};
}

export function addWoodland(scene, track, maps) {
  const rng = random(track.seed + 531);
  const stands = Array.from({length:5}, () => []);
  const colors = [0xc8c9ab, 0xb7c7a6, 0xd4cbac, 0xaab483].map(hex => new T.Color(hex));
  const distantColors = [0xadb4a0, 0x9da693, 0xb5b6a0].map(hex => new T.Color(hex));
  function plant(x, z, aroundTrack, distant = false) {
    const distance = track.nearest(x,z).distance;
    if (distance < 12 || (aroundTrack && distance > 43)) return;
    const pad = track.paddock;
    if (pad && z > pad.z - 12 && z < pad.z + 21 && x > pad.x - 29 && x < pad.x + 49) return;
    const size = (aroundTrack ? 4.2 : 5.3) + rng() * (aroundTrack ? 3.9 : 5.7);
    const tier = aroundTrack ? (distance < 22 ? 0 : 1) : 2;
    const variety = distant ? 4 : tier === 0 ? Math.floor(rng() * 2) : tier + 1;
    const palette = distant ? distantColors : colors;
    stands[variety].push({x,z,size,width:.79 + rng() * .36,yaw:rng() * Math.PI * 2,
      tint: palette[Math.floor(rng() * palette.length)]});
  }
  for (let i = 0; i < 123; i++) {
    const u = (i + rng() * .9) / 123;
    const side = i % 3 === 0 ? -1 : 1;
    const {point} = track.at(u, side * (13.1 + rng() ** 1.2 * 31));
    plant(point.x, point.z, true);
  }
  // Uneven stands add depth between the course and the photographed foothills.
  for (let i = 0; i < 232; i++) {
    const angle = (i + rng() * .85) * Math.PI * 2 / 232;
    const radius = 111 + rng() * 44;
    plant(Math.cos(angle) * radius * 1.17, Math.sin(angle) * radius, false);
  }
  for (let i = 0; i < 184; i++) {
    const angle = (i + rng() * .85) * Math.PI * 2 / 184;
    const radius = 158 + rng() * 45 + 12 * Math.sin(angle * 7);
    plant(Math.cos(angle) * radius * 1.12, Math.sin(angle) * radius, false, true);
  }
  const leafMaterial = new T.MeshStandardMaterial({
    map:maps.leaves, alphaTest:.35, side:T.DoubleSide,
    roughness:.93, vertexColors:true, color:0xf3f5e2, envMapIntensity:.66,
    emissive:0x546039, emissiveIntensity:.11,
  });
  maps.bark.wrapS = maps.bark.wrapT = T.RepeatWrapping;
  maps.bark.repeat.set(1, 2.8);
  const barkMaterial = new T.MeshStandardMaterial({map:maps.bark,color:0xa7a18e,roughness:.97});
  const obj = new T.Object3D();
  stands.forEach((trees, i) => {
    if (!trees.length) return;
    const {foliage, branches} = treeGeometry(track.seed + i * 93, [2600,2600,1650,650,320][i], [1.28,.95,1.35,1.20,1.30][i]);
    const canopy = new T.InstancedMesh(foliage, leafMaterial, trees.length);
    const trunks = new T.InstancedMesh(branches, barkMaterial, trees.length);
    trees.forEach(({x,z,size,width,yaw,tint}, index) => {
      obj.position.set(x, -.035, z);
      obj.rotation.y = yaw;
      obj.scale.set(size * width, size, size * width);
      obj.updateMatrix();
      canopy.setMatrixAt(index,obj.matrix);
      trunks.setMatrixAt(index,obj.matrix);
      canopy.setColorAt(index,tint);
    });
    canopy.castShadow = trunks.castShadow = i < 3;
    canopy.receiveShadow = trunks.receiveShadow = true;
    scene.add(canopy,trunks);
  });
}
