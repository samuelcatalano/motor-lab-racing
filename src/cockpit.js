import * as T from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const helmetLayer = 1;

function instrument(steering) {
  const mount = new T.Group();
  const neutral = steering.getWorldQuaternion(new T.Quaternion()).invert();
  const normal = new T.Vector3(0, .8, -.6);
  const up = new T.Vector3(0, .6, .8);
  const orientation = new T.Matrix4().makeBasis(new T.Vector3(-1, 0, 0), up, normal);
  mount.quaternion.setFromRotationMatrix(orientation).premultiply(neutral);
  mount.position.copy(up).multiplyScalar(.029).addScaledVector(normal, .031).applyQuaternion(neutral);
  steering.add(mount);

  const molded = new T.MeshStandardMaterial({color:0x24272a, roughness:.58});
  const bezel = new T.MeshStandardMaterial({color:0x111516, roughness:.46});
  const fastener = new T.MeshStandardMaterial({color:0x69706e, roughness:.35, metalness:.52});
  mount.add(new T.Mesh(new RoundedBoxGeometry(.172, .093, .028, 3, .011), molded));
  const surround = new T.Mesh(new RoundedBoxGeometry(.146, .073, .010, 2, .005), bezel);
  surround.position.z = .013;
  mount.add(surround);
  const screw = new T.CylinderGeometry(.0025, .0025, .0014, 8).rotateX(Math.PI / 2);
  for (const x of [-.076, .076]) {
    for (const y of [-.024, .024]) {
      const mesh = new T.Mesh(screw, fastener);
      mesh.position.set(x, y, .0138);
      mount.add(mesh);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 226;
  const ctx = canvas.getContext('2d');
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  const lcd = new T.Mesh(new T.PlaneGeometry(.137, .061),
    new T.MeshBasicMaterial({map, toneMapped:false}));
  lcd.position.z = .0183;
  mount.add(lcd);

  let previousSpeed, previousLap;
  return {
    mount,
    draw(speed, lap) {
      if (speed === previousSpeed && lap === previousLap) return;
      previousSpeed = speed;
      previousLap = lap;
      ctx.fillStyle = '#99b5a0';
      ctx.fillRect(0, 0, 512, 226);
      ctx.strokeStyle = '#6e8b76';
      ctx.lineWidth = 2;
      ctx.strokeRect(6, 6, 500, 214);
      ctx.beginPath();
      ctx.moveTo(221, 28);
      ctx.lineTo(221, 198);
      ctx.stroke();
      ctx.fillStyle = '#182b23';
      ctx.font = 'bold 27px monospace';
      ctx.fillText('km/h', 26, 58);
      ctx.fillText('VOLTA', 247, 58);
      ctx.font = 'bold 111px monospace';
      ctx.fillText(String(speed).padStart(2, '0'), 20, 162);
      ctx.font = 'bold 47px monospace';
      ctx.fillText(lap, 247, 143, 240);
      map.needsUpdate = true;
    },
  };
}

export function makeCockpit({group, steering}) {
  const helmet = group.getObjectByName('DriverHelmet');
  helmet?.traverse(node => node.layers.set(helmetLayer));
  group.traverse(node => {
    const name = node.material?.name;
    if (name === 'Motor Lab Racing | Helmet' || name?.startsWith('Racer | original ')) {
      node.layers.set(helmetLayer);
    }
  });

  const panel = instrument(steering);
  const center = group.worldToLocal(steering.getWorldPosition(new T.Vector3()));
  return {
    show(active, speed, lap) {
      panel.mount.visible = active;
      if (active) panel.draw(Math.round(speed * 3.6), lap);
    },
    frame(eye, target, narrow) {
      eye.set(center.x, center.y + .489, center.z - .340 - .11 * narrow);
      target.set(eye.x, eye.y - .74, eye.z + 1);
      group.localToWorld(eye);
      group.localToWorld(target);
    },
  };
}
