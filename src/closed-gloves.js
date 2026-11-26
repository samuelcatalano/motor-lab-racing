import {
  BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Group,
  Mesh, MeshStandardMaterial, Vector3,
} from 'three/webgpu';

const rimRadius = .14175;
const rimTube = .01575;

function handWeight(mesh, index) {
  const {skinIndex, skinWeight} = mesh.geometry.attributes;
  let weight = 0;
  for (let slot = 0; slot < 4; slot++) {
    const bone = mesh.skeleton.bones[skinIndex.getComponent(index, slot)];
    if (/^RigHand[LR]$|Hand(Index|Middle|Ring|Pinky|Thumb)[1-4]$/.test(bone.name)) {
      weight += skinWeight.getComponent(index, slot);
    }
  }
  return weight;
}

function hideOpenHands(root) {
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const source = mesh.geometry;
    const count = source.index?.count ?? source.attributes.position.count;
    const indices = [];
    let changed = false;
    for (let index = 0; index < count; index += 3) {
      const face = [0, 1, 2].map(offset => source.index ? source.index.getX(index + offset) : index + offset);
      if (face.some(vertex => handWeight(mesh, vertex) > .45)) changed = true;
      else indices.push(...face);
    }
    if (!changed) return;
    mesh.geometry = source.clone();
    mesh.geometry.setIndex(indices);
    mesh.geometry.clearGroups();
  });
}

// The surface is authored around the steering rim. Only its wrist endpoint comes from the arm rig.
export function addClosedGloves(root, wheel) {
  hideOpenHands(root);
  const normal = new Vector3().fromArray(wheel.userData.steeringAxis).negate();
  const up = new Vector3(1, 0, 0).cross(normal);
  const material = new MeshStandardMaterial({color:0x303236, roughness:.76, metalness:0});
  const seamMaterial = new MeshStandardMaterial({color:0x171a1e, roughness:.90});
  const palms = new Group();
  palms.name = 'Closed racing gloves';
  wheel.add(palms);

  function point(angle, radial, depth) {
    return new Vector3(Math.cos(angle), 0, 0).addScaledVector(up, Math.sin(angle))
      .multiplyScalar(radial).addScaledVector(normal, depth + .092 * rimRadius * Math.sin(angle));
  }

  function keepOutsideRim(position) {
    const radial = Math.hypot(position.x, position.dot(up));
    const center = position.clone().addScaledVector(normal, -position.dot(normal)).multiplyScalar(rimRadius / radial);
    center.addScaledVector(normal, .092 * center.dot(up));
    const offset = position.clone().sub(center);
    if (offset.length() < rimTube + .002) position.copy(center).add(offset.setLength(rimTube + .002));
  }

  function surface(name, curve, widthAt, depthAt, spread, finish = material) {
    const positions = [], indices = [];
    const steps = 48, sides = 16;
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const center = curve.getPoint(t);
      const tangent = curve.getTangent(t).normalize();
      const across = spread.clone().addScaledVector(tangent, -spread.dot(tangent)).normalize();
      const depth = tangent.clone().cross(across).normalize();
      for (let side = 0; side <= sides; side++) {
        const angle = side / sides * Math.PI * 2;
        const position = center.clone().addScaledVector(across, Math.cos(angle) * widthAt(t))
          .addScaledVector(depth, Math.sin(angle) * depthAt(t));
        keepOutsideRim(position);
        positions.push(position.x, position.y, position.z);
      }
    }
    for (let step = 0; step < steps; step++) {
      for (let side = 0; side < sides; side++) {
        const a = step * (sides + 1) + side, b = a + sides + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    for (const end of [0, 1]) {
      const center = curve.getPoint(end);
      keepOutsideRim(center);
      const cap = positions.length / 3;
      positions.push(center.x, center.y, center.z);
      const row = end * steps * (sides + 1);
      for (let side = 0; side < sides; side++) {
        if (end === 0) indices.push(cap, row + side + 1, row + side);
        else indices.push(cap, row + side, row + side + 1);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new Mesh(geometry, finish);
    mesh.name = name;
    mesh.userData.closedGlove = true;
    mesh.castShadow = mesh.receiveShadow = true;
    palms.add(mesh);
  }

  for (const [side, sign] of [['L', 1], ['R', -1]]) {
    const angle = sign > 0 ? .36 : Math.PI - .36;
    const spread = new Vector3(-Math.sin(angle), 0, 0).addScaledVector(up, Math.cos(angle)).multiplyScalar(sign);
    const wrist = wheel.worldToLocal(root.getObjectByName('RigHand' + side).getWorldPosition(new Vector3()));
    const knuckles = point(angle, rimRadius + .024, .014);
    const palm = new CatmullRomCurve3([wrist, wrist.clone().lerp(knuckles, .5), knuckles]);
    const palmWidth = t => .017 + .015 * Math.sin(Math.PI * t * .75);
    surface('Glove palm ' + side, palm, palmWidth, t => .009 + .001 * Math.sin(Math.PI * t), spread);
    const back = knuckles.clone().sub(wrist).normalize().cross(spread).normalize();
    if (back.dot(normal) > 0) back.negate();
    for (const offset of [-.010, .010]) {
      const seam = new CatmullRomCurve3([.20, .45, .75, .94].map(t =>
        wrist.clone().lerp(knuckles, t).addScaledVector(spread, offset)
          .addScaledVector(back, .010)));
      surface('Glove stitched panel ' + side, seam, () => .0006, () => .0006, spread, seamMaterial);
    }

    for (const [finger, offset, end, radius] of [
      ['Index', .028, -2.95, .0085], ['Middle', .009, -3.30, .009],
      ['Ring', -.010, -3.20, .0085], ['Pinky', -.028, -2.95, .0075],
    ]) {
      const fingerAngle = angle + sign * offset / rimRadius;
      const curve = {
        getPoint(t) {
          const bend = .50 + (end - .50) * t;
          return point(fingerAngle, rimRadius + .026 * Math.cos(bend), .026 * Math.sin(bend));
        },
        getTangent(t) {
          const bend = .50 + (end - .50) * t;
          return point(fingerAngle, -.026 * Math.sin(bend), .026 * Math.cos(bend))
            .sub(point(fingerAngle, 0, 0)).multiplyScalar(end - .50).normalize();
        },
      };
      const width = t => radius * (.98 - .18 * t) * Math.sqrt(Math.max(.015, 1 - Math.max(0, (t - .90) / .10) ** 2));
      surface('Glove ' + finger + ' ' + side, curve, width, width, spread);
    }

    const thumbAngle = angle + sign * .24;
    const thumb = new CatmullRomCurve3([
      wrist.clone().lerp(knuckles, .72).addScaledVector(spread, .018),
      point(thumbAngle, rimRadius - .003, .026),
      point(thumbAngle + sign * .06, rimRadius - .023, .018),
      point(thumbAngle + sign * .08, rimRadius - .026, .007),
    ]);
    const thumbWidth = t => .009 * (1 - .35 * t) * Math.sqrt(Math.max(.025, 1 - Math.max(0, (t - .88) / .12) ** 2));
    surface('Glove Thumb ' + side, thumb, thumbWidth, thumbWidth, spread);
  }
  return palms;
}
