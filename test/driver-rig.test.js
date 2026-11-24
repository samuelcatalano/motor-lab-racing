import assert from 'node:assert/strict';
import test from 'node:test';
import { Group, Vector3 } from 'three';
import { mountDriverRig, solveElbow } from '../src/driver-rig.js';

test('the seated arm stays on the elbow side and reaches both ends of steering travel', () => {
  const wheel = new Vector3(0, .491, .244);
  const steeringAxis = new Vector3(0, -.6051864, .7960838).normalize();
  for (const sign of [-1, 1]) {
    const shoulder = new Vector3(sign * .156, .570, -.120);
    const restElbow = new Vector3(sign * .225, .470, .016);
    const restWrist = new Vector3(sign * .134, .502, .200);
    const upper = shoulder.distanceTo(restElbow);
    const forearm = restElbow.distanceTo(restWrist);
    for (const angle of [-.54, 0, .54]) {
      const wrist = restWrist.clone().sub(wheel).applyAxisAngle(steeringAxis, angle).add(wheel);
      const elbow = solveElbow(shoulder, wrist, restElbow, upper, forearm,
        new Vector3(), new Vector3(), new Vector3());
      assert.ok(Math.abs(elbow.distanceTo(shoulder) - upper) < 1e-9);
      assert.ok(Math.abs(elbow.distanceTo(wrist) - forearm) < 1e-9);
      assert.ok(sign * elbow.x > sign * shoulder.x);
      if (angle === 0) assert.ok(elbow.distanceTo(restElbow) < 1e-9);
    }
  }
});

test('throttle and brake drive only their own foot and preserve pedal contact', () => {
  const root = new Group();
  const world = node => node.getWorldPosition(new Vector3());
  function joint(parent, name, x, y, z) {
    const node = new Group();
    node.name = name;
    node.position.copy(parent.worldToLocal(new Vector3(x, y, z)));
    parent.add(node);
    return node;
  }
  const wheel = joint(root, 'Steering', 0, .41, .21);
  const spine = joint(root, 'RigSpine', 0, .33, -.21);
  joint(spine, 'RigHead', 0, .68, -.16);
  const legs = ['L', 'R'].map((side, i) => {
    const x = i === 0 ? .11 : -.11;
    const arm = joint(spine, 'RigUpperArm' + side, x, .55, -.15);
    const forearm = joint(arm, 'RigForearm' + side, x * 1.5, .44, .03);
    joint(forearm, 'RigHand' + side, x * 1.35, .45, .17);
    const thigh = joint(root, 'RigThigh' + side, x, .18, -.21);
    const knee = joint(thigh, 'RigShin' + side, x * 1.15, .27, .09);
    const foot = joint(knee, 'RigFoot' + side, x, .15, .39);
    const pedal = joint(root, i === 0 ? 'BrakePedal' : 'ThrottlePedal', x, .09, .58);
    const contact = joint(pedal, 'PedalContact' + side, x, .18, .61);
    return {knee, foot, contact, atRest:world(foot), kneeRest:world(knee),
      shoeContact:foot.worldToLocal(world(contact))};
  });
  const pose = mountDriverRig(root, root, wheel);
  for (const [throttle, brake] of [[1, 0], [0, 1], [.35, .8], [0, 0]]) {
    pose(0, 0, 0, throttle, brake);
    for (const [i, leg] of legs.entries()) {
      const pressing = (i === 0 ? brake : throttle) > 0;
      assert.equal(world(leg.foot).distanceTo(leg.atRest) > .004, pressing);
      assert.equal(world(leg.knee).distanceTo(leg.kneeRest) > .004, pressing);
      assert.ok(leg.foot.localToWorld(leg.shoeContact.clone()).distanceTo(world(leg.contact)) < 1e-6);
    }
  }
});
