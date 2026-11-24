"""Fit 3dUVpro's standing rally-driver scan to the imported kart."""
import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from fit_go_kart import STEERING_AXIS, STEERING_CENTER


def smooth(edge1, edge2, value):
    t = np.clip((value-edge1)/(edge2-edge1),0,1)
    return t*t*(3-2*t)


def blend(first, second, weight):
    return first + (second-first)*weight[:,None]


def frame(start, end):
    axis = end-start
    length = np.linalg.norm(axis)
    axis /= length
    lateral = np.array((1.,0.,0.)) - axis*axis[0]
    lateral /= np.linalg.norm(lateral)
    return np.array((lateral,np.cross(axis,lateral),axis)),length


def retarget(points, rest_start, rest_end, start, end, width):
    basis,rest_length = frame(rest_start,rest_end)
    posed,length = frame(start,end)
    local = (points-rest_start) @ basis.T
    local *= (width,width,length/rest_length)
    return start + local @ posed


def seat_driver(rest):
    x,height,forward = rest.T
    side = np.where(x<0,-1,1)
    p = np.column_stack((abs(x),height,forward))
    suit = np.column_stack((x*.82,.226+.579*height,-.255-.081*height+.68*forward))

    # Shoulder, elbow, cuff and fingers are measured on the scan in its rest pose.
    rest_arm = np.array([
        (.204,.575,-.033),(.317,.305,-.096),(.389,.047,-.038),(.387,-.098,-.010),
    ])
    seated_arm = np.array([
        (.170,.549,-.253),(.237,.414,-.082),(.159,.403,.149),(.132,.408,.194),
    ])
    upper,forearm,glove = [
        retarget(p,*rest_arm[i:i+2],*seated_arm[i:i+2],width)
        for i,width in enumerate((.80,.70,.69))
    ]
    arm = blend(upper,forearm,1-smooth(.245,.385,height))
    arm = blend(arm,glove,1-smooth(.011,.078,height))
    arm[:,0] *= side
    # Below the armpit the scan has a gap between the torso and the sleeve.
    shoulder_edge = np.interp(height,(0,.17,.25,.30,.35,.44,.55,.67),
                              (.276,.252,.232,.215,.211,.202,.176,.181))
    width = .018+.074*smooth(.296,.43,height)
    arm_weight = smooth(shoulder_edge,shoulder_edge+width,abs(x))
    arm_weight *= 1-smooth(.572,.663,height)
    fold = smooth(.305,.366,height)*(1-smooth(.417,.505,height))*(1-smooth(.244,.301,abs(x)))
    arm[:,1] += .044*fold
    arm[:,2] -= .070*fold

    rest_leg = np.array([(.133,-.011,-.030),(.177,-.413,-.040),(.192,-.842,-.058)])
    seated_leg = np.array([(.114,.193,-.234),(.123,.254,.218),(.115,.150,.638)])
    thigh,shin = [
        retarget(p,*rest_leg[i:i+2],*seated_leg[i:i+2],width)
        for i,width in enumerate((.76,.72))
    ]
    boots = np.column_stack((
        .116+(abs(x)-.192)*.70,
        .158+(height+.842)*.36,
        .642+(forward+.058)*.74,
    ))
    leg = blend(thigh,shin,1-smooth(-.505,-.330,height))
    leg = blend(leg,boots,1-smooth(-.887,-.785,height))
    leg[:,0] *= side
    body = blend(suit,leg,1-smooth(-.282,-.030,height))
    posed = blend(body,arm,arm_weight)
    steering = arm_weight * (1-smooth(.059,.555,height))
    return posed,steering,arm_weight


def world_coords(p):
    return np.ascontiguousarray(p[:,(0,2,1)] * (1,-1,1),dtype=np.float32)


def relax_underarm(data, points, arm_weight):
    edges = np.empty((len(data.edges),2),dtype=np.int32)
    data.edges.foreach_get('vertices',edges.ravel())
    destinations = np.concatenate((edges[:,0],edges[:,1]))
    sources = np.concatenate((edges[:,1],edges[:,0]))
    count = np.maximum(1,np.bincount(destinations,minlength=len(points)))
    influence = .64*4*arm_weight*(1-arm_weight)
    for _ in range(10):
        mean = np.column_stack([
            np.bincount(destinations,points[sources,i],minlength=len(points))/count for i in range(3)
        ])
        points = blend(points,mean,influence)
    return points


def remove_scan_fragments(edit):
    remaining = set(edit.verts)
    debris = []
    while remaining:
        component = [remaining.pop()]
        for vertex in component:
            for edge in vertex.link_edges:
                neighbor = edge.other_vert(vertex)
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    component.append(neighbor)
        if len(component)<80:
            debris.extend(component)
    bmesh.ops.delete(edit,geom=debris,context='VERTS')


def fit_driver(path, torso, arms, fabric, accessories):
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = list(bpy.context.selected_objects)
    meshes = [obj for obj in imported if obj.type=='MESH']
    if not meshes:
        raise ValueError('The supplied driver has no mesh')
    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
        obj.data.transform(world)
    for obj in imported:
        if obj.type=='EMPTY':
            bpy.data.objects.remove(obj,do_unlink=True)
    driver = meshes[0]
    bpy.context.view_layer.objects.active = driver
    bpy.ops.object.join()
    driver.name = 'RallyDriverScan'
    data = driver.data
    data.materials.clear()
    data.materials.append(fabric)
    data.materials.append(accessories)

    edit = bmesh.new()
    edit.from_mesh(data)
    bmesh.ops.remove_doubles(edit,verts=list(edit.verts),dist=.000015)
    # Cut under the scanned helmet so the separate SC04 fits over the collar.
    cut = bmesh.ops.bisect_plane(
        edit,geom=list(edit.verts)+list(edit.edges)+list(edit.faces),dist=.00001,
        plane_co=(0,0,.706),plane_no=(0,-.48,1),clear_outer=True,
    )
    remove_scan_fragments(edit)
    cut_edges = [e for e in cut['geom_cut'] if isinstance(e,bmesh.types.BMEdge) and e.is_valid and e.is_boundary]
    bmesh.ops.holes_fill(edit,edges=cut_edges)
    bmesh.ops.triangulate(edit,faces=[face for face in edit.faces if len(face.verts)>3])
    for face in edit.faces:
        face.smooth = True
        x,y,z = face.calc_center_median()
        is_glove = z<.045 and abs(x)>.297
        is_boot = z<-.842
        face.material_index = int(is_glove or is_boot)
    edit.to_mesh(data)
    edit.free()
    data.update()
    points = np.empty((len(data.vertices),3),dtype=np.float32)
    data.vertices.foreach_get('co',points.ravel())
    rest = points[:,(0,2,1)] * (1,1,-1)
    posed,steering,arm_weight = seat_driver(rest)
    posed = relax_underarm(data,posed,arm_weight)
    data.vertices.foreach_set('co',world_coords(posed).ravel())
    data.update()

    driver.shape_key_add(name='Basis')
    center = np.array(STEERING_CENTER)
    axis = np.array(STEERING_AXIS)
    offset = posed-center
    for name,angle in (('SteerNegative',-.54),('SteerPositive',.54)):
        theta = (steering*angle)[:,None]
        c,s = np.cos(theta),np.sin(theta)
        rotated = center+offset*c+np.cross(axis,offset)*s+np.outer(offset@axis,axis)*(1-c)
        key = driver.shape_key_add(name=name)
        key.data.foreach_set('co',world_coords(rotated).ravel())

    # Keep the scan, name and helmet under the same driver attitude pivot.
    arms.parent = torso
    arms.matrix_parent_inverse = torso.matrix_world.inverted()
    driver.parent = arms
    driver.matrix_parent_inverse = arms.matrix_world.inverted()
    return driver


def wrap_name(driver, letters):
    coords = [v.co for v in driver.data.vertices]
    faces = [tuple(p.vertices) for p in driver.data.polygons]
    surface = BVHTree.FromPolygons(coords,faces,all_triangles=True)
    for word,offset in letters:
        matrix = word.matrix_world.copy()
        inverse = matrix.inverted()
        for vertex in word.data.vertices:
            x,_,z = matrix @ vertex.co
            hit,normal,index,distance = surface.ray_cast(Vector((x,.7,z)),Vector((0,-1,0)),1.0)
            if hit is None:
                raise ValueError('The back embroidery extends beyond the posed suit')
            vertex.co = inverse @ (hit + Vector((0,offset,0)))
        word.data.update()
