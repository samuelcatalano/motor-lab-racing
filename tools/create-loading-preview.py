"""Render the Motor Lab pre-grid using the kart GLB and the neutral Racer FBX.

blender -b --factory-startup --python-exit-code 1 \
  --python tools/create-loading-preview.py -- /path/to/Ch20_nonPBR.fbx
"""

from argparse import ArgumentParser
from itertools import combinations
from math import radians
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory

import bpy
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fit_mixamo import aim_hand, append_glove_cuffs, rename_channels


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / ".local-assets" / "mixamo-kart.glb"
PREVIEW_GLB = ROOT / ".local-assets" / "motor-lab-loading-preview.glb"
PREVIEW_WEBP = ROOT / "public" / "assets" / "loading-pit.webp"
RENDER_SIZE = (1600, 960)


def apply_world_skin(obj):
    """Bake the preview pose and keep the resulting model independent of the rig."""
    world = obj.matrix_world.copy()
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for modifier in list(obj.modifiers):
        if modifier.type == "ARMATURE":
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.parent = None
    obj.matrix_world = world


def uv_keys(mesh):
    return [tuple(round(float(value), 6) for value in loop.vector)
            for loop in mesh.uv_layers.active.uv]


def transfer_racewear(seated_body, standing_body):
    # The game GLB triangulates the original FBX and splits it by material.
    # Match triangles in UV space so the original geometry inherits all four
    # racewear materials while keeping its neutral hips, boots and seam normals.
    source = seated_body.data
    target = standing_body.data
    keys = uv_keys(source)
    materials = {
        tuple(sorted(keys[index] for index in face.loop_indices)): face.material_index
        for face in source.polygons
    }
    keys = uv_keys(target)
    target.materials.clear()
    for material in source.materials:
        target.materials.append(material)
    target.uv_layers.active.name = source.uv_layers.active.name
    for face in target.polygons:
        face_uv = [keys[index] for index in face.loop_indices]
        matches = set()
        for triangle in combinations(face_uv, 3):
            material = materials.get(tuple(sorted(triangle)))
            if material is not None:
                matches.add(material)
        if len(matches) != 1:
            raise ValueError(f"The FBX UVs do not match the game's Racer at face {face.index}")
        face.material_index = matches.pop()


def align_bone(rig, name, direction):
    bone = rig.pose.bones[name]
    position, rotation, scale = bone.matrix.decompose()
    current_axis = rotation @ Vector((0, 1, 0))
    delta = current_axis.rotation_difference(Vector(direction).normalized())
    bone.matrix = Matrix.LocRotScale(position, delta @ rotation, scale)
    bpy.context.view_layer.update()


def add_standing_driver(source_rig, fbx):
    children = list(source_rig.children)
    source_body = next(obj for obj in children if obj.name.startswith("Mixamo Racer"))
    brands = [obj for obj in children if obj != source_body and not obj.name.startswith("Racer | glove cuff")]
    originals = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(fbx), use_anim=False)
    imported = set(bpy.data.objects) - originals
    rig = next(obj for obj in imported if obj.type == "ARMATURE")
    body = next(obj for obj in imported if obj.type == "MESH")
    transfer_racewear(source_body, body)
    bones = {bone.name.split(":")[-1]:bone for bone in rig.pose.bones}
    source_hip = source_rig.data.bones["RigPelvis"].head_local.copy()
    original_hip = rig.matrix_world @ bones["Hips"].bone.head_local
    standing_transform = Matrix.Translation(source_hip) @ Matrix.Scale(.85, 4) @ Matrix.Translation(-original_hip)
    skin_world = body.matrix_world.copy()
    rig.data.transform(standing_transform @ rig.matrix_world)
    rig.matrix_world = Matrix.Identity(4)
    body.parent = rig
    body.matrix_parent_inverse = Matrix.Identity(4)
    body.matrix_basis = Matrix.Identity(4)
    body.data.transform(standing_transform @ skin_world)
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    rename_channels(rig, bones)
    append_glove_cuffs(body, rig)

    for side, suffix, sign in (("Left", "L", 1), ("Right", "R", -1)):
        align_bone(rig, "RigUpperArm" + suffix, (sign * .13, .06, -1))
        align_bone(rig, "RigForearm" + suffix, (sign * .06, -.14, -1))
        hand = rig.pose.bones["RigHand" + suffix]
        aim_hand(hand, bones[side + "HandMiddle1"], hand.head.copy(),
                 Vector((sign * .012, -.14, -1)), Vector((-sign, -.08, 0)))

    # The lower body is the original upright mesh. Place its soles on the same
    # plane as the kart tires, maintaining the original spread and toe angle.
    heading = Matrix.Rotation(radians(7), 4, "Z")
    sole_height = min(vertex.co.z for vertex in body.data.vertices)
    placement = Matrix.Translation(Vector((-1.17, .43, -sole_height))) @ heading
    rig.matrix_world = placement
    bpy.context.view_layer.update()

    # The authoring tool leaned the whole driver forward around the hip before
    # adding the game decals. Back that lean out before placing the boxed model.
    straighten = Matrix.Translation(source_hip) @ Matrix.Rotation(-.128, 4, "X") @ Matrix.Translation(-source_hip)
    for obj in brands:
        apply_world_skin(obj)
        obj.matrix_world = placement @ straighten @ obj.matrix_world
    for obj in list(source_rig.children):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.objects.remove(source_rig, do_unlink=True)
    body.name = "Mixamo Racer | standing"
    for obj in list(rig.children):
        if obj.type == "MESH":
            apply_world_skin(obj)
    bpy.data.objects.remove(rig, do_unlink=True)
    bpy.context.view_layer.update()


def frame_models(camera, meshes):
    # Frame the full projected silhouettes, including the closest tire and the
    # driver's boots. Give the lower edge extra room for the ground shadows.
    view_rotation = Vector((2.8, 4.7, 2.45)).to_track_quat("Z", "Y")
    to_view = view_rotation.inverted()
    points = [to_view @ (obj.matrix_world @ Vector(corner))
              for obj in meshes for corner in obj.bound_box]
    left, right = min(point.x for point in points), max(point.x for point in points)
    bottom, top = min(point.y for point in points), max(point.y for point in points)
    aspect = RENDER_SIZE[0] / RENDER_SIZE[1]
    height = top - bottom
    camera.data.ortho_scale = max((right - left) * 1.19, height * aspect * 1.24)
    center = Vector(((left + right) / 2, (bottom + top) / 2 - .035 * height, 5.5))
    camera.location = view_rotation @ center
    camera.rotation_euler = view_rotation.to_euler()


def area_light(name, location, color, power, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.shape = "DISK"
    data.size = size
    data.color = color
    light = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(light)
    light.location = location
    light.rotation_euler = (Vector((-.35, 0, .65)) - light.location).to_track_quat("-Z", "Y").to_euler()


def render_preview(scene, meshes, cwebp):
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = RENDER_SIZE
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -1.5

    world = bpy.data.worlds.new("Motor Lab loading studio")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (.22, .28, .25, 1)
    background.inputs["Strength"].default_value = .25
    bpy.ops.mesh.primitive_plane_add(size=100, location=(0, 0, -.002))
    bpy.context.object.is_shadow_catcher = True

    area_light("Warm softbox", (1.4, -2.8, 3.8), (1, .93, .82), 330, 3)
    area_light("Cool fill", (3.5, 3, 2.2), (.65, .78, 1), 250, 2.5)
    area_light("White rim", (-2, 2, 3.2), (.92, .98, 1), 430, 2)

    camera_data = bpy.data.cameras.new("Loading preview camera")
    camera = bpy.data.objects.new("Loading preview camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera_data.type = "ORTHO"
    scene.camera = camera
    frame_models(camera, meshes)

    # Fade just the soft shadows near the edges. The models are inside the
    # safety margins, so their silhouettes retain full opacity.
    scene.use_nodes = True
    tree = scene.compositing_node_group = bpy.data.node_groups.new("Loading shadow fade", "CompositorNodeTree")
    tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    render = tree.nodes.new("CompositorNodeRLayers")
    mask = tree.nodes.new("CompositorNodeBoxMask")
    mask.inputs["Size"].default_value = (.95, .94)
    blur = tree.nodes.new("CompositorNodeBlur")
    blur.inputs["Size"].default_value = (28, 22)
    alpha = tree.nodes.new("CompositorNodeSetAlpha")
    output = tree.nodes.new("NodeGroupOutput")
    tree.links.new(render.outputs["Image"], alpha.inputs["Image"])
    tree.links.new(mask.outputs["Mask"], blur.inputs["Image"])
    tree.links.new(blur.outputs["Image"], alpha.inputs["Alpha"])
    tree.links.new(alpha.outputs["Image"], output.inputs["Image"])

    with TemporaryDirectory(prefix="motor-lab-pre-grid-") as tmp:
        png = Path(tmp) / "loading-pit.png"
        webp = Path(tmp) / "loading-pit.webp"
        scene.render.filepath = str(png)
        bpy.ops.render.render(write_still=True)
        subprocess.run([cwebp, "-q", "88", "-alpha_q", "100", "-m", "6", str(png), "-o", str(webp)], check=True)
        shutil.copyfile(webp, PREVIEW_WEBP)


def main():
    parser = ArgumentParser()
    parser.add_argument("driver_fbx", type=Path, help="Original neutral Mixamo Racer (Ch20_nonPBR.fbx)")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    fbx = args.driver_fbx.resolve(strict=True)
    cwebp = shutil.which("cwebp")
    if cwebp is None:
        raise RuntimeError("cwebp is required to compress the loading preview")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    scene = bpy.context.scene
    rig = bpy.data.objects["LippiRig"]
    # Place the kart tires on the ground, excluding the seated driver from the
    # measurement. The auxiliary icosphere is not part of the authored model.
    marker = bpy.data.objects.get("Icosphere")
    if marker:
        bpy.data.objects.remove(marker, do_unlink=True)
    kart_meshes = [obj for obj in scene.objects if obj.type == "MESH" and obj.parent != rig]
    kart_objects = [obj for obj in scene.objects if obj.parent is None and obj != rig]
    tire_height = min((obj.matrix_world @ Vector(corner)).z for obj in kart_meshes for corner in obj.bound_box)
    for obj in kart_objects:
        obj.location.z -= tire_height
    bpy.context.view_layer.update()
    add_standing_driver(rig, fbx)
    asset_objects = list(scene.objects)
    meshes = [obj for obj in asset_objects if obj.type == "MESH"]
    render_preview(scene, meshes, cwebp)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in asset_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.export_scene.gltf(filepath=str(PREVIEW_GLB), export_format="GLB", use_selection=True,
                              export_apply=True, export_cameras=False, export_lights=False)
    print(f"Preview GLB: {PREVIEW_GLB} ({PREVIEW_GLB.stat().st_size} bytes)")
    print(f"Loading image: {PREVIEW_WEBP} ({PREVIEW_WEBP.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
