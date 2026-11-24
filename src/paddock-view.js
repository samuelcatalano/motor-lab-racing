import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function noise(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function facadeMap(kind, seed) {
  const concrete = kind === 'concrete';
  const horizontal = kind === 'shutter';
  const base = concrete ? [162, 155, 142] : horizontal ? [88, 96, 100] : [155, 157, 146];
  const random = noise(seed);
  return canvasTexture(256, 256, (ctx, width, height) => {
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const run = horizontal ? y : x;
        const step = run % (horizontal ? 16 : 12);
        const rib = concrete ? 0 : step === 0 ? -32 : step === 1 ? -12 : step < 5 ? 18 - step * 2 : 0;
        const weather = Math.sin(x * .095 + Math.sin(y * .011)) * 6
          + Math.sin(x * .028 + y * .011) * 8 + (random() - .5) * (concrete ? 22 : 9);
        const drip = !horizontal && Math.sin(x * 1.867) > .76 ? -(1 - y / height) * 13 : 0;
        for (let c = 0; c < 3; c++) image.data[i + c] = base[c] + weather + rib + drip;
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  });
}

function mat(color, roughness = .8, metalness = 0, map = null) {
  return new T.MeshStandardMaterial({ color, roughness, metalness, map });
}

function scenicParts(parent) {
  const batches = new Map();
  const up = new T.Vector3(0, 1, 0);
  const rotations = new T.Quaternion();
  const transform = new T.Matrix4();
  const size = new T.Vector3(1, 1, 1);
  function record(material, geometry, center, orientation, casts) {
    const position = new T.Vector3(...center);
    geometry.applyMatrix4(transform.compose(position, orientation, size));
    const list = batches.get(material) ?? [[], []];
    if (!batches.has(material)) batches.set(material, list);
    list[casts ? 0 : 1].push(geometry.index ? geometry.toNonIndexed() : geometry);
    if (geometry.index) geometry.dispose();
  }
  return {
    box(material, dimensions, center, { angle = 0, radius = 0, casts = true } = {}) {
      const geometry = radius
        ? new RoundedBoxGeometry(...dimensions, 2, radius)
        : new T.BoxGeometry(...dimensions);
      record(material, geometry, center, rotations.setFromAxisAngle(up, angle), casts);
    },
    cylinder(material, radius, start, end, segments = 10) {
      const a = new T.Vector3(...start), b = new T.Vector3(...end);
      const axis = b.clone().sub(a);
      const geometry = new T.CylinderGeometry(radius, radius, axis.length(), segments);
      record(material, geometry, a.lerp(b, .5).toArray(),
        rotations.setFromUnitVectors(up, axis.normalize()), true);
    },
    flush() {
      for (const [material, groups] of batches) {
        groups.forEach((geometries, index) => {
          if (!geometries.length) return;
          const mesh = new T.Mesh(mergeGeometries(geometries), material);
          mesh.castShadow = index === 0;
          mesh.receiveShadow = true;
          parent.add(mesh);
          geometries.forEach(geometry => geometry.dispose());
        });
      }
    },
  };
}

function sign(kicker, title, ink, paint) {
  const texture = canvasTexture(512, 128, (ctx, width, height) => {
    ctx.fillStyle = paint;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#e5b148';
    ctx.fillRect(0, 0, 10, height);
    ctx.fillRect(18, 110, 102, 3);
    ctx.fillStyle = ink;
    ctx.font = 'bold 23px sans-serif';
    ctx.fillText(kicker, 24, 36, width - 48);
    ctx.font = '900 italic 48px sans-serif';
    ctx.fillText(title, 21, 94, width - 42);
  });
  return mat(0xffffff, .68, .07, texture);
}

function bayDoors(parts, materials) {
  const { concrete, wall, frame, dark, glass, gutter, shutter, paint } = materials;
  for (let index = 0; index < 4; index++) {
    const x = index * 7.3;
    parts.box(concrete, [7.19, .56, 5.4], [x, .21, 0]);
    parts.box(wall, [7.22, 3.26, 5.3], [x, 1.76, 0]);
    parts.box(dark, [7.3, .23, 5.54], [x, 3.52, .05]);
    parts.box(frame, [7.1, .08, .13], [x, 3.38, 2.77]);
    parts.box(dark, [6.12, 2.68, .12], [x, 1.36, 2.692]);
    parts.box(shutter, [5.84, 2.28, .095], [x, 1.24, 2.768]);
    parts.box(frame, [5.94, .092, .076], [x, .12, 2.842]);
    parts.box(frame, [5.95, .13, .14], [x, 2.43, 2.82]);
    parts.box(dark, [.28, .05, .06], [x, .75, 2.848]);
    parts.box(dark, [6.3, .12, .86], [x, 2.71, 2.985]);
    parts.box(frame, [6.32, .055, .07], [x, 2.644, 3.422]);
    for (const side of [-1, 1]) {
      parts.box(frame, [.10, 2.39, .13], [x + side * 2.99, 1.28, 2.81]);
      parts.box(dark, [.145, .21, .18], [x + side * 3.26, 1.80, 2.75]);
      parts.box(materials.lamp, [.085, .148, .022], [x + side * 3.26, 1.80, 2.852]);
      parts.box(dark, [.077, .39, .13], [x + side * 2.36, 2.56, 2.76]);
    }
    for (let pane = 0; pane < 6; pane++) {
      parts.box(dark, [.87, .34, .051], [x + (pane - 2.5) * 1.0, 3.10, 2.692]);
      parts.box(glass, [.81, .285, .029], [x + (pane - 2.5) * 1.0, 3.10, 2.732]);
    }
    for (const side of [-1, 1]) {
      parts.box(paint, [.064, .009, 3.7], [x + side * 3.0, .04, 4.65], { casts: false });
    }
    parts.box(paint, [6, .009, .077], [x, .04, 6.48], { casts: false });
    parts.box(sign('MOTOR LAB', 'BOX 0' + (index + 1), '#faf0dd', '#202a29'),
      [1.23, .31, .032], [x - 2.15, 2.76, 3.438], { casts: false });
  }
  for (const x of [-3.45, 10.95, 25.47]) {
    parts.cylinder(gutter, .062, [x, .34, 2.82], [x, 3.4, 2.82]);
    parts.cylinder(gutter, .062, [x, .34, 2.82], [x, .22, 3.04]);
    for (const y of [.66, 1.38, 2.18, 2.98]) {
      parts.box(frame, [.129, .049, .052], [x, y, 2.867]);
    }
  }
}

function controlTower(parts, materials) {
  const { concrete, wall, frame, dark, glass, gutter, lamp } = materials;
  const x = 37, z = 1;
  parts.box(concrete, [5.0, .30, 4.8], [x, .055, z]);
  parts.box(concrete, [4.34, 3.46, 4.10], [x, 1.77, z]);
  parts.box(dark, [4.56, .30, 4.29], [x, 3.46, z]);
  parts.box(wall, [4.63, 2.34, 4.04], [x, 4.766, z]);
  parts.box(dark, [5.23, .23, 4.66], [x, 6.047, z]);
  parts.box(frame, [5.14, .09, 4.55], [x, 6.197, z]);
  parts.box(frame, [4.54, .064, .067], [x, 4.56, z + 2.045]);
  parts.box(frame, [4.54, .064, .067], [x, 5.67, z + 2.045]);
  parts.box(frame, [.068, .064, 3.97], [x - 2.35, 4.56, z]);
  parts.box(frame, [.068, .064, 3.97], [x - 2.35, 5.67, z]);
  for (let panel = 0; panel < 4; panel++) {
    const a = panel - 1.5;
    parts.box(dark, [1.07, 1.17, .067], [x + a * 1.08, 5.11, z + 2.041]);
    parts.box(glass, [.979, 1.055, .037], [x + a * 1.08, 5.11, z + 2.09]);
    parts.box(dark, [.064, 1.17, .944], [x - 2.345, 5.11, z + a * .965]);
    parts.box(glass, [.035, 1.055, .85], [x - 2.386, 5.11, z + a * .965]);
  }
  for (const side of [-1, 1]) {
    const position = x + side * 2.21;
    parts.box(frame, [.135, 2.41, .126], [position, 4.78, z + 2.03]);
    parts.box(wall, [.127, 1.07, .116], [position, 4.09, z + 2.105]);
  }
  parts.box(dark, [1.15, 2.23, .065], [x - 1.30, 1.235, z + 2.095]);
  parts.box(frame, [1.015, 2.1, .044], [x - 1.30, 1.224, z + 2.137]);
  parts.box(glass, [.78, .55, .028], [x - 1.30, 1.83, z + 2.175]);
  parts.box(gutter, [.21, .026, .049], [x - 1.06, 1.04, z + 2.18]);
  parts.box(concrete, [1.51, .13, .65], [x - 1.3, .055, z + 2.27]);
  parts.box(dark, [1.59, .12, .92], [x - 1.3, 2.47, z + 2.36]);
  parts.box(lamp, [.31, .04, .16], [x - 1.3, 2.39, z + 2.24]);
  const board = sign('VALE DO CEDRO', 'CONTROLE', '#fbf2df', '#282e2b');
  parts.box(board, [2.72, .68, .029], [x + .60, 2.763, z + 2.087], { casts: false });
  parts.box(board, [2.72, .68, .029], [x - 2.192, 2.763, z], { angle: Math.PI / 2, casts: false });

  const mastX = x + 2.91;
  for (const dx of [-.26, .26]) {
    for (const dz of [-.26, .26]) {
      parts.cylinder(gutter, .031, [mastX + dx, .14, z + dz], [mastX + dx * .46, 8.68, z + dz * .46]);
    }
  }
  for (let storey = 0; storey < 7; storey++) {
    const y = .8 + storey * 1.13;
    const spread = .26 - .016 * storey;
    for (const side of [-1, 1]) {
      parts.cylinder(gutter, .015, [mastX - spread, y, z + side * spread],
        [mastX + spread, y + 1.13, z + side * spread * .94], 6);
      parts.cylinder(gutter, .015, [mastX - spread, y + 1.13, z + side * spread * .94],
        [mastX + spread, y, z + side * spread], 6);
      parts.cylinder(gutter, .015, [mastX + side * spread, y, z - spread],
        [mastX + side * spread * .94, y + 1.13, z + spread], 6);
      parts.cylinder(gutter, .017, [mastX - spread, y, z + side * spread],
        [mastX + spread, y, z + side * spread], 6);
    }
  }
  parts.box(frame, [1.58, .108, .64], [mastX, 8.825, z]);
  for (const offset of [-.54, 0, .54]) {
    parts.box(dark, [.42, .27, .13], [mastX + offset, 8.98, z + .21]);
    parts.box(lamp, [.355, .205, .021], [mastX + offset, 8.98, z + .286]);
  }
}

function fenceTexture() {
  const map = canvasTexture(256, 128, (ctx, width, height) => {
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#b0b4ab';
    const pitch = 16;
    for (let x = -height; x < width + height; x += pitch) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + height, height);
      ctx.moveTo(x, 0);
      ctx.lineTo(x - height, height);
      ctx.stroke();
    }
  });
  return new T.MeshStandardMaterial({
    color: 0x7d8176, map, alphaTest: .4, side: T.DoubleSide,
    roughness: .55, metalness: .38,
  });
}

function fence(parts, materials) {
  const { frame, gutter, concrete, paint, dark } = materials;
  const chain = fenceTexture();
  for (const [first, count] of [[-3.5, 5], [13.5, 6], [32.0, 5]]) {
    const dz = 7.38;
    const adjusted = first + count * 2.6;
    parts.box(gutter, [count * 2.6, .055, .053], [(first + adjusted) / 2, 1.63, dz]);
    parts.box(gutter, [count * 2.6, .04, .041], [(first + adjusted) / 2, .29, dz]);
    for (let index = 0; index <= count; index++) {
      const x = first + index * 2.6;
      parts.box(concrete, [.28, .13, .28], [x, .06, dz]);
      parts.box(frame, [.065, 1.67, .065], [x, .897, dz]);
      if (index < count) {
        parts.box(chain, [2.55, 1.34, .006], [x + 1.3, .96, dz + .04], { casts: false });
      }
    }
  }
  const wayfinding = [
    [5.8, sign('VALE DO CEDRO', 'PIT LANE', '#faf0dd', '#24423f')],
    [24.25, sign('ÁREA TÉCNICA', 'BOXES 01–04', '#faf0dd', '#282d2b')],
    [37.5, sign('ACESSO RESTRITO', 'CONTROLE', '#faf0dd', '#24423f')],
  ];
  for (const [x, material] of wayfinding) {
    parts.box(frame, [2.48, .61, .041], [x, 1.19, 7.438], { casts: false });
    parts.box(material, [2.42, .57, .024], [x, 1.19, 7.471], { casts: false });
  }
  for (const x of [10.02, 12.78, 29.82, 31.40]) {
    parts.box(dark, [.085, .82, .086], [x, .41, 7.43], { radius: .012 });
    parts.box(paint, [.088, .17, .09], [x, .60, 7.43], { radius: .01 });
  }
}

function buildServiceVan(parent, materials) {
  const van = new T.Group();
  van.position.set(30.1, .03, 1.7);
  van.rotation.y = .35;
  parent.add(van);
  const parts = scenicParts(van);
  const { frame, dark, glass, lamp, gutter, paint } = materials;
  const coating = mat(0xe8e2ce, .36, .09);
  const stripe = mat(0x285954, .40, .11);
  const rubber = mat(0x161814, .94);
  const rim = mat(0xa4a9a5, .45, .62);
  const red = mat(0xa63122, .38);
  parts.box(dark, [1.67, .16, 3.72], [0, .39, .20], { radius: .027 });
  parts.box(coating, [1.73, 1.66, 2.68], [0, 1.29, -.55], { radius: .105 });
  parts.box(coating, [1.69, 1.25, 1.44], [0, .99, 1.35], { radius: .15 });
  parts.box(coating, [1.65, .466, .61], [0, .816, 2.07], { radius: .12 });
  parts.box(coating, [1.60, .26, 1.24], [0, 1.825, 1.20], { radius: .091 });
  parts.box(gutter, [1.73, .09, 2.68], [0, 2.14, -.56], { radius: .027 });
  parts.box(dark, [1.64, .18, .21], [0, .52, 2.375], { radius: .042 });
  parts.box(dark, [1.67, .18, .20], [0, .50, -1.91], { radius: .039 });
  parts.box(frame, [1.20, .19, .046], [0, .754, 2.38], { radius: .016 });
  for (let j = 0; j < 5; j++) {
    parts.box(gutter, [1.13, .012, .010], [0, .687 + j * .031, 2.411]);
  }
  parts.box(glass, [1.44, .56, .058], [0, 1.518, 1.983], { radius: .077 });
  parts.box(dark, [1.45, .042, .067], [0, 1.188, 1.998], { radius: .019 });
  for (const side of [-1, 1]) {
    parts.box(stripe, [.030, .21, 2.44], [side * .868, 1.24, -.55], { radius: .017 });
    parts.box(paint, [.027, .073, 2.44], [side * .883, 1.106, -.55], { radius: .012 });
    parts.box(dark, [.031, .026, 1.03], [side * .849, 1.14, 1.27], { radius: .012 });
    parts.box(glass, [.052, .498, 1.012], [side * .835, 1.52, 1.30], { radius: .067 });
    parts.box(dark, [.092, .024, 1.032], [side * .856, 1.247, 1.3]);
    parts.box(dark, [.04, .04, .17], [side * .861, 1.112, 1.07], { radius: .014 });
    parts.cylinder(frame, .021, [side * .81, 1.4, 1.8], [side * .99, 1.4, 1.8]);
    parts.box(dark, [.112, .147, .095], [side * .998, 1.45, 1.79], { radius: .031 });
    parts.box(lamp, [.246, .177, .055], [side * .646, .86, 2.361], { radius: .03 });
    parts.box(red, [.14, .295, .037], [side * .756, .92, -1.9], { radius: .023 });
    parts.box(lamp, [.103, .039, .042], [side * .756, .87, -1.915], { radius: .012 });
    for (const z of [-1.005, 1.45]) {
      const arch = index => {
        const angle = Math.PI * index / 12;
        return [side * .865, .326 + Math.sin(angle) * .356, z + Math.cos(angle) * .356];
      };
      for (let index = 0; index < 12; index++) {
        parts.cylinder(dark, .024, arch(index), arch(index + 1), 6);
      }
      parts.cylinder(rubber, .339, [side * .71, .329, z], [side * .963, .329, z], 28);
      parts.cylinder(rim, .218, [side * .963, .329, z], [side * .972, .329, z], 24);
      parts.cylinder(frame, .074, [side * .972, .329, z], [side * .982, .329, z], 14);
      for (let index = 0; index < 6; index++) {
        const angle = index / 6 * Math.PI * 2;
        const y = .33 + Math.cos(angle) * .133;
        const lz = z + Math.sin(angle) * .133;
        parts.cylinder(dark, .024, [side * .971, y, lz], [side * .977, y, lz], 9);
      }
    }
  }
  const badge = sign('MOTOR LAB', 'APOIO', '#eee9d6', '#285954');
  parts.box(badge, [1.15, .29, .019], [0, 1.49, -1.901], { casts: false });
  parts.box(badge, [1.32, .33, .022], [-.876, 1.55, -.535], { angle: Math.PI / 2, casts: false });
  parts.box(badge, [1.32, .33, .022], [.876, 1.55, -.535], { angle: Math.PI / 2, casts: false });
  parts.box(gutter, [.56, .05, .19], [0, 2.258, 1.41], { radius: .016 });
  parts.box(paint, [.53, .08, .172], [0, 2.308, 1.41], { radius: .026 });
  parts.flush();
}

export function addPaddock(scene, track) {
  if (!track.paddock) return;
  const group = new T.Group();
  group.name = 'Vale do Cedro paddock';
  group.position.set(track.paddock.x, 0, track.paddock.z);
  scene.add(group);

  const materials = {
    concrete: mat(0xe2e0d3, .94, 0, facadeMap('concrete', 71)),
    wall: mat(0xe8e1c6, .78, .09, facadeMap('cladding', 18)),
    shutter: mat(0xf1f4f3, .68, .29, facadeMap('shutter', 4)),
    frame: mat(0x52605d, .53, .27),
    gutter: mat(0x777f76, .57, .42),
    dark: mat(0x232c2b, .72, .12),
    glass: mat(0x4e6367, .25, .51),
    paint: mat(0xeaae46, .82),
    lamp: new T.MeshStandardMaterial({ color: 0xf1e6c8, roughness: .42,
      emissive: 0x8b7448, emissiveIntensity: .23 }),
  };
  const parts = scenicParts(group);
  parts.box(materials.concrete, [48.7, .055, 10.64], [18.8, .002, 2.61], { casts: false });
  parts.box(materials.frame, [48.65, .053, .096], [18.8, .008, 7.94], { casts: false });
  bayDoors(parts, materials);
  controlTower(parts, materials);
  fence(parts, materials);
  parts.flush();
  buildServiceVan(group, materials);
}
