import assert from 'node:assert/strict';
import test from 'node:test';
import {BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture} from 'three/webgpu';
import {uniform} from 'three/tsl';
import {roadMaterial} from '../src/world.js';
import {addWaterBeading} from '../src/weather-effects.js';

test('road material is a PBR node material with dynamic color, roughness, and normal nodes', () => {
  const maps = {
    map: new Texture(),
    normalMap: new Texture(),
    roughnessMap: new Texture(),
  };
  const material = roadMaterial(
    {seed: 3},
    1,
    maps,
    null,
    uniform(0),
    uniform(0),
    {lampPoints: {value: []}, lampReflection: {value: 0}, lampReflectionNode: uniform(0)},
  );

  assert.equal(material.isMeshStandardNodeMaterial, true);
  assert.ok(material.colorNode?.isNode);
  assert.ok(material.roughnessNode?.isNode);
  assert.ok(material.normalNode?.isNode);
});

test('kart water beading converts standard materials to PBR node materials', () => {
  const group = new Group();
  const original = new MeshStandardMaterial({name: 'Racer suit | woven fabric'});
  const mesh = new Mesh(new BoxGeometry(), original);
  group.add(mesh);

  addWaterBeading(group, uniform(0));

  assert.equal(mesh.material.isMeshStandardNodeMaterial, true);
  assert.notEqual(mesh.material, original);
  assert.ok(mesh.material.colorNode?.isNode);
  assert.ok(mesh.material.roughnessNode?.isNode);
  assert.ok(mesh.material.normalNode?.isNode);
});
