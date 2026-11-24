import * as T from 'three/webgpu';
import { random } from './surfaces.js';
import { addSkidMarks } from './skid-marks.js';

const capacity = 64;

function wispMap() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const rng = random(386);
  for (let i = 0; i < 18; i++) {
    const angle = rng() * 2 * Math.PI;
    const offset = Math.sqrt(rng()) * 16;
    const x = 32 + Math.cos(angle) * offset, y = 32 + Math.sin(angle) * offset;
    const radius = 5 + rng() * 13;
    const gradient = ctx.createRadialGradient(x,y,0,x,y,radius);
    gradient.addColorStop(0,'rgba(255,255,255,.36)');
    gradient.addColorStop(.55,'rgba(255,255,255,.20)');
    gradient.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
  }
  return new T.CanvasTexture(canvas);
}

export function addTireTrail(scene, track, rearWheels) {
  const geometry = new T.BufferGeometry();
  const buffer = (name, width) => {
    const attribute = new T.Float32BufferAttribute(new Float32Array(capacity * width), width)
      .setUsage(T.DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
    return attribute;
  };
  const positions = buffer('position', 3);
  const style = buffer('wispStyle', 3);
  const viewport = {value:1};
  const material = new T.ShaderMaterial({
    uniforms:{wisp:{value:wispMap()}, viewport},
    vertexShader:`
      uniform float viewport;
      attribute vec3 wispStyle;
      varying vec2 style;
      void main() {
        style = wispStyle.yz;
        vec4 center = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * center;
        gl_PointSize = clamp(wispStyle.x * viewport * projectionMatrix[1][1] * .5 / max(.2, -center.z), 1.0, 190.0);
      }`,
    fragmentShader:`
      uniform sampler2D wisp;
      varying vec2 style;
      void main() {
        float density = texture2D(wisp, gl_PointCoord).a * style.x;
        vec3 tint = mix(vec3(.67,.70,.72), vec3(.55,.43,.29), min(1.,style.y));
        tint = mix(tint,vec3(.58,.72,.81),step(1.5,style.y));
        gl_FragColor = vec4(tint, density);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent:true,
    depthWrite:false,
  });
  const cloud = new T.Points(geometry, material);
  cloud.frustumCulled = false;
  cloud.renderOrder = 4;
  scene.add(cloud);

  const marks = addSkidMarks(scene, track, rearWheels.length);
  const contacts = rearWheels.map(() => new T.Vector2());
  const particles = Array.from({length:capacity}, () => ({age:0, life:0}));
  const rng = random(119);
  let next = 0, carry = 0;
  function spawn(kart, fx, fz, kind, contact, side) {
    const particle = particles[next];
    next = (next + 1) % capacity;
    Object.assign(particle, {
      age:0, life:kind === 2 ? .34 + rng() * .36 : .46 + rng() * .43,
      x:contact.x,
      z:contact.y,
      y:.14,
      vx:kart.vx * .13 - fx * .35 - side * fz * .62 + (rng() - .5) * .72,
      vz:kart.vz * .13 - fz * .35 + side * fx * .62 + (rng() - .5) * .72,
      kind,
    });
  }
  return {
    resize(height) { viewport.value = height; },
    reset() {
      for (const particle of particles) particle.life = 0;
      carry = 0;
      marks.reset();
    },
    update(kart, dt) {
      const {smoke = 0, dust = 0, spray = 0} = kart;
      const kind = spray > 0 ? 2 : Number(dust > smoke);
      const density = Math.max(smoke, dust, spray);
      carry += density * dt * (kind === 2 ? 49 : 34);
      const fx = Math.cos(kart.angle), fz = Math.sin(kart.angle);
      for (let i = 0; i < rearWheels.length; i++) {
        const wheel = rearWheels[i];
        contacts[i].set(kart.x + wheel.z * fx + wheel.x * fz,
          kart.z + wheel.z * fz - wheel.x * fx);
      }
      marks.update(contacts, smoke, dt);
      while (carry >= 1) {
        for (let i = 0; i < contacts.length; i++) {
          spawn(kart, fx, fz, kind, contacts[i], -Math.sign(rearWheels[i].x));
        }
        carry--;
      }
      let count = 0;
      for (const particle of particles) {
        if (particle.age >= particle.life) continue;
        particle.age += dt;
        if (particle.age >= particle.life) continue;
        particle.x += dt * particle.vx;
        particle.z += dt * particle.vz;
        particle.y += dt * .62;
        const phase = particle.age / particle.life;
        positions.setXYZ(count, particle.x, particle.y, particle.z);
        const water = particle.kind === 2;
        style.setXYZ(count, (water ? .23 : .35) + phase * 1.08,
          Math.min(1, phase * 32) * (1 - phase) ** 1.18 * (water ? .67 : .53), particle.kind);
        count++;
      }
      geometry.setDrawRange(0, count);
      if (count) positions.needsUpdate = style.needsUpdate = true;
    },
  };
}
