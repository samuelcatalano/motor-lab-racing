"""Prepare the supplied kart and SC04 helmet for the game's visual pivots."""
import bmesh
import bpy
from mathutils import Matrix, Vector

SCALE = .0105
AXLE_MIDPOINT = 8.8375
GROUND_OFFSET = -.00125
STEERING_CENTER = Vector((0, .4045, .193))
# The top of the imported steering wheel tilts toward the front of the kart.
STEERING_AXIS = Vector((0, -.795, .607)).normalized()


def set_origin(obj, origin):
    for vertex in obj.data.vertices:
        vertex.co -= origin
    obj.location = origin


def split_mesh(source, name, keep):
    mesh = source.data.copy()
    edit = bmesh.new()
    edit.from_mesh(mesh)
    bmesh.ops.delete(edit, geom=[v for v in edit.verts if not keep(v.co)], context='VERTS')
    if not edit.faces:
        edit.free()
        bpy.data.meshes.remove(mesh)
        raise ValueError(f'No source geometry found for {name}')
    edit.to_mesh(mesh)
    edit.free()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def normalize(point):
    return Vector((point.x * SCALE, (point.y - AXLE_MIDPOINT) * SCALE,
                   point.z * SCALE + GROUND_OFFSET))


def prepare_kart(path, to_blender):
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = list(bpy.context.selected_objects)
    parts = {obj.name: obj for obj in imported if obj.type == 'MESH'}
    required = {f'Object_{index}' for index in range(2, 8)}
    if parts.keys() != required:
        raise ValueError(f'Unexpected go_kart.glb mesh names: {sorted(parts)}')
    for obj in parts.values():
        transform = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
        for vertex in obj.data.vertices:
            vertex.co = normalize(transform @ vertex.co)
        obj.data.update()

    steering = parts['Object_5']
    steering.name = 'ImportedSteering'
    steering['steeringAxis'] = list(STEERING_AXIS)
    set_origin(steering, to_blender(STEERING_CENTER))
    front_and_hubs, rear_tires = parts['Object_6'], parts['Object_7']
    for side, sign in (('Left', 1), ('Right', -1)):
        front = split_mesh(front_and_hubs, f'Front{side}Tire',
                           lambda p: p.x * sign > 0 and p.y < 0)
        rear = split_mesh(rear_tires, f'Rear{side}Tire',
                          lambda p: p.x * sign > 0)
        hub = split_mesh(front_and_hubs, f'Rear{side}Hub',
                          lambda p: p.x * sign > 0 and p.y > 0)
        # Level the front slicks with the slightly taller rear slicks.
        for vertex in front.data.vertices:
            vertex.co.z -= 1.522 * SCALE
        for position, tire, extra in (('Front', front, None), ('Rear', rear, hub)):
            points = [v.co for v in tire.data.vertices]
            center = Vector(tuple((min(p[i] for p in points) + max(p[i] for p in points)) / 2
                                  for i in range(3)))
            pivot = bpy.data.objects.new(f'{position}{side}Wheel', None)
            bpy.context.collection.objects.link(pivot)
            pivot.location = center
            for part in (tire, extra):
                if part:
                    set_origin(part, center)
                    part.parent = pivot
                    part.location.zero()

    for obj in imported:
        if obj.type == 'EMPTY' or obj in (front_and_hubs, rear_tires):
            bpy.data.objects.remove(obj, do_unlink=True)


def prepare_helmet(path, pivot, paint_color):
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = list(bpy.context.selected_objects)
    meshes = [obj for obj in imported if obj.type == 'MESH']
    shell = next((slot.material for obj in meshes for slot in obj.material_slots
                  if slot.material and slot.material.name == 'Material.002'), None)
    if shell is None:
        raise ValueError('Could not find the SC04 shell material in the supplied helmet')

    transforms = [(obj,obj.matrix_world.copy()) for obj in meshes]
    corners = [transform @ Vector(v) for obj,transform in transforms for v in obj.bound_box]
    low = Vector(tuple(min(v[i] for v in corners) for i in range(3)))
    high = Vector(tuple(max(v[i] for v in corners) for i in range(3)))
    center = (high+low)/2
    center.z = low.z
    # Keep the original proportions and seat the opening over the driver's collar.
    scale = .238 / (high.z-low.z)
    fit = Matrix.Translation((0,.262,.633)) @ Matrix.Scale(scale,4) @ Matrix.Translation(-center)
    local_fit = pivot.matrix_world.inverted() @ fit
    for obj,transform in transforms:
        obj.name = f'SC04_{obj.name}'
        obj.parent = pivot
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_basis = local_fit @ transform
    for obj in imported:
        if obj.type == 'EMPTY':
            bpy.data.objects.remove(obj,do_unlink=True)

    shell.name = 'SC04 Amaranth shell #9F2B68'
    shell.diffuse_color = paint_color
    surface = next(node for node in shell.node_tree.nodes if node.type=='BSDF_PRINCIPLED')
    surface.inputs['Base Color'].default_value = paint_color
    surface.inputs['Metallic'].default_value = .13
    surface.inputs['Roughness'].default_value = .29
    surface.inputs['Coat Weight'].default_value = .28
