import * as T from 'three/webgpu';
import {attribute, min, mix, step, texture, uv, vec3} from 'three/tsl';
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
  const positions=new T.Float32BufferAttribute(new Float32Array(capacity*4*3),3).setUsage(T.DynamicDrawUsage);
  const uvValues=new Float32Array(capacity*4*2);
  const densityAttribute=new T.Float32BufferAttribute(new Float32Array(capacity*4),1).setUsage(T.DynamicDrawUsage);
  const kindAttribute=new T.Float32BufferAttribute(new Float32Array(capacity*4),1);
  const indices=new Uint16Array(capacity*6);
  for(let i=0;i<capacity;i++) {
    const v=i*4, u=i*8;
    uvValues.set([0,0,1,0,0,1,1,1],u);
    indices.set([v,v+2,v+1,v+1,v+2,v+3],i*6);
  }
  geometry.setAttribute('position',positions);
  geometry.setAttribute('uv',new T.BufferAttribute(uvValues,2));
  geometry.setAttribute('density',densityAttribute);
  geometry.setAttribute('kind',kindAttribute);
  geometry.setIndex(new T.BufferAttribute(indices,1));
  geometry.setDrawRange(0,0);
  const wisp=wispMap();
  const material = new T.MeshBasicNodeMaterial({transparent:true,depthWrite:false,side:T.DoubleSide});
  const sprite=texture(wisp,uv());
  const smokeTint=mix(vec3(.67,.70,.72),vec3(.55,.43,.29),min(attribute('kind'),1));
  material.colorNode=mix(smokeTint,vec3(.58,.72,.81),step(1.5,attribute('kind'))).mul(sprite.rgb);
  material.opacityNode=sprite.a.mul(attribute('density'));
  const cloud = new T.Mesh(geometry, material);
  cloud.frustumCulled = false;
  cloud.visible = false;
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
    reset() {
      for (const particle of particles) particle.life = 0;
      carry = 0;
      marks.reset();
    },
    update(kart, dt, camera) {
      const {smoke = 0, dust = 0, spray = 0} = kart;
      const kind = spray > 0 ? 2 : Number(dust > smoke);
      const effectDensity = Math.max(smoke, dust, spray);
      carry += effectDensity * dt * (kind === 2 ? 49 : 34);
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
        const water = particle.kind === 2;
        const size=(water ? .23 : .35)+phase*1.08;
        const alpha=Math.min(1,phase*32)*(1-phase)**1.18*(water?.67:.53);
        const center=new T.Vector3(particle.x,particle.y,particle.z);
        const right=new T.Vector3(1,0,0).applyQuaternion(camera.quaternion).multiplyScalar(size*.5);
        const up=new T.Vector3(0,1,0).applyQuaternion(camera.quaternion).multiplyScalar(size*.5);
        const corners=[center.clone().sub(right).sub(up),center.clone().add(right).sub(up),
          center.clone().sub(right).add(up),center.clone().add(right).add(up)];
        for(let corner=0;corner<4;corner++) {
          positions.setXYZ(count*4+corner,corners[corner].x,corners[corner].y,corners[corner].z);
          densityAttribute.setX(count*4+corner,alpha);
          kindAttribute.setX(count*4+corner,particle.kind);
        }
        count++;
      }
      geometry.setDrawRange(0, count*6);
      cloud.visible=count>0;
      if (count) positions.needsUpdate = densityAttribute.needsUpdate = kindAttribute.needsUpdate = true;
    },
  };
}
