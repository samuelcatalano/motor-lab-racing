"""Build the Vale do Cedro kart shell, seated driver and chassis as one GLB.

Run from the project root: blender -b -t 4 -P tools/build-kart.py
To fit a supplied go_kart.glb locally, append -- /path/to/go_kart.glb.
Add the path to racing_helmet_-_sc04tm.glb after the kart to fit that helmet.
Add rally_driver_character.glb as the third file to fit the scanned pilot.
Model coordinates match Three.js in metres: Y up, +Z forward.
"""
from argparse import ArgumentParser
from collections import defaultdict
from math import cos, exp, hypot, pi, sin
from pathlib import Path
from random import Random
import sys

import bmesh
import bpy
from mathutils import Vector

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[1]
args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
parser = ArgumentParser()
parser.add_argument('assets',nargs='*')
parser.add_argument('--blend',type=Path,help='Save an editable authored rig scene')
options = parser.parse_args(args)
args = options.assets
if len(args) > 3:
    raise ValueError('Expected up to three files: go_kart.glb, SC04 helmet, and rally driver')
SOURCE = Path(args[0]).expanduser().resolve(strict=True) if args else None
HELMET_SOURCE = Path(args[1]).expanduser().resolve(strict=True) if len(args)>1 else None
DRIVER_SOURCE = Path(args[2]).expanduser().resolve(strict=True) if len(args)>2 else None
OUTPUT = ROOT / ('.local-assets/go-kart-fitted.glb' if SOURCE else 'public/assets/kart/kart-body.glb')
PARTS = defaultdict(list)
PART_GROUP = "Kart"
TEXTURES = SCRIPT.parent / "kart-textures"
sys.path.insert(0, str(SCRIPT.parent))
from author_driver import add_editing_controls, build_driver
from competition_materials import apply_competition_materials
from kart_running_gear import add_running_gear
if SOURCE:
    from fit_go_kart import prepare_helmet, prepare_kart
if DRIVER_SOURCE:
    from fit_rally_driver import fit_driver, wrap_name


def vector(point):
    x, y, z = point
    return Vector((x, -z, y))


def color(srgb):
    rgb = [(srgb >> shift & 255) / 255 for shift in (16, 8, 0)]
    return tuple(((v + .055) / 1.055) ** 2.4 if v > .04045 else v / 12.92
                 for v in rgb) + (1,)


def material(name, srgb, roughness, metal=0, coat=0):
    item = bpy.data.materials.new(name)
    item.diffuse_color = color(srgb)
    item.use_nodes = True
    shader = item.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = item.diffuse_color
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metal
    shader.inputs['Coat Weight'].default_value = coat
    return item


metal = material('Brushed aluminium', 0xa8afb1, .32, .78)
cast = material('Cast aluminium', 0x6a7578, .47, .51)
steel = material('Blackened steel', 0x34383b, .56, .55)
gold = material('Anodised fittings', 0xb6975e, .38, .72)
hardware = material('Zinc fasteners', 0xb8bed0, .38, .67)
tubing = material('Painted frame', 0x256582, .36, .24, .26)
paint = material('Teal livery', 0x134867, .32, .08, .43)
accent = material('Amber livery', 0xffbc28, .33, .06, .38)
ivory = material('Warm ivory livery', 0xeadfb7, .42)
black = material('Moulded black plastic', 0x181d20, .49, .04)
seat = material('Fibreglass seat', 0x353638, .52, .08, .16)
seat_pad = material('Seat padding', 0x292c2c, .92)
mechanical_black = material('Injection moulded impact guard', 0x25282b, .59)
heat_tint = material('Heat tinted stainless steel', 0x756050, .45, .68)
rubber = material('Hose and edge rubber', 0x1c2022, .91)
tank = material('Fuel tank', 0xb6a778, .68)
suit = material('Sunflower race fabric', 0xffd84a, .88)
ink = material('Rear number ink', 0x232c2b, .9)
white_ink = material('LEANDRO LIPPI white embroidery', 0xffffff, .84)
letter_shadow = material('Fine border around race embroidery', 0x593e22, .92)
navy = material('Suit gussets and gloves', 0x26333f, .83)
helmet = material('Amaranth helmet shell #9F2B68', 0x9f2b68, .35, .04, .31)
helmet_trim = material('Helmet stripe', 0xe5e2d9, .36, .04, .33)
visor = material('Smoke visor', 0x172634, .13, .09, .67)
helmet_graphite = material('Helmet graphite graphics',0x20242c,.29,.06,.32)
rim_material = material('Dark magnesium rim',0x5c6269,.36,.72)
wheel_grip_material = material('Microtextured steering grip',0x202326,.77)
slick_material = material('Competition slick rubber',0x222222,.84)


def finish(obj, mat, smooth=False):
    obj.data.materials.append(mat)
    if smooth:
        for face in obj.data.polygons:
            face.use_smooth = True
    PARTS[(PART_GROUP, mat.name)].append(obj)
    return obj


def mesh(name, vertices, faces, mat, smooth=True):
    geometry = bpy.data.meshes.new(name)
    geometry.from_pydata([vector(v) for v in vertices], [], faces)
    geometry.update()
    obj = bpy.data.objects.new(name, geometry)
    bpy.context.collection.objects.link(obj)
    return finish(obj, mat, smooth)


def bevel(obj, width, segments=2):
    mod = obj.modifiers.new('Rounded edges', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod = obj.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    mod.keep_sharp = True
    return obj


def box(name, center, size, mat, radius=.008):
    bpy.ops.mesh.primitive_cube_add(size=1, location=vector(center))
    obj = bpy.context.object
    obj.name = name
    obj.scale = vector(size)
    obj.scale.y = abs(obj.scale.y)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if radius:
        bevel(obj, radius)
    return finish(obj, mat)


def sphere(name, center, radii, mat, rings=16, segments=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=vector(center))
    obj = bpy.context.object
    obj.name = name
    obj.scale = tuple(abs(c) for c in vector(radii))
    return finish(obj, mat, True)


def tube(name, points, radius, mat, *, poly=False, resolution=5, radial=3):
    curve = bpy.data.curves.new(name, type='CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = resolution
    curve.bevel_depth = radius
    curve.bevel_resolution = radial
    curve.use_fill_caps = True
    if poly:
        path = curve.splines.new('POLY')
        path.points.add(len(points) - 1)
        for p, point in zip(path.points, points):
            p.co = (*vector(point), 1)
    else:
        path = curve.splines.new('BEZIER')
        path.bezier_points.add(len(points) - 1)
        for p, point in zip(path.bezier_points, points):
            p.co = vector(point)
            p.handle_left_type = p.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    return finish(bpy.context.object, mat, True)


def cylinder(name, start, end, radius, mat, vertices=16, tip_radius=None):
    a, b = vector(start), vector(end)
    d = b - a
    args = dict(vertices=vertices, depth=d.length, location=(a + b) / 2)
    if tip_radius is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=radius, **args)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=radius, radius2=tip_radius, **args)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    finish(obj, mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = len(polygon.vertices) == 4
    return obj


def loft(name, rings, steps, section, mat):
    verts = [section(i, 2 * pi * k / steps) for i in range(rings) for k in range(steps)]
    faces = [(i*steps+k, i*steps+(k+1)%steps, (i+1)*steps+(k+1)%steps, (i+1)*steps+k)
             for i in range(rings-1) for k in range(steps)]
    faces += [tuple(range(steps-1, -1, -1)), tuple(range((rings-1)*steps, rings*steps))]
    return mesh(name, verts, faces, mat)


def profile_housing(name, sections, mat, steps=28):
    # Each section gives Z, Y centre, half width and half height.
    def section(i, theta):
        z, y, width, height = sections[i]
        return (width * cos(theta), y + height * sin(theta), z)
    return loft(name, len(sections), steps, section, mat)


def hex_bolt(name, center, radius=.008, axis='y'):
    p = tuple(center)
    d = ['x', 'y', 'z'].index(axis)
    a, b = list(p), list(p)
    a[d] -= .003
    b[d] += .003
    cylinder(name, a, b, radius, hardware, 6)


def polygon_plate(name, outline, y, z, mat, thickness):
    obj = mesh(name, [(x,y+dy,z) for x,dy in outline],
               [tuple(reversed(range(len(outline))))], mat, False)
    body = obj.modifiers.new('Moulded thickness', 'SOLIDIFY')
    body.thickness = thickness
    bevel(obj, thickness * .35, 3)
    return obj


def profile(rows, position):
    # Cubic interpolation keeps the surface tangent continuous at each section.
    for i,(a,b) in enumerate(zip(rows,rows[1:])):
        if position <= b[0] + 1e-8:
            previous, later = rows[max(0,i-1)], rows[min(len(rows)-1,i+2)]
            t = min(1,max(0,(position-a[0])/(b[0]-a[0])))
            t2,t3 = t*t,t*t*t
            width = b[0]-a[0]
            return tuple((2*t3-3*t2+1)*a[k] + (-2*t3+3*t2)*b[k]
                + (t3-2*t2+t)*width*(b[k]-previous[k])/(b[0]-previous[0])
                + (t3-t2)*width*(later[k]-a[k])/(later[0]-a[0])
                for k in range(1,len(a)))
    raise ValueError('Coordinate outside profile')

# Welded frame and its visible diagonal bracing.
for side in (-1, 1):
    tube('Main frame rail', [(side*x, y, z) for x, y, z in [
        (.28,.145,-.7),(.40,.151,-.54),(.415,.159,-.26),(.39,.155,.16),
        (.37,.158,.51),(.25,.169,.735),(.11,.168,.78)]], .018, tubing)
    tube('Side pod mounting hoop', [(side*x, y, z) for x, y, z in [
        (.38,.16,-.34),(.54,.169,-.32),(.56,.166,.20),(.445,.17,.36),(.36,.164,.33)]], .014, metal)
    tube('Triangular seat support', [(side*x, y, z) for x, y, z in [
        (.18,.247,-.31),(.36,.155,-.51),(.3,.157,-.003),(.18,.247,-.31)]], .011, metal, poly=True)
    cylinder('Rear bumper extension', (side*.358,.146,-.49), (side*.51,.157,-.77), .014, metal)
    cylinder('Toe link', (side*.12,.188,.42), (side*.5,.146,.562), .007, hardware)
    cylinder('Brake line', (side*.32,.169,-.48), (side*.321,.169,.42), .0035, rubber)
for z, width in [(-.66,.76),(-.4,.78),(.075,.77),(.545,.72)]:
    cylinder('Crossmember', (-width/2,.149,z), (width/2,.149,z), .016, tubing)
box('Pedal floor pan', (0,.127,.395), (.543,.014,.56), steel, .013)
box('Seat floor pan', (0,.127,-.157), (.423,.014,.48), steel, .007)
tube('Steering column', [(0,.174,.48),(0,.31,.343),(0,.485,.246)], .013, metal)

# Rear axle, sprocket, drilled disc and caliper.
cylinder('Live rear axle', (-.573,.139,-.57), (.573,.139,-.57), .019, metal, 24)
for side in (-1, 1):
    for x, r, w, m in [(.428,.038,.033,cast),(.474,.042,.019,gold),(.511,.027,.042,hardware)]:
        cylinder('Axle bearing and lock collar', (side*(x-w/2),.139,-.57),
                 (side*(x+w/2),.139,-.57),r,m)
cylinder('Ventilated brake rotor', (-.288,.139,-.57), (-.273,.139,-.57), .095, metal, 36)
cylinder('Brake rotor hub', (-.296,.139,-.57), (-.269,.139,-.57), .047, steel)
box('Caliper', (-.275,.215,-.52), (.054,.08,.045), accent, .008)
for k in range(15):
    angle = k*2*pi/15
    y,z = .139+.073*cos(angle),-.57+.073*sin(angle)
    cylinder('Rotor drill recess', (-.290,y,z), (-.2885,y,z), .0036, steel, 8)
cylinder('Drive sprocket', (.269,.139,-.57), (.291,.139,-.57), .103, steel, 32)
for k in range(28):
    angle = k*2*pi/28
    y,z=.139+.101*cos(angle),-.57+.101*sin(angle)
    cylinder('Sprocket tooth', (.266,y,z), (.294,y,z), .005, metal, 6)
# Chain drawn as twin roller rows rather than a solid opaque belt.
chain_track = [
    (.062,-.603),(.044,-.547),(.081,-.49),(.21,-.41),(.285,-.37),
    (.331,-.393),(.319,-.445),(.224,-.533),(.128,-.641),(.081,-.653),(.062,-.603),
]
for x in (.272, .289):
    tube('Chain side links', [(x,y,z) for y,z in chain_track], .006, steel)
for a,b in zip(chain_track,chain_track[1:]):
    count=max(1,round(hypot(a[0]-b[0],a[1]-b[1])/.024))
    for k in range(count):
        t=k/count
        y,z=a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t
        cylinder('Chain roller', (.267,y,z), (.294,y,z), .0048, hardware, 6)

# Engine, radiator and their plumbing remain visible around the lower seat.
box('Engine mounting plate', (.351,.156,-.388), (.226,.026,.258), metal, .008)
box('Engine crankcase', (.342,.221,-.39), (.177,.154,.216), cast, .020)
cylinder('Cast starter flange', (.344,.231,-.48), (.344,.231,-.507), .055, cast, 24)
cylinder('Starter motor', (.344,.231,-.505), (.344,.231,-.554), .041, black, 24)
cylinder('Pressed starter cap', (.344,.231,-.554), (.344,.231,-.558), .035, steel, 24)
for j in range(5):
    box('Cast reinforcement rib', (.432,.242,-.457+j*.028), (.016,.048,.008), cast, .003)
for x in (.312,.376):
    hex_bolt('Starter flange bolt', (x,.265,-.508), .006, 'z')
for j in range(7):
    size=.155 + .009*sin(j*.45)
    box('Engine cooling fin', (.356,.285+j*.017,-.397), (.169,.006,size), cast, .002)
    box('Machined fin edge', (.356,.285+j*.017,-.399-size/2), (.149,.003,.003), metal, .001)
box('Cylinder head', (.353,.409,-.396), (.151,.034,.133), cast, .009)
for x in (.303,.402):
    for z in (-.439,-.355):
        hex_bolt('Cylinder head bolt',(x,.428,z))
cylinder('Spark plug', (.355,.41,-.391), (.355,.456,-.391), .009, ivory, 10)
tube('Ignition lead', [(.355,.46,-.391),(.383,.466,-.418),(.424,.437,-.491),(.423,.318,-.521)], .006, rubber)
box('Radiator surround', (-.338,.296,-.294), (.181,.201,.065), metal, .011)
box('Radiator top tank', (-.338,.390,-.294), (.18,.036,.073), metal, .012)
box('Radiator lower tank', (-.338,.2,-.293), (.174,.034,.069), cast, .008)
box('Recessed radiator core', (-.338,.294,-.33), (.151,.155,.013), steel, .002)
for k in range(15):
    box('Radiator vertical tube',(-.405+k*.0095,.294,-.339),(.0014,.149,.002),cast,.0004)
for k in range(32):
    box('Radiator folded cooling fin',(-.338,.221+k*.0047,-.338),(.143,.0009,.002),cast,0)
for x in (-.411,-.264):
    cylinder('Radiator mounting stay', (x,.209,-.313),(x*.98,.163,-.48),.009,metal)
    hex_bolt('Radiator frame screw', (x,.377,-.333), .006, 'z')
cylinder('Radiator filler neck',(-.32,.413,-.28),(-.32,.431,-.28),.023,cast,12)
cylinder('Radiator cap',(-.32,.43,-.28),(-.32,.439,-.28),.026,hardware,12)
tube('Coolant return hose', [(-.325,.205,-.263),(-.256,.202,-.294),(-.184,.185,-.36),(.175,.185,-.35),(.324,.244,-.324)], .011, rubber)
tube('Coolant pressure hose', [(-.303,.391,-.263),(-.243,.361,-.299),(-.211,.26,-.316),(-.168,.218,-.38),(.179,.221,-.385),(.318,.342,-.337)], .01, rubber)
tube('Exhaust header', [(.383,.348,-.445),(.429,.316,-.532),(.417,.267,-.633),(.366,.242,-.712)], .022, heat_tint)
for x, end, radius, radius_end, mat in [
    (.369,.299,.023,.045,heat_tint), (.299,.17,.045,.051,steel), (.17,.045,.051,.042,steel),
    (.045,-.035,.042,.019,heat_tint), (-.035,-.072,.019,.019,steel),
    (-.072,-.111,.026,.036,metal), (-.111,-.337,.036,.036,metal),
    (-.337,-.359,.036,.025,cast), (-.359,-.392,.019,.019,steel),
]:
    cylinder('Exhaust chamber and silencer', (x,.234+.018*x,-.748+.105*x),
             (end,.234+.018*end,-.748+.105*end),radius,mat,32,radius_end)
for x,radius in [(.299,.045),(.17,.051),(.045,.042),(-.111,.036),(-.337,.036)]:
    y,z=.234+.018*x,-.748+.105*x
    cylinder('Exhaust circumferential weld', (x+.0015,y,z), (x-.0015,y,z),radius+.0016,heat_tint,32)
for x in (-.137,-.297):
    y,z=.234+.018*x,-.748+.105*x
    cylinder('Silencer steel retaining strap', (x+.007,y,z), (x-.007,y,z),.0377,cast,32)
    cylinder('Silencer mounting stay',(x,y-.033,z),(x,.159,z+.126),.008,metal)
cylinder('Recessed silencer outlet', (-.391,.227,-.789),(-.394,.227,-.789),.014,black,24)
box('Fuel cell', (0,.205,.292), (.154,.142,.25), tank, .039)
cylinder('Fuel filler', (0,.275,.338), (0,.292,.338), .025, black, 18)
tube('Fuel line', [(0,.29,.339),(.099,.251,.26),(.168,.208,-.095),(.32,.252,-.28)], .005, gold)

# A steel carrier supports the two open moulded rails from inside.
tube('Rear guard carrier', [(-.428,.158,-.662),(-.479,.156,-.796),
    (-.348,.154,-.863),(0,.158,-.872),(.348,.154,-.863),
    (.479,.156,-.796),(.428,.158,-.662)], .014, steel, resolution=6)
for height, radius in ((.127,.020),(.225,.022)):
    tube('Moulded rear guard rail', [
        (-.541,height,-.704),(-.592,height-.012,-.793),(-.550,height-.015,-.875),
        (-.405,height-.004,-.894),(-.209,height+.003,-.895),(0,height+.004,-.921),
        (.209,height+.003,-.895),(.405,height-.004,-.894),(.550,height-.015,-.875),
        (.592,height-.012,-.793),(.541,height,-.704),
    ], radius, mechanical_black, resolution=6)
for side in (-1,1):
    for x,z in [(.565,-.858),(.421,-.891)]:
        box('Rear guard moulded bridge', (side*x,.168,z), (.030,.111,.028), mechanical_black, .009)
    hex_bolt('Rear guard retaining bolt', (side*.436,.174,-.907), .008, 'z')
    for x,z in [(.458,-.302),(.468,.194)]:
        hex_bolt('Fairing fastener', (side*x,.268,z), .007)
number_outline=[(-.105,-.04),(-.073,-.067),(.073,-.067),(.105,-.04),
                (.099,.036),(.068,.064),(-.068,.064),(-.099,.036)]
polygon_plate('Rear number holder',number_outline,.181,-.939,mechanical_black,.030)
polygon_plate('Amber number decal',[(x*.85,y*.80) for x,y in number_outline],.181,-.963,accent,.002)
for x in (-.086,.086):
    hex_bolt('Rear number plate rivet',(x,.181,-.960),.004,'z')


pod_sections = [
    (-.379,.461,.014,.198,.012),(-.349,.465,.059,.202,.039),
    (-.294,.472,.077,.208,.059),(-.181,.472,.087,.209,.061),
    (.035,.472,.087,.210,.061),(.166,.470,.081,.204,.062),
    (.226,.466,.064,.197,.052),(.265,.452,.041,.189,.035),(.281,.431,.009,.185,.009),
]


def pod_surface(side, z, angle, offset=0):
    x,w,y,h = profile(pod_sections,z)
    u,v=cos(angle),sin(angle)
    return (side*(x+(w+offset)*abs(u)**.74*(1 if u>=0 else -1)),
            y+(h+offset)*abs(v)**.75*(1 if v>=0 else -1),z)


def pod_graphic(side, name, mat, z_range, inner, outer):
    rows, columns = 37, 7
    vertices=[]
    for i in range(rows):
        t=i/(rows-1)
        z=z_range[0]+t*(z_range[1]-z_range[0])
        for j in range(columns):
            angle=inner(t)+(outer(t)-inner(t))*j/(columns-1)
            vertices.append(pod_surface(side,z,angle,.0012))
    faces=[(i,i+1,i+columns+1,i+columns) for i in range((rows-1)*columns) if i%columns!=columns-1]
    if side<0:
        faces=[tuple(reversed(face)) for face in faces]
    mesh(name,vertices,faces,mat)


for side in (-1,1):
    loft('Moulded side pod',43,48,
         lambda i,t:pod_surface(side,-.379+i*.660/42,t*side),paint)
    pod_graphic(side,'Amber side livery',accent,(-.345,.235),
                lambda t:.19+.71*t, lambda t:1.08+.25*t)
    pod_graphic(side,'Ivory side livery detail',ivory,(-.325,.203),
                lambda t:.115+.69*t, lambda t:.166+.689*t)
profile_housing('Sculpted nose fairing',[
    (.249,.286,.038,.031),(.299,.294,.066,.066),(.405,.255,.081,.067),
    (.532,.228,.118,.059),(.62,.216,.151,.054),
    (.746,.196,.182,.049),(.812,.178,.143,.037),(.855,.165,.073,.020)
],paint)
tube('Front guard mounting tube', [(-.377,.147,.619),(-.412,.154,.713),(-.287,.157,.791),
     (0,.156,.827),(.287,.157,.791),(.412,.154,.713),(.377,.147,.619)],.013,metal)
front_guard=[(.444,.157,.653),(.471,.163,.739),(.372,.160,.802),(.203,.151,.852),(.074,.152,.869)]
tube('Moulded front fender', [(-x,y,z) for x,y,z in front_guard]+[(0,.154,.870)]
     + list(reversed(front_guard)), .036,mechanical_black,resolution=5)

# Thin bucket seat with rounded rolled rim. The top edge stays below the name.
seat_rows = [
    (.20,-.045,.135,.052),(.214,-.155,.181,.072),(.255,-.272,.188,.085),
    (.334,-.317,.196,.091),(.402,-.326,.182,.077),(.475,-.337,.144,.055),
]
rows, cols = len(seat_rows), 15
verts = []
for y,z,w,wrap in seat_rows:
    for i in range(cols):
        u = 2*i/(cols-1)-1
        verts.append((u*w,y + .040*u*u,z+wrap*u*u))
faces = [(j*cols+i,(j+1)*cols+i,(j+1)*cols+i+1,j*cols+i+1)
         for j in range(rows-1) for i in range(cols-1)]
bucket = mesh('Fibreglass bucket shell',verts,faces,seat)
mod = bucket.modifiers.new('Thin shell', 'SOLIDIFY')
mod.thickness=.008
bevel(bucket,.003)
tube('Bucket top rolled rim',verts[-cols:],.009,seat,poly=True)
for i in (0,cols-1):
    tube('Bucket side rolled rim',[verts[j*cols+i] for j in range(rows)],.009,seat)
for side in (-1,1):
    hex_bolt('Bucket mounting screw',(side*.17,.35,-.266), .009, 'x')
    tube('Rear bucket support', [(side*.115,.255,-.285),(side*.204,.281,-.322),
         (side*.286,.211,-.428),(side*.379,.151,-.455)],.009,metal)
    box('Seat lower liner',(side*.093,.231,-.072),(.119,.031,.108),seat_pad,.013)

def mix(a,b,t):
    return a + (b-a)*t


def bell(x):
    return exp(-x*x)


def weave_material(mat, srgb):
    # The UV repeat follows the physical scale of the 30 cm scanned linen tile.
    size=128
    rgb=color(srgb)[:3]
    diffuse=[]
    for y in range(size):
        for x in range(size):
            dye = .965 + .019*sin(2*pi*(x-y)/64)*cos(2*pi*y/128)
            dye += .011*sin(2*pi*x/16)*sin(2*pi*y/24)
            diffuse.extend([*(channel*dye for channel in rgb),1.0])
    image=bpy.data.images.new('Dyed yellow suit fabric',width=size,height=size,alpha=False)
    image.pixels.foreach_set(diffuse)
    image.update()
    image.pack()

    nodes=mat.node_tree.nodes
    links=mat.node_tree.links
    principled=nodes.get('Principled BSDF')
    base=nodes.new('ShaderNodeTexImage')
    base.image=image
    links.new(base.outputs['Color'],principled.inputs['Base Color'])
    for filename, label, socket in [
        ('suit-normal.jpg','Scanned fibre normal','Normal'),
        ('suit-roughness.jpg','Scanned fibre roughness','Roughness'),
    ]:
        source=TEXTURES / filename
        if not source.exists():
            raise FileNotFoundError(source)
        tex=nodes.new('ShaderNodeTexImage')
        tex.label=label
        tex.image=bpy.data.images.load(str(source),check_existing=True)
        tex.image.colorspace_settings.name='Non-Color'
        tex.image.pack()
        if socket=='Normal':
            normal=nodes.new('ShaderNodeNormalMap')
            normal.inputs['Strength'].default_value=.66
            links.new(tex.outputs['Color'],normal.inputs['Color'])
            links.new(normal.outputs['Normal'],principled.inputs[socket])
        else:
            links.new(tex.outputs['Color'],principled.inputs[socket])


if DRIVER_SOURCE:
    weave_material(suit,0xffd84a)
shell_edge = material('Helmet lower rubber seal', 0x111922, .67)
wing_edge = material('Helmet rear airflow trim', 0x5a2544, .42, .06, .22)


def word(name, y, max_width, height, wrapped=True):
    curve=bpy.data.curves.new(name,'FONT')
    curve.body=name
    curve.align_x='CENTER'
    curve.resolution_u=8
    for font in (Path('/System/Library/Fonts/Supplemental/Arial Bold.ttf'),
                 Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')):
        if wrapped and font.exists():
            curve.font=bpy.data.fonts.load(str(font),check_existing=True)
            break
    node=bpy.data.objects.new(name,curve)
    bpy.context.collection.objects.link(node)
    bpy.ops.object.select_all(action='DESELECT')
    node.select_set(True)
    bpy.context.view_layer.objects.active=node
    bpy.ops.object.convert(target='MESH')
    node=bpy.context.object
    if wrapped:
        glyphs=bmesh.new()
        glyphs.from_mesh(node.data)
        bmesh.ops.triangulate(glyphs,faces=list(glyphs.faces))
        bmesh.ops.subdivide_edges(glyphs,edges=list(glyphs.edges),cuts=2,use_grid_fill=True)
        glyphs.to_mesh(node.data)
        glyphs.free()
    xmin,xmax = min(v.co.x for v in node.data.vertices),max(v.co.x for v in node.data.vertices)
    ymin,ymax = min(v.co.y for v in node.data.vertices),max(v.co.y for v in node.data.vertices)
    scale=min(max_width/(xmax-xmin),height/(ymax-ymin))
    if wrapped:
        backing=node.copy()
        backing.data=node.data.copy()
        backing.name=name+' outline'
        bpy.context.collection.objects.link(backing)
        for v in backing.data.vertices:
            x=-(v.co.x-(xmin+xmax)/2)*scale*1.045
            h=y+(v.co.y-(ymin+ymax)/2)*scale*1.13
            v.co=vector((x,h,0))
        finish(backing,letter_shadow)
    for v in node.data.vertices:
        # The rear camera looks down +Z, therefore screen right is negative X.
        x=-(v.co.x-(xmin+xmax)/2)*scale
        h=y+(v.co.y-(ymin+ymax)/2)*scale
        v.co=vector((x,h,0 if wrapped else -.968))
    node.data.update()
    finish(node,white_ink if wrapped else ink)


PART_GROUP = 'DriverName'
word('LEANDRO',.606 if SOURCE else .589,.271,.037)
word('LIPPI',.563 if SOURCE else .543,.202,.033)
PART_GROUP = 'Kart'
word('27',.187,.137,.076,wrapped=False)

PART_GROUP = 'DriverHelmet'
# The crown, brow and chin use separate changes of curvature in the shell profile.
HELMET=[
    (.690,-.124,.089,.064,.093),(.706,-.126,.104,.084,.137),
    (.726,-.132,.113,.100,.159),(.752,-.140,.122,.114,.169),
    (.776,-.142,.128,.128,.151),(.805,-.144,.131,.136,.139),
    (.834,-.146,.130,.136,.136),(.854,-.148,.130,.133,.137),
    (.875,-.149,.125,.125,.124),(.897,-.151,.108,.113,.103),
    (.916,-.153,.080,.087,.083),(.929,-.154,.046,.056,.051),
    (.934,-.155,.016,.019,.020),(.935,-.155,.0012,.0013,.0013),
]


def helmet_surface(y,t,layer=0):
    z,w,back,front=profile(HELMET,y)
    c=cos(t)
    depth=back if c>=0 else front
    rear_flare=.007*bell((y-.764)/.022)*max(0,c)**2
    # The rear cutout follows the nape while the front drops under the jaw.
    y += .016*bell((y-.697)/.053)*max(0,c)**1.6
    z -= (depth+rear_flare+layer)*c
    up,front = y-.707,z+.12
    pitch=.15
    return (-(w+layer)*sin(t),.707+up*cos(pitch)-front*sin(pitch),
            -.12+up*sin(pitch)+front*cos(pitch))


def helmet_patch(name,y_first,y_last,start,end,material,layer,rows=14,columns=48,taper=0,corner=0):
    positions=[]
    for j in range(rows):
        for k in range(columns):
            u,v=k/(columns-1),j/(rows-1)
            inset=taper*abs(2*u-1)**5
            y=mix(y_first+inset,y_last-inset*.7,v)
            turn=corner*abs(2*v-1)**5
            positions.append(helmet_surface(y,mix(start+turn,end-turn,u),layer))
    faces=[(a,a+1,a+1+columns,a+columns) for j in range(rows-1)
          for k in range(columns-1) for a in (j*columns+k,)]
    return mesh(name,positions,faces,material)


def helmet_sweep(name,side,knots,mat,layer):
    sections=56
    verts=[]
    for j in range(sections):
        angle=knots[0][0]+(knots[-1][0]-knots[0][0])*j/(sections-1)
        bottom,top=profile(knots,angle)
        for i in range(4):
            verts.append(helmet_surface(mix(bottom,top,i/3),side*angle,layer))
    faces=[(a,a+4,a+5,a+1) for j in range(sections-1) for i in range(3) for a in (4*j+i,)]
    return mesh(name,verts,faces if side>0 else [tuple(reversed(f)) for f in faces],mat)


loft('Moulded full-face helmet shell',67,96,
    lambda i,t:helmet_surface(mix(.690,.935,i/66),t),helmet)
helmet_patch('Rubber opening seal',.691,.704,-pi,pi,shell_edge,.0018,9,96)
helmet_patch('Shaped chin bar',.713,.770,pi-1.11,pi+1.11,helmet,.0048,taper=.012)
helmet_patch('Visor gasket',.774,.854,pi-1.73,pi+1.73,shell_edge,.0048,18,72,taper=.018,corner=.11)
helmet_patch('Curved smoked visor',.783,.846,pi-1.62,pi+1.62,visor,.0087,22,80,taper=.020,corner=.11)
helmet_patch('Moulded rear aero lip',.718,.742,-.95,.95,helmet_graphite,.007,14,60,taper=.009)
helmet_patch('Recessed rear extractor',.713,.734,-.98,.98,wing_edge,.003,12,60,taper=.009)
for s in (-1,1):
    helmet_sweep('Graphite sweep',s,[(.04,.748,.749),(.32,.748,.766),(.68,.751,.779),
                                  (1.05,.755,.796),(1.39,.753,.793),(1.57,.747,.752)],
                 helmet_graphite,.0035)
    helmet_sweep('Ivory sweep edge',s,[(.10,.750,.751),(.37,.750,.752),(.69,.753,.757),
                                     (1.05,.758,.764),(1.38,.756,.761),(1.55,.750,.751)],
                 helmet_trim,.0047)
    for t in (.53,.68):
        helmet_patch('Rear extraction vent',.790,.800,s*t-.044,s*t+.044,shell_edge,.002,5,6,taper=.003)
    t=pi+s*1.57
    x,y,z=helmet_surface(.814,t,.009)
    cylinder('Visor hinge cover',(x,y,z),(x+s*.0032,y,z),.012,shell_edge,24)
    cylinder('Visor hinge fastener',(x+s*.0031,y,z),(x+s*.0042,y,z),.0047,steel,16)
    for t in (pi+s*.22,pi+s*.38):
        helmet_patch('Chin air intake',.743,.752,t-.053,t+.053,shell_edge,.006,5,7,taper=.002)
helmet_patch('Crown centre stripe',.890,.935,-.12,.12,helmet_trim,.0012,16,14)

# The game rotates the torso at the waist and the helmet at the neck.
def pivot(name, position, parent=None):
    obj=bpy.data.objects.new(name,None)
    bpy.context.collection.objects.link(obj)
    obj.location=vector(position)
    bpy.context.view_layer.update()
    if parent:
        obj.parent=parent
        obj.matrix_parent_inverse=parent.matrix_world.inverted()
    return obj


def surface_grain(mat, name, amplitude, grain, seed):
    # Tileable grain is packed in the GLB so it renders consistently in Three.js.
    size=128
    base=[1.055*c**(1/2.4)-.055 if c > .0031308 else 12.92*c for c in mat.diffuse_color[:3]]
    rng=Random(seed)
    pixels=[]
    for j in range(size):
        for i in range(size):
            x,y=2*pi*i/size,2*pi*j/size
            strength=1+amplitude*(.19*sin(3*x+2*y)+.14*cos(7*x-4*y)
                                  +.12*sin(grain*x+2*y)*cos(13*y-x)+rng.uniform(-.52,.52))
            pixels.extend([*(min(1,c*strength) for c in base),1])
    image=bpy.data.images.new(name,width=size,height=size,alpha=False)
    image.pixels.foreach_set(pixels)
    image.update()
    image.pack()
    nodes=mat.node_tree.nodes
    tex=nodes.new('ShaderNodeTexImage')
    tex.image=image
    mat.node_tree.links.new(tex.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])


def project_surface_uv(obj, size):
    geo=obj.data
    uv=geo.uv_layers.active or geo.uv_layers.new(name='UVMap')
    matrix=obj.matrix_world
    points=[matrix @ vertex.co for vertex in geo.vertices]
    normal_matrix=matrix.to_3x3().inverted().transposed()
    for face in geo.polygons:
        normal=normal_matrix @ face.normal
        axis=max(range(3),key=lambda i:abs(normal[i]))
        u,v=((1,2),(0,2),(0,1))[axis]
        for idx in face.loop_indices:
            point=points[geo.loops[idx].vertex_index]
            uv.data[idx].uv=(point[u]/size,point[v]/size)


def seat_weave():
    size=384
    colors,roughness,normals=[],[],[]
    for j in range(size):
        for i in range(size):
            x,y=i*24/size,j*24/size
            warp=(int(x)-int(y))%4<2
            cross,along=(x,y) if warp else (y,x)
            rib=.5-.5*cos(2*pi*cross)
            fibre=.5+.5*cos(2*pi*(3*cross+.08*along))
            tint=.132+.05*rib+.012*fibre
            colors.extend((tint,tint*.99,tint*1.025,1))
            rough=.49+.12*(1-rib)+.035*fibre
            roughness.extend((rough,rough,rough,1))
            slope=.06*sin(2*pi*cross)
            normals.extend((.5+slope if warp else .5,.5 if warp else .5+slope,.993,1))
    nodes=seat.node_tree.nodes
    links=seat.node_tree.links
    bsdf=nodes.get('Principled BSDF')
    for name,socket,data in [('Resin carbon weave','Base Color',colors),
                             ('Resin gloss variation','Roughness',roughness),
                             ('Carbon tow relief','Normal',normals)]:
        tex=nodes.new('ShaderNodeTexImage')
        tex.image=bpy.data.images.new(name,width=size,height=size,alpha=False)
        if socket!='Base Color':
            tex.image.colorspace_settings.name='Non-Color'
        tex.image.pixels.foreach_set(data)
        tex.image.update()
        tex.image.pack()
        if socket=='Normal':
            normal=nodes.new('ShaderNodeNormalMap')
            normal.inputs['Strength'].default_value=.55
            links.new(tex.outputs['Color'],normal.inputs['Color'])
            links.new(normal.outputs['Normal'],bsdf.inputs[socket])
        else:
            links.new(tex.outputs['Color'],bsdf.inputs[socket])


mechanical_surfaces={
    mat.name: size for mat,size in [
        (metal,.20),(cast,.16),(steel,.18),(heat_tint,.14),
        (seat,.106),(mechanical_black,.22),(rim_material,.18),(wheel_grip_material,.10),
        (paint,.30),(black,.16),(tank,.18),
    ]
}
for i,(mat,name,amount,grain) in enumerate([
    (metal,'Fine brushed aluminium grain',.13,47),
    (cast,'Cast and machined aluminium grain',.22,31),
    (steel,'Weathered black steel',.23,29),
    (heat_tint,'Heat discolouration on exhaust',.23,18),
    (mechanical_black,'Moulded plastic grain',.14,38),
    (rim_material,'Cast magnesium grain',.11,38),
    (wheel_grip_material,'Microtextured steering grip grain',.17,41),
    (paint,'Livery paint variation',.038,25),
    (black,'Polymer moulding grain',.10,29),
    (tank,'Translucent tank surface variation',.08,31),
]):
    surface_grain(mat,name,amount,grain,784+i)
seat_weave()
apply_competition_materials({m.name:m for m in bpy.data.materials},texture_dir=TEXTURES)

if not SOURCE:
    if SCRIPT.with_name('competition_kart.py').is_file():
        from competition_kart import build as competition_vehicle
        PART_GROUP='Kart'
        competition_vehicle(globals())
    PART_GROUP='RunningSteering'
    add_running_gear(globals())


def fitted_driver_point(point, group):
    x,y,z=point
    if group=='DriverHelmet':
        x,y,z=x*.89,.785+(y-.807)*.95,-.122+(z+.147)*.94
    else:
        x*=.975
    return (x,y-.045,z-.145-.085*(y-.57))


torso_position=(0,.395,-.13)
helmet_position=(0,.709,-.115)
if SOURCE:
    torso_position=fitted_driver_point(torso_position,'DriverTorso')
    helmet_position=fitted_driver_point(helmet_position,'DriverHelmet')
else:
    helmet_position=(0,.681,-.105)
torso_pivot=pivot('DriverTorso', torso_position)
helmet_pivot=pivot('DriverHelmet', helmet_position, torso_pivot)
arms_pivot=pivot('DriverArms', (0,0,0)) if DRIVER_SOURCE else None
pivots={'DriverTorso':torso_pivot,'DriverHelmet':helmet_pivot}
pivots['DriverName']=torso_pivot
if arms_pivot:
    pivots['DriverArms']=arms_pivot
bpy.context.view_layer.update()

# Apply edge treatments and batch by material within each animated part.
bpy.ops.object.select_all(action='DESELECT')
letters=[]
for (group, material_name),objects in PARTS.items():
    if (SOURCE and group=='Kart') or (HELMET_SOURCE and group=='DriverHelmet'):
        for obj in objects:
            bpy.data.objects.remove(obj,do_unlink=True)
        continue
    for obj in objects:
        bpy.context.view_layer.objects.active=obj
        obj.select_set(True)
        for mod in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
        if material_name in mechanical_surfaces:
            project_surface_uv(obj,mechanical_surfaces[material_name])
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    first = objects[0]
    bpy.context.view_layer.objects.active=first
    if len(objects)>1:
        bpy.ops.object.join()
    first.name=first.data.materials[0].name
    if SOURCE and group in ('DriverHelmet','DriverName'):
        world=first.matrix_world.copy()
        inverse=world.inverted()
        for vertex in first.data.vertices:
            x,y,z=world @ vertex.co
            vertex.co=inverse @ vector(fitted_driver_point((x,z,-y),group))
    if not SOURCE and group=='DriverHelmet':
        world=first.matrix_world.copy()
        inverse=world.inverted()
        for vertex in first.data.vertices:
            x,y,z=world @ vertex.co
            vertex.co=inverse @ vector((x*.96,z-.028,-y+.010))
    if group in pivots:
        first.parent=pivots[group]
        first.matrix_parent_inverse=pivots[group].matrix_world.inverted()
    if group=='DriverName':
        letters.append((first,.0013 if material_name==white_ink.name else .0008))
    first.select_set(False)

if SOURCE:
    prepare_kart(SOURCE, vector)
if HELMET_SOURCE:
    prepare_helmet(HELMET_SOURCE, helmet_pivot, color(0x9f2b68))
if DRIVER_SOURCE:
    driver=fit_driver(DRIVER_SOURCE,torso_pivot,arms_pivot,suit,navy)
    bpy.context.view_layer.update()
    wrap_name(driver,letters)
else:
    rig=build_driver(TEXTURES,bool(SOURCE),torso_position,helmet_position,helmet_pivot,letters)
    bpy.data.objects.remove(torso_pivot,do_unlink=True)
OUTPUT.parent.mkdir(parents=True,exist_ok=True)
temporary = OUTPUT.with_suffix('.tmp.glb')
result = bpy.ops.export_scene.gltf(
    filepath=str(temporary),export_format='GLB',export_yup=True,
    export_animations=False,export_cameras=False,export_lights=False,export_extras=True
)
if 'FINISHED' not in result:
    raise RuntimeError('Could not export the kart')
temporary.replace(OUTPUT)
if options.blend:
    if DRIVER_SOURCE:
        raise ValueError('Use the authored driver to save an editable rig scene')
    options.blend.parent.mkdir(parents=True,exist_ok=True)
    add_editing_controls(rig)
    scene=bpy.context.scene
    groups={name:bpy.data.collections.new(name) for name in
            ('01 Kart and chassis','02 Wheels and steering','03 Pilot and skeleton')}
    for group in groups.values():
        scene.collection.children.link(group)
    for obj in list(scene.objects):
        root=obj
        while root.parent:
            root=root.parent
        if root==rig:
            label='03 Pilot and skeleton'
        elif root.name.endswith('Wheel') or root.name=='KartSteering':
            label='02 Wheels and steering'
        else:
            label='01 Kart and chassis'
        for group in list(obj.users_collection):
            group.objects.unlink(obj)
        groups[label].objects.link(obj)
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                space=area.spaces.active
                space.region_3d.view_location=Vector((0,0,.36))
                space.region_3d.view_distance=3.0
                space.region_3d.view_rotation=Vector((-2,2.35,-1.05)).to_track_quat('-Z','Y')
                space.shading.type='MATERIAL'
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(options.blend.resolve()),compress=True)
