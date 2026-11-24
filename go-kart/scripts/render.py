"""Render the assembled asset from reproducible cameras in Blender."""
import argparse
from pathlib import Path
import sys

import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--preview',action='store_true')
parser.add_argument('--output',type=Path)
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
package = Path(__file__).resolve().parents[1]
output = args.output or package/'renders'
output.mkdir(parents=True,exist_ok=True)

scene = bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=12 if args.preview else 30
scene.cycles.use_denoising=True
scene.render.resolution_x=840 if args.preview else 1280
scene.render.resolution_y=570 if args.preview else 880
scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
scene.view_settings.look='AgX - Medium High Contrast'
scene.view_settings.exposure=-.24
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=False


def material(name,color,roughness):
    m=bpy.data.materials.new(name)
    m.use_nodes=True
    bsdf=m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value=(*color,1)
    bsdf.inputs['Roughness'].default_value=roughness
    return m


def lighting(hdri=None):
    world=bpy.data.worlds.new('Track HDR' if hdri else 'Neutral studio')
    world.use_nodes=True
    scene.world=world
    bg=world.node_tree.nodes.get('Background')
    bg.inputs['Strength'].default_value=.48
    bg.inputs['Color'].default_value=(.24,.24,.24,1)
    if hdri:
        env=world.node_tree.nodes.new('ShaderNodeTexEnvironment')
        env.image=bpy.data.images.load(str(hdri))
        world.node_tree.links.new(env.outputs['Color'],bg.inputs['Color'])
    return world


def area(name,location,power,size,target=(0,0,.3),color=(1,1,1)):
    bpy.ops.object.light_add(type='AREA',location=location)
    obj=bpy.context.object
    obj.name=name
    obj.data.energy=power
    obj.data.shape='DISK'
    obj.data.size=size
    obj.data.color=color
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    return obj


lighting()
key=area('Softbox key',(-2,-2.4,3.7),280,3)
fill=area('Softbox fill',(2,-.45,2.05),140,2.1)
rim=area('Softbox rear',(0,2,2.5),220,2.3)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.008))
floor=bpy.context.object
floor.name='Studio floor'
floor.data.materials.append(material('Neutral studio ground',(.17,.18,.185),.79))
bpy.ops.object.camera_add()
camera=bpy.context.object
scene.camera=camera

views={
  '01-frontal': ((0,-3.2,.78),(0,0,.40),2.36),
  '02-traseira': ((0,3.2,.78),(0,0,.40),2.36),
  '03-lateral-esquerda': ((3.2,0,.67),(0,0,.38),2.42),
  '04-lateral-direita': ((-3.2,0,.67),(0,0,.38),2.42),
  '05-tres-quartos-frontal': ((2.5,-2.65,1.52),(0,0,.35),2.52),
  '06-tres-quartos-traseira': ((-2.55,2.55,1.65),(0,0,.34),2.52),
  '07-superior': ((0,.001,3.50),(0,0,.2),3.10),
  '08-motor': ((1.55,1.48,.94),(.28,.45,.22),1.02),
  '09-capacete': ((.72,-.82,.89),(0,.09,.80),.48),
  '10-piloto-e-volante': ((1.72,-1.32,1.12),(0,0,.48),1.48),
}
view_layer=bpy.context.view_layer


def shot(name,view):
    position,target,scale=view
    camera.location=position
    camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO'
    camera.data.ortho_scale=scale
    scene.render.filepath=str(output/f'{name}.png')
    bpy.ops.render.render(write_still=True)


if args.preview:
    for name in ('05-tres-quartos-frontal','06-tres-quartos-traseira','10-piloto-e-volante'):
        shot(name,views[name])
else:
    for name,view in views.items():
        shot(name,view)
    beauty=views['05-tres-quartos-frontal']
    rear=views['06-tres-quartos-traseira']
    view_layer.material_override=material('Clay neutral',(.53,.53,.53),.67)
    shot('11-clay',rear)
    wire=material('Topology diagnostic',(.52,.55,.59),.63)
    nodes,links=wire.node_tree.nodes,wire.node_tree.links
    widget=nodes.new('ShaderNodeWireframe')
    widget.use_pixel_size=True
    widget.inputs['Size'].default_value=.65
    mix=nodes.new('ShaderNodeMixRGB')
    mix.inputs[1].default_value=(.52,.58,.62,1)
    mix.inputs[2].default_value=(.022,.029,.034,1)
    links.new(widget.outputs[0],mix.inputs[0])
    links.new(mix.outputs[0],nodes.get('Principled BSDF').inputs['Base Color'])
    view_layer.material_override=wire
    shot('12-wireframe',rear)
    view_layer.material_override=None
    shot('13-materiais',views['10-piloto-e-volante'])
    scene.render.resolution_x=1600
    scene.render.resolution_y=1080
    shot('14-beauty',beauty)
    for light in (key,fill,rim):
        bpy.data.objects.remove(light,do_unlink=True)
    lighting(package.parent/'public/assets/vale-do-cedro/valley-light.hdr')
    bpy.ops.object.light_add(type='SUN',location=(2,-3,5))
    sun=bpy.context.object
    sun.rotation_euler=Vector((-1.1,.7,-1.8)).to_track_quat('-Z','Y').to_euler()
    sun.data.energy=2.3
    sun.data.angle=.06
    shot('15-luz-de-pista',rear)
