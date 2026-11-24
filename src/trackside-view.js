import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { random } from './surfaces.js';

function signTexture(number) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d7d4c3';
  ctx.fillRect(0,0,256,128);
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#787c76';
  ctx.strokeRect(5,5,246,118);
  ctx.fillStyle = '#242822';
  ctx.font = 'bold 80px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(number,128,65);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  return map;
}

export function addTracksideDetails(scene, track) {
  if (!track.paddock || !track.curbs?.length) return;
  const postMaterial = new T.MeshStandardMaterial({color:0x696c63,metalness:.28,roughness:.77});
  const posts = [], caps = [];
  const pad = track.paddock;
  const RNG = random(track.seed + 240);
  const firstCurve = track.curbs[0][0] * track.length;
  const brakingMarker = Math.min(firstCurve + 18, track.length * .21);

  // Marker faces oppose the oncoming kart. Keep props clear of the kart's run-off.
  for (const distance of [50, 25]) {
    const {point, tangent} = track.at((brakingMarker - distance) / track.length, -track.width / 2 - 6.23);
    const angle = Math.atan2(-tangent.x,-tangent.z);
    const marker = new T.Mesh(new T.PlaneGeometry(1.25,.625),
      new T.MeshStandardMaterial({map:signTexture(distance),roughness:.85,side:T.DoubleSide}));
    marker.rotation.y = angle;
    marker.position.copy(point).setY(1.13);
    marker.receiveShadow = true;
    scene.add(marker);
    posts.push(new T.BoxGeometry(.09,1.34,.12).translate(point.x,.67,point.z));
  }

  // A worn service strip beside the pit fence, with painted bollards near its opening.
  const padMaterial = new T.MeshStandardMaterial({
    color:0x89877a,roughness:.97,vertexColors:true,
  });
  const path = new T.PlaneGeometry(35,2.2,25,3).rotateX(-Math.PI/2);
  const color = [];
  for (let i = 0; i < path.attributes.position.count; i++) {
    const value = .86 + RNG() * .14;
    color.push(value,value * .98,value * .95);
  }
  path.setAttribute('color',new T.Float32BufferAttribute(color,3));
  const walkway = new T.Mesh(path,padMaterial);
  walkway.position.set(pad.x+11,-.022,pad.z+9.4);
  walkway.receiveShadow = true;
  scene.add(walkway);
  for (let i = 0; i < 8; i++) {
    const x = pad.x - 2 + i * 4.15, z = pad.z + 10.0;
    posts.push(new T.CylinderGeometry(.043,.048,.68,10).translate(x,.34,z));
    caps.push(new T.CylinderGeometry(.044,.045,.115,10).translate(x,.54,z));
  }
  for (const [parts, material] of [[posts,postMaterial],[caps,new T.MeshStandardMaterial({color:0xc99136,roughness:.83})]]) {
    const batch = new T.Mesh(mergeGeometries(parts.map(part => part.index ? part.toNonIndexed() : part)),material);
    batch.castShadow = batch.receiveShadow = true;
    scene.add(batch);
    parts.forEach(part => part.dispose());
  }
}
