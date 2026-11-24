import * as T from 'three/webgpu';

const capacity = 1024;
const halfWidth = .078;
const roadHeight = .012;

export function addSkidMarks(scene, track, wheelCount) {
  const geometry = new T.BufferGeometry();
  const positions = new T.BufferAttribute(new Float32Array(capacity * 12), 3)
    .setUsage(T.DynamicDrawUsage);
  const intensity = new T.BufferAttribute(new Float32Array(capacity * 4), 1)
    .setUsage(T.DynamicDrawUsage);
  const edge = new Float32Array(capacity * 4);
  const indices = new Uint16Array(capacity * 6);
  for (let i = 0; i < capacity; i++) {
    const vertex = i * 4;
    edge.set([-1, 1, -1, 1], vertex);
    indices.set([vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2], i * 6);
  }
  geometry.setAttribute('position', positions);
  geometry.setAttribute('strength', intensity);
  geometry.setAttribute('edge', new T.BufferAttribute(edge, 1));
  geometry.setIndex(new T.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);

  const material = new T.ShaderMaterial({
    vertexShader:`
      attribute float strength;
      attribute float edge;
      varying vec2 brush;
      void main() {
        brush = vec2(edge, strength);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader:`
      varying vec2 brush;
      void main() {
        float coverage = 1.0 - smoothstep(.40, 1.0, abs(brush.x));
        gl_FragColor = vec4(.028, .024, .020, brush.y * coverage);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent:true,
    depthWrite:false,
  });
  const marks = new T.Mesh(geometry, material);
  marks.frustumCulled = false;
  scene.add(marks);

  const previous = Array.from({length:wheelCount}, () => ({x:0, z:0, strength:0}));
  let next = 0, count = 0;
  return {
    reset() {
      geometry.setDrawRange(0, 0);
      next = count = 0;
      for (const wheel of previous) wheel.strength = 0;
    },
    update(contacts, smoke, dt) {
      if (!dt) return;
      const initial = next;
      for (let i = 0; i < contacts.length; i++) {
        const wheel = previous[i];
        const {x, y:z} = contacts[i];
        const onRoad = smoke > .06 && track.nearest(x, z).distance < track.width / 2 - halfWidth;
        if (!onRoad) {
          wheel.strength = 0;
          continue;
        }
        const dx = x - wheel.x, dz = z - wheel.z;
        const distance = Math.hypot(dx, dz);
        const strength = .12 + smoke * .30;
        if (wheel.strength && distance < .14) continue;
        if (wheel.strength && distance < 2.25) {
          const nx = -dz * halfWidth / distance, nz = dx * halfWidth / distance;
          const j = next * 4;
          positions.setXYZ(j, wheel.x - nx, roadHeight, wheel.z - nz);
          positions.setXYZ(j + 1, wheel.x + nx, roadHeight, wheel.z + nz);
          positions.setXYZ(j + 2, x - nx, roadHeight, z - nz);
          positions.setXYZ(j + 3, x + nx, roadHeight, z + nz);
          intensity.setX(j, wheel.strength);
          intensity.setX(j + 1, wheel.strength);
          intensity.setX(j + 2, strength);
          intensity.setX(j + 3, strength);
          next = (next + 1) % capacity;
          count = Math.min(count + 1, capacity);
        }
        Object.assign(wheel, {x, z, strength});
      }
      if (next === initial) return;
      positions.needsUpdate = intensity.needsUpdate = true;
      geometry.setDrawRange(0, count * 6);
    },
  };
}
