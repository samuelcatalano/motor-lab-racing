import * as T from 'three/webgpu';
import {
  attribute, dFdx, dFdy, dot, float, floor, fract, length, materialColor,
  materialNormal, materialRoughness, max, mix, normalize, positionLocal, positionView,
  sin, smoothstep, uniform, vec2, vec3,
} from 'three/tsl';
import { random } from './surfaces.js';

export function addRain(scene, trackSeed) {
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
  const rainAmount=uniform(0), nightBrightness=uniform(1);
  const rainMaterial=new T.LineBasicNodeMaterial({
    color:0xa3c2d4,
    transparent:true,depthWrite:false,
  });
  const tip=attribute('tip');
  const viewDistance=length(positionView);
  rainMaterial.opacityNode=mix(1,.12,tip)
    .mul(smoothstep(.48,2.2,viewDistance))
    .mul(float(1).sub(smoothstep(15,38,viewDistance)))
    .mul(rainAmount).mul(nightBrightness).mul(.66);
  const rain=new T.LineSegments(geometry,rainMaterial);
  rain.frustumCulled=false;
  rain.renderOrder=6;
  scene.add(rain);
  const wrap=value=>value < -extent ? value+extent*2 : value > extent ? value-extent*2 : value;
  let x,z;
  return {
    set(hour,wet){
      rain.visible=wet;
      rainAmount.value=Number(wet);
      nightBrightness.value=hour==='night'?.87:.98;
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
  const replacements=new Map();
  group.traverse(node=>{
    if(!node.isMesh) return;
    const original=Array.isArray(node.material)?node.material:[node.material];
    const converted=original.map(mat=>{
      if(!mat?.isMeshStandardMaterial) return mat;
      if(replacements.has(mat)) return replacements.get(mat);
      const name=mat.name.toLowerCase();
      const fabric=/cloth|glove|woven|pad|suit|lettering/.test(name);
      const coating=new T.MeshStandardNodeMaterial().copy(mat);
      const point=positionLocal;
      const beadNoise = p => {
        const cell=floor(p);
        const jitter=vec2(
          fract(sin(dot(cell,vec2(91.7,238.2))).mul(27345.67)),
          fract(sin(dot(cell,vec2(19.3,143.9))).mul(27345.67)),
        );
        const local=fract(p).sub(vec2(.28).add(jitter.mul(.44))).mul(vec2(1,.82));
        return float(1).sub(smoothstep(.070,.20,length(local)));
      };
      const beading=max(
        beadNoise(point.xz.mul(53)),
        beadNoise(point.zy.add(vec2(.12,.29)).mul(67)).mul(.72),
      );
      const tint=fabric?.24:.12;
      const roughnessTarget=fabric?.59:.31;
      const roughnessMix=fabric?.26:.65;
      const beadMix=fabric?.29:.72;
      coating.colorNode=materialColor.mul(float(1).sub(wetness.mul(float(tint).add(beading.mul(.12)))));
      coating.roughnessNode=mix(
        mix(materialRoughness,roughnessTarget,wetness.mul(roughnessMix)),
        .11,
        beading.mul(wetness).mul(beadMix),
      );
      coating.normalNode=normalize(materialNormal.add(
        vec3(dFdx(beading),dFdy(beading),0).mul(wetness).mul(.23),
      ));
      replacements.set(mat,coating);
      return coating;
    });
    node.material=Array.isArray(node.material)?converted:converted[0];
  });
}
