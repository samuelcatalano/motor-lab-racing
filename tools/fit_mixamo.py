"""Fit the official Mixamo Racer FBX into a private Motor Lab desktop preview."""
from argparse import ArgumentParser
from math import asin, atan2, cos, hypot, sin, sqrt, tau
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0,str(Path(__file__).resolve().parent))
from author_driver import add_editing_controls
from fit_go_kart import STEERING_AXIS, STEERING_CENTER, prepare_kart


def point(x, y, z):
    return Vector((x, -z, y))


WHEEL_CENTER = point(*STEERING_CENTER)
WHEEL_NORMAL = -point(*STEERING_AXIS)
WHEEL_UP = Vector((1, 0, 0)).cross(WHEEL_NORMAL)
RIM_RADIUS = .14175


def normalize(rig, suit):
    # Scale the Racer to the bucket and lean forward to reach the low wheel.
    original_hip=Vector((0,-.025,.9667))
    calibration=(Matrix.Translation(point(0,.232,-.230))
                 @ Matrix.Rotation(.128,4,'X') @ Matrix.Scale(.85,4)
                 @ Matrix.Translation(-original_hip))
    skin_world=suit.matrix_world.copy()
    armature_world=rig.matrix_world.copy()
    rig.data.transform(calibration @ armature_world)
    rig.matrix_world=Matrix.Identity(4)
    suit.parent=rig
    suit.matrix_parent_inverse=Matrix.Identity(4)
    suit.matrix_basis=Matrix.Identity(4)
    suit.data.transform(calibration @ skin_world)
    for bone in rig.pose.bones:
        bone.matrix_basis=Matrix.Identity(4)
    bpy.context.view_layer.update()


def align(bone, child, start, end, roll=0):
    base=bone.bone.matrix_local.to_quaternion()
    source=(child.bone.head_local-bone.bone.head_local).normalized()
    target=(end-start).normalized()
    rotation=Quaternion(target,roll) @ source.rotation_difference(target) @ base
    bone.matrix=Matrix.Translation(start) @ rotation.to_matrix().to_4x4()
    bpy.context.view_layer.update()


def hand_frame(axis, normal):
    axis=axis.normalized()
    normal=(normal-axis*normal.dot(axis)).normalized()
    return Matrix((axis,normal,axis.cross(normal))).transposed()


def aim_hand(hand,middle,wrist,direction,palm):
    rest_dir=middle.bone.head_local-hand.bone.head_local
    source=hand_frame(rest_dir,Vector((0,0,-1)))
    dest=hand_frame(direction,palm)
    q=(dest @ source.transposed()).to_quaternion() @ hand.bone.matrix_local.to_quaternion()
    hand.matrix=Matrix.Translation(wrist) @ q.to_matrix().to_4x4()
    bpy.context.view_layer.update()


def rim_at(radial):
    # The rim slopes slightly forward from the axis of the steering column.
    return WHEEL_CENTER + RIM_RADIUS * radial + WHEEL_NORMAL * (.092 * RIM_RADIUS * radial.dot(WHEEL_UP))


def aim_joint(joint,child,target):
    current = child.head - joint.head
    rotation = current.rotation_difference(target - joint.head) @ joint.matrix.to_quaternion()
    joint.matrix = Matrix.Translation(joint.head) @ rotation.to_matrix().to_4x4()
    bpy.context.view_layer.update()


def close_grip(bones,side,radial):
    for finger in ('Index','Middle','Ring','Pinky'):
        joints=[bones[f'{side}Hand{finger}{i}'] for i in range(1,5)]
        knuckle=joints[0].head-WHEEL_CENTER
        outward=(knuckle-WHEEL_NORMAL*knuckle.dot(WHEEL_NORMAL)).normalized()
        center=rim_at(outward)
        delta=joints[0].head-center
        run,depth=delta.dot(outward),delta.dot(WHEEL_NORMAL)
        angle=atan2(depth,run)
        # Offset the joints by the padding thickness so the palm contacts the rubber.
        radius=max(.0225,hypot(run,depth))
        for joint,child in zip(joints,joints[1:]):
            length=(child.head-joint.head).length
            angle-=2*asin(min(.98,length/(2*radius)))
            target=center+radius*(cos(angle)*outward+sin(angle)*WHEEL_NORMAL)
            aim_joint(joint,child,target)

    center=rim_at(radial)
    thumb=[bones[f'{side}HandThumb{i}'] for i in range(1,5)]
    for joint,child,(up,inset,rear) in zip(thumb,thumb[1:],(
        (.022,.007,.048),(.037,.020,.023),(.044,.022,.004),
    )):
        aim_joint(joint,child,center+WHEEL_UP*up-radial*inset+WHEEL_NORMAL*rear)


def elbow_point(shoulder, wrist, pole, first, second):
    axis=(wrist-shoulder).normalized()
    d=min((wrist-shoulder).length,first+second-1e-5)
    bend=pole-shoulder
    bend=(bend-axis*bend.dot(axis)).normalized()
    along=(first*first-second*second+d*d)/(2*d)
    return shoulder+axis*along+bend*sqrt(max(0,first*first-along*along))


def seat(rig, bones):
    for side, sign in (('Left',1),('Right',-1)):
        upper,fore,hand,mid=[bones[side+name] for name in ('Arm','ForeArm','Hand','HandMiddle1')]
        shoulder=upper.head.copy()
        radial=(Vector((sign,0,0))+.20*WHEEL_UP).normalized()
        direction=(-WHEEL_NORMAL+.26*WHEEL_UP-.12*radial).normalized()
        knuckle=rim_at(radial)+.0205*radial+.009*WHEEL_NORMAL
        wrist=knuckle-direction*(mid.bone.head_local-hand.bone.head_local).length
        pole=point(sign*.246,.375,-.180)
        upper_length=(fore.bone.head_local-upper.bone.head_local).length
        lower_length=(hand.bone.head_local-fore.bone.head_local).length
        elbow=elbow_point(shoulder,wrist,pole,upper_length,lower_length)
        align(upper,fore,shoulder,elbow)
        align(fore,hand,elbow,wrist)
        aim_hand(hand,mid,wrist,direction,-radial)
        close_grip(bones,side,radial)

        thigh,shin,foot,toe=[bones[side+name] for name in ('UpLeg','Leg','Foot','ToeBase')]
        hip=thigh.head.copy()
        ankle=point(sign*.110,.155,.397)
        thigh_length=(shin.bone.head_local-thigh.bone.head_local).length
        calf_length=(foot.bone.head_local-shin.bone.head_local).length
        knee=elbow_point(hip,ankle,point(sign*.173,.322,.206),thigh_length,calf_length)
        align(thigh,shin,hip,knee)
        align(shin,foot,knee,ankle)
        align(foot,toe,ankle,point(sign*.094,.173,.551),roll=sign*.055)

    bpy.context.view_layer.update()


def helmet_islands(suit):
    # Recover connected surfaces across UV seams without modifying the FBX topology.
    world=suit.matrix_world.copy()
    positions=[world @ vertex.co for vertex in suit.data.vertices]
    keys={}
    indices=[keys.setdefault(tuple(round(axis,5) for axis in p),len(keys)) for p in positions]
    graph=[set() for key in keys]
    for edge in suit.data.edges:
        a,b=(indices[i] for i in edge.vertices)
        graph[a].add(b)
        graph[b].add(a)
    parts=[-1]*len(graph)
    for i in range(len(graph)):
        if parts[i]>=0:
            continue
        parts[i]=i
        queue=[i]
        for member in queue:
            for neighbor in graph[member]:
                if parts[neighbor]<0:
                    parts[neighbor]=i
                    queue.append(neighbor)
    groups={}
    for face in suit.data.polygons:
        key=parts[indices[face.vertices[0]]]
        groups.setdefault(key,[]).append(face.index)
    head={key:faces for key,faces in groups.items() if
          min(positions[i].z for f in faces for i in suit.data.polygons[f].vertices)>1.48}
    shell=max(head.values(),key=len)
    if len(shell)<1000:
        raise ValueError('Cannot identify the Racer helmet shell')
    return set(shell),{f for faces in head.values() for f in faces},positions


def image_values(image):
    if max(image.size)>2048:
        image.scale(2048,2048)
    pixels=np.empty(image.size[0]*image.size[1]*4,dtype=np.float32)
    image.pixels.foreach_get(pixels)
    return pixels.reshape(-1,4)


def create_map(name,size,values,linear=False,jpeg=False):
    image=bpy.data.images.new(name,width=size[0],height=size[1],alpha=False)
    if linear:
        image.colorspace_settings.name='Non-Color'
    image.pixels.foreach_set(np.ascontiguousarray(values,dtype=np.float32).ravel())
    image.update()
    if jpeg:
        with TemporaryDirectory(prefix='motor-lab-mixamo-') as work:
            path=Path(work)/'texture.jpg'
            image.filepath_raw=str(path)
            image.file_format='JPEG'
            image.save()
            data=path.read_bytes()
            image.pack(data=data,data_len=len(data))
    else:
        image.pack()
    return image


def racewear_normals(source,size):
    width,height=size
    u=np.arange(width,dtype=np.float32)[None,:]
    v=np.arange(height,dtype=np.float32)[:,None]
    diagonal=np.sin(1.32*u+.69*v)
    cross=np.sin(1.43*v-.51*u)
    fabric=source.copy().reshape(height,width,4)
    fabric[:,:,0]+=.049*(diagonal+.36*cross)
    fabric[:,:,1]+=.042*(cross-.36*diagonal)
    glove=source.copy().reshape(height,width,4)
    grain=np.random.default_rng(482).random((height,width),dtype=np.float32)
    grain=(grain+np.roll(grain,1,axis=0)+np.roll(grain,1,axis=1))/3
    glove[:,:,0]+=.087*(grain-np.roll(grain,1,axis=1))
    glove[:,:,1]+=.087*(grain-np.roll(grain,1,axis=0))
    return (
        create_map('Racer | diagonal twill',size,np.clip(fabric,0,1),True,True),
        create_map('Racer | glove pebble grain',size,np.clip(glove,0,1),True,True),
    )


def make_pbr(suit):
    shell_faces,helmet_faces,rest=helmet_islands(suit)
    images={Path(n.image.filepath).stem.lower().split('_')[-1]:n.image
            for n in suit.data.materials[0].node_tree.nodes
            if n.type=='TEX_IMAGE' and n.image}
    diffuse,normal,gloss=[images[name] for name in ('diffuse','normal','glossiness')]
    pixels=image_values(diffuse)
    red,green,blue=pixels[:,0],pixels[:,1],pixels[:,2]
    mask=np.clip((red-np.maximum(green,blue)-.048)*8,0,1)[:,None]
    dyed=np.power(np.maximum(red,0)/.60,.94)
    yellow=dyed[:,None]*np.array((.839,.641,.064))
    gold=pixels.copy()
    gold[:,:3]=np.clip(pixels[:,:3]*(1-mask)+yellow*mask,0,1)
    charcoal=pixels.copy()
    grey=pixels[:,:3] @ np.array((.32,.57,.11),dtype=np.float32)
    toned=(.045+.64*grey[:,None])*np.array((.92,.97,1.04))
    charcoal[:,:3]=np.clip(pixels[:,:3]*(1-mask)+toned*mask,0,1)
    shell=pixels.copy()
    uv=suit.data.uv_layers.active.data
    w,h=diffuse.size
    samples=[pixels[int(uv[i].uv.y*h)%h*w+int(uv[i].uv.x*w)%w,:3]
             for f in shell_faces for i in suit.data.polygons[f].loop_indices]
    reference=max(.032,float(np.median(np.array(samples) @ (.32,.57,.11))))
    tint=np.array((159,43,104),dtype=np.float32)/255
    lustre=np.clip((grey/reference)**.65,.20,1.75)
    shell[:,:3]=np.clip(lustre[:,None]*tint,0,1)
    normal.colorspace_settings.name='Non-Color'
    base=create_map('Racer | yellow color and original cloth detail',diffuse.size,gold,jpeg=True)
    boots=create_map('Racer | graphite gloves and boots',diffuse.size,charcoal,jpeg=True)
    shell_map=create_map('Racer | Amaranth helmet on original shell UV',diffuse.size,shell,jpeg=True)
    source_map=create_map('Racer | original trim and visor UV',diffuse.size,pixels,jpeg=True)
    normal_values=image_values(normal)
    woven_normal,glove_normal=racewear_normals(normal_values,normal.size)
    normal=create_map('Racer | original normal relief at 2K',normal.size,normal_values,True,True)
    gloss_pixels=image_values(gloss)
    rough_values=np.repeat(np.clip(.39+.48*gloss_pixels[:,:1],.39,.83),4,axis=1)
    rough_values[:,3]=1
    rough=create_map('Racer | converted roughness',gloss.size,rough_values,True)

    def make_mat(name,base_map,coat=0,*,relief_map=normal,roughness=rough,specular=.38):
        mat=bpy.data.materials.new(name)
        mat.use_nodes=True
        nodes=mat.node_tree.nodes
        links=mat.node_tree.links
        shader=nodes.get('Principled BSDF')
        shader.inputs['Specular IOR Level'].default_value=specular
        shader.inputs['Coat Weight'].default_value=coat
        shader.inputs['Coat Roughness'].default_value=.28
        for image,socket in ((base_map,'Base Color'),(relief_map,'Normal')):
            tex=nodes.new('ShaderNodeTexImage')
            tex.image=image
            if socket=='Normal':
                relief=nodes.new('ShaderNodeNormalMap')
                relief.inputs['Strength'].default_value=.95
                links.new(tex.outputs['Color'],relief.inputs['Color'])
                links.new(relief.outputs['Normal'],shader.inputs[socket])
            else:
                links.new(tex.outputs['Color'],shader.inputs[socket])
        if isinstance(roughness,float):
            shader.inputs['Roughness'].default_value=roughness
        else:
            tex=nodes.new('ShaderNodeTexImage')
            tex.image=roughness
            links.new(tex.outputs['Color'],shader.inputs['Roughness'])
        return mat

    suit.data.materials.clear()
    suit.data.materials.append(make_mat('Racer | yellow race cloth',base,
        relief_map=woven_normal,roughness=.79,specular=.25))
    suit.data.materials.append(make_mat('Racer | charcoal gloves and boots',boots,
        relief_map=glove_normal,roughness=.72,specular=.27))
    suit.data.materials.append(make_mat('Racer | original Amaranth shell #9F2B68',shell_map,.22))
    suit.data.materials.append(make_mat('Racer | original visor and helmet trims',source_map,.16))
    fingertips={g.index for g in suit.vertex_groups if 'Hand' in g.name}
    for face in suit.data.polygons:
        vertices=[suit.data.vertices[i] for i in face.vertices]
        height=sum(rest[v.index].z for v in vertices)/len(vertices)
        gloves=sum(g.weight for v in vertices for g in v.groups if g.group in fingertips)
        if face.index in shell_faces:
            face.material_index=2
        elif face.index in helmet_faces:
            face.material_index=3
        else:
            face.material_index=int(height<.145 or gloves>.57*len(vertices))


def bake_neutral(rig,suit):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active=suit
    suit.select_set(True)
    skin=next(mod for mod in suit.modifiers if mod.type=='ARMATURE')
    bpy.ops.object.modifier_apply(modifier=skin.name)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    skin=suit.modifiers.new('Mixamo deformation weights','ARMATURE')
    skin.object=rig


def rename_channels(rig,bones):
    names={'Hips':'RigPelvis','Spine':'RigSpine','Head':'RigHead'}
    for side,suffix in (('Left','L'),('Right','R')):
        names.update({side+part:'Rig'+target+suffix for part,target in (
            ('Arm','UpperArm'),('ForeArm','Forearm'),('Hand','Hand'),('UpLeg','Thigh'),
            ('Leg','Shin'),('Foot','Foot'),('ToeBase','Toe'),
        )})
    for before,after in names.items():
        bones[before].name=after


def back_surface(suit,x,y,offset):
    hit,location,_,_=suit.ray_cast(point(x,y,-.65),Vector((0,-1,0)),distance=.65)
    if not hit:
        raise ValueError(f'Cannot place the Racer back lettering at {(x,y)}')
    return location+Vector((0,offset,0))


def attach_label(obj, rig, material, bone='RigSpine'):
    obj.data.materials.append(material)
    group=obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    skin=obj.modifiers.new('Decal follows the rig','ARMATURE')
    skin.object=rig
    obj.parent=rig


def append_pedals(suit,rig):
    face=bpy.data.materials.new('Pedal | shot-peened aluminum')
    face.diffuse_color=(.35,.39,.43,1)
    face.metallic=.72
    face.roughness=.43
    stem=bpy.data.materials.new('Pedal | blackened steel')
    stem.diffuse_color=(.045,.048,.054,1)
    stem.metallic=.68
    stem.roughness=.61

    def box(name,pivot,center,size,mat,bevel=.002):
        bpy.ops.mesh.primitive_cube_add(size=1)
        part=bpy.context.object
        part.name=name
        part.parent=pivot
        part.location=center
        for vertex in part.data.vertices:
            vertex.co=Vector(tuple(vertex.co[i]*size[i] for i in range(3)))
        part.data.materials.append(mat)
        edge=part.modifiers.new('Machined edges','BEVEL')
        edge.width=bevel
        edge.segments=2
        return part

    for side,label,width in (('L','Brake',.060),('R','Throttle',.046)):
        toe=rig.data.bones['RigToe'+side].head_local
        groups={item.index for item in suit.vertex_groups if item.name in ('RigFoot'+side,'RigToe'+side)}
        shoe=[v.co for v in suit.data.vertices if abs(v.co.x-toe.x)<.028
              and any(g.group in groups and g.weight>.5 for g in v.groups)]
        front=min(shoe,key=lambda v:v.y)
        contact=Vector((toe.x,front.y-.0015,front.z))
        pivot=bpy.data.objects.new(label+'Pedal',None)
        bpy.context.collection.objects.link(pivot)
        pivot.location=contact-point(0,.083,.023)
        anchor=bpy.data.objects.new('PedalContact'+side,None)
        bpy.context.collection.objects.link(anchor)
        anchor.parent=pivot
        anchor.location=contact-pivot.location
        box(label+' pedal plate',pivot,anchor.location+point(0,0,.006),
            (width,.009,.068),face,.004)
        box(label+' pedal lever',pivot,point(0,.045,.015),
            (.018,.021,.100),stem).rotation_euler.x=.16
        for i in range(4):
            box(label+' grip rib',pivot,anchor.location+point(0,.022-i*.014,.0005),
                (width*.76,.003,.0038),stem,.0008)


def append_glove_cuffs(suit,rig):
    materials=[]
    for name,color,roughness in (
        ('Glove | wrist closure fabric',(.023,.029,.034,1),.88),
        ('Glove | cuff binding',(.009,.012,.015,1),.75),
        ('Glove | gold top stitch',(.38,.245,.046,1),.92),
    ):
        mat=bpy.data.materials.new(name)
        mat.use_nodes=True
        shader=mat.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value=color
        shader.inputs['Roughness'].default_value=roughness
        materials.append(mat)
    # Size the closure to the original sleeve at each cross-section.
    widths=(.014,.018,.021,.024,.044,.048,.051)
    bands=(1,0,2,0,0,1)
    columns=44
    for side in ('L','R'):
        wrist=rig.data.bones[f'RigHand{side}'].head_local
        elbow=rig.data.bones[f'RigForearm{side}'].head_local
        axis=(wrist-elbow).normalized()
        radial=axis.cross(WHEEL_UP).normalized()
        tangent=axis.cross(radial)
        vertices,faces=[],[]
        for row,distance in enumerate(widths):
            center=wrist-axis*distance
            for column in range(columns):
                angle=tau*column/columns
                outward=radial*cos(angle)+tangent*sin(angle)
                hit,location,_,_=suit.ray_cast(center+.079*outward,-outward,distance=.086)
                if not hit:
                    raise RuntimeError(f'Cannot fit Racer glove cuff {side} at {distance:.3f} m')
                vertices.append(location+.0013*outward)
                if row<len(widths)-1:
                    i=row*columns+column
                    after=row*columns+(column+1)%columns
                    faces.append((i,i+columns,after+columns,after))
        name=f'Racer | glove cuff {side}'
        mesh=bpy.data.meshes.new(name)
        mesh.from_pydata(vertices,[],faces)
        mesh.update()
        obj=bpy.data.objects.new(name,mesh)
        bpy.context.collection.objects.link(obj)
        attach_label(obj,rig,materials[0],f'RigForearm{side}')
        for mat in materials[1:]:
            mesh.materials.append(mat)
        for face in mesh.polygons:
            band=bands[face.index//columns]
            # Break the gold row into short stitches rather than a solid stripe.
            face.material_index=0 if band==2 and face.index%2 else band
            face.use_smooth=True


def append_name(suit,rig):
    material=bpy.data.materials.new('Racer | white back lettering')
    material.diffuse_color=(1,1,1,1)
    material.use_nodes=True
    material.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.8
    panel_mat=bpy.data.materials.new('Racer | graphite lettering border')
    panel_mat.diffuse_color=(.027,.030,.040,1)
    panel_mat.use_nodes=True
    bsdf=panel_mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value=panel_mat.diffuse_color
    bsdf.inputs['Roughness'].default_value=.91
    for word,width,height,y in [('LEANDRO',.228,.029,.581),('LIPPI',.151,.024,.549)]:
        font=bpy.data.curves.new(word,'FONT')
        font.body=word
        font.align_x='CENTER'
        font.resolution_u=8
        for filename in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf',
                         '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'):
            if Path(filename).is_file():
                font.font=bpy.data.fonts.load(filename,check_existing=True)
                break
        letters=bpy.data.objects.new(word,font)
        bpy.context.collection.objects.link(letters)
        bpy.ops.object.select_all(action='DESELECT')
        letters.select_set(True)
        bpy.context.view_layer.objects.active=letters
        bpy.ops.object.convert(target='MESH')
        edit=bmesh.new()
        edit.from_mesh(letters.data)
        bmesh.ops.triangulate(edit,faces=list(edit.faces))
        bmesh.ops.subdivide_edges(edit,edges=list(edit.edges),cuts=2,use_grid_fill=True)
        edit.to_mesh(letters.data)
        edit.free()
        for vertex in letters.data.vertices:
            vertex.co.x += .24 * vertex.co.y
        x0,x1=[fn(v.co.x for v in letters.data.vertices) for fn in (min,max)]
        y0,y1=[fn(v.co.y for v in letters.data.vertices) for fn in (min,max)]
        scale=min(width/(x1-x0),height/(y1-y0))
        outline=letters.copy()
        outline.data=letters.data.copy()
        outline.name=f'{word} border'
        bpy.context.collection.objects.link(outline)
        for vertex,edge in zip(letters.data.vertices,outline.data.vertices):
            x=-(vertex.co.x-(x0+x1)/2)*scale
            h=(vertex.co.y-(y0+y1)/2)*scale
            vertex.co=back_surface(suit,x,y+h,.0020)
            edge.co=back_surface(suit,x*1.026,y+h*1.13,.0010)
        letters.data.update()
        outline.data.update()
        attach_label(outline,rig,panel_mat)
        attach_label(letters,rig,material)


def append_brand(suit,rig):
    image=bpy.data.images.load(str(Path(__file__).parent/'kart-textures'/'motor-lab-racing.png'))
    image.pack()
    placements=(
        ('Suit',.239,.039,.626,.76,'RigSpine'),
        ('Helmet',.115,.019,.781,.40,'RigHead'),
    )
    columns,rows=24,8
    stride=columns+1
    for part,width,height,center,roughness,bone in placements:
        name=f'Motor Lab Racing | {part}'
        vertices,coords,faces=[],[],[]
        for row in range(rows+1):
            v=row/rows
            for column in range(columns+1):
                u=column/columns
                vertices.append(back_surface(suit,(.5-u)*width,center+(v-.5)*height,.0018))
                # Use just the artwork and its black margin from the supplied image.
                coords.append((.022+.954*u,.203+.51*v))
                if row<rows and column<columns:
                    i=row*stride+column
                    faces.append((i,i+1,i+stride+1,i+stride))
        mesh=bpy.data.meshes.new(name)
        mesh.from_pydata(vertices,[],faces)
        mesh.update()
        uv=mesh.uv_layers.new(name='Logo')
        for loop in mesh.loops:
            uv.data[loop.index].uv=coords[loop.vertex_index]
        for face in mesh.polygons:
            face.use_smooth=True
        obj=bpy.data.objects.new(name,mesh)
        bpy.context.collection.objects.link(obj)
        mat=bpy.data.materials.new(name)
        mat.use_nodes=True
        nodes=mat.node_tree.nodes
        texture=nodes.new('ShaderNodeTexImage')
        texture.image=image
        bsdf=nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value=roughness
        mat.node_tree.links.new(texture.outputs['Color'],bsdf.inputs['Base Color'])
        attach_label(obj,rig,mat,bone)


def main():
    parser=ArgumentParser()
    parser.add_argument('kart',type=Path,help='Supplied go_kart.glb or a previously fitted mixamo-kart.blend')
    parser.add_argument('fbx',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--blend',type=Path)
    parser.add_argument('--original-colors',action='store_true',help='Keep the FBX colors for comparison')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    kart_path=args.kart.resolve(strict=True)
    if kart_path.suffix.lower()=='.blend':
        bpy.ops.wm.open_mainfile(filepath=str(kart_path),load_ui=False)
        old_rig=bpy.data.objects['LippiRig']
        for obj in (*old_rig.children_recursive,old_rig):
            bpy.data.objects.remove(obj,do_unlink=True)
        for name in ('BrakePedal','ThrottlePedal'):
            pedal=bpy.data.objects.get(name)
            if pedal:
                for obj in (*pedal.children_recursive,pedal):
                    bpy.data.objects.remove(obj,do_unlink=True)
        bpy.data.orphans_purge(do_recursive=True)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        prepare_kart(kart_path,lambda coordinates: point(*coordinates))
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.import_scene.fbx(filepath=str(args.fbx.resolve(strict=True)),use_anim=False)
    rig=next(obj for obj in bpy.context.selected_objects if obj.type=='ARMATURE')
    suit=next(obj for obj in bpy.context.selected_objects if obj.type=='MESH')
    rig.name='LippiRig'
    suit.name='Mixamo Racer | seated and recolored'
    if not args.original_colors:
        make_pbr(suit)
    normalize(rig,suit)
    bones={bone.name.split(':')[-1]:bone for bone in rig.pose.bones}
    seat(rig,bones)
    bake_neutral(rig,suit)
    rename_channels(rig,{bone.name.split(':')[-1]:bone for bone in rig.pose.bones})
    bpy.context.view_layer.update()
    append_pedals(suit,rig)
    if not args.original_colors:
        append_name(suit,rig)
        append_brand(suit,rig)
        append_glove_cuffs(suit,rig)
    rig['assetSource']='Adobe Mixamo Racer'

    args.output.parent.mkdir(exist_ok=True,parents=True)
    temp=args.output.with_suffix('.tmp.glb')
    result=bpy.ops.export_scene.gltf(filepath=str(temp.resolve()),export_format='GLB',
                                    export_animations=False,export_extras=True,
                                    export_cameras=False,export_lights=False)
    if 'FINISHED' not in result:
        raise RuntimeError('Mixamo GLB export failed')
    temp.replace(args.output)
    if args.blend:
        add_editing_controls(rig)
        bpy.context.preferences.filepaths.save_version=0
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend.resolve()),compress=True)


if __name__=='__main__':
    main()
