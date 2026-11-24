import * as T from 'three/webgpu';
import {
  abs, dot, equirectUV, float, floor, fract, length, max, mix, normalize,
  positionLocal, pow, smoothstep, sin, step, texture, uniform, vec2, vec3,
} from 'three/tsl';
import { times } from './conditions.js';

export const activeFloodlightCount=9;

function atmosphere(scene, panorama) {
  const texture = panorama?.photo ?? panorama?.lighting ?? null;
  const uniforms = {
    valley:{value:texture}, hasValley:{value:Number(Boolean(texture))}, sun:{value:new T.Vector3()},
    phase:{value:0}, rain:{value:0}, clock:{value:0},
  };
  const phase=uniform(0), rain=uniform(0), clock=uniform(0), sun=uniform(new T.Vector3());
  const skyMaterial=new T.MeshBasicNodeMaterial({side:T.BackSide,depthWrite:false,depthTest:false});
  const ray=normalize(positionLocal);
  const rotated=vec3(ray.x.mul(.7518).sub(ray.z.mul(.6594)),ray.y,
    ray.x.mul(.6594).add(ray.z.mul(.7518)));
  const skyUv=equirectUV(rotated);
  const height=smoothstep(-.04,.64,ray.y);
  let photo=mix(vec3(.59,.72,.78),vec3(.15,.32,.54),height);
  if(texture) photo=textureNode(texture,skyUv).rgb;
  const skyMask=smoothstep(.075,.37,ray.y);
  const sunDot=max(0,dot(ray,sun));
  const luma=dot(photo,vec3(.213,.715,.072));
  const dusk=float(1).sub(abs(phase.sub(1)));
  const night=max(0,phase.sub(1));
  let color=mix(photo,photo.mul(vec3(.66,.57,.59)),dusk);
  color=color.add(dusk.mul(pow(sunDot,5)).mul(skyMask)
    .mul(vec3(.57,.21,.063)).mul(float(1).sub(height.mul(.57))));
  const clouds=ray.xz.mul(float(5).div(max(.27,ray.y.add(.42)))).add(clock.mul(.012));
  const cloud=noise(clouds).mul(.6).add(noise(clouds.mul(2.7)).mul(.29))
    .add(noise(clouds.mul(6)).mul(.11));
  const overcast=mix(vec3(.091,.121,.147),vec3(.33,.36,.41),smoothstep(.18,.86,cloud));
  const rainValley=mix(vec3(luma).mul(vec3(.46,.53,.59)),overcast,skyMask.mul(.89));
  color=mix(color,rainValley,rain);
  const nightSky=mix(vec3(.034,.061,.112),vec3(.007,.018,.048),height);
  const starField=skyUv.mul(vec2(900,440));
  const stars=step(.994,hash(floor(starField)))
    .mul(float(1).sub(smoothstep(.055,.30,length(fract(starField).sub(.5)))));
  const moon=max(dot(normalize(vec3(.39,.34,-.79)),ray),0);
  const moonGlow=smoothstep(.99993,.99998,moon).mul(.81).add(pow(moon,210).mul(.039));
  const nightWithStars=nightSky.add(float(1).sub(rain)
    .mul(stars.mul(.49).mul(height).add(moonGlow)).mul(vec3(.77,.86,1)));
  const darkValley=photo.mul(vec3(.046,.073,.118));
  color=mix(color,mix(darkValley,nightWithStars.mul(float(1).add(rain.mul(.36).mul(cloud))),skyMask),night);
  const sunDisk=smoothstep(.99991,.999975,sunDot);
  const sunGlow=pow(sunDot,100).mul(.29).add(pow(sunDot,13).mul(.097)).add(sunDisk.mul(6.4));
  color=color.add(float(1).sub(rain).mul(float(1).sub(night))
    .mul(mix(vec3(1,.71,.37),vec3(1,.46,.19),dusk)).mul(sunGlow)
    .mul(smoothstep(.06,.155,ray.y)));
  skyMaterial.colorNode=color;
  const sky = new T.Mesh(new T.SphereGeometry(1320,48,28),skyMaterial);
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  scene.add(sky);
  return {sky, uniforms, nodes:{phase,rain,clock,sun}};
}

function textureNode(map, mapUv) { return texture(map,mapUv); }
function hash(point) { return fract(sin(dot(point,vec2(126.1,311.7))).mul(43758.5453)); }
function noise(point) {
  const cell=floor(point), offset=fract(point);
  const f=offset.mul(offset).mul(vec2(3).sub(offset.mul(2)));
  return mix(mix(hash(cell),hash(cell.add(vec2(1,0))),f.x),
    mix(hash(cell.add(vec2(0,1))),hash(cell.add(vec2(1,1))),f.x),f.y);
}

function floodlights(scene, track) {
  const count = Math.ceil(track.length / 22);
  const coordinates = [];
  const structure = new T.MeshStandardMaterial({color:0x616969,metalness:.32,roughness:.64});
  const housings = new T.MeshStandardMaterial({color:0x293537,metalness:.36,roughness:.58});
  const bulbs = new T.MeshStandardMaterial({color:0xc1cbd2,emissive:0xd1eaff,emissiveIntensity:0});
  const footings = new T.InstancedMesh(new T.BoxGeometry(.82,.38,.81), structure, count);
  const masts = new T.InstancedMesh(new T.CylinderGeometry(.077,.151,10.9,9), structure, count);
  const frames = new T.InstancedMesh(new T.BoxGeometry(1.82,.105,.14), structure, count);
  const heads = new T.InstancedMesh(new T.BoxGeometry(.57,.40,.24), housings, count*3);
  const emitters = new T.InstancedMesh(new T.BoxGeometry(.50,.32,.029), bulbs, count*3);
  const glowPositions = [];
  const transform = new T.Object3D();
  const axis = new T.Vector3(0,1,0);
  for (let i=0; i<count; i++) {
    const u=(i+.40)/count;
    const {point,tangent}=track.at(u,(i % 2 ? -1 : 1)*(track.width/2+5.1));
    const target=track.at(u+.0105).point;
    const lamp=point.clone().setY(10.8);
    coordinates.push({lamp,target});
    transform.rotation.set(0,0,0);
    transform.position.copy(point).setY(.16);
    transform.updateMatrix();
    footings.setMatrixAt(i,transform.matrix);
    transform.position.y=5.41;
    transform.updateMatrix();
    masts.setMatrixAt(i,transform.matrix);
    transform.position.copy(lamp);
    transform.rotation.y=Math.atan2(tangent.z,tangent.x)*-1;
    transform.updateMatrix();
    frames.setMatrixAt(i,transform.matrix);
    const direction=target.clone().sub(lamp).normalize();
    const facing=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(direction, new T.Vector3(),axis));
    for (let j=0;j<3;j++) {
      transform.position.copy(lamp).addScaledVector(tangent,(j-1)*.62);
      transform.quaternion.copy(facing);
      transform.updateMatrix();
      heads.setMatrixAt(i*3+j,transform.matrix);
      transform.position.addScaledVector(direction,.139);
      transform.updateMatrix();
      emitters.setMatrixAt(i*3+j,transform.matrix);
      glowPositions.push(transform.position.x,transform.position.y,transform.position.z);
    }
  }
  footings.receiveShadow=true;
  masts.castShadow=true;
  scene.add(footings,masts,frames,heads,emitters);

  const glowCanvas=document.createElement('canvas');
  glowCanvas.width=glowCanvas.height=64;
  const glowContext=glowCanvas.getContext('2d');
  const glowGradient=glowContext.createRadialGradient(32,32,2,32,32,31);
  glowGradient.addColorStop(0,'rgba(255,255,255,.66)');
  glowGradient.addColorStop(.34,'rgba(224,239,255,.30)');
  glowGradient.addColorStop(1,'rgba(180,213,255,0)');
  glowContext.fillStyle=glowGradient;
  glowContext.fillRect(0,0,64,64);
  const glowMaterial=new T.SpriteNodeMaterial({
    map:new T.CanvasTexture(glowCanvas),color:0xb5d3ff,transparent:true,opacity:0,
    depthWrite:false,blending:T.AdditiveBlending,
  });
  const glowSprites=glowPositions.reduce((sprites,_,i)=>{
    if(i%3!==0) return sprites;
    const sprite=new T.Sprite(glowMaterial);
    sprite.position.fromArray(glowPositions,i*3);
    sprite.scale.setScalar(.72);
    sprite.visible=false;
    scene.add(sprite);
    sprites.push(sprite);
    return sprites;
  },[]);

  const lights=Array.from({length:Math.min(activeFloodlightCount,count)},(_,i)=>{
    const light=new T.SpotLight(i%3===2?0xffe1bc:0xe5edff,0,48,.94,.63,2);
    if(i===0) {
      light.castShadow=true;
      light.shadow.mapSize.set(1024,1024);
      light.shadow.normalBias=.031;
      light.shadow.bias=-.00017;
    }
    scene.add(light,light.target);
    return light;
  });
  const reflections={
    lampPoints:{value:Array.from({length:activeFloodlightCount},()=>new T.Vector3(1e4,10,1e4))},
    lampReflection:{value:0},
    lampReflectionNode:uniform(0),
  };
  let level=0, nearest=-1;
  return {
    reflections,
    set(power,wet){
      level=power;
      nearest=-1;
      reflections.lampReflection.value=wet?power:0;
      reflections.lampReflectionNode.value=wet?power:0;
      bulbs.emissiveIntensity=power*3.4;
      glowMaterial.opacity=power*.82;
      glowSprites.forEach(sprite=>{
        sprite.visible=power>0;
        sprite.scale.setScalar(wet?1.04:.72);
      });
      lights.forEach((light,i)=>{
        light.visible=power>0;
        light.intensity=power*(i%3===2?630:755);
      });
    },
    update(kart) {
      if(!level) return;
      let best=Infinity, closest=0;
      for (const [i,{lamp}] of coordinates.entries()) {
        const d=(lamp.x-kart.x)**2+(lamp.z-kart.z)**2;
        if(d<best){best=d;closest=i;}
      }
      if(closest===nearest) return;
      nearest=closest;
      const ordered=coordinates.slice().sort(({lamp:a},{lamp:b})=>
        ((a.x-kart.x)**2+(a.z-kart.z)**2)-((b.x-kart.x)**2+(b.z-kart.z)**2));
      lights.forEach((light,i)=>{
        light.position.copy(ordered[i].lamp);
        light.target.position.copy(ordered[i].target);
        reflections.lampPoints.value[i].copy(ordered[i].lamp);
      });
    },
  };
}

export function addTrackLighting(scene, renderer, track, panorama) {
  const {sky,uniforms,nodes}=atmosphere(scene,panorama);
  if (panorama) {
    scene.environment=panorama.lighting;
    scene.environmentRotation.y=panorama.sameExposure ? .72 : -.85;
  }
  const skyLight=new T.HemisphereLight(0xd6e5ff,0x7e775f,.68);
  const sun=new T.DirectionalLight(0xffe6c8,2.55);
  sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-34,right:34,top:34,bottom:-34,near:2,far:160});
  sun.shadow.normalBias=.027;
  sun.shadow.bias=-.00011;
  scene.add(skyLight,sun,sun.target);
  const lamps=floodlights(scene,track);
  const fog=scene.fog=new T.FogExp2(0xbecacc,.0012);
  return {
    reflections:lamps.reflections,
    set(hour,wet) {
      const preset=times[hour];
      const rain=Number(wet), night=hour==='night';
      uniforms.sun.value.fromArray(preset.sun).normalize();
      uniforms.phase.value=preset.phase;
      uniforms.rain.value=rain;
      nodes.sun.value.copy(uniforms.sun.value);
      nodes.phase.value=preset.phase;
      nodes.rain.value=rain;
      skyLight.color.setHex(wet ? (night?0x809cc7:0xb9cbdf) : preset.sky);
      skyLight.groundColor.setHex(night?0x37465f:wet?0x596878:0x7e775f);
      skyLight.intensity=preset.fill + (wet&&!night ? .10 : 0);
      sun.color.setHex(wet?0xdbe7f0:preset.color);
      sun.intensity=preset.power*(wet?.11:1);
      sun.visible=!night;
      sun.castShadow=!wet&&!night;
      scene.environmentIntensity=preset.ambient*(wet?.74:1);
      fog.color.setHex(night ? (wet?0x202d43:0x162235) : wet?0x687b88:hour==='dusk'?0x9d9696:0xbecacc);
      fog.density=(night?.0039:wet?.0082:hour==='dusk'?.00205:.00115)*(night&&wet?1.73:1);
      renderer.toneMappingExposure=night?1.11:wet?1.08:1.06;
      lamps.set(night?1:wet?.38:preset.lamps,wet);
    },
    update(kart,camera,dt) {
      sky.position.copy(camera.position);
      uniforms.clock.value+=dt;
      nodes.clock.value=uniforms.clock.value;
      sun.target.position.set(kart.x,0,kart.z);
      sun.position.copy(sun.target.position).addScaledVector(uniforms.sun.value,75);
      lamps.update(kart);
    },
  };
}
