"""Package the approved assembly. Run: blender -b --python go-kart/scripts/package.py -- --output-root /tmp/kart-package

The output root contains source/ and production/. Use the project go-kart directory
only after the artistic gate has passed; the default is deliberately temporary.
"""
import argparse
import sys
from pathlib import Path

import bpy

PROJECT = Path(__file__).resolve().parents[1]
ASSEMBLY = PROJECT / 'source' / 'go-kart-assembled.blend'
LEVELS = {'hero': 90000, 'lod0': 35000, 'lod1': 14000, 'lod2': 4500, 'lod3': 1200}


def load():
    bpy.ops.wm.open_mainfile(filepath=str(ASSEMBLY))
    assert bpy.data.objects.get('LippiRig'), 'Missing driver armature'


def is_driver(obj):
    while obj:
        if obj.name == 'LippiRig':
            return True
        obj = obj.parent
    return False


def save_master(path, driver):
    load()
    remove = [obj for obj in bpy.context.scene.objects if is_driver(obj) != driver]
    for obj in remove:
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(path))


def triangles(mesh):
    return sum(len(poly.vertices) - 2 for poly in mesh.polygons)


def export_level(path, target):
    load()
    if target <= 4500:
        omitted = ('embroidery', 'stitch', 'flatlock', 'wheel lug', 'Rim fixation', 'hub cap', 'rear number ink')
        for obj in list(bpy.context.scene.objects):
            if obj.type == 'MESH' and any(part.lower() in obj.name.lower() for part in omitted):
                bpy.data.objects.remove(obj, do_unlink=True)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    # These modifiers simplify the original mesh ahead of the armature, so the
    # skin and its vertex groups remain available to the glTF exporter.
    counts = {o.name: triangles(o.data) for o in meshes}
    total = sum(counts.values())
    ratio = min(1.0, target / total)
    for obj in meshes:
        if counts[obj.name] < 16:
            continue
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        modifier = obj.modifiers.new('LOD reduction', 'DECIMATE')
        # Keep the rolling and helmet silhouettes even when the nominal budget
        # would otherwise collapse them to only a handful of faces.
        silhouette = ('competition slick', 'magnesium rim', 'helmet', 'visor', 'steering grip')
        floor = 0.12 if any(part in obj.name.lower() for part in silhouette) else 0.0
        modifier.ratio = max(ratio, floor)
        while obj.modifiers.find(modifier.name) > 0:
            bpy.ops.object.modifier_move_up(modifier=modifier.name)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.data.validate(clean_customdata=False)
        obj.select_set(False)
    # Constraints are Blender-only and would otherwise change the bind pose.
    for obj in bpy.context.scene.objects:
        for constraint in obj.constraints:
            constraint.mute = True
        if obj.type == 'ARMATURE':
            for bone in obj.pose.bones:
                for constraint in bone.constraints:
                    constraint.mute = True
    actual = sum(triangles(o.data) for o in meshes)
    print(f'PACKAGE {path.name}: {actual} triangles before export; target {target}')
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB',
                              export_extras=True, export_animations=False,
                              export_apply=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-root', type=Path, default=Path('/tmp/go-kart-package'))
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    source, production = args.output_root / 'source', args.output_root / 'production'
    source.mkdir(parents=True, exist_ok=True)
    production.mkdir(parents=True, exist_ok=True)
    save_master(source / 'kart-master.blend', False)
    save_master(source / 'driver-master.blend', True)
    for name, target in LEVELS.items():
        export_level(production / f'go-kart-{name}.glb', target)


if __name__ == '__main__':
    main()
