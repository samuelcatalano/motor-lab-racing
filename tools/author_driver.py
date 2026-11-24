"""Model and skin the original seated Leandro Lippi pilot in Blender."""
from math import cos, exp, pi, sin

import bmesh
import bpy
from mathutils import Matrix, Vector


def point(x,y,z):
    return Vector((x,-z,y))


def cabin_point(position, imported):
    x,y,z = position
    if imported:
        return x,y,z
    towards_pedals = smooth(-.24,.64,z)
    return x,y+.032-.017*towards_pedals,z+.124-.251*towards_pedals


def fit_cabin(obj, imported):
    if not imported:
        for v in obj.data.vertices:
            x,y,z = v.co
            v.co = point(*cabin_point((x,z,-y), False))
        obj.data.update()
    return obj


def smooth(a,b,x):
    t = max(0,min(1,(x-a)/(b-a)))
    return t*t*(3-2*t)


def interpolate(rows,t):
    i = min(int(t*(len(rows)-1)),len(rows)-2)
    a,b,c,d = rows[max(0,i-1)],rows[i],rows[i+1],rows[min(i+2,len(rows)-1)]
    t = t*(len(rows)-1)-i
    return tuple(.5*(2*p + (q-o)*t + (2*o-5*p+4*q-r)*t*t + (r-o+3*p-3*q)*t*t*t)
                 for o,p,q,r in zip(a,b,c,d))


def mesh(name,verts,faces):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts,[],faces)
    data.update()
    obj = bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(obj)
    return obj


def loft(name,surface,rings=53,sides=40):
    verts = [surface(i/(rings-1),j*2*pi/sides) for i in range(rings) for j in range(sides)]
    faces = [(a,b,b+sides,a+sides) for i in range(rings-1) for j in range(sides)
             for a,b in [(i*sides+j,i*sides+(j+1)%sides)]]
    faces.extend([tuple(reversed(range(sides))),tuple(range((rings-1)*sides,rings*sides))])
    obj = mesh(name,verts,faces)
    edit = bmesh.new()
    edit.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(edit,faces=list(edit.faces))
    for face in edit.faces:
        face.smooth = True
    edit.to_mesh(obj.data)
    edit.free()
    return obj


def tube_shape(name,rows,wrinkle=0,rings=47,sides=32):
    def section(t,angle):
        x,y,z,width,depth = interpolate(rows,t)
        before = point(*interpolate(rows,max(0,t-.008))[:3])
        after = point(*interpolate(rows,min(1,t+.008))[:3])
        axis = (after-before).normalized()
        lateral = axis.cross(Vector((0,0,1))).normalized()
        radial = axis.cross(lateral)
        bend = exp(-((t-.55)/.145)**2)
        fold = wrinkle*(.68*sin(23*t+1.8*sin(3*angle)+.7*sin(8*angle))
                         +.32*sin(39*t-2*angle+1.3*sin(7*t)))*bend
        return point(x,y,z) + lateral*(width+fold)*cos(angle) + radial*(depth+fold)*sin(angle)
    return loft(name,section,rings,sides)


def merge_skin(parts, name, resolution):
    bpy.ops.object.select_all(action='DESELECT')
    base = parts[0]
    bpy.context.view_layer.objects.active = base
    for part in parts:
        part.select_set(True)
    bpy.ops.object.join()
    base.name = name
    mod = base.modifiers.new('Seamless garment surface','REMESH')
    mod.mode = 'VOXEL'
    mod.voxel_size = resolution
    bpy.ops.object.modifier_apply(modifier=mod.name)
    mod = base.modifiers.new('Soften the seam transitions','SMOOTH')
    mod.factor = .67
    mod.iterations = 4
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for face in base.data.polygons:
        face.use_smooth = True
    base.select_set(False)
    return base


def join_skin(parts,name):
    bpy.ops.object.select_all(action='DESELECT')
    base=parts[0]
    bpy.context.view_layer.objects.active=base
    for part in parts:
        part.select_set(True)
    bpy.ops.object.join()
    base.name=name
    for face in base.data.polygons:
        face.use_smooth=True
    base.select_set(False)
    return base


def jacket():
    rows = [
        (.156,-.226,.081,.061),(.173,-.231,.128,.082),
        (.209,-.238,.157,.096),(.265,-.241,.147,.103),
        (.330,-.249,.143,.101),(.388,-.258,.151,.105),
        (.449,-.267,.163,.108),(.498,-.272,.180,.100),
        (.534,-.271,.184,.092),(.560,-.260,.156,.081),
        (.580,-.253,.117,.074),(.605,-.246,.079,.062),
        (.626,-.245,.066,.056),(.640,-.245,.064,.054),
    ]
    def section(t,a):
        y,z,w,d = interpolate(rows,t)
        x = w*sin(a)
        back = max(0,cos(a))
        front = max(0,-cos(a))
        lower = exp(-((y-.296)/.084)**2)
        chest = exp(-((y-.456)/.060)**2)
        shoulder = exp(-((y-.515)/.044)**2)
        fold = .0018*sin(31*y+13*abs(x)+1.6*sin(5*a))*lower
        fold += .0022*sin(27*y-11*abs(x)+1.2*sin(3*a))*chest*front
        fold += .0025*shoulder*exp(-((abs(x)-.108)/.035)**2)
        fold -= .0018*shoulder*exp(-(x/.030)**2)
        diagonal = .0024*sin(34*y-25*abs(x)+sin(8*x))*exp(-((y-.39-.18*abs(x))/.026)**2)
        fold += diagonal*front
        return point(x,y-.014*sin(a)**2,z-(d+fold)*cos(a)-.001*back*sin(8*a+11*y))
    return loft('Sculpted jacket',section,81,64)


def mirrored(rows, side):
    return [(side*x,y,z,w,d) for x,y,z,w,d in rows]


def joints(imported):
    if imported:
        return ((.156,.530,-.246),(.228,.413,-.083),(.165,.402,.153),(.146,.411,.192))
    return ((.156,.570,-.120),(.225,.470,.016),(.134,.502,.200),(.112,.514,.244))


def sleeve(rows,side):
    shoulder,elbow,wrist,_ = [Vector(v) for v in rows]
    s0=shoulder.lerp(elbow,-.25)
    s1=shoulder.lerp(elbow,.28)
    s2=shoulder.lerp(elbow,.68)
    e0=elbow.lerp(wrist,.17)
    e1=elbow.lerp(wrist,.58)
    e2=elbow.lerp(wrist,.88)
    sections=[
        (*s0,.043,.045),(*shoulder,.051,.052),(*s1,.046,.045),(*s2,.042,.039),
        (*elbow,.039,.037),(*e0,.035,.034),(*e1,.032,.030),
        (*e2,.026,.024),(*wrist,.025,.023),
    ]
    return tube_shape('Tailored sleeve',mirrored(sections,side),.00165,58,36)


def pants(side):
    sections=[
        (.060,.193,-.243,.055,.057),(.082,.181,-.147,.065,.053),(.104,.201,-.071,.058,.054),
        (.117,.231,.073,.055,.054),(.124,.250,.194,.053,.050),
        (.125,.244,.258,.048,.045),(.122,.220,.346,.045,.041),
        (.121,.192,.455,.040,.035),(.119,.160,.565,.030,.031),(.117,.153,.642,.028,.025),
    ]
    return tube_shape('Bent leg',mirrored(sections,side),.003,59,36)


def gloves(rows,side):
    wrist,hand = (Vector(v) for v in rows[2:])
    end = hand + Vector((-.026,-.005,.021))
    palm = tube_shape('Palm and gauntlet',mirrored([
        (*(wrist.lerp(hand,-.20)),.024,.021),(*wrist,.026,.022),
        (*hand,.029,.021),(*end,.022,.014),
    ],side),0,29,34)
    parts = [palm]
    for i in range(4):
        offset = Vector((.010*i,0,-.009*i))
        start = end+offset
        curl = start+Vector((-.013,-.021,.010))
        tip = curl+Vector((.005,-.013,-.012))
        parts.append(tube_shape('Curved glove fingers',mirrored([
            (*start,.0076,.0078),(*curl,.0072,.0080),(*tip,.0053,.0062),
            (*(tip+Vector((.002,-.002,-.002))),.0028,.0032),
        ],side),0,18,20))
    thumb = wrist.lerp(hand,.5)+Vector((-.019,.008,-.004))
    parts.append(tube_shape('Thumb grip',mirrored([
        (*thumb,.012,.010),(*(thumb+Vector((-.019,.011,.016))),.009,.008),
        (*(thumb+Vector((-.022,-.003,.030))),.0045,.0055),
    ],side),0,16,20))
    return join_skin(parts,'Leather driving glove')


def boot(side):
    upper = [
        (.116,.150,.605,.028,.026),(.116,.147,.647,.039,.032),
        (.116,.150,.679,.041,.029),(.116,.155,.719,.041,.027),
        (.116,.158,.751,.034,.024),(.116,.162,.764,.020,.016),
    ]
    sole = [(x,y-.023,z,w*.98,.010) for x,y,z,w,h in upper]
    return (tube_shape('Suede racing boot',mirrored(upper,side),0,37,32),
            tube_shape('Moulded racing boot sole',mirrored(sole,side),0,37,30))


def material(name,color,roughness):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color,1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = mat.diffuse_color
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


def fabric_material(textures):
    mat = material('Lippi | woven yellow suit',( .87,.53,.045),.85)
    nodes,links = mat.node_tree.nodes,mat.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Specular IOR Level'].default_value = .14
    for role,socket in [('color','Base Color'),('normal','Normal'),('roughness','Roughness')]:
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(str(textures/f'bi-stretch-{role}.jpg'),check_existing=True)
        if role!='color':
            tex.image.colorspace_settings.name = 'Non-Color'
        tex.image.pack()
        if role=='normal':
            n = nodes.new('ShaderNodeNormalMap')
            n.inputs['Strength'].default_value = .52
            links.new(tex.outputs['Color'],n.inputs['Color'])
            links.new(n.outputs['Normal'],bsdf.inputs[socket])
        elif role=='roughness':
            mapping = nodes.new('ShaderNodeMapRange')
            mapping.clamp = True
            mapping.inputs['From Min'].default_value = 0
            mapping.inputs['From Max'].default_value = 1
            mapping.inputs['To Min'].default_value = .68
            mapping.inputs['To Max'].default_value = .94
            links.new(tex.outputs['Color'],mapping.inputs['Value'])
            links.new(mapping.outputs['Result'],bsdf.inputs[socket])
        else:
            links.new(tex.outputs['Color'],bsdf.inputs[socket])
    return mat


def textile_uv(obj):
    uv = obj.data.uv_layers.new(name='Fabric at 30 cm repeat')
    vertices = obj.data.vertices
    for face in obj.data.polygons:
        axis = max(range(3),key=lambda i:abs(face.normal[i]))
        u,v = ((1,2),(0,2),(0,1))[axis]
        for idx in face.loop_indices:
            co = vertices[obj.data.loops[idx].vertex_index].co
            uv.data[idx].uv = (co[u]/.3,co[v]/.3)


def create_armature(arms, spine, head, imported):
    data = bpy.data.armatures.new('Lippi | deformation skeleton')
    rig = bpy.data.objects.new('LippiRig',data)
    bpy.context.collection.objects.link(rig)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    rig.show_in_front = True
    bpy.ops.object.mode_set(mode='EDIT')
    def bone(name,start,end,parent=None):
        b = data.edit_bones.new(name)
        b.head,b.tail = point(*start),point(*end)
        if parent:
            b.parent = data.edit_bones[parent]
            b.use_connect = (b.head-b.parent.tail).length < .0001
        return b
    bone('RigPelvis',(0,.176,-.227),(0,.300,-.25))
    bone('RigSpine',spine,(0,spine[1]+.17,spine[2]),'RigPelvis')
    bone('RigHead',head,(head[0],head[1]+.144,head[2]),'RigSpine')
    for side,suf in [(1,'L'),(-1,'R')]:
        shoulder,elbow,wrist,grip = [(side*x,y,z) for x,y,z in arms]
        bone(f'RigUpperArm{suf}',shoulder,elbow,'RigSpine')
        bone(f'RigForearm{suf}',elbow,wrist,f'RigUpperArm{suf}')
        bone(f'RigHand{suf}',wrist,grip,f'RigForearm{suf}')
        hip,knee,ankle = [cabin_point(p,imported) for p in [
            (side*.086,.188,-.224),(side*.124,.250,.194),(side*.117,.153,.642),
        ]]
        bone(f'RigThigh{suf}',hip,knee,'RigPelvis')
        bone(f'RigShin{suf}',knee,ankle,f'RigThigh{suf}')
        bone(f'RigFoot{suf}',ankle,cabin_point((side*.117,.156,.743),imported),f'RigShin{suf}')
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def bind(obj,rig,weights):
    for name,values in weights.items():
        group = obj.vertex_groups.new(name=name)
        # Quantized weights keep Blender's vertex-group write cost independent of vertex count.
        buckets = {}
        for index,value in values:
            if value:
                buckets.setdefault(round(value,3),[]).append(index)
        for weight,indices in buckets.items():
            group.add(indices,weight,'REPLACE')
    mod = obj.modifiers.new('Lippi skin','ARMATURE')
    mod.object = rig
    obj.parent = rig


def rigid(obj,rig,bone,mat=None):
    if mat:
        obj.data.materials.append(mat)
    bind(obj,rig,{bone:((v.index,1) for v in obj.data.vertices)})


def bone_weights(co,arms,imported):
    x,y,z = abs(co.x),co.z,-co.y
    side = 'L' if co.x>=0 else 'R'
    shoulder,elbow,wrist,grip = [point(*q) for q in arms]
    p = Vector((x,-z,y))
    upper_axis = (elbow-shoulder).normalized()
    lower_axis = (wrist-elbow).normalized()
    upper_extent = (p-shoulder).dot(upper_axis)
    elbow_plane = (p-elbow).dot((upper_axis+lower_axis).normalized())
    sleeve_weight = smooth(.119,.192,x)*smooth(-.061,.046,upper_extent)
    # Once the sleeve leaves the torso, weight it independently of the rear panels.
    sleeve_weight = max(sleeve_weight,
        smooth(-.156,-.054,z)*smooth(.108,.173,x)*smooth(.273,.379,y)) if imported else sleeve_weight
    sleeve_weight = max(sleeve_weight,smooth(elbow.y-.041,elbow.y-.006,y)
                        *smooth(-.042,.050,z)*smooth(.094,.156,x))
    sleeve_weight *= smooth(.259,.332,y)
    elbow_weight = smooth(-.057,.053,elbow_plane)
    leg = smooth(-.215,-.098,z)*(1-smooth(.211,.326,y))*(1-sleeve_weight)
    shin = smooth(.131,.280,z)
    torso = (1-smooth(.205,.340,y))*(1-leg-sleeve_weight)
    candidates = [
        ('RigPelvis',torso),('RigSpine',1-leg-sleeve_weight-torso),
        (f'RigUpperArm{side}',sleeve_weight*(1-elbow_weight)),(f'RigForearm{side}',sleeve_weight*elbow_weight),
        (f'RigThigh{side}',leg*(1-shin)),(f'RigShin{side}',leg*shin),
    ]
    ranked = sorted(candidates,key=lambda p:p[1],reverse=True)[:4]
    used = [(name,weight) for name,weight in ranked if weight>.002]
    total = sum(weight for _,weight in used)
    result=[]
    for name,weight in used:
        result.append((name,round(weight/total,3)))
    name,first = result[0]
    result[0] = (name,round(first+1-sum(weight for _,weight in result),3))
    return result


def project_back(suit,x,y,offset):
    hit,location,_,_ = suit.ray_cast(point(x,y,-.8),Vector((0,-1,0)),distance=1.2)
    return location+Vector((0,offset,0)) if hit else None


def project_front(suit,x,y,offset):
    hit,location,_,_ = suit.ray_cast(point(x,y,suit['panelFrontZ']),Vector((0,1,0)),distance=.5)
    return location-Vector((0,offset,0)) if hit else None


def front_panel(suit,rig,name,rows,mat,bone='RigSpine',offset=.0012):
    rows=[interpolate(rows,i/28) for i in range(29)]
    verts=[]
    for y,x,width in rows:
        for edge in (-1,1):
            p=project_front(suit,x+edge*width,y,offset)
            if p is None:
                raise ValueError(f'Could not project {name} on the jacket front')
            verts.append(tuple(p))
    faces=[(i*2,i*2+1,(i+1)*2+1,(i+1)*2) for i in range(len(rows)-1)]
    obj=mesh(name,verts,faces)
    edit=bmesh.new()
    edit.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(edit,faces=list(edit.faces))
    for face in edit.faces:
        face.smooth=True
    edit.to_mesh(obj.data)
    edit.free()
    obj.data.materials.append(mat)
    rigid(obj,rig,bone)
    return obj


def front_zipper(suit,rig,tape_mat,tooth_mat):
    rows=[(.321,0,.0053),(.355,0,.0050),(.405,0,.0047),
          (.458,0,.0047),(.510,0,.0050),(.556,0,.0055)]
    front_panel(suit,rig,'Graphite front zipper tape',rows,tape_mat,offset=.0014)
    verts=[]
    faces=[]
    for i in range(35):
        y=.325+i*.00655
        half_y=.00125
        start=len(verts)
        for h in (-half_y,half_y):
            for x in (-.0038,.0038):
                p=project_front(suit,x,y+h,.0025)
                if p is None:
                    raise ValueError('Could not project zipper teeth on the jacket front')
                verts.append(tuple(p))
        faces.append((start,start+1,start+3,start+2))
    teeth=mesh('Satin nickel zipper teeth',verts,faces)
    teeth.data.materials.append(tooth_mat)
    for polygon in teeth.data.polygons:
        polygon.use_smooth=True
    rigid(teeth,rig,'RigSpine')
    front_panel(suit,rig,'Zipper pull tab',[(.552,0,.003),(.567,0,.003),(.572,0,.002)],
                tooth_mat,offset=.0032)


def stitch_front(suit,name,points,radius):
    points=[p for x,y in points if (p:=project_front(suit,x,y,radius*.8)) is not None]
    if len(points)<2:
        raise ValueError(f'Could not project {name} on the jacket front')
    curve=bpy.data.curves.new(name,'CURVE')
    curve.dimensions='3D'
    curve.resolution_u=5
    curve.bevel_depth=radius
    curve.bevel_resolution=1
    spline=curve.splines.new('BEZIER')
    spline.bezier_points.add(len(points)-1)
    for knot,co in zip(spline.bezier_points,points):
        knot.co=co
        knot.handle_left_type=knot.handle_right_type='AUTO'
    obj=bpy.data.objects.new(name,curve)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.convert(target='MESH')
    return bpy.context.object


def stitch(suit,name,points,radius):
    points = [p for x,y in points if (p:=project_back(suit,x,y,radius*.63)) is not None]
    if len(points)<2:
        raise ValueError(f'Could not project {name} on the jacket')
    curve = bpy.data.curves.new(name,'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 5
    curve.bevel_depth = radius
    curve.bevel_resolution = 1
    spline = curve.splines.new('BEZIER')
    spline.bezier_points.add(len(points)-1)
    for knot,co in zip(spline.bezier_points,points):
        knot.co = co
        knot.handle_left_type = knot.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name,curve)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    return bpy.context.object


def wrap_letters(suit,rig,letters):
    for obj,offset in letters:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_world = Matrix.Identity(4)
        source = [world @ vertex.co for vertex in obj.data.vertices]
        contacts = None
        for drop in (i*.002 for i in range(41)):
            projected = [project_back(suit,co.x,co.z-drop,offset) for co in source]
            if all(point is not None for point in projected):
                contacts = projected
                break
        if contacts is None:
            raise ValueError(f'{obj.name} does not fit the jacket back')
        for vertex,contact in zip(obj.data.vertices,contacts):
            vertex.co = contact
        obj.data.update()
        rigid(obj,rig,'RigSpine')


def attach_helmet(rig,helmet):
    bpy.context.view_layer.update()
    world = helmet.matrix_world.copy()
    helmet.parent = rig
    helmet.parent_type = 'BONE'
    helmet.parent_bone = 'RigHead'
    helmet.matrix_world = world


def build_driver(textures, imported, spine, head, helmet, letters):
    arms = joints(imported)
    rig = create_armature(arms,spine,head,imported)
    suit_parts = [fit_cabin(jacket(),imported)]
    for side in (-1,1):
        suit_parts.extend([sleeve(arms,side),fit_cabin(pants(side),imported)])
    suit = merge_skin(suit_parts,'Lippi | continuous seated race suit',.0036)
    suit['panelFrontZ'] = -.085 if imported else .060
    textile_uv(suit)
    suit.data.materials.append(fabric_material(textures))
    leather = material('Lippi | charcoal glove leather',(.028,.034,.047),.74)
    sole = material('Lippi | vulcanized rubber',(.010,.012,.016),.93)
    piping = material('Lippi | ochre flatlock seams',(.375,.200,.024),.90)
    graphite = material('Lippi | graphite stretch gusset and cuff',(.030,.039,.048),.88)
    collar=loft('Graphite stand collar',lambda t,a:
        point((.068+.003*sin(pi*t))*sin(a),.613+.018*t-.004*cos(a),-.245-.058*cos(a)),24,48)
    rigid(fit_cabin(collar,imported),rig,'RigSpine',graphite)
    zipper_metal = material('Lippi | satin nickel zipper',(.34,.37,.40),.38)
    zipper_metal.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value=.48
    front_zipper(suit,rig,graphite,zipper_metal)
    for side,suf in [(1,'L'),(-1,'R')]:
        rigid(gloves(arms,side),rig,f'RigHand{suf}',leather)
        wrist,hand=(Vector(v) for v in arms[2:])
        cuff=tube_shape('Low-profile graphite glove cuff',mirrored([
            (*wrist.lerp(hand,-.10),.028,.026),(*wrist,.029,.026),
            (*wrist.lerp(hand,.10),.027,.024),
        ],side),0,19,30)
        rigid(cuff,rig,f'RigHand{suf}',graphite)
        shoe,undersole = boot(side)
        rigid(fit_cabin(shoe,imported),rig,f'RigFoot{suf}',leather)
        rigid(fit_cabin(undersole,imported),rig,f'RigFoot{suf}',sole)
        gusset=front_panel(suit,rig,'Graphite stretch side gusset',[
            (.309,side*.119,.0040),(.353,side*.128,.0050),
            (.407,side*.137,.0055),(.461,side*.145,.0055),
            (.508,side*.151,.0042),
        ],graphite,offset=.0018)
        seam=stitch_front(suit,'Front shoulder panel topstitch',[
            (side*.150,.557),(side*.143,.535),(side*.132,.510),(side*.120,.486),
        ],.00115)
        rigid(seam,rig,'RigSpine',piping)
        seam = stitch(suit,'Jacket shoulder flatlock',[(side*x,y) for x,y in [
            (.045,.580),(.081,.572),(.117,.559),(.142,.546),(.166,.525),
        ]],.00135)
        rigid(seam,rig,'RigSpine',piping)
        seam = stitch(suit,'Jacket side flatlock',[(side*x,y) for x,y in [
            (.103,.258),(.112,.314),(.123,.364),(.130,.415),(.143,.477),
        ]],.0012)
        rigid(seam,rig,'RigSpine',piping)
    wrap_letters(suit,rig,letters)
    weights={}
    for v in suit.data.vertices:
        for name,weight in bone_weights(v.co,arms,imported):
            weights.setdefault(name,[]).append((v.index,weight))
    bind(suit,rig,weights)
    attach_helmet(rig,helmet)
    return rig


def add_editing_controls(rig):
    """Add active, neutral-pose-matched IK controls to the editable Blender rig."""
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for side in ('L','R'):
        arm = rig.data.edit_bones[f'RigUpperArm{side}']
        wrist = rig.data.edit_bones[f'RigHand{side}']
        reach = wrist.head-arm.head
        along = max(0,min(1,(arm.tail-arm.head).dot(reach)/reach.length_squared))
        bend = arm.tail-(arm.head+reach*along)
        if bend.length < 1e-5:
            bend = Vector((0,1,0))
        pole_origin = arm.tail+bend.normalized()*max(.14,(arm.tail-arm.head).length*.8)
        for name,origin in [(f'Grip.{side}',wrist.head),(f'Elbow guide.{side}',pole_origin)]:
            control = rig.data.edit_bones.new(name)
            control.head=origin
            if name.startswith('Grip.'):
                control.tail=wrist.tail
                control.roll=wrist.roll
            else:
                control.tail=origin+Vector((0,0,.065))
            control.use_deform=False
    bpy.ops.object.mode_set(mode='POSE')
    wheel=bpy.data.objects.get('KartSteering') or bpy.data.objects.get('ImportedSteering')
    for side in ('L','R'):
        if wheel:
            grip=rig.pose.bones[f'Grip.{side}'].constraints.new('CHILD_OF')
            grip.name='Follow the steering rim'
            grip.target=wheel
            grip.inverse_matrix=wheel.matrix_world.inverted()
        hand=rig.pose.bones[f'RigHand{side}'].constraints.new('COPY_ROTATION')
        hand.name='Keep the glove parallel to the rim'
        hand.target=rig
        hand.subtarget=f'Grip.{side}'
        forearm=rig.pose.bones[f'RigForearm{side}']
        solver=forearm.constraints.new('IK')
        solver.name='Seat-fit wrist target'
        solver.target=rig
        solver.subtarget=f'Grip.{side}'
        solver.chain_count=2
        solver.use_stretch=False
        solver.pole_target=rig
        solver.pole_subtarget=f'Elbow guide.{side}'
        solver.influence=1
        rest=forearm.bone.head_local.copy()
        def distance(angle):
            solver.pole_angle=angle
            bpy.context.view_layer.update()
            return (forearm.head-rest).length_squared
        best=min((i*pi/18 for i in range(-18,18)),key=distance)
        step=pi/18
        for _ in range(5):
            step/=3
            best=min((max(-pi,min(pi,best+j*step)) for j in range(-2,3)),key=distance)
        solver.pole_angle=best
    bpy.ops.object.mode_set(mode='OBJECT')
