"""Original glTF-friendly materials for the authored competition kart.

Call ``apply_competition_materials({m.name: m for m in bpy.data.materials},
texture_dir=Path(__file__).parent / 'kart-textures')`` after the script's
existing ``surface_grain`` setup. The function preserves existing material
names and paint colors, and returns the created/reused named materials.

The slick tire is deliberately not UV-projected here: author its lathe UVs at
roughly 0.55 UV units per metre around the circumference and 1.0 UV units per
metre across the tread width. This puts the 1K tire tile's subtle mould grain
at a sub-millimetre scale. For other mapped parts, project at the sizes in
``UV_SCALE_METRES`` (tile repeats per metre); the helper creates a dominant-
axis projection in world metres with per-face planar UVs.

All texture pixels are generated from deterministic analytic patterns in this
file. No external texture source or license is involved. Node graphs only use
Principled BSDF, Image Texture and Normal Map nodes supported by glTF export.
"""
from __future__ import annotations

from math import cos, pi, sin
from pathlib import Path

import bpy
from mathutils import Vector


UV_SCALE_METRES = {
    'Competition slick rubber': 1.0,
    'Fibreglass seat': 5.0,
    'Brushed aluminium': 5.0,
    'Cast aluminium': 6.0,
    'Blackened steel': 5.0,
    'Painted frame': 2.5,
    'Teal livery': 2.5,
    'Amber livery': 2.5,
    'Warm ivory livery': 2.5,
    'Moulded black plastic': 4.0,
    'Injection moulded impact guard': 4.0,
}


def _tire_pixel(x, y, size, kind):
    """Return a tileable, restrained slick-tire texture sample."""
    u, v = 2*pi*x/size, 2*pi*y/size
    # Subtle circumferential mould flow, fine carbon-black grain, no fake tread.
    grain = .5*sin(37*u + 3*sin(5*v)) + .3*cos(53*v-9*u) + .2*sin(71*u+61*v)
    mould = .5*cos(3*v + .34*sin(7*u)) + .5*cos(4*v - .22*sin(5*u))
    fine = .5*sin(131*u+97*v) + .5*cos(113*v-149*u)
    if kind == 'color':
        value = .016 + .0022*grain + .0014*mould + .0005*fine
        return (value, value, value, 1.0)
    if kind == 'roughness':
        value = .83 + .035*grain + .018*mould + .008*fine
        return (value, value, value, 1.0)
    # Mild tangent-space micro relief: only about 0.18 mm at intended scale.
    dx = .5*cos(37*u+3*sin(5*v))*37 - .3*sin(53*v-9*u)*9
    dy = .5*cos(37*u+3*sin(5*v))*15 - .3*sin(53*v-9*u)*53
    nx, ny = -dx*.00022, -dy*.00022
    norm = (nx*nx + ny*ny + 1.0)**.5
    return (nx/norm*.5+.5, ny/norm*.5+.5, 1/norm*.5+.5, 1.0)


def _write_tire_textures(texture_dir: Path):
    texture_dir.mkdir(parents=True, exist_ok=True)
    outputs = {}
    for kind, suffix in [('color', 'basecolor'), ('roughness', 'roughness'), ('normal', 'normal')]:
        path = texture_dir / f'competition-slick-{suffix}.png'
        outputs[kind] = path
        if path.exists():
            continue
        size = 1024
        image = bpy.data.images.new(f'Competition slick {suffix}', size, size, alpha=False, float_buffer=False)
        pixels = [0.0] * (size*size*4)
        put = 0
        for y in range(size):
            for x in range(size):
                pixels[put:put+4] = _tire_pixel(x, y, size, kind)
                put += 4
        image.pixels.foreach_set(pixels)
        image.filepath_raw = str(path)
        image.file_format = 'PNG'
        image.save()
        bpy.data.images.remove(image)
    return outputs


def _clear_surface_links(material, socket_name):
    shader = material.node_tree.nodes.get('Principled BSDF')
    if shader:
        socket = shader.inputs.get(socket_name)
        if socket:
            for link in list(material.node_tree.links):
                if link.to_socket == socket:
                    material.node_tree.links.remove(link)


def _image_node(material, path, label, colorspace='sRGB'):
    image = bpy.data.images.load(str(path), check_existing=True)
    image.colorspace_settings.name = colorspace
    image.pack()
    node = material.node_tree.nodes.new('ShaderNodeTexImage')
    node.label = label
    node.image = image
    return node


def _build_slick(material, maps):
    material.use_nodes = True
    material.diffuse_color = (.018, .019, .018, 1)
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = material.diffuse_color
    shader.inputs['Roughness'].default_value = .82
    shader.inputs['Metallic'].default_value = 0.0
    shader.inputs['IOR'].default_value = 1.48
    nodes, links = material.node_tree.nodes, material.node_tree.links
    for name in ('Base Color', 'Roughness', 'Normal'):
        _clear_surface_links(material, name)
    color_node = _image_node(material, maps['color'], 'Original carbon-black elastomer · sRGB')
    rough_node = _image_node(material, maps['roughness'], 'Slick rubber micro-roughness · Non-Color', 'Non-Color')
    normal_node = _image_node(material, maps['normal'], 'Slick rubber mould flow normal · Non-Color', 'Non-Color')
    links.new(color_node.outputs['Color'], shader.inputs['Base Color'])
    links.new(rough_node.outputs['Color'], shader.inputs['Roughness'])
    normal = nodes.new('ShaderNodeNormalMap')
    normal.inputs['Strength'].default_value = .32
    links.new(normal_node.outputs['Color'], normal.inputs['Color'])
    links.new(normal.outputs['Normal'], shader.inputs['Normal'])


def _principled(material):
    material.use_nodes = True
    return material.node_tree.nodes.get('Principled BSDF')


def project_competition_uv(obj, tile_repeats_per_metre=1.0):
    """Make metric dominant-axis UVs; caller chooses authored parts and scale."""
    mesh = obj.data
    layer = mesh.uv_layers.active or mesh.uv_layers.new(name='CompetitionUV')
    matrix = obj.matrix_world
    points = [matrix @ vertex.co for vertex in mesh.vertices]
    normal_matrix = matrix.to_3x3().inverted().transposed()
    axes = ((1, 2), (0, 2), (0, 1))
    for face in mesh.polygons:
        normal = normal_matrix @ face.normal
        axis = max(range(3), key=lambda i: abs(normal[i]))
        u, v = axes[axis]
        for loop_index in face.loop_indices:
            point = points[mesh.loops[loop_index].vertex_index]
            layer.data[loop_index].uv = (point[u]*tile_repeats_per_metre,
                                         point[v]*tile_repeats_per_metre)
    return layer


def apply_competition_materials(materials, objects_by_material=None, texture_dir=None):
    """Attach PBR refinements to the script's named materials and return them.

    ``materials`` maps Blender material names to material datablocks. Pass
    ``objects_by_material`` as ``{material_name: [objects...]}`` to project
    metric UVs for non-tire materials in ``UV_SCALE_METRES``. Wheel UVs are
    intentionally preserved. ``texture_dir`` defaults beside this module.
    """
    texture_dir = Path(texture_dir) if texture_dir else Path(__file__).parent / 'kart-textures'
    maps = _write_tire_textures(texture_dir)
    slick = materials.get('Competition slick rubber') or bpy.data.materials.get('Competition slick rubber')
    if slick is None:
        slick = bpy.data.materials.new('Competition slick rubber')
    _build_slick(slick, maps)
    result = {'Competition slick rubber': slick}

    # Physically plausible dielectric/conductor values, preserving artist colors.
    settings = {
        'Brushed aluminium': (.30, .90, .15), 'Cast aluminium': (.45, .78, .0),
        'Blackened steel': (.50, .82, .0), 'Zinc fasteners': (.31, .82, .0),
        'Painted frame': (.34, .0, .28), 'Teal livery': (.30, .0, .34),
        'Amber livery': (.33, .0, .28), 'Warm ivory livery': (.39, .0, .18),
        'Moulded black plastic': (.48, .0, .0),
        'Injection moulded impact guard': (.56, .0, .0),
        'Fibreglass seat': (.58, .0, .0), 'Heat tinted stainless steel': (.42, .78, .0),
        'Hose and edge rubber': (.87, .0, .0), 'Fuel tank': (.62, .0, .0),
    }
    for name, (roughness, metallic, coat) in settings.items():
        item = materials.get(name) or bpy.data.materials.get(name)
        if item is None:
            continue
        shader = _principled(item)
        shader.inputs['Roughness'].default_value = roughness
        shader.inputs['Metallic'].default_value = metallic
        if 'Coat Weight' in shader.inputs:
            shader.inputs['Coat Weight'].default_value = coat
        result[name] = item
        if objects_by_material and name in UV_SCALE_METRES:
            for obj in objects_by_material.get(name, ()):
                project_competition_uv(obj, UV_SCALE_METRES[name])
    if objects_by_material:
        for obj in objects_by_material.get('Competition slick rubber', ()):
            # The authored wheel lathe UV is part of its asset contract.
            if not obj.data.uv_layers:
                raise ValueError(f'{obj.name}: slick tires require authored lathe UVs')
    return result
