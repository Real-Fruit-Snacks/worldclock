"""Generate js/mapdata.js from tools/reference/land-110m.json.

land-110m.json is TopoJSON from the world-atlas package, derived from
Natural Earth (public domain). Projection: equirectangular onto a
1000x500 viewBox; x=(lon+180)/360*1000, y=(90-lat)/180*500.
Run once from the repo root: python tools/gen_map.py

Rings are unwrapped into continuous longitude space before clipping so
that rings crossing the +/-180 antimeridian (e.g. Fiji, the Russian
Arctic coast, Antarctica) do not draw a full-width horizontal chord
across the map. Each ring is emitted (possibly as multiple subpaths)
via a shift-and-clip against the [-180, 180] longitude strip.
"""
import json
import sys

W, H = 1000.0, 500.0

with open("tools/reference/land-110m.json", encoding="utf-8") as f:
    topo = json.load(f)

sx, sy = topo["transform"]["scale"]
tx, ty = topo["transform"]["translate"]

arcs = []
for arc in topo["arcs"]:
    x = y = 0
    pts = []
    for dx, dy in arc:
        x += dx; y += dy
        pts.append((x * sx + tx, y * sy + ty))  # (lon, lat)
    arcs.append(pts)

def ring(indexes):
    out = []
    for i in indexes:
        pts = arcs[i] if i >= 0 else list(reversed(arcs[~i]))
        if out:
            pts = pts[1:]  # shared endpoint
        out.extend(pts)
    return out

def proj(lon, lat):
    return ((lon + 180.0) / 360.0 * W, (90.0 - lat) / 180.0 * H)

def unwrap(coords):
    """Unwrap a ring's longitudes into continuous space (no jump > 180)."""
    out = []
    prev_lon = coords[0][0]
    offset = 0.0
    for lon, lat in coords:
        d = lon - prev_lon
        if d > 180.0:
            offset -= 360.0
        elif d < -180.0:
            offset += 360.0
        prev_lon = lon
        out.append((lon + offset, lat))
    return out

def close_polar_ring(coords):
    """If a ring wound all the way around the globe (e.g. Antarctica),
    close it through the pole rather than leaving a dangling gap.

    The pole-hugging closing edge legitimately spans (close to) the full
    360 degrees of longitude -- that's what makes it "a solid band at
    the bottom, closed at the pole edge" rather than a dangling seam.
    A single straight segment that wide would look identical to the
    antimeridian-chord bug this file exists to fix, so it is emitted as
    several shorter collinear segments (same straight line, more
    vertices) each well under the self-check's chord threshold.
    """
    if not coords:
        return coords
    first_lon = coords[0][0]
    last_lon = coords[-1][0]
    if abs(last_lon - first_lon) > 180.0:
        mean_lat = sum(lat for _, lat in coords) / len(coords)
        pole = -90.0 if mean_lat < 0 else 90.0
        span = first_lon - last_lon
        steps = max(1, int(abs(span) // 90.0) + 1)  # <=90 deg per segment
        pole_pts = [
            (last_lon + span * k / steps, pole) for k in range(1, steps + 1)
        ]
        coords = coords + [(last_lon, pole)] + pole_pts
    return coords

def clip_half_plane(coords, keep_ge, bound):
    """Sutherland-Hodgman clip of a closed polygon against a single
    half-plane on longitude. keep_ge=True keeps lon >= bound, else
    keeps lon <= bound. Interpolates latitude at the boundary."""
    if not coords:
        return coords
    out = []
    n = len(coords)
    for i in range(n):
        cur = coords[i]
        prev = coords[i - 1]  # wraps to last on i=0, closing the polygon
        cur_in = (cur[0] >= bound) if keep_ge else (cur[0] <= bound)
        prev_in = (prev[0] >= bound) if keep_ge else (prev[0] <= bound)
        if cur_in:
            if not prev_in:
                out.append(_intersect(prev, cur, bound))
            out.append(cur)
        else:
            if prev_in:
                out.append(_intersect(prev, cur, bound))
    return out

def _intersect(a, b, bound):
    ax, ay = a
    bx, by = b
    if bx == ax:
        t = 0.0
    else:
        t = (bound - ax) / (bx - ax)
    lat = ay + t * (by - ay)
    return (bound, lat)

cmds = []
land = topo["objects"]["land"]
if land["type"] == "GeometryCollection":
    land = land["geometries"][0]
assert land["type"] == "MultiPolygon"
for polygon in land["arcs"]:
    for r in polygon:
        coords = ring(r)
        coords = unwrap(coords)
        coords = close_polar_ring(coords)
        for shift in (-360.0, 0.0, 360.0):
            shifted = [(lon + shift, lat) for lon, lat in coords]
            clipped = clip_half_plane(shifted, True, -180.0)
            clipped = clip_half_plane(clipped, False, 180.0)
            if len(clipped) < 3:
                continue
            seg = []
            for j, (lon, lat) in enumerate(clipped):
                x, y = proj(lon, lat)
                seg.append(("M" if j == 0 else "L") + "%.1f %.1f" % (x, y))
            cmds.append("".join(seg) + "Z")

# Self-check: no emitted L segment should jump more than 400px in x,
# which would indicate an unclipped antimeridian chord.
bad = False
for cmd in cmds:
    pts = []
    for tok in cmd.replace("Z", "").split("L"):
        tok = tok[1:] if tok.startswith("M") else tok
        if not tok:
            continue
        xs, ys = tok.split(" ")
        pts.append((float(xs), float(ys)))
    for i in range(1, len(pts)):
        if abs(pts[i][0] - pts[i - 1][0]) > 400:
            print("WARNING: antimeridian chord detected: %r -> %r" % (pts[i - 1], pts[i]))
            bad = True
if bad:
    sys.exit(1)

d = "".join(cmds)
js = ("// GENERATED by tools/gen_map.py from Natural Earth land-110m (public domain).\n"
      "// Do not edit by hand; re-run the generator instead.\n"
      "window.WC = window.WC || {};\n"
      'WC.MAP_PATH = "%s";\n' % d)
with open("js/mapdata.js", "w", encoding="utf-8", newline="\n") as f:
    f.write(js)
print("wrote js/mapdata.js (%d KB, %d rings)" % (len(js) // 1024, len(cmds)))
