"""Author the garage-only hand pose with Blender, preserving the race source.

Run from this checkout: blender --background --python tools/pose-garage-grip.py
Outputs: .local-assets/garage-grip.blend and public/assets/kart/garage-kart.glb.
The editable .blend retains the original UVs, materials and skinned rig.
Coordinates are Blender metres; the wheel section is measured from ImportedSteering.
"""
import bpy, math, json, bmesh
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
from mathutils import Vector, Matrix
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'.local-assets/mixamo-kart.glb'))
rig=bpy.data.objects['LippiRig']
bones=rig.pose.bones
wheel=bpy.data.objects['ImportedSteering']
center=wheel.matrix_world.translation.copy()
normal=Vector((0,.6068561673,.7948116660)).normalized()
up=Vector((0,-normal.z,normal.y))
radius=.14175

def update():
    bpy.context.view_layer.update()

def frame(forward,across):
    forward=forward.normalized()
    across=(across-forward*across.dot(forward)).normalized()
    return Matrix((across,forward,across.cross(forward))).transposed()

def aim(bone,child,target):
    update()
    q=(child.head-bone.head).rotation_difference(target-bone.head) @ bone.matrix.to_quaternion()
    bone.matrix=Matrix.Translation(bone.head) @ q.to_matrix().to_4x4()
    update()

def elbow_at(shoulder,wrist,pole,upper,lower):
    axis=(wrist-shoulder).normalized()
    distance=(wrist-shoulder).length
    along=(upper*upper-lower*lower+distance*distance)/(2*distance)
    bend=pole-shoulder
    bend=(bend-axis*bend.dot(axis)).normalized()
    return shoulder+axis*along+bend*math.sqrt(max(0,upper*upper-along*along))

def rim(radial):
    return center+radius*radial+normal*(.092*radius*radial.dot(up))

def close_fingers(side):
    for name in ('Index','Middle','Ring','Pinky'):
        chain=[bones[f'mixamorig6:{side}Hand{name}{i}'] for i in range(1,5)]
        delta=chain[0].head-center
        radial=(delta-normal*delta.dot(normal)).normalized()
        c=rim(radial)
        for joint,child in zip(chain,chain[1:]):
            delta=joint.head-c
            r=math.hypot(delta.dot(radial),delta.dot(normal))
            length=(child.head-joint.head).length
            glove_radius=.024
            cosine=(r*r+glove_radius*glove_radius-length*length)/(2*r*glove_radius)
            angle=math.atan2(delta.dot(normal),delta.dot(radial))-math.acos(max(-1,min(1,cosine)))
            aim(joint,child,c+radial*glove_radius*math.cos(angle)+normal*glove_radius*math.sin(angle))
    middle=bones[f'mixamorig6:{side}HandMiddle1']
    delta=middle.head-center
    radial=(delta-normal*delta.dot(normal)).normalized()
    c=rim(radial)
    thumb=[bones[f'mixamorig6:{side}HandThumb{i}'] for i in range(1,5)]
    for joint,child,(inset,depth,height) in zip(thumb,thumb[1:],((.004,.033,.020),(-.016,.028,.018),(-.022,.004,-.010))):
        aim(joint,child,c+radial*inset+normal*depth+up*height)

for side,letter,sign in [('Left','L',1),('Right','R',-1)]:
    hand=bones['RigHand'+letter]
    middle=bones[f'mixamorig6:{side}HandMiddle1']
    across=bones[f'mixamorig6:{side}HandIndex1'].head-bones[f'mixamorig6:{side}HandPinky1'].head
    offset=middle.head-hand.head
    source=frame(offset,across)
    direction=Vector((-sign*.65,-.76,0)).normalized()
    dest=frame(direction,Vector((0,0,1)))
    q=(dest @ source.transposed()).to_quaternion()
    hand_q=q @ hand.matrix.to_quaternion()
    radial=(Vector((sign,0,0))+up*.15).normalized()
    knuckle=rim(radial)+radial*.022+normal*.012
    wrist=knuckle-q @ offset
    upper,lower=bones['RigUpperArm'+letter],bones['RigForearm'+letter]
    upper_length=(lower.head-upper.head).length
    lower_length=(hand.head-lower.head).length
    elbow=elbow_at(upper.head,wrist,Vector((sign*.32,.015,.36)),upper_length,lower_length)
    aim(upper,lower,elbow)
    aim(lower,hand,wrist)
    hand.matrix=Matrix.Translation(wrist) @ hand_q.to_matrix().to_4x4()
    update()
    close_fingers(side)
    print('GRIP',side,'wrist',tuple(hand.head),'knuckle',tuple(middle.head))


# Bake the authored deformation into a new rest pose; keep skinning for steering.
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' and m.object==rig for m in o.modifiers)]
for obj in meshes:
    bpy.context.view_layer.objects.active=obj
    for modifier in list(obj.modifiers):
        if modifier.type=='ARMATURE':
            bpy.ops.object.modifier_apply(modifier=modifier.name)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')

# Retain the source glove topology/UVs, refining only the contact surfaces.
# A small clearance against the actual rim section prevents skin from crossing it.
contact_count=0
maximum_correction=0
for obj in meshes:
    glove_groups={g.index for g in obj.vertex_groups if 'Hand' in g.name}
    selected={v.index for v in obj.data.vertices if sum(g.weight for g in v.groups if g.group in glove_groups)>.6}
    if selected:
        bm=bmesh.new();bm.from_mesh(obj.data)
        bm.verts.ensure_lookup_table()
        edges=[e for e in bm.edges if all(v.index in selected for v in e.verts)]
        bmesh.ops.subdivide_edges(bm,edges=edges,cuts=1,use_grid_fill=True)
        bm.to_mesh(obj.data);bm.free()
        for v in obj.data.vertices:
            if sum(g.weight for g in v.groups if g.group in glove_groups)<=.6: continue
            point=obj.matrix_world @ v.co
            delta=point-center
            radial=(delta-normal*delta.dot(normal)).normalized()
            section=rim(radial)
            offset=point-section
            distance=offset.length
            if distance<.0166 and distance>1e-8:
                correction=.0166-distance
                point+=offset.normalized()*correction
                v.co=obj.matrix_world.inverted() @ point
                contact_count+=1
                maximum_correction=max(maximum_correction,correction)
        obj.data.update()
    modifier=obj.modifiers.new('Authored garage skin','ARMATURE');modifier.object=rig
rig['garageGripAuthored']=True
rig['gripAuthoring']='Blender: closed finger bones, opposed inner thumbs; original cockpit asset retained'
print('CONTACT',contact_count,'max adjustment meters',maximum_correction)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'.local-assets/garage-grip.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/assets/kart/garage-kart.glb'),export_format='GLB',export_extras=True,export_animations=False,export_cameras=False,export_lights=False)
