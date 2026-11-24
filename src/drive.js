import { tireFeedback } from './tire-feedback.js';
import { surfaceWeather } from './conditions.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function spawn(track) {
  const {point, tangent} = track.at(1 - 14 / track.length);
  return {x: point.x, z: point.z, angle: Math.atan2(tangent.z, tangent.x),
    vx: 0, vz: 0, speed: 0, steer: 0, spin: 0, throttle: 0, brake: 0, squeal: 0, smoke: 0, dust: 0, spray: 0};
}

export function drive(kart, input, track, dt, wetness = 0) {
  const {x, z} = kart;
  const surface = track.nearest(x, z).distance;
  const grass = surface > track.width / 2 + .45;
  const weather = surfaceWeather(wetness, grass);
  const forwardX = Math.cos(kart.angle), forwardZ = Math.sin(kart.angle);
  let speed = kart.vx * forwardX + kart.vz * forwardZ;
  let slip = -kart.vx * forwardZ + kart.vz * forwardX;
  const limit = grass ? 12 : 26;
  const power = 8.9 * (1 - clamp(speed / 30, 0, 1));
  const braking = speed > .55 ? 15 * weather.brake : 3.2;
  speed += (input.throttle * power - braking * input.brake) * dt;
  speed *= Math.exp(-weather.drag * dt);
  speed = Math.min(speed, Math.max(limit, speed - (grass ? 15 : 4) * dt));
  speed = Math.max(speed, -4.5);
  if (Math.abs(speed) < .1 && !input.throttle && !input.brake) speed = 0;

  kart.steer += (input.steer - kart.steer) * (1 - Math.exp(-14 * dt));
  const yaw = kart.steer * clamp(speed / 4, -1, 1) * (grass ? 1.16 : 1.75) * weather.yaw
    / (1 + Math.abs(speed) / 21);
  kart.angle += yaw * dt;
  slip = (slip - speed * yaw * dt) * Math.exp(-weather.grip * dt);
  const fx = Math.cos(kart.angle), fz = Math.sin(kart.angle);
  kart.vx = fx * speed - fz * slip;
  kart.vz = fz * speed + fx * slip;
  kart.x += kart.vx * dt;
  kart.z += kart.vz * dt;
  const location = track.nearest(kart.x, kart.z);
  if (location.distance > track.width / 2 + 5.4) {
    kart.x = x;
    kart.z = z;
    kart.vx *= -.14;
    kart.vz *= -.14;
  }
  kart.speed = Math.hypot(kart.vx, kart.vz);
  kart.spin += speed * dt / .135;
  const feedback = tireFeedback(Math.max(0, speed), slip, input.brake, grass);
  kart.throttle = input.throttle;
  kart.brake = input.brake;
  kart.squeal = feedback.squeal * (1 - wetness * .72);
  kart.smoke = feedback.smoke * (1 - wetness);
  kart.dust = feedback.dust * (1 - wetness);
  kart.spray = wetness * clamp((kart.speed - 2) / 19, 0, 1) * (grass ? .48 : 1);
  return {x, z, offTrack: location.distance > track.width / 2 + 1.35};
}
