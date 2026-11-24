import * as T from 'three/webgpu';
import { times } from './conditions.js';

export const activeFloodlightCount=9;

function atmosphere(scene, panorama) {
  const texture = panorama?.photo ?? panorama?.lighting ?? null;
  const uniforms = {
    valley:{value:texture}, hasValley:{value:Number(Boolean(texture))}, sun:{value:new T.Vector3()},
    phase:{value:0}, rain:{value:0}, clock:{value:0},
  };
  const sky = new T.Mesh(new T.SphereGeometry(1320, 48, 28), new T.ShaderMaterial({
    uniforms, side:T.BackSide, depthWrite:false, depthTest:false,
    vertexShader:`
      varying vec3 direction;
      void main() {
        direction = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader:`
      #include <common>
      uniform sampler2D valley;
      uniform float hasValley, phase, rain, clock;
      uniform vec3 sun;
      varying vec3 direction;
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(126.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i=floor(p), f=fract(p);
        f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
          mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
      }
      void main() {
        vec3 ray = normalize(direction);
        vec3 rotated = vec3(.7518*ray.x-.6594*ray.z,ray.y,.6594*ray.x+.7518*ray.z);
        vec2 uv=equirectUv(rotated);
        float height=smoothstep(-.04,.64,ray.y);
        vec3 photo=mix(vec3(.59,.72,.78),vec3(.15,.32,.54),height);
        if(hasValley>.5) photo=texture2D(valley,uv).rgb;
        float skyMask=smoothstep(.075,.37,ray.y);
        float sunDot=max(0.0,dot(ray,sun));
        float luma=dot(photo,vec3(.213,.715,.072));
        float dusk=1.0-abs(phase-1.0);
        float night=max(0.0,phase-1.0);
        vec3 color=mix(photo,photo*vec3(.66,.57,.59),dusk);
        color+=dusk * pow(sunDot,5.0)*skyMask*vec3(.57,.21,.063)*(1.0-height*.57);
        vec2 clouds=ray.xz * (5.0/max(.27,ray.y+.42))+clock*.012;
        float cloud=noise(clouds)*.6+noise(clouds*2.7)*.29+noise(clouds*6.0)*.11;
        vec3 overcast=mix(vec3(.091,.121,.147),vec3(.33,.36,.41),smoothstep(.18,.86,cloud));
        vec3 rainValley=mix(vec3(luma)*vec3(.46,.53,.59),overcast,skyMask*.89);
        color=mix(color,rainValley,rain);
        vec3 nightSky=mix(vec3(.034,.061,.112),vec3(.007,.018,.048),height);
        nightSky+=pow(max(dot(ray,normalize(vec3(.35,.37,-.85))),0.0),14.0)*vec3(.013,.027,.055);
        vec2 starField=uv*vec2(900.0,440.0), starCell=floor(starField);
        float stars=step(.994,hash(starCell)) *
          (1.0-smoothstep(.055,.30,length(fract(starField)-.5)));
        vec3 moonDir=normalize(vec3(.39,.34,-.79));
        float moon=max(dot(moonDir,ray),0.0);
        nightSky+= (1.0-rain) * (stars*.49*height+
          smoothstep(.99993,.99998,moon)*.81+pow(moon,210.0)*.039)*vec3(.77,.86,1);
        vec3 darkValley=photo*vec3(.046,.073,.118);
        color=mix(color,mix(darkValley,nightSky*(1.0+rain*.36*cloud),skyMask),night);

        vec3 n=normalize(cross(sun,vec3(0,1,0)));
        float angle=atan(dot(ray,n), dot(ray,cross(sun,n)));
        float spokes=pow(.5+.5*cos(angle*13.0+1.6*sin(angle*3.0)),10.0);
        float sunDisk=smoothstep(.99991,.999975,sunDot);
        float rays=pow(sunDot,100.0)*(.22+spokes*.19)+pow(sunDot,13.0)*.097;
        vec3 glow=mix(vec3(1,.71,.37),vec3(1,.46,.19),dusk);
        color+=(1.0-rain)*(1.0-night)*glow*(rays+sunDisk*6.4)*smoothstep(.06,.155,ray.y);
        gl_FragColor=vec4(color,1);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  scene.add(sky);
  return {sky, uniforms};
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

  const glowGeometry=new T.BufferGeometry();
  glowGeometry.setAttribute('position',new T.Float32BufferAttribute(glowPositions,3));
  const glow = new T.Points(glowGeometry,new T.ShaderMaterial({
    uniforms:{level:{value:0}, rain:{value:0}},
    vertexShader:`
      uniform float rain;
      void main(){
        vec4 view=modelViewMatrix*vec4(position,1.);
        gl_Position=projectionMatrix*view;
        gl_PointSize=clamp((550.+rain*550.)/max(1.,-view.z),4.,105.);
      }`,
    fragmentShader:`
      uniform float level,rain;
      void main(){
        float radius=length(gl_PointCoord-.5)*2.;
        float a=max(0.,1.-radius);
        gl_FragColor=vec4(.70,.83,1.,(pow(a,4.)*.52+pow(a,1.75)*rain*.13)*level);
      }`,
    depthWrite:false,transparent:true,blending:T.AdditiveBlending,
  }));
  glow.frustumCulled=false;
  scene.add(glow);

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
  };
  let level=0, nearest=-1;
  return {
    reflections,
    set(power,wet){
      level=power;
      nearest=-1;
      reflections.lampReflection.value=wet?power:0;
      bulbs.emissiveIntensity=power*3.4;
      glow.material.uniforms.level.value=power;
      glow.material.uniforms.rain.value=Number(wet);
      glow.visible=power>0;
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
  const {sky,uniforms}=atmosphere(scene,panorama);
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
      sun.target.position.set(kart.x,0,kart.z);
      sun.position.copy(sun.target.position).addScaledVector(uniforms.sun.value,75);
      lamps.update(kart);
    },
  };
}
