import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Scene, Vector3 } from 'three';
import { buildKart } from '../src/kart-view.js';

test('the imported wheels, steering and gloves follow driving input', () => {
  const body = new Group();
  const steering = new Group();
  steering.name = 'ImportedSteering';
  steering.userData.steeringAxis = [0, 0, 1];
  const arms = new Group();
  arms.name = 'DriverArms';
  const gloves = new Group();
  gloves.morphTargetDictionary = { SteerNegative: 0, SteerPositive: 1 };
  gloves.morphTargetInfluences = [0, 0];
  arms.add(gloves);
  body.add(steering, arms);
  for (const name of ['FrontLeftWheel', 'FrontRightWheel', 'RearLeftWheel', 'RearRightWheel']) {
    const pivot = new Group();
    pivot.name = name;
    pivot.add(new Group());
    body.add(pivot);
  }

  const kart = buildKart(new Scene(), body);
  const front = body.getObjectByName('FrontLeftWheel');
  const rear = body.getObjectByName('RearLeftWheel');
  const frame = { x: 0, z: 0, angle: 0, steer: .5, speed: 8, spin: 1.2 };
  kart.update(frame, 0);
  assert.equal(front.rotation.y, -.2);
  assert.equal(rear.rotation.y, 0);
  assert.equal(front.children[0].rotation.x, frame.spin);
  assert.equal(rear.children[0].rotation.x, frame.spin);
  const rightGrip = () => new Vector3(-1, 0, 0).applyQuaternion(steering.quaternion);
  const tireHeading = () => new Vector3(0, 0, 1).applyQuaternion(front.quaternion);
  assert.ok(rightGrip().y < 0 && tireHeading().x < 0, 'a right turn lowers the right grip and steers right');
  assert.deepEqual(gloves.morphTargetInfluences, [0, .5]);

  kart.update({ ...frame, steer: -.75 }, 0);
  assert.ok(rightGrip().y > 0 && tireHeading().x > 0, 'a left turn raises the right grip and steers left');
  assert.deepEqual(gloves.morphTargetInfluences, [.75, 0]);
  kart.update({ ...frame, steer: 0 }, 0);
  assert.deepEqual(gloves.morphTargetInfluences, [0, 0]);
});
