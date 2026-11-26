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
            glove_radius=.0205  # same circle for all four fingers: the index curls like the others
            cosine=(r*r+glove_radius*glove_radius-length*length)/(2*r*glove_radius)
            angle=math.atan2(delta.dot(normal),delta.dot(radial))-math.acos(max(-1,min(1,cosine)))
            aim(joint,child,c+radial*glove_radius*math.cos(angle)+normal*glove_radius*math.sin(angle))
    middle=bones[f'mixamorig6:{side}HandMiddle1']
    delta=middle.head-center
    radial=(delta-normal*delta.dot(normal)).normalized()
    c=rim(radial)
    thumb=[bones[f'mixamorig6:{side}HandThumb{i}'] for i in range(1,5)]
    for joint,child,(inset,depth,height) in zip(thumb,thumb[1:],((.004,.033,.020),(-.016,.028,.018),(-.016,.004,-.010))):
        aim(joint,child,c+radial*inset+normal*depth+up*height)

for side,letter,sign in [('Left','L',1),('Right','R',-1)]:
    hand=bones['RigHand'+letter]
    middle=bones[f'mixamorig6:{side}HandMiddle1']
    across=bones[f'mixamorig6:{side}HandIndex1'].head-bones[f'mixamorig6:{side}HandPinky1'].head
    offset=middle.head-hand.head
    source=frame(offset,across)
    upper,lower=bones['RigUpperArm'+letter],bones['RigForearm'+letter]
    upper_length=(lower.head-upper.head).length
    lower_length=(hand.head-lower.head).length
    radial=(Vector((sign,0,0))+up*.15).normalized()
    def solve(direction):
        # Partial roll toward the rim tangent; frame() orthogonalizes it, so the roll never bends the wrist.
        # Knuckle row along the rim tangent: the tube crosses the hand at the knuckle line.
        t=normal.cross(radial).normalized()
        if t.dot(up)<0: t=-t
        dest=frame(direction,t)
        q=(dest @ source.transposed()).to_quaternion()
        knuckle=rim(radial)+.021*(math.cos(math.radians(-50))*radial+math.sin(math.radians(-50))*normal)  # 21 mm off the tube, 50 deg toward the front: the rim lies in the palm
        wrist=knuckle-q @ offset
        elbow=elbow_at(upper.head,wrist,Vector((sign*.58,-.086,.764)),upper_length,lower_length)
        return q,wrist,elbow
    # The pole raises the elbows outward to grip height, so the forearm points forward and toward the
    # wheel centre, square to the tube; the hand converges onto the forearm line (straight wrist).
    direction=(rim(radial)-upper.head).normalized()
    for _ in range(12):
        _,wrist,elbow=solve(direction)
        direction=(direction*.2+(wrist-elbow).normalized()*.8).normalized()
    q,wrist,elbow=solve(direction)
    # Hand and wrist stay as solved; only the elbow swings on its cone toward the reference forearm
    # (~12 deg short of it, holding the wrist bend near 18 deg, under the 20 deg wrist test).
    elbow=elbow_at(upper.head,wrist,Vector((sign*.2542,.0396,.5197)),upper_length,lower_length)
    hand_q=q @ hand.matrix.to_quaternion()
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

# Thicken the forearm sleeve (elbow to wrist) radially about its axis; gloves and upper arm stay as they are.
forearm_thickening=.10
for letter in 'LR':
    elbow=rig.matrix_world @ bones['RigForearm'+letter].head
    wrist=rig.matrix_world @ bones['RigHand'+letter].head
    axis=wrist-elbow
    radii=[[],[]]
    for obj in meshes:
        group=obj.vertex_groups.get('RigForearm'+letter)
        if group is None: continue
        hands={g.index for g in obj.vertex_groups if 'Hand' in g.name}
        inverse=obj.matrix_world.inverted()
        for v in obj.data.vertices:
            w=sum(g.weight for g in v.groups if g.group==group.index)
            if w<=.5 or sum(g.weight for g in v.groups if g.group in hands)>=.1: continue
            point=obj.matrix_world @ v.co
            s=max(0,min(1,(point-elbow).dot(axis)/axis.length_squared))
            foot=elbow+axis*s
            if s>.85: radii[0].append((point-foot).length)
            fade=max(0,min(1,(1-s)/.3)); fade=fade*fade*(3-2*fade)  # smoothstep: full to 70% of the forearm, zero at the wrist so the sleeve meets the glove cuff
            point=foot+(point-foot)*(1+forearm_thickening*w*fade)
            if s>.85: radii[1].append((point-foot).length)
            v.co=inverse @ point
        obj.data.update()
    print('FOREARM',letter,'wrist diameter mm',*(round(2000*sum(r)/max(1,len(r)),1) for r in radii),'vertices',len(radii[0]))

# Graft a bridge of glove surface from the right cuff's inner mouth to the glove past the wrist: 24 quads per ring
# (one per 15-degree sector around the forearm axis), 5 rings blended smoothly between the two section outlines.
# Weights run from forearm to hand (hand capped at .55, so glove tests and contact are unchanged); material comes
# from the nearest glove vertex and every UV from one charcoal texel of the glove. Smooth shaded. Nothing existing moves.
from mathutils import kdtree
elbow=rig.matrix_world @ bones['RigForearmR'].head
wrist=rig.matrix_world @ bones['RigHandR'].head
axis=(wrist-elbow).normalized()
side=(Vector((0,0,1))-axis*axis.z).normalized()
other=axis.cross(side)
def flat(point):
    d=point-wrist; along=d.dot(axis); return along,d-axis*along
def sector_of(radial):
    return int((math.degrees(math.atan2(radial.dot(other),radial.dot(side)))+180)//15)%24
def fill(values):
    known=[k for k in range(24) if values[k]]
    out=list(values)
    for i in range(24):
        if values[i]: continue
        a=max((k for k in known if k<i),default=known[-1]-24); b=min((k for k in known if k>i),default=known[0]+24)
        out[i]=values[a%24]+(values[b%24]-values[a%24])*(i-a)/(b-a)
    return out
cuff=[];ring=[];host=None;glove_points=[]
for obj in meshes:
    right={g.index for g in obj.vertex_groups if g.name=='RigHandR' or g.name.startswith('mixamorig6:RightHand')}
    digits={g.index for g in obj.vertex_groups if any(n in g.name for n in ('Index','Middle','Ring','Pinky','Thumb'))}
    for v in obj.data.vertices:
        point=obj.matrix_world @ v.co
        along,radial=flat(point)
        if obj.name=='Racer | glove cuff R':
            if along>-.025: cuff.append((along,radial))
        elif right and sum(g.weight for g in v.groups if g.group in right)>.6 and sum(g.weight for g in v.groups if g.group in digits)<.1:
            if host is None: host=obj
            if obj==host:
                glove_points.append((point,v.index))
                if .008<along<.016: ring.append(radial)
cuff_edge=max(a for a,_ in cuff)
mouth_centre=sum((r for _,r in cuff),Vector())/len(cuff)
mouth=[0]*24
for _,r in cuff:
    k=sector_of(r-mouth_centre); mouth[k]=min(mouth[k] or 1,(r-mouth_centre).length)
mouth=fill(mouth)
ring_centre=sum(ring,Vector())/len(ring)
outline=[0]*24
for r in ring:
    k=sector_of(r-ring_centre); outline[k]=max(outline[k],(r-ring_centre).length)
outline=fill(outline)
tree=kdtree.KDTree(len(glove_points))
for i,(point,_) in enumerate(glove_points): tree.insert(point,i)
tree.balance()
uv_of={};material_of={}
uv_layer=host.data.uv_layers.active
for poly in host.data.polygons:
    for loop in poly.loop_indices:
        vi=host.data.loops[loop].vertex_index
        if vi not in uv_of: uv_of[vi]=tuple(uv_layer.data[loop].uv); material_of[vi]=poly.material_index
start,end=cuff_edge-.003,.012
bm=bmesh.new();bm.from_mesh(host.data)
deform=bm.verts.layers.deform.verify()
uv=bm.loops.layers.uv.active
forearm_group=host.vertex_groups['RigForearmR'].index
hand_group=host.vertex_groups['RigHandR'].index
inverse=host.matrix_world.inverted()
rings=[]
for i in range(5):
    t=i/4; u=t*t*(3-2*t)
    centre=wrist+axis*(start+(end-start)*t)+mouth_centre.lerp(ring_centre,u)
    row=[]
    for k in range(24):
        angle=math.radians(-180+15*k+7.5)
        size=(mouth[k]-.001)*(1-u)+(outline[k]-.0005)*u  # not 'radius': rim() reads that global
        vert=bm.verts.new(inverse @ (centre+(side*math.cos(angle)+other*math.sin(angle))*size))
        vert[deform][forearm_group]=1-.55*t; vert[deform][hand_group]=.55*t
        row.append(vert)
    rings.append(row)
import numpy
_,nearest,_=tree.find(wrist+axis*.02)
material=host.material_slots[material_of.get(glove_points[nearest][1],0)].material
image=next(n.image for n in material.node_tree.nodes if n.type=='TEX_IMAGE' and n.image)
pixels=numpy.empty(len(image.pixels),dtype=numpy.float32);image.pixels.foreach_get(pixels)
pixels=pixels.reshape(image.size[1],image.size[0],image.channels)
def shade(coords):
    x=min(image.size[0]-1,int(coords[0]%1*image.size[0])); y=min(image.size[1]-1,int(coords[1]%1*image.size[1]))
    return float(pixels[y,x,:3].mean())
tones=sorted((shade(uv_of[i]),i) for _,i in glove_points if i in uv_of)
dark=[t for t in tones if t[0]<.3] or tones
charcoal=uv_of[dark[len(dark)//2][1]]  # median of the glove's dark texels
faces=0
for a_row,b_row in zip(rings,rings[1:]):
    for k in range(24):
        quad=(a_row[k],a_row[(k+1)%24],b_row[(k+1)%24],b_row[k])
        face=bm.faces.new(quad)
        middle=host.matrix_world @ face.calc_center_median()
        _,nearest,_=tree.find(middle)
        face.material_index=material_of.get(glove_points[nearest][1],0)
        face.normal_update()
        if (host.matrix_world.to_3x3() @ face.normal).dot(middle-wrist-axis*(middle-wrist).dot(axis))<0: face.normal_flip()
        face.smooth=True
        for loop in face.loops: loop[uv].uv=charcoal
        faces+=1
bm.to_mesh(host.data);bm.free();host.data.update()
print('GRAFT R faces',faces,'charcoal uv',tuple(round(c,3) for c in charcoal),'tone',round(dark[len(dark)//2][0],3),'image',image.name,'host',host.name,'cuff mouth mm',round(min(mouth)*1000,1),round(max(mouth)*1000,1),'glove outline mm',round(min(outline)*1000,1),round(max(outline)*1000,1))

# Chest logo: copy the back logo, subdivide it (3 cuts per edge, UVs/weights interpolated) so it can follow the
# zip placket, turn it 180 deg about the vertical axis through the torso centre (y .22), then cast each vertex
# backward onto whatever suit surface is in front of the chest (zip included) and seat it 1.5 mm in front of it.
back_logo=bpy.data.objects['Motor Lab Racing | Suit']
front_logo=back_logo.copy();front_logo.data=back_logo.data.copy();front_logo.name='Motor Lab Racing | Suit front'
bm=bmesh.new();bm.from_mesh(front_logo.data)
bmesh.ops.subdivide_edges(bm,edges=bm.edges[:],cuts=3,use_grid_fill=True)
bm.to_mesh(front_logo.data);bm.free()
turn=Matrix.Translation((0,.22,0)) @ Matrix.Rotation(math.pi,4,'Z') @ Matrix.Translation((0,-.22,0))
depsgraph=bpy.context.evaluated_depsgraph_get()
seated=0;gaps=[]
for v in front_logo.data.vertices:
    point=turn @ (front_logo.matrix_world @ v.co)
    origin=Vector((point.x,point.y-.04,point.z))
    hit,location,_,_,owner,_=bpy.context.scene.ray_cast(depsgraph,origin,Vector((0,1,0)),distance=.08)
    if hit and not owner.name.startswith('Motor Lab Racing | Suit') and 'glove' not in owner.name:
        point.y=location.y-.0015; seated+=1; gaps.append(.0015)
    v.co=front_logo.matrix_world.inverted() @ point
front_logo.data.update()
back_logo.users_collection[0].objects.link(front_logo)
meshes.append(front_logo)
ys=[(front_logo.matrix_world @ v.co).y for v in front_logo.data.vertices]
print('CHEST LOGO vertices',len(front_logo.data.vertices),'faces',len(front_logo.data.polygons),'seated',seated,'y',round(min(ys),3),round(max(ys),3))

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
            if distance<.0175 and distance>1e-8:  # 1.75 mm keeps triangle interiors off the tube
                correction=.0175-distance
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
