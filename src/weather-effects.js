import * as T from 'three';
import { random } from './surfaces.js';

export function addRain(scene, trackSeed, wetness) {
  const amount=1400;
  const extent=30, ceiling=15;
  const rng=random(trackSeed+747);
  const drops=Array.from({length:amount},()=>({
    x:(rng()-.5)*extent*2,
    y:rng()*ceiling,
    z:(rng()-.5)*extent*2,
    speed:8+rng()*8,
    length:.24+rng()*.44,
  }));
  const geometry=new T.BufferGeometry();
  const positions=new T.Float32BufferAttribute(new Float32Array(amount*6),3).setUsage(T.DynamicDrawUsage);
  const tips=new T.Float32BufferAttribute(new Float32Array(amount*2).map((_,i)=>i%2),1);
  geometry.setAttribute('position',positions);
  geometry.setAttribute('tip',tips);
  const brightness={value:1};
  const rain=new T.LineSegments(geometry,new T.ShaderMaterial({
    uniforms:{wetness,brightness},
    vertexShader:`
      attribute float tip;
      varying float fade;
      void main(){
        vec4 view=modelViewMatrix*vec4(position,1.);
        gl_Position=projectionMatrix*view;
        float d=length(view.xyz);
        fade=mix(1.,.12,tip)*smoothstep(.48,2.2,d)*(1.-smoothstep(15.,38.,d));
      }`,
    fragmentShader:`
      uniform float wetness,brightness;
      varying float fade;
      void main(){
        gl_FragColor=vec4(.64,.76,.83,fade*wetness*brightness*.66);
      }`,
    transparent:true,depthWrite:false,
  }));
  rain.frustumCulled=false;
  rain.renderOrder=6;
  scene.add(rain);
  const wrap=value=>value < -extent ? value+extent*2 : value > extent ? value-extent*2 : value;
  let x,z;
  return {
    set(hour,wet){
      rain.visible=wet;
      brightness.value=hour==='night'?.87:.98;
    },
    update(kart,dt){
      if(!rain.visible){x=undefined;return;}
      const dx=T.MathUtils.clamp(kart.x-(x??kart.x),-extent,extent);
      const dz=T.MathUtils.clamp(kart.z-(z??kart.z),-extent,extent);
      x=kart.x;z=kart.z;
      for(const [i,drop] of drops.entries()){
        drop.x=wrap(drop.x+1.65*dt-dx);
        drop.z=wrap(drop.z-.68*dt-dz);
        drop.y-=drop.speed*dt;
        if(drop.y<.03) drop.y+=ceiling;
        positions.setXYZ(i*2,x+drop.x,drop.y,z+drop.z);
        positions.setXYZ(i*2+1,x+drop.x-.14*drop.length,drop.y+drop.length,z+drop.z+.055*drop.length);
      }
      positions.needsUpdate=true;
    },
  };
}

export function addWaterBeading(group, wetness) {
  const materials=new Set();
  group.traverse(node=>{
    if(!node.isMesh) return;
    for(const mat of Array.isArray(node.material)?node.material:[node.material]) {
      if(mat?.isMeshStandardMaterial) materials.add(mat);
    }
  });
  for (const mat of materials) {
    const name=mat.name.toLowerCase();
    const fabric=/cloth|glove|woven|pad|suit|lettering/.test(name);
    const existing=mat.onBeforeCompile.bind(mat);
    const originalKey=mat.customProgramCacheKey();
    mat.onBeforeCompile=shader=>{
      existing(shader);
      shader.uniforms.kartWet=wetness;
      shader.vertexShader=shader.vertexShader
        .replace('#include <common>','#include <common>\nvarying vec3 rainPosition;')
        .replace('#include <begin_vertex>','#include <begin_vertex>\nrainPosition = position;');
      shader.fragmentShader=shader.fragmentShader
        .replace('#include <common>',`
          #include <common>
          uniform float kartWet;
          varying vec3 rainPosition;
          float waterBeads(vec2 p) {
            vec2 cell=floor(p);
            vec2 jitter=fract(sin(vec2(dot(cell,vec2(91.7,238.2)),dot(cell,vec2(19.3,143.9))))*27345.67);
            vec2 local=(fract(p)-(.28+jitter*.44))*vec2(1.,.82);
            return 1.-smoothstep(.070,.20,length(local));
          }`)
        .replace('#include <map_fragment>',`
          #include <map_fragment>
          float beading=max(waterBeads(rainPosition.xz*53.0),waterBeads((rainPosition.zy+vec2(.12,.29))*67.0)*.72);
          diffuseColor.rgb *= 1.0-kartWet*(${fabric?'.24':'.12'}+beading*.12);`)
        .replace('#include <roughnessmap_fragment>',`
          #include <roughnessmap_fragment>
          roughnessFactor=mix(roughnessFactor,${fabric?'.59':'.31'},kartWet*${fabric?'.26':'.65'});
          roughnessFactor=mix(roughnessFactor,.11,beading*kartWet*${fabric?'.29':'.72'});`)
        .replace('#include <normal_fragment_maps>',`
          #include <normal_fragment_maps>
          normal=normalize(normal+vec3(dFdx(beading),dFdy(beading),0.)*kartWet*.23);`);
    };
    mat.customProgramCacheKey=()=>originalKey+'|wet-coating|'+fabric;
  }
}
