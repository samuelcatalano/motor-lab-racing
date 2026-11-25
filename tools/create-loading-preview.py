"""Build a standing-driver loading preview from the local Motor Lab GLB."""

from pathlib import Path
import shutil
import subprocess

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / ".local-assets" / "mixamo-kart.glb"
PREVIEW_GLB = ROOT / ".local-assets" / "motor-lab-loading-preview.glb"
PREVIEW_PNG = ROOT / ".local-assets" / "motor-lab-loading-preview.png"
PREVIEW_WEBP = ROOT / "public" / "assets" / "loading-pit.webp"


def align_bone(rig, name, direction):
    bpy.context.view_layer.update()
    bone = rig.pose.bones[name]
    position, rotation, scale = bone.matrix.decompose()
    current_axis = rotation @ Vector((0, 1, 0))
    delta = current_axis.rotation_difference(Vector(direction).normalized())
    bone.matrix = Matrix.LocRotScale(position, delta @ rotation, scale)
    bpy.context.view_layer.update()


if not SOURCE.exists():
    raise FileNotFoundError(f"Missing source GLB: {SOURCE}")

bpy.ops.import_scene.gltf(filepath=str(SOURCE))
scene = bpy.context.scene
rig = bpy.data.objects.get("LippiRig")
if rig is None:
    raise RuntimeError("The source GLB does not contain the LippiRig armature")

# These default primitives are unused glTF placeholders in the source file.
for obj in list(scene.objects):
    if obj.name in {"Cube", "Icosphere"}:
        bpy.data.objects.remove(obj, do_unlink=True)
asset_objects = list(scene.objects)

# The original armature is seated in the kart. Extend the same legs and relax
# the arms, then move the posed driver next to the untouched kart geometry.
# This offset places the angled glTF boot soles into the shadow-catcher plane,
# so both feet read as planted in the orthographic loading render.
rig.location = (-1.18, 0.85, 0.60)
for side, sign in (("L", 1), ("R", -1)):
    align_bone(rig, "RigThigh" + side, (sign * 0.11, 0.015, -1))
    align_bone(rig, "RigShin" + side, (-sign * 0.01, -0.035, -1))
    # The source boots have soles angled below the ankle axis. Tilt the foot
    # bones down slightly so their actual soles, not just the rig axes, land flat.
    align_bone(rig, "RigFoot" + side, (0, -1, -0.5))
    align_bone(rig, "mixamorig6:" + ("Left" if side == "L" else "Right") + "ToeBase", (0, -1, -0.5))
    # Relax the arms close to the suit and keep the wrists/hands beside the thighs.
    align_bone(rig, "RigUpperArm" + side, (sign * 0.15, 0, -1))
    align_bone(rig, "RigForearm" + side, (sign * 0.045, -0.015, -1))
    align_bone(rig, "RigHand" + side, (sign * 0.02, -0.08, -1))

# Render the GLB-derived pose as a transparent, lightweight first frame.
scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.render.resolution_x = 1600
scene.render.resolution_y = 960
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = True
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = -1.5

world = bpy.data.worlds.new("Motor Lab loading studio") if not bpy.data.worlds else bpy.data.worlds[0]
scene.world = world
world.use_nodes = True
background = world.node_tree.nodes.get("Background")
background.inputs["Color"].default_value = (0.22, 0.28, 0.25, 1)
background.inputs["Strength"].default_value = 0.25

# A Cycles shadow catcher adds grounding beneath the real GLB meshes while
# keeping the loading art transparent over the game's own track background.
bpy.ops.mesh.primitive_plane_add(size=100, location=(0, 0, -0.006))
ground = bpy.context.object
ground.name = "Render-only contact shadows"
ground.is_shadow_catcher = True


def area_light(name, location, color, power, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.shape = "DISK"
    data.size = size
    data.color = color
    light = bpy.data.objects.new(name, data)
    scene.collection.objects.link(light)
    light.location = location
    light.rotation_euler = (Vector((0, 0.1, 0.7)) - light.location).to_track_quat("-Z", "Y").to_euler()


area_light("Warm softbox", (1.4, -2.8, 3.8), (1.0, 0.93, 0.82), 330, 3)
area_light("Cool fill", (3.5, 3, 2.2), (0.65, 0.78, 1), 250, 2.5)
area_light("White rim", (-2, 2, 3.2), (0.92, 0.98, 1), 430, 2)

camera_data = bpy.data.cameras.new("Loading preview camera")
camera = bpy.data.objects.new("Loading preview camera", camera_data)
scene.collection.objects.link(camera)
camera.location = (2.7, 4.6, 2.2)
target = Vector((-0.4, 0.1, 0.7))
camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
camera_data.type = "ORTHO"
camera_data.ortho_scale = 3.0
scene.camera = camera
scene.render.filepath = str(PREVIEW_PNG)
bpy.ops.render.render(write_still=True)

# Bake the posed armature into its meshes so the new preview GLB stays upright
# without adding an animation or changing the original source model.
bpy.context.view_layer.update()
for obj in asset_objects:
    if obj.type != "MESH":
        continue
    for modifier in list(obj.modifiers):
        if modifier.type == "ARMATURE" and modifier.object == rig:
            world_matrix = obj.matrix_world.copy()
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.modifier_apply(modifier=modifier.name)
            if obj.parent == rig:
                obj.parent = None
                obj.matrix_world = world_matrix
            break
    if obj.parent == rig:
        world_matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world_matrix

bpy.data.objects.remove(rig, do_unlink=True)
export_objects = [obj for obj in asset_objects if obj != rig]
bpy.ops.object.select_all(action="DESELECT")
for obj in export_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = next(
    obj for obj in export_objects if obj.type == "MESH"
)
bpy.ops.export_scene.gltf(
    filepath=str(PREVIEW_GLB),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_cameras=False,
    export_lights=False,
)

cwebp = shutil.which("cwebp")
if cwebp is None:
    raise RuntimeError("cwebp is required to compress the loading preview")
subprocess.run(
    [cwebp, "-q", "88", "-alpha_q", "100", "-m", "6", str(PREVIEW_PNG), "-o", str(PREVIEW_WEBP)],
    check=True,
)
PREVIEW_PNG.unlink()
print(f"Preview GLB: {PREVIEW_GLB} ({PREVIEW_GLB.stat().st_size} bytes)")
print(f"Loading image: {PREVIEW_WEBP} ({PREVIEW_WEBP.stat().st_size} bytes)")
