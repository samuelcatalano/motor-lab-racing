"""Original road wheels and steering assembly laid out in the same coordinates as the kart."""
from math import cos,pi,sin
import bpy
from mathutils import Vector


def coordinates(x,y,z):
    return Vector((x,-z,y))


def wheel_mesh(name, profile, material, parent, segments=72, contact=False):
    vertices=[]
    for x,r in profile:
        for i in range(segments):
            angle=2*pi*i/segments
            y=r*cos(angle)
            if contact:
                y=max(y,-.140)
            vertices.append(coordinates(x,y,r*sin(angle)))
    faces=[(i*segments+j,i*segments+(j+1)%segments,(i+1)*segments+(j+1)%segments,(i+1)*segments+j)
           for i in range(len(profile)-1) for j in range(segments)]
    data=bpy.data.meshes.new(name)
    data.from_pydata(vertices,[],faces)
    data.update()
    obj=bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(obj)
    obj.parent=parent
    obj.data.materials.append(material)
    uv=data.uv_layers.new(name='Mould circumference')
    along=[0.0]
    for a,b in zip(profile,profile[1:]):
        along.append(along[-1]+((a[0]-b[0])**2+(a[1]-b[1])**2)**.5)
    circumference=2*pi*max(r for x,r in profile)
    for index,face in enumerate(data.polygons):
        face.use_smooth=True
        i,j=divmod(index,segments)
        for loop,(ring,step) in zip(face.loop_indices,[(i,j),(i,j+1),(i+1,j+1),(i+1,j)]):
            uv.data[loop].uv=(step/segments*circumference/.22,along[ring]/.22)
    return obj


def blank(name,position,parent=None):
    obj=bpy.data.objects.new(name,None)
    bpy.context.collection.objects.link(obj)
    obj.parent=parent
    obj.location=coordinates(*position)
    return obj


def wheel_pieces(name,radius,width,position,side,materials):
    pivot=blank(name,position)
    half=width/2
    # Independent rounded tread, sidewall bead and deep drawn rim.
    profile=[
        (-half+.005,.071),(-half+.001,.083),(-half,radius*.75),
        (-half+.003,radius*.88),(-half+.010,radius*.961),
        (-half+.023,radius-.001),(-half+.035,radius),
        (half-.035,radius),(half-.023,radius-.001),(half-.010,radius*.961),
        (half-.003,radius*.88),(half,radius*.75),(half-.001,.083),(half-.005,.071),
    ]
    wheel_mesh('Competition slick',profile,materials['rubber'],pivot,contact=True)
    for sign in (-1,1):
        lip=[
            (sign*(half-.028),.025),(sign*(half-.022),.034),
            (sign*(half-.023),.048),(sign*(half-.016),.063),
            (sign*(half-.004),.072),(sign*(half-.001),.075),
            (sign*(half+.001),.077),(sign*(half+.001),.079),
            (sign*(half-.008),.081),(sign*(half-.027),.077),
        ]
        if sign<0:
            lip.reverse()
        wheel_mesh('Deep dish magnesium rim',lip,materials['rim'],pivot,48)
    outer=side*(half-.020)
    for index in range(3):
        angle=index*2*pi/3
        bolt=blank('Rim fixation', (outer,.041*cos(angle),.041*sin(angle)), pivot)
        wheel_mesh('Zinc wheel lug',[(side*-.002,0),(side*-.002,.006),
                  (side*.006,.006),(side*.006,.0024)],materials['hardware'],bolt,6)
    hub=blank('Sealed hub cap',(outer,0,0),pivot)
    wheel_mesh('Turned hub cap',[(side*-.009,0),(side*-.009,.027),(side*-.006,.029),
              (side*.004,.028),(side*.007,.022),(side*.007,0)],materials['metal'],hub,40)


def steering_wheel(env):
    center=(0,.491,.244)
    wheel=blank('KartSteering',center)
    angle=.65
    axis=(0,-sin(angle),cos(angle))
    wheel['steeringAxis']=list(axis)

    def ring_point(a):
        x=.117*cos(a)
        radial=max(-.093,.119*sin(a))
        return (x,radial*cos(angle),radial*sin(angle))

    rim=env['tube']('Soft touch steering rim',[ring_point(i*2*pi/40) for i in range(41)],
                    .014,env['wheel_grip_material'],resolution=3,radial=3)
    rim.parent=wheel
    for a in (-.21,pi+.21):
        grip=env['tube']('Textured ergonomic grip',[ring_point(a+i*.027) for i in range(-17,18)],
                         .016,env['wheel_grip_material'],resolution=2,radial=3)
        grip.parent=wheel

    def spoke(s):
        p=[(.020,-.012),(.083,.019),(.113,.010),(.110,-.012),(.043,-.029),(.019,-.031)]
        vertices=[(x*s,y*cos(angle)+depth*axis[1],y*sin(angle)+depth*axis[2])
                  for depth in (-.005,.005) for x,y in p]
        ring=len(p)
        faces=[tuple(range(ring-1,-1,-1)),tuple(range(ring,2*ring))]
        faces.extend((i,(i+1)%ring,(i+1)%ring+ring,i+ring) for i in range(ring))
        obj=env['mesh']('Bevelled steering spoke',vertices,faces,env['steel'],False)
        env['bevel'](obj,.002,2)
        obj.parent=wheel

    spoke(-1)
    spoke(1)
    cap=env['cylinder']('Steering hub',tuple(q*-.023 for q in axis),
                        tuple(q*.009 for q in axis),.041,env['cast'],28)
    cap.parent=wheel
    for i in range(5):
        a=2*pi*i/5
        fixing=(.029*cos(a),.029*sin(a)*cos(angle),.029*sin(a)*sin(angle))
        start=tuple(p+q*.008 for p,q in zip(fixing,axis))
        end=tuple(p+q*.013 for p,q in zip(fixing,axis))
        screw=env['cylinder']('Steering hub fastener',start,end,.0043,env['hardware'],8)
        screw.parent=wheel
    return wheel


def add_running_gear(env):
    mats={'rubber':env['slick_material'],'rim':env['rim_material'],
          'hardware':env['hardware'],'metal':env['metal']}
    for side,key in [(1,'Left'),(-1,'Right')]:
        wheel_pieces('Front'+key+'Wheel',.139,.113,(side*.54,.139,.56),side,mats)
        wheel_pieces('Rear'+key+'Wheel',.143,.163,(side*.54,.139,-.57),side,mats)
    steering_wheel(env)
