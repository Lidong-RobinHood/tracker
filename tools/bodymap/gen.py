#!/usr/bin/env python3
"""Body-map generator. All shapes below are hand-authored coordinates.

Original artwork created for this project on 2026-11-19 (see docs/AUTHORSHIP.md).

Usage (repo root):
    python3 tools/bodymap/gen.py                 # rewrites src/ui/bodymap-art.js (path data only)
    python3 tools/bodymap/gen.py --preview DIR   # also writes preview.html, front/back/combined
                                                 # SVGs and icons/<muscle>.svg into DIR (not shipped)
Then run `node tools/build-precache.mjs` and `npm test`.
Colours are not part of the artwork: app.css paints .bm-body / .bm-muscle / .is-* with tokens.

Shapes are written for the screen-left half of the figure (x <= 100) and
mirrored about x = 100, so both sides are identical by construction.
Only absolute M/L/C/Q/Z commands are used so mirroring is a pure x -> 200-x.
"""
import os, re, json

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ART_MODULE = os.path.join(ROOT, 'src', 'ui', 'bodymap-art.js')
OUT = None  # preview directory, set by --preview
W, H = 200, 440
CX = 100

# ---------------------------------------------------------------- helpers
def fmt(v):
    v = round(v, 1)
    s = ('%.1f' % v).rstrip('0').rstrip('.')
    return '0' if s == '-0' else s

TOK = re.compile(r'[MLCQZ]|-?\d+(?:\.\d+)?')

def norm(d, mirror=False):
    out, nums = [], []
    def flush():
        for i in range(0, len(nums), 2):
            x, y = nums[i], nums[i + 1]
            if mirror:
                x = 2 * CX - x
            out.append(fmt(x) + ' ' + fmt(y))
        nums.clear()
    for t in TOK.findall(d):
        if t.isalpha():
            flush(); out.append(t)
        else:
            nums.append(float(t))
    flush()
    s = ' '.join(out)
    s = re.sub(r'([MLCQZ]) ', r'\1', s)
    s = re.sub(r' ([MLCQZ])', r'\1', s)
    return s

def pts(d):
    n = [float(t) for t in TOK.findall(d) if not t.isalpha()]
    return list(zip(n[0::2], n[1::2]))

def ellipse(cx, cy, rx, ry):
    k = 0.5523
    return (f'M{cx} {cy-ry} C{cx+k*rx} {cy-ry} {cx+rx} {cy-k*ry} {cx+rx} {cy} '
            f'C{cx+rx} {cy+k*ry} {cx+k*rx} {cy+ry} {cx} {cy+ry} '
            f'C{cx-k*rx} {cy+ry} {cx-rx} {cy+k*ry} {cx-rx} {cy} '
            f'C{cx-rx} {cy-k*ry} {cx-k*rx} {cy-ry} {cx} {cy-ry} Z')

def blob(p, t=0.32):
    """Closed smooth curve through points p (Catmull-Rom -> cubic)."""
    # Centripetal Catmull-Rom (alpha 0.5) -> cubic Bezier. Handles unevenly
    # spaced points without loops or overshoot; t scales roundness.
    n = len(p)
    f = 6 * t * 0.85
    def dist(a, b):
        return max(((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.25, 1e-3)
    d = f'M{p[0][0]} {p[0][1]}'
    for i in range(n):
        p0, p1, p2, p3 = p[i - 1], p[i], p[(i + 1) % n], p[(i + 2) % n]
        d01, d12, d23 = dist(p0, p1), dist(p1, p2), dist(p2, p3)
        c = []
        for ax in (0, 1):
            m1 = d12 * ((p1[ax] - p0[ax]) / d01 - (p2[ax] - p0[ax]) / (d01 + d12) + (p2[ax] - p1[ax]) / d12)
            m2 = d12 * ((p2[ax] - p1[ax]) / d12 - (p3[ax] - p1[ax]) / (d12 + d23) + (p3[ax] - p2[ax]) / d23)
            c.append((p1[ax] + f * m1 / 3, p2[ax] - f * m2 / 3))
        c1 = (c[0][0], c[1][0]); c2 = (c[0][1], c[1][1])
        d += f' C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]} {p2[1]}'
    return d + ' Z'

import math
def arm(p, deg=5.5, c=(56, 94)):
    """Swing hanging-arm points outward about the shoulder joint."""
    a = math.radians(deg); ca, sa = math.cos(a), math.sin(a)
    return [(round(c[0] + (x - c[0]) * ca - (y - c[1]) * sa, 1),
             round(c[1] + (x - c[0]) * sa + (y - c[1]) * ca, 1)) for x, y in p]

# ---------------------------------------------------------------- silhouette
# (left half unless noted). Landmarks: head 10-63, chin 63, shoulders ~86,
# waist ~184, crotch ~242, knee ~326, ankle ~406, sole 430.
HEAD = ('M100 10 C110.5 10 118 19 118 33 C118 45 113.5 54.5 106.5 60.8 '
        'C104 63.2 102 64.5 100 64.5 C98 64.5 96 63.2 93.5 60.8 '
        'C86.5 54.5 82 45 82 33 C82 19 89.5 10 100 10 Z')
NECK = 'M90 50 C91 62 90 72 87 84 L113 84 C110 72 109 62 110 50 Z'  # full

BODY_HALF = [
    # torso
    blob([(100, 72), (90, 74), (72, 82), (56, 88), (49, 100), (52, 116),
          (58, 130), (64, 158), (68, 184), (65, 200), (62.5, 218), (70, 240),
          (100, 246)], 0.22),
    # upper arm
    blob(arm([(60, 90), (47, 94), (41.5, 110), (39, 136), (35.5, 170), (46, 177.5),
          (55, 170), (60, 146), (61.5, 124)]), 0.25),
    # forearm
    blob(arm([(37, 166), (30.5, 184), (28.5, 210), (29, 238), (39, 239), (43.5, 218),
          (51, 196), (55, 174), (47, 166)]), 0.25),
    # hand
    blob(arm([(29, 234), (25, 252), (27, 268), (33, 275), (38, 268), (41, 250),
          (40, 234)]), 0.25),
    # thigh
    blob([(66, 214), (60, 236), (59, 268), (65, 302), (72, 328), (84, 334),
          (94, 328), (97, 296), (100, 262), (100, 232), (90, 214)], 0.22),
    # lower leg
    blob([(74, 318), (68, 334), (64, 358), (69, 384), (78, 404), (91, 406),
          (93, 386), (96, 362), (97, 340), (93, 320)], 0.22),
    # foot
    blob([(81, 400), (78, 414), (76.5, 425), (81, 430.5), (94, 430.5), (98, 426),
          (95, 414), (91.5, 400)], 0.2),
]

# ---------------------------------------------------------------- muscles
FRONT = {
    'traps': [blob([(92, 62), (89.5, 72), (80, 79), (67, 84.5), (78, 87), (89, 84.5), (93.5, 76)], 0.22)],
    'shoulders': [blob(arm([(72, 87), (58, 88), (47.5, 98), (45.5, 114), (48.5, 133),
                        (55, 124), (60, 108), (66, 96)], 2.5), 0.25)],
    'chest': [blob([(98, 89), (76, 89), (65, 97), (62, 110), (68, 124),
                    (82, 130), (98, 126)], 0.22)],
    'biceps': [blob(arm([(55.5, 122), (59.5, 134), (58.5, 150), (54.5, 165), (46.5, 169.5),
                     (40.5, 160), (41.5, 142), (47.5, 128)]), 0.25)],
    'forearms': [blob(arm([(40.5, 172), (33, 186), (30.5, 206), (31.5, 228), (37.5, 229.5),
                       (42.5, 210), (50.5, 191), (53, 177)]), 0.25)],
    'abs': [
        blob([(99, 134), (89, 134), (88, 150), (99, 151)], 0.08),
        blob([(99, 155), (88, 155), (88, 171), (99, 172)], 0.08),
        blob([(99, 176), (88, 176), (89, 192), (99, 193)], 0.08),
        blob([(99, 197), (89, 197), (92, 218), (99, 224)], 0.1),
        # obliques
        blob([(84, 136), (72, 132), (66, 150), (68, 172), (74, 192), (86, 206),
              (85, 176)], 0.22),
    ],
    'quads': [
        blob([(64, 222), (59, 248), (60, 280), (66, 304), (74, 320), (79, 312),
              (77, 284), (72, 252), (69, 230)], 0.22),
        blob([(79, 222), (73, 234), (78, 262), (81, 290), (83, 310), (89, 298),
              (92, 268), (91, 240), (86, 226)], 0.22),
        blob([(92, 279), (97, 293), (95.5, 310), (89.5, 320), (84.5, 317), (86, 302),
              (88.5, 289)], 0.27),
    ],
    'calves': [
        blob([(70.5, 336), (66.5, 356), (71, 380), (79, 390), (81.5, 364), (78.5, 340)], 0.25),
        blob([(89, 334), (95.5, 348), (94.5, 372), (88, 384), (85, 358)], 0.25),
    ],
}

BACK = {
    'traps': [blob([(100, 63), (94.5, 64.5), (91.5, 70), (87, 78), (76, 82.5), (68, 86),
                    (78, 92), (89, 108), (95, 128), (100, 142)], 0.2)],
    'shoulders': [blob(arm([(70, 90), (58, 89), (47.5, 98), (45.5, 114), (48.5, 133),
                        (55, 124), (60, 110), (66, 98)], 2.5), 0.25)],
    'back': [
        blob([(74, 94), (64, 102), (66, 118), (78, 124), (90, 120), (86, 106)], 0.25),
        blob([(91, 125), (74, 127), (62, 121), (64, 150), (72, 184), (86, 196),
              (97, 198), (97.5, 158)], 0.22),
    ],
    'triceps': [
        blob(arm([(48.5, 125), (52, 140), (51, 157), (47.5, 168), (41, 161.5), (40.8, 144), (43.5, 131)]), 0.25),
        blob(arm([(55.5, 120), (60, 134), (59, 151), (55.5, 166), (53.2, 160), (54.8, 142), (52.5, 127)]), 0.25),
    ],
    'forearms': [blob(arm([(40.5, 172), (33, 186), (30.5, 206), (31.5, 228), (37.5, 229.5),
                       (42.5, 210), (50.5, 191), (53, 177)]), 0.25)],
    'glutes': [blob([(98, 214), (88, 206), (76, 206), (67, 216), (65, 234),
                     (73, 250), (86, 256), (97, 254)], 0.26)],
    'hamstrings': [
        blob([(66, 262), (66, 286), (72, 310), (78, 322), (81, 300), (80, 264)], 0.24),
        blob([(83, 262), (84, 292), (86, 322), (92, 318), (97, 290), (97, 262)], 0.24),
    ],
    'calves': [
        blob([(73, 330), (67, 350), (70, 372), (80, 384), (83, 358), (81, 334)], 0.25),
        blob([(85, 330), (95, 342), (96, 364), (88, 388), (84, 360)], 0.25),
    ],
}

ORDER = {
    'front': ['traps', 'shoulders', 'chest', 'biceps', 'forearms', 'abs', 'quads', 'calves'],
    'back': ['traps', 'shoulders', 'back', 'triceps', 'forearms', 'glutes', 'hamstrings', 'calves'],
}
DATA = {'front': FRONT, 'back': BACK}

# ---------------------------------------------------------------- styles
STYLE = (
    '.bm{--bm-body-d:#e3e6eb;--bm-idle-d:#c4cad3;--bm-hot-d:#ff5a36;'
    '--bm-1-d:#ffd9c7;--bm-2-d:#ffb08f;--bm-3-d:#ff8257;--bm-4-d:#f2542d;'
    '--bm-recovering-d:#ef5350;--bm-ready-d:#f4b740;--bm-fresh-d:#3fbf7f}'
    '@media(prefers-color-scheme:dark){.bm{--bm-body-d:#2a2e35;--bm-idle-d:#454c57;'
    '--bm-1-d:#5a3428;--bm-2-d:#8a4229;--bm-3-d:#c4512c;--bm-4-d:#ff6a3d}}'
    '.bm-body{fill:var(--bm-body,var(--bm-body-d))}'
    '.bm-muscle{fill:var(--bm-idle,var(--bm-idle-d));stroke:var(--bm-body,var(--bm-body-d));'
    'stroke-width:1.6;stroke-linejoin:round}'
    '.bm .is-hot{fill:var(--bm-hot,var(--bm-hot-d))}'
    '.bm .is-1{fill:var(--bm-1,var(--bm-1-d))}.bm .is-2{fill:var(--bm-2,var(--bm-2-d))}'
    '.bm .is-3{fill:var(--bm-3,var(--bm-3-d))}.bm .is-4{fill:var(--bm-4,var(--bm-4-d))}'
    '.bm .is-recovering{fill:var(--bm-recovering,var(--bm-recovering-d))}'
    '.bm .is-ready{fill:var(--bm-ready,var(--bm-ready-d))}'
    '.bm .is-fresh{fill:var(--bm-fresh,var(--bm-fresh-d))}'
)

def body_paths():
    out = [HEAD, NECK]
    for d in BODY_HALF:
        out += [d, None]  # None = mirrored partner marker
    res = []
    for d in out[:2]:
        res.append(norm(d))
    for d in BODY_HALF:
        res.append(norm(d)); res.append(norm(d, True))
    return res

def muscle_paths(view):
    """One <path> per muscle group: all its shapes (left + right) as subpaths.
    Muscle shapes never overlap, so combining them is safe for fill."""
    res = []
    for m in ORDER[view]:
        parts = []
        for d in DATA[view][m]:
            parts += [norm(d), norm(d, True)]
        res.append((m, ''.join(parts)))
    return res

def view_group(view, dx=0, clip=None, values=None):
    g = []
    for d in body_paths():
        if clip is None or intersects(d, clip):
            g.append(f'<path class="bm-body" d="{d}"/>')
    for m, d in muscle_paths(view):
        if clip is None or intersects(d, clip):
            st = (values or {}).get(m)
            cls = 'bm-muscle' + (f' is-{st}' if st is not None else '')
            g.append(f'<path class="{cls}" data-muscle="{m}" d="{d}"/>')
    t = f' transform="translate({dx} 0)"' if dx else ''
    return f'<g data-view="{view}"{t}>\n' + '\n'.join(g) + '\n</g>'

def intersects(d, box):
    p = pts(d)
    xs = [a for a, _ in p]; ys = [b for _, b in p]
    x, y, w, h = box
    return not (max(xs) < x or min(xs) > x + w or max(ys) < y or min(ys) > y + h)

def svg(view, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" class="bm" viewBox="0 0 {W} {H}" '
            f'role="img" aria-label="{title}">\n<style>{STYLE}</style>\n'
            + view_group(view) + '\n</svg>\n')

def combined():
    return (f'<svg xmlns="http://www.w3.org/2000/svg" class="bm" viewBox="0 0 {2*W} {H}" '
            f'role="img" aria-label="Body map, front and back">\n<style>{STYLE}</style>\n'
            + view_group('front') + '\n' + view_group('back', W) + '\n</svg>\n')

# ---------------------------------------------------------------- icons
ICONS = {  # muscle: (view, square crop x, y, size)
    'chest': ('front', 52, 66, 96),
    'shoulders': ('front', 40, 58, 120),
    'biceps': ('front', 14, 96, 92),
    'forearms': ('front', 0, 162, 80),
    'abs': ('front', 52, 120, 96),
    'quads': ('front', 46, 212, 108),
    'calves': ('back', 52, 314, 96),
    'traps': ('back', 52, 46, 96),
    'back': ('back', 42, 82, 116),
    'triceps': ('back', 14, 96, 92),
    'glutes': ('back', 54, 186, 92),
    'hamstrings': ('back', 46, 236, 108),
}
ICON_STYLE = (
    '.bm{--bm-body-d:#e8ebef;--bm-idle-d:#d9dee5;--bm-hot-d:#ff5a36}'
    '@media(prefers-color-scheme:dark){.bm{--bm-body-d:#30343c;--bm-idle-d:#3d434d}}'
    '.bm-body{fill:var(--bm-body,var(--bm-body-d))}'
    '.bm-muscle{fill:var(--bm-idle,var(--bm-idle-d));stroke:var(--bm-body,var(--bm-body-d));'
    'stroke-width:1.6;stroke-linejoin:round}'
    '.bm .is-hot{fill:var(--bm-hot,var(--bm-hot-d))}'
)

def icon(m):
    view, x, y, s = ICONS[m]
    box = (x, y, s, s)
    g = []
    for d in body_paths():
        if intersects(d, box):
            g.append(f'<path class="bm-body" d="{d}"/>')
    for mm, d in muscle_paths(view):
        if intersects(d, box):
            cls = 'bm-muscle is-hot' if mm == m else 'bm-muscle'
            g.append(f'<path class="{cls}" data-muscle="{mm}" d="{d}"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" class="bm bm-icon" viewBox="{x} {y} {s} {s}" '
            f'role="img" aria-label="{m}">\n<style>{ICON_STYLE}</style>\n'
            + '\n'.join(g) + '\n</svg>\n')

# ---------------------------------------------------------------- JS module
def js():
    front = view_group('front'); back = view_group('back')
    return f'''// Body map: original artwork, hand-authored. No third-party assets.
// Usage: import {{ bodyMap, MUSCLES }} from './bodymap.js';
//   el.append(bodyMap({{ view: 'front', values: {{ chest: 3, abs: 'ready' }} }}));
// values: number 0-4 -> class is-0..is-4, or 'recovering' | 'ready' | 'fresh' | 'hot'.

const NS = 'http://www.w3.org/2000/svg';
export const VIEWBOX = '0 0 {W} {H}';
export const MUSCLES = {json.dumps(ORDER)};
export const STYLE = {json.dumps(STYLE)};
export const FRONT = {json.dumps(front)};
export const BACK = {json.dumps(back)};

const STATES = new Set(['recovering', 'ready', 'fresh', 'hot']);
const STATE_CLASSES = ['is-0', 'is-1', 'is-2', 'is-3', 'is-4', 'is-recovering', 'is-ready', 'is-fresh', 'is-hot'];

function stateClass(v) {{
  if (typeof v === 'number' && Number.isFinite(v)) return 'is-' + Math.max(0, Math.min(4, Math.round(v)));
  if (typeof v === 'string' && STATES.has(v)) return 'is-' + v;
  return null;
}}

/** Apply values to an existing body-map SVG (front, back or combined). */
export function setValues(svg, values = {{}}) {{
  for (const p of svg.querySelectorAll('.bm-muscle')) {{
    p.classList.remove(...STATE_CLASSES);
    const v = Object.prototype.hasOwnProperty.call(values, p.dataset.muscle) ? values[p.dataset.muscle] : undefined;
    const c = stateClass(v);
    if (c) p.classList.add(c);
  }}
  return svg;
}}

/** Build an SVGElement. view: 'front' | 'back' | 'both'. Markup is static; values only set classes. */
export function bodyMap({{ view = 'front', values = {{}}, title, includeStyle = true, doc = document }} = {{}}) {{
  const both = view === 'both';
  const groups = both ? FRONT + BACK.replace('<g data-view="back">', '<g data-view="back" transform="translate({W} 0)">')
                      : (view === 'back' ? BACK : FRONT);
  const src = '<svg xmlns="' + NS + '" class="bm" viewBox="0 0 ' + (both ? {2*W} : {W}) + ' {H}">' +
              (includeStyle ? '<style>' + STYLE + '</style>' : '') + groups + '</svg>';
  const parsed = new DOMParser().parseFromString(src, 'image/svg+xml').documentElement;
  const svg = doc.importNode(parsed, true);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', String(title ?? (both ? 'Body map, front and back' : 'Body map, ' + view)));
  return setValues(svg, values);
}}
'''

DARK = ('--bm-body:#2a2e35;--bm-idle:#454c57;--bm-1:#5a3428;--bm-2:#8a4229;'
        '--bm-3:#c4512c;--bm-4:#ff6a3d')
LABEL = {'chest': 'Chest', 'shoulders': 'Shoulders', 'biceps': 'Biceps', 'forearms': 'Forearms',
         'abs': 'Abs', 'quads': 'Quads', 'calves': 'Calves', 'traps': 'Traps', 'back': 'Back',
         'triceps': 'Triceps', 'glutes': 'Glutes', 'hamstrings': 'Hamstrings'}

def inline(view, h, values=None, extra=''):
    return (f'<svg class="bm" viewBox="0 0 {W} {H}" style="height:{h}px{extra}">'
            + view_group(view, values=values) + '</svg>')

def preview():
    css = STYLE + ICON_STYLE.replace('.bm{', '.ic{').replace('@media(prefers-color-scheme:dark){.bm{', '@media(x){.ic{')
    big = ''
    for theme in ('light', 'dark'):
        big += f'<div class="panel {theme}"><div class="cap">{theme} · idle</div>'
        big += inline('front', 400) + inline('back', 400) + '</div>'
    big += '<div class="panel light"><div class="cap">light · intensity is-1…is-4</div>'
    big += inline('front', 400, {'chest': 4, 'shoulders': 3, 'biceps': 2, 'forearms': 1, 'abs': 3, 'quads': 4, 'calves': 1, 'traps': 2})
    big += inline('back', 400, {'traps': 3, 'shoulders': 2, 'back': 4, 'triceps': 3, 'forearms': 1, 'glutes': 4, 'hamstrings': 2, 'calves': 1}) + '</div>'
    singles = ''
    seq = [('front', m) for m in ORDER['front']] + [('back', m) for m in ORDER['back']]
    for v, m in seq:
        singles += (f'<figure>{inline(v, 190, {m: "hot"})}<figcaption>{LABEL[m]}<span>{v}</span></figcaption></figure>')
    rec_f = {'chest': 'recovering', 'shoulders': 'ready', 'biceps': 'recovering', 'forearms': 'fresh',
             'abs': 'ready', 'quads': 'fresh', 'calves': 'fresh', 'traps': 'ready'}
    rec_b = {'traps': 'ready', 'shoulders': 'ready', 'back': 'recovering', 'triceps': 'recovering',
             'forearms': 'fresh', 'glutes': 'ready', 'hamstrings': 'fresh', 'calves': 'fresh'}
    phones = ''
    for theme in ('light', 'dark'):
        phones += (f'<div class="phone {theme}"><div class="ph-t">Recovery</div><div class="ph-row">'
                   + inline('front', 140, rec_f) + inline('back', 140, rec_b) + '</div>'
                   '<div class="legend"><i class="r"></i>Recovering<i class="y"></i>Ready<i class="g"></i>Fresh</div></div>')
    icons = ''
    for theme in ('light', 'dark'):
        row = ''
        for m in ICONS:
            ic = icon(m).split('\n', 2)[2].rsplit('</svg>', 1)[0]
            vb = re.search(r'viewBox="([^"]+)"', icon(m)).group(1)
            one = lambda sz: f'<svg class="bm ic" viewBox="{vb}" width="{sz}" height="{sz}">{ic}</svg>'
            row += f'<div class="ic-c">{one(44)}{one(28)}<div>{LABEL[m]}</div></div>'
        icons += f'<div class="icons {theme}">{row}</div>'
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Body map preview</title>
<style>{css}
body{{margin:0;padding:24px;background:#f4f5f7;font:13px/1.3 -apple-system,system-ui,sans-serif;color:#1d2129;width:1452px}}
h2{{font-size:14px;margin:22px 0 10px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:#69707d}}
h1{{font-size:20px;margin:0 0 4px}} .sub{{color:#69707d;margin-bottom:8px}}
.row{{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}}
.panel{{border-radius:14px;padding:12px 16px;display:flex;gap:8px;position:relative;padding-top:30px}}
.cap{{position:absolute;top:9px;left:14px;font-size:11px;opacity:.6}}
.light{{background:#fff}} .dark{{background:#16181d;color:#e7e9ee;{DARK}}}
.dark .ic{{--bm-body:#30343c;--bm-idle:#3d434d}}
.ic{{--bm-body:#e8ebef;--bm-idle:#d9dee5}}
.singles{{display:grid;grid-template-columns:repeat(8,1fr);gap:10px;background:#fff;border-radius:14px;padding:12px}}
figure{{margin:0;text-align:center}} figcaption{{font-weight:600;margin-top:4px}} figcaption span{{display:block;font-weight:400;font-size:11px;color:#8a909b}}
.phone{{width:375px;border-radius:22px;padding:16px;box-sizing:border-box;--bm-recovering:#ef5350;--bm-ready:#f4b740;--bm-fresh:#3fbf7f}}
.ph-t{{font-weight:600;font-size:15px;margin-bottom:8px}} .ph-row{{display:flex;justify-content:center;gap:28px}}
.legend{{display:flex;gap:6px;align-items:center;justify-content:center;font-size:11px;margin-top:10px;opacity:.85}}
.legend i{{width:10px;height:10px;border-radius:3px;display:inline-block;margin-left:8px}} .r{{background:#ef5350}} .y{{background:#f4b740}} .g{{background:#3fbf7f}}
.icons{{display:flex;gap:6px;padding:12px;border-radius:14px;margin-bottom:10px}}
.ic-c{{width:104px;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px}}
.ic-c svg{{border-radius:8px}} .light .ic-c svg{{background:#f6f7f9}} .dark .ic-c svg{{background:#1f2227}}
svg{{display:block}}
</style></head><body>
<h1>Body map</h1><div class="sub">Original hand-authored SVG · viewBox 0 0 {W} {H} · front + back · 12 muscle groups</div>
<h2>Views (400 px tall)</h2><div class="row">{big}</div>
<h2>Each group highlighted alone</h2><div class="singles">{singles}</div>
<h2>Phone · 140 px tall · recovery states</h2><div class="row">{phones}</div>
<h2>Icons · 44 px and 28 px</h2>{icons}
</body></html>"""

# ---------------------------------------------------------------- app module (data only)
def art_module():
    """src/ui/bodymap-art.js: the shapes as data. src/ui/bodymap.js builds the SVG elements."""
    body = body_paths()
    views = {v: [[m, d] for m, d in muscle_paths(v)] for v in ORDER}
    icons = {}
    for m, (view, x, y, s) in ICONS.items():
        box = (x, y, s, s)
        icons[m] = {
            'view': view, 'box': [x, y, s],
            'body': [i for i, d in enumerate(body) if intersects(d, box)],
            'muscles': [mm for mm, d in muscle_paths(view) if intersects(d, box)],
        }
    dump = lambda o: json.dumps(o, separators=(',', ':'))
    return (
        '// Generated by tools/bodymap/gen.py. Do not edit; edit the generator and run it again.\n'
        '// Original body-map artwork, hand-authored as coordinates for this project (docs/AUTHORSHIP.md).\n'
        '// Path data only; src/ui/bodymap.js builds the SVG, app.css colours it with tokens.\n\n'
        f"export const VIEWBOX = [0, 0, {W}, {H}];\n"
        '/** Silhouette paths, shared by front and back. */\n'
        f'export const BODY = Object.freeze({dump(body)});\n'
        '/** Per view: [muscleId, path] in paint order (each path holds the left and right shapes). */\n'
        f'export const VIEW_PATHS = Object.freeze({dump(views)});\n'
        '/** Per muscle icon: source view, square crop [x, y, size], body path indices and muscles to draw. */\n'
        f'export const ICON_CROPS = Object.freeze({dump(icons)});\n'
    )

if __name__ == '__main__':
    import sys
    open(ART_MODULE, 'w').write(art_module())
    print('wrote', os.path.relpath(ART_MODULE, ROOT))
    if '--preview' in sys.argv:
        OUT = sys.argv[sys.argv.index('--preview') + 1]
        os.makedirs(os.path.join(OUT, 'icons'), exist_ok=True)
        open(os.path.join(OUT, 'preview.html'), 'w').write(preview())
        open(os.path.join(OUT, 'front.svg'), 'w').write(svg('front', 'Body map, front'))
        open(os.path.join(OUT, 'back.svg'), 'w').write(svg('back', 'Body map, back'))
        open(os.path.join(OUT, 'bodymap.svg'), 'w').write(combined())
        for m in ICONS:
            open(os.path.join(OUT, 'icons', m + '.svg'), 'w').write(icon(m))
        open(os.path.join(OUT, 'bodymap.js'), 'w').write(js())
        print('preview in', OUT)
