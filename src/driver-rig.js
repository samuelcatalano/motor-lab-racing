import { Euler, Quaternion, Vector3 } from 'three';

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

export function mountDriverRig(body, root, wheel) {
  const spine = body?.getObjectByName('RigSpine');
  const head = body?.getObjectByName('RigHead');
  if (!spine || !head) return null;

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
    return {
      ...pose,
      pole:spine.worldToLocal(pose.joint), grip:wheel.worldToLocal(pose.tip),
      gripOrientation: relativeQuaternion(hand, wheel),
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
