"""Original vehicle geometry refinement for the authored competition kart.

Call ``build(globals())`` from ``build-kart.py`` before the PARTS join/export
pass.  The module intentionally reuses that builder's geometry helpers and
materials, so it owns vehicle shape and mechanical layout without introducing
a second material system or an external mesh dependency.
"""

from math import atan2, cos, hypot, pi, sin, sqrt

from mathutils import Vector


_REPLACED_OBJECTS = {
    # Main tube sizes are tied to the 30 mm competition frame reference.
    'Main frame rail', 'Crossmember', 'Live rear axle',
    # Replace the first-pass driveline with a direct-drive, single-speed layout.
    'Drive sprocket', 'Sprocket tooth', 'Chain side links', 'Chain roller',
    'Ventilated brake rotor', 'Brake rotor hub', 'Rotor drill recess', 'Caliper',
    # Replace first-pass engine / water cooling / exhaust geometry.
    'Engine mounting plate', 'Engine crankcase', 'Cast starter flange',
    'Starter motor', 'Pressed starter cap', 'Cast reinforcement rib',
    'Starter flange bolt', 'Engine cooling fin', 'Machined fin edge',
    'Cylinder head', 'Cylinder head bolt', 'Spark plug', 'Ignition lead',
    'Radiator surround', 'Radiator top tank', 'Radiator lower tank',
    'Recessed radiator core', 'Radiator vertical tube',
    'Radiator folded cooling fin', 'Radiator mounting stay',
    'Radiator frame screw', 'Radiator filler neck', 'Radiator cap',
    'Coolant return hose', 'Coolant pressure hose', 'Exhaust header',
    'Exhaust chamber and silencer', 'Exhaust circumferential weld',
    'Silencer steel retaining strap', 'Silencer mounting stay',
    'Recessed silencer outlet', 'Fuel line',
    # Replace the first-pass body skins and blunt polygonal front guard.
    'Moulded side pod', 'Amber side livery', 'Ivory side livery detail',
    'Sculpted nose fairing', 'Front guard mounting tube', 'Moulded front fender',
}


def _is_replaced(name):
    return any(name == base or name.startswith(base + '.')
               for base in _REPLACED_OBJECTS)


def _remove_first_pass(api):
    bpy = api['bpy']
    parts = api['PARTS']
    # Read names while datablocks are alive; Blender invalidates StructRNA
    # wrappers immediately when an object is unlinked.
    for group, objects in list(parts.items()):
        parts[group] = [obj for obj in objects if not _is_replaced(obj.name)]
    for obj in list(bpy.data.objects):
        if _is_replaced(obj.name):
            bpy.data.objects.remove(obj, do_unlink=True)


def _tube_mesh(api, name, controls, radii, mat, radial=16, samples=8):
    """Create a smooth, changing-section tube along a 3D centreline."""
    points = [Vector(point) for point in controls]

    def catmull(values, segment, t):
        p0 = values[max(0, segment - 1)]
        p1 = values[segment]
        p2 = values[segment + 1]
        p3 = values[min(len(values) - 1, segment + 2)]
        t2, t3 = t * t, t * t * t
        return .5 * ((2 * p1) + (-p0 + p2) * t
                     + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                     + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)

    centres, widths = [], []
    for segment in range(len(points) - 1):
        for index in range(samples):
            t = index / samples
            centres.append(catmull(points, segment, t))
            widths.append(max(.0005, catmull(radii, segment, t)))
    centres.append(points[-1])
    widths.append(radii[-1])

    vertices = []
    for index, (centre, width) in enumerate(zip(centres, widths)):
        tangent = (centres[min(len(centres) - 1, index + 1)]
                   - centres[max(0, index - 1)]).normalized()
        reference = Vector((0, 1, 0))
        if abs(tangent.dot(reference)) > .92:
            reference = Vector((1, 0, 0))
        side = reference.cross(tangent).normalized()
        up = tangent.cross(side).normalized()
        for ring in range(radial):
            theta = 2 * pi * ring / radial
            point = centre + width * (cos(theta) * side + sin(theta) * up)
            vertices.append(tuple(point))

    faces = []
    for index in range(len(centres) - 1):
        for ring in range(radial):
            a = index * radial + ring
            b = index * radial + (ring + 1) % radial
            c = (index + 1) * radial + (ring + 1) % radial
            d = (index + 1) * radial + ring
            # Angular edge followed by path edge gives outward-facing normals.
            faces.append((a, b, c, d))
    faces.extend([tuple(range(radial - 1, -1, -1)),
                  tuple((len(centres) - 1) * radial + ring
                        for ring in range(radial))])
    return api['mesh'](name, vertices, faces, mat, True)


def _annular_disc(api, name, x0, x1, centre_y, centre_z,
                  outer_radius, inner_radius, mat, segments=64):
    """True annular brake rotor with open centre and visible edge thickness."""
    vertices = []
    for x, radius in ((x0, outer_radius), (x1, outer_radius),
                      (x0, inner_radius), (x1, inner_radius)):
        for index in range(segments):
            theta = 2 * pi * index / segments
            vertices.append((x, centre_y + radius * cos(theta),
                             centre_z + radius * sin(theta)))
    faces = []
    for index in range(segments):
        nxt = (index + 1) % segments
        # Near face, far face, outer rim and bore wall.
        faces.append((index, 2 * segments + index,
                      2 * segments + nxt, nxt))
        faces.append((segments + index, segments + nxt,
                      3 * segments + nxt, 3 * segments + index))
        faces.append((index, segments + index, segments + nxt, nxt))
        faces.append((2 * segments + index, 3 * segments + index,
                      3 * segments + nxt, 2 * segments + nxt))
    return api['mesh'](name, vertices, faces, mat, False)


def _chain_path(sprocket_centre, sprocket_radius, pinion_centre, pinion_radius):
    """Tangent chain loop with a long wrap on the axle sprocket."""
    ay, az = sprocket_centre
    by, bz = pinion_centre
    dy, dz = by - ay, bz - az
    distance = hypot(dy, dz)
    direction = (dy / distance, dz / distance)
    normal = (-direction[1], direction[0])
    sine = (sprocket_radius - pinion_radius) / distance
    cosine = sqrt(1 - sine * sine)
    upper = (direction[0] * sine + normal[0] * cosine,
             direction[1] * sine + normal[1] * cosine)
    lower = (direction[0] * sine - normal[0] * cosine,
             direction[1] * sine - normal[1] * cosine)
    sprocket_upper = (ay + upper[0] * sprocket_radius,
                      az + upper[1] * sprocket_radius)
    pinion_upper = (by + upper[0] * pinion_radius,
                    bz + upper[1] * pinion_radius)
    pinion_lower = (by + lower[0] * pinion_radius,
                    bz + lower[1] * pinion_radius)
    sprocket_lower = (ay + lower[0] * sprocket_radius,
                      az + lower[1] * sprocket_radius)

    def arc(centre, radius, start, end, steps):
        cy, cz = centre
        return [(cy + radius * cos(start + (end - start) * i / steps),
                 cz + radius * sin(start + (end - start) * i / steps))
                for i in range(steps + 1)]

    a0 = atan2(upper[1], upper[0])
    a1 = atan2(lower[1], lower[0])
    pinion_arc = arc(pinion_centre, pinion_radius, a0, a1, 14)
    sprocket_arc = arc(sprocket_centre, sprocket_radius,
                       a1, a0 - 2 * pi, 34)
    return ([sprocket_upper, pinion_upper] + pinion_arc[1:]
            + [sprocket_lower] + sprocket_arc[1:])


def _resample_loop(points, spacing):
    dense = []
    for start, end in zip(points, points[1:] + points[:1]):
        length = hypot(end[0] - start[0], end[1] - start[1])
        steps = max(1, round(length / spacing))
        dense.extend([(start[0] + (end[0] - start[0]) * i / steps,
                       start[1] + (end[1] - start[1]) * i / steps)
                      for i in range(steps)])
    dense.append(dense[0])
    return dense


def _swept_body_y(api, name, centre_x, centre_z, sections, mat, rings=7, steps=32):
    """Rounded cast housing whose stepped section runs up the Y axis."""
    def section(index, theta):
        y, radius_x, radius_z = sections[index]
        return (centre_x + radius_x * cos(theta), y,
                centre_z - radius_z * sin(theta))
    return api['loft'](name, len(sections), steps, section, mat)


def _swept_body_x(api, name, centre_y, centre_z, sections, mat, steps=32):
    """Rounded side cover with an axis parallel to the rear axle."""
    def section(index, theta):
        x, radius_y, radius_z = sections[index]
        return (x, centre_y + radius_y * cos(theta),
                centre_z + radius_z * sin(theta))
    return api['loft'](name, len(sections), steps, section, mat)


def _torus_band(api, name, centre, tangent, major, minor, mat,
                segments=40, tube_steps=8):
    axis = Vector(tangent).normalized()
    reference = Vector((0,1,0))
    if abs(axis.dot(reference)) > .92:
        reference = Vector((1,0,0))
    side = reference.cross(axis).normalized()
    up = axis.cross(side).normalized()
    origin = Vector(centre)
    vertices = []
    for i in range(segments):
        theta = 2*pi*i/segments
        radial = side*cos(theta) + up*sin(theta)
        for j in range(tube_steps):
            phi = 2*pi*j/tube_steps
            point = origin + (major + minor*cos(phi))*radial + minor*sin(phi)*axis
            vertices.append(tuple(point))
    faces = []
    for i in range(segments):
        for j in range(tube_steps):
            a = i*tube_steps+j
            b = i*tube_steps+(j+1)%tube_steps
            c = ((i+1)%segments)*tube_steps+(j+1)%tube_steps
            d = ((i+1)%segments)*tube_steps+j
            faces.append((a,b,c,d))
    return api['mesh'](name,vertices,faces,mat,True)


def _nose_surface(rows, profile, z, lateral, offset=0, underside=False):
    centre_y, width, upper, lower = profile(rows, z)
    across = max(-.999, min(.999, lateral))
    y = centre_y + (-lower if underside else upper) * sqrt(1 - across * across)
    return (width * across, y + offset, z)


def _create_nose(api, mat, accent, ivory, black):
    profile = api['profile']
    rows = [
        (.202,.292,.034,.040,.026),
        (.250,.285,.057,.058,.038),
        (.332,.270,.083,.072,.046),
        (.431,.249,.112,.076,.047),
        (.538,.226,.143,.071,.043),
        (.646,.213,.174,.064,.039),
        (.743,.196,.195,.058,.035),
        (.808,.177,.171,.050,.031),
        (.850,.163,.112,.039,.026),
    ]
    api['loft']('Nose fairing | deep-radius outer skin', 86, 64,
                lambda index, theta: _nose_surface(
                    rows, profile, rows[0][0] + (rows[-1][0] - rows[0][0])
                    * index / 85, cos(theta), underside=sin(theta)<0), mat)

    def top_patch(name, z_start, z_end, across_start, across_end, material):
        row_count, columns = 46, 11
        vertices = []
        for i in range(row_count):
            z = z_start + (z_end - z_start) * i / (row_count - 1)
            for j in range(columns):
                across = across_start + (across_end - across_start) * j / (columns - 1)
                vertices.append(_nose_surface(rows, profile, z, across, .0023))
        faces = [(i * columns + j, (i + 1) * columns + j,
                  (i + 1) * columns + j + 1, i * columns + j + 1)
                 for i in range(row_count - 1) for j in range(columns - 1)]
        return api['mesh'](name, vertices, faces, material, True)

    # Thin raised film-like shapes follow the crown instead of sitting as flat decals.
    top_patch('Front competition number panel', .557, .717, -.46, .46, accent)
    top_patch('Crown ivory pinline', .490, .805, -.54, -.51, ivory)
    top_patch('Crown ivory pinline', .490, .805, .51, .54, ivory)

    bpy=api['bpy']
    text=bpy.data.curves.new('Front race number','FONT')
    text.body='27'
    text.align_x='CENTER'
    text.resolution_u=9
    glyph=bpy.data.objects.new('Front race number',text)
    bpy.context.collection.objects.link(glyph)
    bpy.ops.object.select_all(action='DESELECT')
    glyph.select_set(True)
    bpy.context.view_layer.objects.active=glyph
    bpy.ops.object.convert(target='MESH')
    glyph=bpy.context.object
    height=max(v.co.y for v in glyph.data.vertices)-min(v.co.y for v in glyph.data.vertices)
    middle=sum(fn(v.co.y for v in glyph.data.vertices) for fn in (min,max))/2
    for vertex in glyph.data.vertices:
        x=vertex.co.x*.093/height
        z=.637-(vertex.co.y-middle)*.092/height
        _,wide,_,_=profile(rows,z)
        vertex.co=api['vector'](_nose_surface(rows,profile,z,x/wide,.0049))
    glyph.data.update()
    api['finish'](glyph,api['ink'],False)

    # Small dark chin lip gives the nose an unmistakable moulded lower edge.
    lip_rows = 28
    vertices = []
    for i in range(lip_rows):
        z = .688 + (.835 - .688) * i / (lip_rows - 1)
        for across in (-.70, .70):
            vertices.append(_nose_surface(rows, profile, z, across, -.0018, underside=True))
    faces = [(i * 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
             for i in range(lip_rows - 1)]
    api['mesh']('Nose lower edge | moulded return', vertices, faces, black, True)


def _create_sidepods(api, paint, accent, ivory, black):
    profile = api['profile']
    rows = [
        (-.401,.425,.025,.188,.026),
        (-.375,.446,.060,.196,.052),
        (-.314,.458,.082,.207,.070),
        (-.216,.461,.098,.215,.082),
        (-.070,.461,.103,.216,.084),
        (.082,.459,.098,.212,.080),
        (.188,.452,.082,.201,.066),
        (.248,.439,.053,.190,.044),
        (.281,.416,.011,.183,.012),
    ]

    def pod_surface(side, z, angle, offset=0):
        centre_x, half_width, centre_y, half_height = profile(rows, z)
        u, v = cos(angle), sin(angle)
        x = centre_x + (half_width + offset) * (1 if u >= 0 else -1) * abs(u) ** .78
        y = centre_y + (half_height + offset) * (1 if v >= 0 else -1) * abs(v) ** .78
        return side * x, y, z

    for side in (-1, 1):
        api['loft']('Competition sidepod | radiused shoulder', 66, 56,
                    lambda i, theta: pod_surface(
                        side, rows[0][0] + (rows[-1][0] - rows[0][0]) * i / 65,
                        theta * side), paint)

        def side_strip(name, z0, z1, a0, a1, material, offset=.0018):
            row_count, columns = 44, 7
            vertices = []
            for i in range(row_count):
                t = i / (row_count - 1)
                z = z0 + (z1 - z0) * t
                angle_start = a0 + .10 * sin(pi * t)
                angle_end = a1 - .07 * sin(pi * t)
                for j in range(columns):
                    angle = angle_start + (angle_end - angle_start) * j / (columns - 1)
                    vertices.append(pod_surface(side, z, angle, offset))
            faces = [(i * columns + j, i * columns + j + 1,
                      (i + 1) * columns + j + 1, (i + 1) * columns + j)
                     for i in range(row_count - 1) for j in range(columns - 1)]
            if side < 0:
                faces = [tuple(reversed(face)) for face in faces]
            return api['mesh'](name, vertices, faces, material, True)

        side_strip('Sidepod | upper honey sweep', -.337, .183, .49, .66, accent)
        side_strip('Sidepod | fine ivory accent', -.322, .153, .43, .47, ivory)
        side_strip('Sidepod | lower impact return', -.348, .206, -.73, -.58, black, .0022)

        # Rolled moulding on each leading shoulder makes the fairing read as a
        # pressed impact panel with a continuous radius, not a thin polygon slab.
        leading = [(side*x, y, z) for x, y, z in [
            (.426,.181,.277),(.473,.199,.255),(.507,.225,.211),
            (.531,.253,.153),(.541,.269,.091),(.542,.270,.014),
            (.536,.253,-.077),(.521,.224,-.171),(.490,.196,-.269),
            (.455,.180,-.355),
        ]]
        api['tube']('Sidepod | rolled leading shoulder', leading,
                    .0065, black, resolution=6, radial=3)


def _create_front_bumper(api, metal, black, paint, hardware):
    # The impact rail is an open, broad-radius U with a low, flattened section.
    bumper_controls = [
        (-.421,.154,.628),(-.475,.165,.695),(-.476,.178,.757),
        (-.397,.181,.812),(-.268,.179,.851),(-.130,.174,.874),
        (0,.172,.881),(.130,.174,.874),(.268,.179,.851),
        (.397,.181,.812),(.476,.178,.757),(.475,.165,.695),(.421,.154,.628),
    ]
    # A first solid steel carrier follows the same natural arc but sits inboard.
    api['tube']('Front bumper | steel carrier', [
        (-.389,.149,.635),(-.420,.156,.713),(-.352,.163,.780),
        (-.204,.164,.821),(0,.164,.838),(.204,.164,.821),
        (.352,.163,.780),(.420,.156,.713),(.389,.149,.635),
    ], .012, metal, resolution=7, radial=4)
    _tube_mesh(api, 'Front bumper | continuous moulded impact skin',
               bumper_controls, [.031] * len(bumper_controls), black, 20, 6)

    for side in (-1, 1):
        api['tube']('Front bumper | floating mount', [
            (side*.36,.151,.62),(side*.357,.162,.686),
            (side*.316,.169,.731),(side*.279,.165,.77),
        ], .009, hardware, resolution=6, radial=3)
        api['cylinder']('Front bumper | mount shoulder',
                        (side*.354,.157,.68),(side*.371,.157,.68),
                        .015, metal, 16)
        api['cylinder']('Front bumper | retention bolt',
                        (side*.372,.157,.68),(side*.376,.157,.68),
                        .005, hardware, 10)

    # Original dark-blue / honey-yellow livery follows the curve of the nose.
    # The fascia is a separate shell, so the 27 plate can change independently.
    api['tube']('Front spoiler | graphite lower accent', [
        (-.397,.163,.714),(-.431,.170,.752),(-.366,.174,.802),
        (-.222,.168,.842),(0,.165,.858),(.222,.168,.842),
        (.366,.174,.802),(.431,.170,.752),(.397,.163,.714),
    ], .018, paint, resolution=7, radial=4)


def _create_frame_and_controls(api, tubing, metal, steel, hardware, rubber, gold):
    tube = api['tube']
    for side in (-1, 1):
        tube('Main frame rail | 30 mm CrMo', [(side*x, y, z) for x,y,z in [
            (.28,.145,-.7),(.40,.151,-.54),(.415,.159,-.26),(.39,.155,.16),
            (.37,.158,.51),(.25,.169,.735),(.11,.168,.78),
        ]], .015, tubing, resolution=7, radial=4)
    for z, width in [(-.66,.76),(-.4,.78),(.075,.77),(.545,.72)]:
        api['cylinder']('Crossmember | 30 mm CrMo',
                        (-width/2,.149,z),(width/2,.149,z),.015,tubing,24)
    api['cylinder']('Live rear axle | 50 mm',
                    (-.573,.139,-.57),(.573,.139,-.57),.025,metal,32)

    # The pedal pair uses a shared pivot beam and curved, box-section arms.
    api['cylinder']('Pedal pivot beam',(-.174,.162,.535),(.174,.162,.535),
                    .012,steel,20)
    for x, label in [(-.064, 'Brake'),(.064,'Throttle')]:
        api['tube'](label + ' pedal | formed arm', [
            (x,.166,.536),(x,.178,.565),(x,.195,.594),(x,.211,.626),
        ], .008,metal,radial=3)
        face = api['box'](label + ' pedal | ribbed faceplate',
                          (x,.222,.652),(.070,.121,.019),metal,.014)
        face.rotation_euler.x = -.18
        for i in range(4):
            y = .180 + i*.023
            api['tube'](label + ' pedal | grip rib', [
                (x-.025,y,.651),(x+.025,y,.651),
            ], .0022,steel,poly=True,radial=2)
        api['cylinder'](label + ' pedal | hinge pin',
                        (x-.030,.165,.536),(x+.030,.165,.536),
                        .009,hardware,12)
    api['tube']('Brake pedal | return spring', [
        (-.064,.180,.544),(-.077,.202,.568),(-.064,.221,.584),(-.051,.202,.568),
    ], .0032,gold,radial=3)
    api['tube']('Throttle pedal | cable', [
        (.064,.179,.544),(.10,.192,.542),(.146,.201,.521),
        (.190,.204,.487),(.246,.215,.452),(.301,.248,.420),
    ], .0035,rubber,radial=2)


def _create_engine(api, cast, metal, steel, black, ivory, gold, hardware, rubber,
                   heat_tint, mechanical_black):
    # Compact direct-drive VTS-style package: crankcase, one water-jacketed
    # 54 mm cylinder, head, reed intake, diaphragm carburettor and pump.
    crank_rows = [
        (-.518,.221,.035,.045),(-.494,.222,.065,.062),
        (-.455,.224,.082,.073),(-.407,.226,.091,.079),
        (-.358,.225,.087,.076),(-.322,.220,.064,.062),
        (-.300,.216,.030,.041),
    ]
    api['loft']('Engine crankcase | ribbed magnesium body',54,40,
                lambda i,theta: ( .35 + api['profile'](
                    crank_rows, crank_rows[0][0] + (crank_rows[-1][0] - crank_rows[0][0])
                    * i / 53)[1] * cos(theta),
                    api['profile'](crank_rows, crank_rows[0][0]
                    + (crank_rows[-1][0] - crank_rows[0][0]) * i / 53)[0]
                    + api['profile'](crank_rows, crank_rows[0][0]
                    + (crank_rows[-1][0] - crank_rows[0][0]) * i / 53)[2]
                    * sin(theta),
                    crank_rows[0][0] + (crank_rows[-1][0] - crank_rows[0][0])
                    * i / 53),cast)

    _swept_body_x(api,'Engine clutch housing | machined cover',
                  .236,-.411,[(.413,.058,.057),(.432,.072,.067),
                              (.449,.063,.059),(.459,.040,.041)],metal)
    _swept_body_x(api,'Clutch bell | steel annular cap',
                  .245,-.408,[(.456,.043,.043),(.466,.042,.042)],steel)
    api['cylinder']('Clutch hub | through shaft',
                    (.256,.245,-.408),(.283,.245,-.408),.018,hardware,20)

    # A cast water jacket encloses a measured 54 mm bore; water ports sit just
    # below the head, with no air-cooled fin stack on the liquid-cooled barrel.
    _swept_body_y(api,'Water-jacketed cylinder | Ø54 mm bore',.35,-.394,[
        (.289,.047,.053),(.303,.055,.060),(.335,.057,.061),
        (.378,.056,.060),(.402,.060,.064),(.418,.062,.066),
    ],cast)
    _swept_body_y(api,'Cylinder base gasket',.35,-.394,
                  [(.286,.058,.065),(.292,.058,.065)],steel)
    _swept_body_y(api,'Cylinder head | cast water jacket',.35,-.394,[
        (.405,.065,.068),(.419,.074,.076),(.447,.071,.073),
        (.457,.058,.060),(.462,.036,.040),
    ],cast)
    _swept_body_y(api,'Head sealing land | machined alloy',.35,-.394,
                  [(.418,.076,.078),(.423,.076,.078)],metal)

    # Radial side-cover bolts and liquid ports are kept separate for visual read.
    for index in range(8):
        theta=2*pi*index/8
        y=.236+.064*cos(theta)
        z=-.411+.061*sin(theta)
        api['cylinder']('Crankcase cover | M6 bolt',
                        (.454,y,z),(.460,y,z),.0048,hardware,8)
    for side in (-1,1):
        api['cylinder']('Cylinder head | clamping stud',
                        (.35+side*.045,.460,-.394),
                        (.35+side*.045,.472,-.394),.0047,hardware,10)

    api['cylinder']('Spark plug | threaded shell',
                    (.35,.449,-.394),(.35,.493,-.394),.009,hardware,12)
    api['cylinder']('Spark plug | ceramic insulator',
                    (.35,.481,-.394),(.35,.508,-.394),.0065,ivory,12)
    api['tube']('Ignition lead | high-tension cable',[
        (.35,.507,-.394),(.372,.499,-.402),(.402,.465,-.429),
        (.421,.372,-.444),(.428,.276,-.445),
    ],.0055,rubber,radial=3)

    # Reed cage, carburettor and a period-correct competition air silencer.
    api['box']('Reed cage | machined alloy manifold',
               (.425,.288,-.466),(.086,.066,.058),metal,.014)
    api['cylinder']('Diaphragm carburettor | 24 mm throat',
                    (.455,.292,-.466),(.505,.292,-.466),.023,cast,24)
    api['cylinder']('Carburettor | venturi lip',
                    (.502,.292,-.466),(.508,.292,-.466),.026,metal,24)
    api['cylinder']('Carburettor | throttle cap',
                    (.48,.314,-.466),(.48,.343,-.466),.012,steel,16)
    api['cylinder']('Carburettor | fuel banjo',
                    (.481,.268,-.474),(.498,.268,-.474),.009,gold,12)
    api['box']('Intake silencer | rounded plenum',
               (.481,.345,-.567),(.128,.110,.122),mechanical_black,.027)
    api['cylinder']('Intake silencer | inlet collar',
                    (.483,.344,-.630),(.483,.344,-.645),.041,black,24)
    api['cylinder']('Intake silencer | screened mouth',
                    (.483,.344,-.646),(.483,.344,-.650),.032,steel,24)
    for index in range(9):
        z=-.613+index*.011
        api['tube']('Intake silencer | moulded rib',[
            (.420,.294,z),(.420,.396,z),(.542,.396,z),(.542,.294,z),
        ],.0017,steel,poly=True,radial=2)
    api['tube']('Carburettor | fuel feed',[
        (.493,.268,-.474),(.511,.252,-.493),(.518,.237,-.534),
        (.513,.222,-.574),(.465,.213,-.619),(.408,.208,-.641),
    ],.0048,gold,radial=3)

    # External circulation pump on the clutch side with short inlet/outlet stubs.
    _swept_body_x(api,'External water pump | compact volute',
                  .239,-.495,[(.423,.036,.040),(.442,.048,.052),
                              (.458,.043,.047),(.469,.029,.033)],cast)
    api['cylinder']('Water pump | impeller cap',
                    (.468,.239,-.495),(.474,.239,-.495),.030,metal,24)
    for index in range(6):
        theta=2*pi*index/6
        api['cylinder']('Water pump | cover screw',
                        (.472,.239+.036*cos(theta),-.495+.038*sin(theta)),
                        (.477,.239+.036*cos(theta),-.495+.038*sin(theta)),
                        .0035,hardware,8)
    api['tube']('Water pump | short drive shaft',[
        (.244,.241,-.495),(.262,.241,-.495),(.279,.241,-.495),
    ],.007,steel,radial=3)

    # Compact tuned expansion pipe on the right side; section changes are
    # continuous rather than a row of stacked cylinders.
    api['tube']('Exhaust header | stainless elbow',[
        (.385,.409,-.415),(.413,.373,-.430),(.445,.326,-.466),
        (.456,.279,-.498),(.452,.246,-.526),
    ],.017,heat_tint,radial=4)
    _tube_mesh(api,'Exhaust expansion chamber | formed bell',[
        (.452,.246,-.526),(.476,.237,-.564),(.501,.226,-.614),
        (.506,.219,-.675),(.489,.216,-.735),(.457,.220,-.785),
        (.432,.228,-.819),
    ],[.018,.027,.045,.058,.052,.039,.023],heat_tint,32,8)
    for point, tangent, radius in [
        ((.501,.226,-.614),(.03,-.011,-.061),.045),
        ((.506,.219,-.675),(-.012,-.007,-.061),.058),
        ((.489,.216,-.735),(-.032,.003,-.050),.052),
    ]:
        _torus_band(api,'Exhaust chamber | rolled weld seam',point,tangent,
                    radius,.0013,metal,40,6)
    api['tube']('Exhaust stinger | tail tube',[
        (.432,.228,-.819),(.430,.224,-.849),(.432,.219,-.876),
    ],.0125,steel,radial=3)
    api['cylinder']('Exhaust outlet | dark bore',
                    (.432,.219,-.876),(.432,.219,-.880),.008,black,16)
    for x,z in [(.444,-.582),(.447,-.753)]:
        api['tube']('Exhaust chamber | resilient hanger',[
            (x,.219,z),(x+.017,.188,z+.018),(x+.035,.158,z+.036),
        ],.0065,metal,radial=3)


def _create_radiator(api, metal, cast, steel, hardware, rubber):
    # Side-mounted cross-flow radiator above the left pod, where the core is
    # visible from the intended three-quarter and side views.
    centre_x, centre_y, centre_z = -.555,.369,-.248
    api['box']('Radiator | upper header tank',
               (centre_x,.476,centre_z),(.046,.031,.220),metal,.012)
    api['box']('Radiator | lower header tank',
               (centre_x,.264,centre_z),(.042,.031,.213),cast,.010)
    api['box']('Radiator | perimeter side tank left',
               (centre_x,.369,centre_z-.105),(.044,.190,.025),cast,.009)
    api['box']('Radiator | perimeter side tank right',
               (centre_x,.369,centre_z+.105),(.044,.190,.025),cast,.009)
    api['box']('Radiator | fin core',
               (centre_x-.025,.369,centre_z),(.006,.177,.183),steel,.002)
    for index in range(17):
        z=centre_z-.082+index*.01025
        api['box']('Radiator | pressed vertical tube',
                   (centre_x-.029,.369,z),(.003,.174,.0018),cast,.0007)
    for index in range(28):
        y=.286+index*.0061
        api['box']('Radiator | folded horizontal fin',
                   (centre_x-.031,y,centre_z),(.002,.0011,.173),metal,.00035)

    # The mount is a pair of diagonal rubber-isolated stays, not a hidden box.
    for side in (-1,1):
        api['tube']('Radiator | frame stay',[
            (side*.402,.179,-.361),(side*.432,.233,-.329),
            (side*.477,.307,-.302),(side*.511,.350,-.302),
        ],.0075,metal,radial=3)
        api['cylinder']('Radiator | rubber mount isolator',
                        (-.505,.340,centre_z+side*.091),
                        (-.520,.340,centre_z+side*.091),.009,rubber,12)
        api['cylinder']('Radiator | upper bracket bolt',
                        (-.580,.465,centre_z+side*.094),
                        (-.585,.465,centre_z+side*.094),.0048,hardware,8)

    # Filler neck, cap, overflow and hoses routed under the seat to the pump.
    api['cylinder']('Radiator | filler neck',
                    (centre_x,.490,centre_z+.071),
                    (centre_x,.503,centre_z+.071),.012,cast,16)
    api['cylinder']('Radiator | pressure cap',
                    (centre_x,.503,centre_z+.071),
                    (centre_x,.510,centre_z+.071),.016,hardware,16)
    api['tube']('Radiator | overflow line',[
        (-.555,.508,-.177),(-.535,.487,-.135),(-.519,.435,-.114),
        (-.526,.357,-.111),(-.550,.295,-.122),
    ],.0036,rubber,radial=2)
    api['tube']('Coolant | hot upper return',[
        (-.553,.453,-.325),(-.528,.346,-.366),(-.484,.237,-.378),
        (-.402,.198,-.384),(-.296,.187,-.397),(-.117,.192,-.422),
        (.092,.212,-.451),(.265,.267,-.454),(.417,.306,-.427),
    ],.0085,rubber,radial=3)
    api['tube']('Coolant | pump outlet',[
        (.458,.274,-.483),(.397,.217,-.480),(.286,.184,-.465),
        (.101,.179,-.433),(-.108,.175,-.395),(-.304,.179,-.366),
        (-.437,.220,-.325),(-.526,.302,-.303),(-.553,.314,-.171),
    ],.0085,rubber,radial=3)


def _create_chain_and_brake(api, metal, cast, steel, hardware, rubber, black, gold):
    # Rear axle sprocket (72 tooth pitch circle) and 11-tooth engine clutch.
    sprocket = (.139,-.570)
    pinion = (.245,-.408)
    axle_radius, clutch_radius = .102,.044
    api['cylinder']('Rear axle sprocket | steel carrier',
                    (.270,sprocket[0],sprocket[1]),
                    (.286,sprocket[0],sprocket[1]),axle_radius-.004,steel,64)
    api['cylinder']('Rear axle sprocket | alloy inner web',
                    (.264,sprocket[0],sprocket[1]),
                    (.291,sprocket[0],sprocket[1]),.033,metal,40)
    api['cylinder']('Engine pinion | clutch chain wheel',
                    (.263,pinion[0],pinion[1]),
                    (.295,pinion[0],pinion[1]),clutch_radius-.003,steel,36)
    api['cylinder']('Engine pinion | hub',
                    (.256,pinion[0],pinion[1]),
                    (.300,pinion[0],pinion[1]),.020,metal,24)
    for index in range(72):
        theta=2*pi*index/72
        y=sprocket[0]+(axle_radius-.001)*cos(theta)
        z=sprocket[1]+(axle_radius-.001)*sin(theta)
        api['cylinder']('Rear sprocket | tooth',
                        (.268,y,z),(.290,y,z),.0033,hardware,6)
    for index in range(11):
        theta=2*pi*index/11
        y=pinion[0]+(clutch_radius-.0005)*cos(theta)
        z=pinion[1]+(clutch_radius-.0005)*sin(theta)
        api['cylinder']('Clutch pinion | tooth',
                        (.262,y,z),(.296,y,z),.0041,metal,6)

    loop = _chain_path(sprocket,axle_radius,pinion,clutch_radius)
    samples = _resample_loop(loop,.016)
    for x in (.273,.290):
        api['tube']('Competition chain | side plates',
                    [(x,y,z) for y,z in samples],.0042,steel,
                    poly=True,resolution=1,radial=2)
    for y,z in samples[:-1]:
        api['cylinder']('Competition chain | roller',
                        (.270,y,z),(.293,y,z),.0038,hardware,8)

    # Brake rotor is annular, with a vented carrier and mechanical caliper.
    _annular_disc(api,'Rear brake | annular steel rotor',
                  -.310,-.286,.139,-.570,.092,.041,metal,72)
    _annular_disc(api,'Rear brake | floating carrier ring',
                  -.286,-.273,.139,-.570,.050,.032,steel,56)
    api['cylinder']('Rear brake | rotor hat',
                    (-.322,.139,-.570),(-.267,.139,-.570),.039,cast,32)
    for index in range(10):
        theta=2*pi*index/10
        y=.139+.066*cos(theta)
        z=-.570+.066*sin(theta)
        slot=api['box']('Rear brake | swept cooling slot',
                        (-.312,y,z),(.003,.0045,.013),black,.002)
        slot.rotation_euler.x=theta
    for index in range(6):
        theta=2*pi*index/6
        api['cylinder']('Rear brake | floating bobbin',
                        (-.314,.139+.045*cos(theta),-.570+.045*sin(theta)),
                        (-.280,.139+.045*cos(theta),-.570+.045*sin(theta)),
                        .0054,hardware,10)

    api['box']('Rear brake | twin-piston caliper body',
               (-.315,.212,-.526),(.052,.073,.089),cast,.016)
    api['box']('Rear brake | pad backing plate',
               (-.311,.196,-.558),(.047,.017,.051),steel,.006)
    for side in (-1,1):
        api['cylinder']('Rear brake | caliper bridge bolt',
                        (-.347,.228,-.526+side*.023),
                        (-.345,.228,-.526+side*.023),.0052,hardware,8)
    api['tube']('Rear brake | braided hydraulic line',[
        (-.343,.222,-.522),(-.381,.209,-.486),(-.419,.192,-.438),
        (-.421,.185,-.334),(-.409,.183,-.205),(-.365,.180,-.102),
        (-.291,.174,.006),(-.198,.165,.132),(-.102,.166,.294),
    ],.0042,rubber,radial=3)
    api['cylinder']('Rear brake | banjo fitting',
                    (-.345,.234,-.516),(-.362,.234,-.516),.008,gold,12)


def build(api):
    """Replace first-pass vehicle surfaces with the detailed authored set.

    ``api`` is the executing build-kart.py global namespace.  The helper
    functions write to its normal PARTS registry, allowing the existing GLB
    exporter and material grouping pass to handle all new objects.
    """
    api['PART_GROUP'] = 'Kart'
    _remove_first_pass(api)

    materials = {name: api[name] for name in [
        'tubing','metal','cast','steel','gold','hardware','paint','accent',
        'ivory','black','mechanical_black','heat_tint','rubber',
    ]}
    _create_frame_and_controls(api, materials['tubing'],materials['metal'],
                               materials['steel'],materials['hardware'],
                               materials['rubber'],materials['gold'])
    _create_chain_and_brake(api,materials['metal'],materials['cast'],
                            materials['steel'],materials['hardware'],
                            materials['rubber'],materials['black'],materials['gold'])
    _create_engine(api,materials['cast'],materials['metal'],materials['steel'],
                   materials['black'],materials['ivory'],materials['gold'],materials['hardware'],
                   materials['rubber'],materials['heat_tint'],
                   materials['mechanical_black'])
    _create_radiator(api,materials['metal'],materials['cast'],materials['steel'],
                     materials['hardware'],materials['rubber'])
    _create_sidepods(api,materials['paint'],materials['accent'],
                     materials['ivory'],materials['black'])
    _create_nose(api,materials['paint'],materials['accent'],materials['ivory'],
                 materials['mechanical_black'])
    _create_front_bumper(api,materials['metal'],materials['mechanical_black'],
                         materials['paint'],materials['hardware'])
    return True

