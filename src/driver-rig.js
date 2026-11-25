import { Euler, Quaternion, Vector3 } from 'three/webgpu';

const localAxis = new Vector3(0, 1, 0);
const pedalAxis = new Vector3(1, 0, 0);

export function solveElbow(shoulder, wrist, pole, upper, lower, elbow, axis, bend) {
  axis.subVectors(wrist, shoulder);
  const distance = Math.min(upper + lower - .00001,
    Math.max(Math.abs(upper - lower) + .00001, axis.length()));
  axis.normalize();
  bend.subVectors(pole, shoulder).addScaledVector(axis, -bend.dot(axis)).normalize();
  const projection = (upper ** 2 + distance ** 2 - lower ** 2) / (2 * distance);
  const rise = Math.sqrt(Math.max(0, upper ** 2 - projection ** 2));
  return elbow.copy(shoulder).addScaledVector(axis, projection).addScaledVector(bend, rise);
}

function relativeQuaternion(object, root) {
  return root.getWorldQuaternion(new Quaternion()).invert()
    .multiply(object.getWorldQuaternion(new Quaternion()));
}

function aimBone(bone, neutral, joint, target, local, turn) {
  local.copy(target);
  bone.parent.worldToLocal(local);
  local.sub(bone.position).normalize();
  turn.setFromUnitVectors(joint, local);
  bone.quaternion.multiplyQuaternions(turn, neutral);
  bone.updateWorldMatrix(false, true);
}

function racerFingerBones(hand) {
  const bones = new Map();
  hand.traverse(bone => {
    const finger = bone.name.match(/Hand(Index|Middle|Ring|Pinky|Thumb)[1-4]$/);
    if (finger) bones.set(finger[0], bone);
  });
  return bones;
}

function wrapRacerFingers(bones, wheel, normal, presentation) {
  const rimRadius = .14175;
  const up = new Vector3(1, 0, 0).cross(normal);
  const local = new Vector3(), turn = new Quaternion();
  const worldTarget = target => wheel.localToWorld(target);
  const wheelPosition = bone => wheel.worldToLocal(bone.getWorldPosition(new Vector3()));
  function section(point) {
    const radial = point.clone().addScaledVector(normal, -point.dot(normal)).normalize();
    const depth = .092 * rimRadius * radial.dot(up);
    return {radial, depth};
  }
  function pointJoint(joint, child, target) {
    const rest = joint.quaternion.clone();
    const direction = child.position.clone().applyQuaternion(rest).normalize();
    aimBone(joint, rest, direction, worldTarget(target), local, turn);
  }
  // The padded glove needs extra clearance between its articulated joints.
  for (const [name, baseClearance, clearance, tipClearance = clearance] of [
    ['Index', .026, .030], ['Middle', .031, .033], ['Ring', .031, .033, .043], ['Pinky', .030, .031],
  ]) {
    const chain = [1, 2, 3, 4].map(index => bones.get('Hand' + name + index));
    if (chain.some(bone => !bone)) continue;
    const {radial, depth} = section(wheelPosition(chain[0]));
    const radii = presentation ? [.034, .034, .032] : [baseClearance, clearance, tipClearance];
    for (const [i, gloveClearance] of radii.entries()) {
      const joint = chain[i], child = chain[i + 1];
      const point = wheelPosition(joint);
      const across = point.dot(radial) - rimRadius;
      const axial = point.dot(normal) - depth;
      const radius = Math.hypot(across, axial);
      const length = joint.getWorldPosition(new Vector3()).distanceTo(child.getWorldPosition(new Vector3()));
      // Match the segment length while moving its tip around the padded rim.
      const cosine = (radius ** 2 + gloveClearance ** 2 - length ** 2) / (2 * radius * gloveClearance);
      const angle = Math.atan2(axial, across) - Math.acos(Math.max(-1, Math.min(1, cosine)));
      pointJoint(joint, child, radial.clone().multiplyScalar(rimRadius + gloveClearance * Math.cos(angle))
        .addScaledVector(normal, depth + gloveClearance * Math.sin(angle)));
    }
  }
  const thumbRoot = bones.get('HandThumb1'), thumbBase = bones.get('HandThumb2');
  const thumb = bones.get('HandThumb3'), thumbTip = bones.get('HandThumb4');
  if (thumbRoot && thumbBase && thumb && thumbTip) {
    // Oppose the fingers with the thumb pad against the driver's side of the inner rim.
    const {radial, depth} = section(wheelPosition(bones.get('HandMiddle1')));
    const facing = presentation ? -1 : 1;
    pointJoint(thumbRoot, thumbBase, radial.clone().multiplyScalar(rimRadius - (presentation ? .020 : .004))
      .addScaledVector(normal, depth + facing * .044).addScaledVector(up, .017));
    pointJoint(thumbBase, thumb, radial.clone().multiplyScalar(rimRadius - (presentation ? .042 : .017))
      .addScaledVector(normal, depth + facing * .026).addScaledVector(up, .029));
    pointJoint(thumb, thumbTip, radial.multiplyScalar(rimRadius - (presentation ? .044 : .016))
      .addScaledVector(normal, depth + facing * .016).addScaledVector(up, .041));
  }
}

function limb(upper, lower, end) {
  const start = upper.getWorldPosition(new Vector3());
  const joint = lower.getWorldPosition(new Vector3());
  const tip = end.getWorldPosition(new Vector3());
  return {
    upper, lower, end, joint, tip,
    upperRest: upper.quaternion.clone(), lowerRest: lower.quaternion.clone(),
    upperDirection: lower.position.clone().applyQuaternion(upper.quaternion).normalize(),
    lowerDirection: end.position.clone().applyQuaternion(lower.quaternion).normalize(),
    upperLength: start.distanceTo(joint), lowerLength: joint.distanceTo(tip),
  };
}

function mountLeg(body, root, side) {
  const thigh = body.getObjectByName('RigThigh' + side);
  const shin = body.getObjectByName('RigShin' + side);
  const foot = body.getObjectByName('RigFoot' + side);
  if (!thigh || !shin || !foot) return null;
  const pose = limb(thigh, shin, foot);
  const pedal = body.getObjectByName(side === 'R' ? 'ThrottlePedal' : 'BrakePedal');
  const contact = pedal?.getObjectByName('PedalContact' + side);
  const neutral = root.worldToLocal(pose.tip);
  const offset = contact && neutral.clone().sub(
    root.worldToLocal(contact.getWorldPosition(new Vector3())));
  return {
    ...pose, side, neutral, contact, pedal, offset,
    pole:root.worldToLocal(pose.joint),
    orientation:relativeQuaternion(foot, root),
    restPedalAngle:pedal?.rotation.x ?? 0,
  };
}

export function mountDriverRig(body, root, wheel, {presentation = false} = {}) {
  const spine = body?.getObjectByName('RigSpine');
  const head = body?.getObjectByName('RigHead');
  if (!spine || !head) return null;
  const detailedRacer = Boolean(body.getObjectByName('Racer_|_glove_cuff_L'));

  root.updateWorldMatrix(true, true);
  const spineRest = spine.quaternion.clone();
  const headRest = head.quaternion.clone();
  const spineFrame = relativeQuaternion(spine.parent, root);
  const headFrame = relativeQuaternion(head.parent, root);
  const spineFrameInverse = spineFrame.clone().invert(), headFrameInverse = headFrame.clone().invert();

  const arms = ['L', 'R'].map(side => {
    const upper = body.getObjectByName('RigUpperArm' + side);
    const lower = body.getObjectByName('RigForearm' + side);
    const hand = body.getObjectByName('RigHand' + side);
    const pose = limb(upper, lower, hand);
    const grip = wheel.worldToLocal(pose.tip);
    const gripOrientation = relativeQuaternion(hand, wheel);
    const fingers = detailedRacer ? racerFingerBones(hand) : null;
    let rimNormal;
    if (detailedRacer) {
      // Opposed palms sit at nine and three, with the thumbs on the inner rim.
      const axis = new Vector3().fromArray(wheel.userData.steeringAxis).normalize();
      const gripAngle = presentation ? .22 : -.08;
      const turn = new Quaternion().setFromAxisAngle(axis, side === 'L' ? gripAngle : -gripAngle);
      const middle = fingers.get('HandMiddle1');
      const knuckleOffset = middle &&
        wheel.worldToLocal(middle.getWorldPosition(new Vector3())).sub(grip).applyQuaternion(turn);
      grip.applyQuaternion(turn);
      gripOrientation.premultiply(turn);
      if (knuckleOffset) {
        // Rotate about the knuckles so the wrist straightens without moving the grip off the rim.
        const relax = new Quaternion().setFromAxisAngle(pedalAxis, presentation ? -.48 : -.43);
        grip.add(knuckleOffset).sub(knuckleOffset.applyQuaternion(relax));
        gripOrientation.premultiply(relax);
        if (presentation) {
          const rimUp = pedalAxis.clone().cross(axis.clone().negate()).normalize();
          const closePalm = new Quaternion().setFromAxisAngle(rimUp, side === 'L' ? .70 : -.70);
          grip.add(knuckleOffset).sub(knuckleOffset.applyQuaternion(closePalm));
          gripOrientation.premultiply(closePalm);
        }
        const palmRoll = presentation ? .10 : .48;
        const roll = new Quaternion().setFromAxisAngle(knuckleOffset.normalize(), side === 'L' ? palmRoll : -palmRoll);
        gripOrientation.premultiply(roll);
      }
      rimNormal = axis.negate();
      const outward = grip.clone().addScaledVector(rimNormal, -grip.dot(rimNormal)).normalize();
      grip.addScaledVector(outward, presentation ? -.002 : -.004);
      if (presentation) grip.addScaledVector(rimNormal, -.049);
      // Protract the shoulders so the outside arm can reach the raised grip at full lock.
      const collar = upper.parent;
      const shoulderAxis = localAxis.clone().applyQuaternion(relativeQuaternion(collar.parent, root).invert());
      collar.quaternion.premultiply(new Quaternion().setFromAxisAngle(shoulderAxis, side === 'L' ? -.4 : .4));
    }
    return {
      ...pose,
      pole:spine.worldToLocal(pose.joint), grip, gripOrientation, fingers, rimNormal,
    };
  });
  const legs = ['L', 'R'].map(side => mountLeg(body, root, side)).filter(Boolean);

  const delta = new Quaternion(), wheelRotation = new Quaternion(), turn = new Quaternion();
  const footRotation = new Quaternion(), kartRotation = new Quaternion();
  const leanAngles = new Euler();
  const start = new Vector3(), tip = new Vector3(), pole = new Vector3(), joint = new Vector3();
  const axis = new Vector3(), bend = new Vector3(), local = new Vector3();
  function aimLimb(pose) {
    pose.upper.getWorldPosition(start);
    solveElbow(start, tip, pole, pose.upperLength, pose.lowerLength, joint, axis, bend);
    aimBone(pose.upper, pose.upperRest, pose.upperDirection, joint, local, turn);
    aimBone(pose.lower, pose.lowerRest, pose.lowerDirection, tip, local, turn);
  }

  return (lean, pitch, look, throttle = 0, brake = 0) => {
    delta.setFromEuler(leanAngles.set(pitch, 0, lean));
    spine.quaternion.copy(spineFrameInverse).multiply(delta).multiply(spineFrame).multiply(spineRest);
    delta.setFromAxisAngle(localAxis, -look);
    head.quaternion.copy(headFrameInverse).multiply(delta).multiply(headFrame).multiply(headRest);
    root.updateWorldMatrix(true, true);
    wheel.getWorldQuaternion(wheelRotation);

    for (const arm of arms) {
      wheel.localToWorld(tip.copy(arm.grip));
      spine.localToWorld(pole.copy(arm.pole));
      aimLimb(arm);
      arm.lower.getWorldQuaternion(turn).invert();
      arm.end.quaternion.copy(turn).multiply(wheelRotation).multiply(arm.gripOrientation);
      arm.end.updateWorldMatrix(false, true);
      if (arm.fingers) {
        wrapRacerFingers(arm.fingers, wheel, arm.rimNormal, presentation);
        arm.fingers = null;
      }
    }

    root.getWorldQuaternion(kartRotation);
    for (const leg of legs) {
      const right = leg.side === 'R';
      const press = right ? throttle : brake;
      footRotation.setFromAxisAngle(pedalAxis, press * (right ? .195 : .15));
      if (leg.contact) {
        leg.pedal.rotation.x = leg.restPedalAngle + press * (right ? .32 : .25);
        leg.contact.getWorldPosition(tip);
        root.worldToLocal(tip).add(local.copy(leg.offset).applyQuaternion(footRotation));
      } else {
        tip.copy(leg.neutral);
        tip.z += press * .019;
        tip.y += press * .007;
      }
      root.localToWorld(tip);
      root.localToWorld(pole.copy(leg.pole));
      aimLimb(leg);
      leg.lower.getWorldQuaternion(turn).invert();
      leg.end.quaternion.copy(turn).multiply(kartRotation).multiply(footRotation).multiply(leg.orientation);
      leg.end.updateWorldMatrix(false, true);
    }
  };
}
