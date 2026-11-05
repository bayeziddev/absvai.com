# Writes the HyperFrames project for the tutorial from work/scenes.json (what to show and say), work/timing.json (when
# each sentence of the voice starts and ends) and work/shots/meta.json (where each button sits in each screenshot).
#   python3 video/build.py video/work
# Output: work/guide (index.html, compositions/*.html), work/out/VandarMart-subtitles-bn.srt and the YouTube text.
import json, html, os, shutil, sys

WORK = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'work'))
G = f'{WORK}/guide'
OUT = f'{WORK}/out'
CHANNEL = 'connect with Bayezid'  # the YouTube channel: the corner mark of the whole video
scenes = json.load(open(f'{WORK}/scenes.json', encoding='utf-8'))
timing = json.load(open(f'{WORK}/timing.json', encoding='utf-8'))
meta = json.load(open(f'{WORK}/shots/meta.json', encoding='utf-8'))
os.makedirs(f'{G}/compositions', exist_ok=True)
os.makedirs(OUT, exist_ok=True)

# The project's own files: fonts and GSAP (from npm), the screens, the voice and the sound effects.
A = f'{G}/assets'
for sub in ('fonts', 'shots', 'voice', 'sfx'): os.makedirs(f'{A}/{sub}', exist_ok=True)
FS = f'{WORK}/npm/node_modules/@fontsource/hind-siliguri/files'
for w in (400, 500, 600, 700):
    for sub in ('bengali', 'latin'): shutil.copy(f'{FS}/hind-siliguri-{sub}-{w}-normal.woff2', f'{A}/fonts/')
shutil.copy(f'{WORK}/npm/node_modules/gsap/dist/gsap.min.js', f'{A}/gsap.min.js')
for src, dst, ext in ((f'{WORK}/shots', 'shots', '.png'), (f'{WORK}/voice', 'voice', '.wav'), (f'{WORK}/sfx', 'sfx', '.mp3')):
    for f in os.listdir(src):
        if f.endswith(ext) and not f.endswith('.raw.wav'): shutil.copy(f'{src}/{f}', f'{A}/{dst}/{f}')
json.dump({'$schema': 'https://hyperframes.heygen.com/schema/hyperframes.json', 'registry': 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
           'paths': {'blocks': 'compositions', 'components': 'compositions/components', 'assets': 'assets'}, 'media': {'autoProxy': True}, 'authoringSkill': 'hyperframes'},
          open(f'{G}/hyperframes.json', 'w'), indent=2)
json.dump({'id': 'vandarmart-guide', 'name': 'Vandar Mart full guide'}, open(f'{G}/meta.json', 'w'), indent=2)
E = lambda s: html.escape(str(s), quote=True)
W, H = 1920, 1080

FONTS = ''.join(
    f"@font-face{{font-family:'Hind Siliguri';font-style:normal;font-weight:{w};font-display:block;src:url('assets/fonts/hind-siliguri-{sub}-{w}-normal.woff2') format('woff2');unicode-range:{rng};}}"
    for w in (400, 500, 600, 700)
    for sub, rng in (('bengali', 'U+0951-0952,U+0964-0965,U+0980-09FE,U+1CD0,U+1CD2,U+1CD5-1CD6,U+1CD8,U+1CE1,U+1CEA,U+1CED,U+1CF2,U+1CF5-1CF7,U+200C-200D,U+20B9,U+25CC,U+A8F1'),
                     ('latin', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD,U+2192')))

TOKENS = """
  --ink: #2A1F1A; --cream: #FFF8EC; --orange: #FF7800; --amber: #FFB347; --chili: #B3261E; --leaf: #2E7D32; --wa: #25D366;
  --night: #1B1512; --night-2: #2A201B;
"""
BASE_CSS = f"""
{FONTS}
#root {{ position: absolute; inset: 0; overflow: hidden; font-family: 'Hind Siliguri', 'Poppins', sans-serif; {TOKENS} }}
.bg {{ position: absolute; inset: 0; background: radial-gradient(1200px 700px at 8% 0%, rgba(255,120,0,.20), transparent 60%), radial-gradient(900px 600px at 100% 100%, rgba(46,125,50,.16), transparent 60%), linear-gradient(160deg, #241B17, #15100D); }}
.grain {{ position: absolute; inset: 0; background-image: radial-gradient(rgba(255,255,255,.035) 1px, transparent 1px); background-size: 4px 4px; }}
"""

# Where the screenshots sit on the canvas (before the camera moves).
DESK = dict(x=200, y=168, w=1520, bar=42)          # browser window
PHONE = dict(cx=1330, w=420, bezel=14)            # phone

def chapter_of(i):
    label = ''
    for s in scenes[: i + 1]:
        if s['kind'] == 'chapter': label = f"অংশ {s['num']} · {s['text']}"
    return label

def frame_geometry(img):
    m = meta[img]; vw, vh = m['viewport']['width'], m['viewport']['height']
    if vw < 600:  # phone
        k = PHONE['w'] / vw
        sh = vh * k
        fw, fh = PHONE['w'] + 2 * PHONE['bezel'], sh + 2 * PHONE['bezel']
        fx, fy = PHONE['cx'] - fw / 2, (H - fh) / 2 - 10
        return dict(kind='phone', k=k, fx=fx, fy=fy, fw=fw, fh=fh, cx=fx + PHONE['bezel'], cy=fy + PHONE['bezel'], cw=PHONE['w'], ch=sh)
    k = DESK['w'] / vw
    ch = vh * k
    return dict(kind='desk', k=k, fx=DESK['x'], fy=DESK['y'], fw=DESK['w'], fh=ch + DESK['bar'], cx=DESK['x'], cy=DESK['y'] + DESK['bar'], cw=DESK['w'], ch=ch)

def focus_box(s, g):
    b = meta[s['img']]['boxes'].get(s['focus']) if s.get('focus') else None
    if not b: return None
    pad = 10
    x, y = g['cx'] + b['x'] * g['k'] - pad, g['cy'] + b['y'] * g['k'] - pad
    w, h = b['w'] * g['k'] + 2 * pad, b['h'] * g['k'] + 2 * pad
    # keep the ring inside the visible screen of the device
    x2, y2 = min(x + w, g['cx'] + g['cw'] + 4), min(y + h, g['cy'] + g['ch'] + 4)
    x, y = max(x, g['cx'] - 4), max(y, g['cy'] - 4)
    return dict(x=x, y=y, w=x2 - x, h=y2 - y)

def camera(s, g, box):
    """Scale and offset for the push-in to the focus (screen = offset + scale × canvas point)."""
    if g['kind'] == 'phone':
        if not box: return 1.05, (1 - 1.05) * PHONE['cx'], (1 - 1.05) * 520
        sc = s.get('zoom') or 1.22
        cx, cy = box['x'] + box['w'] / 2, box['y'] + box['h'] / 2
        tx, ty = PHONE['cx'] + 30, 500
        return sc, tx - sc * cx, ty - sc * cy
    if not box: return 1.07, (1 - 1.07) * 960, (1 - 1.07) * DESK['y']
    sc = s.get('zoom') or max(1.0, min(2.0, 1500 / box['w'], 700 / box['h']) * 0.92)
    cx, cy = box['x'] + box['w'] / 2, box['y'] + box['h'] / 2
    tx, ty = 960, 470
    ox, oy = tx - sc * cx, ty - sc * cy
    # never show more than a little background beyond the browser window
    ox = min(ox, 60 - sc * g['fx']); ox = max(ox, W - 60 - sc * (g['fx'] + g['fw']))
    oy = min(oy, 40 - sc * g['fy']); oy = max(oy, H - 150 - sc * (g['fy'] + g['fh']))
    if sc * g['fw'] < W - 120: ox = (W - sc * g['fw']) / 2 - sc * g['fx']
    return sc, ox, oy

CURSOR_SVG = '<svg width="46" height="46" viewBox="0 0 24 24"><path d="M4 2.5 19.5 12l-6.8 1.6L16.6 21l-3 1.4-3.9-7.3L4 19.5z" fill="#fff" stroke="#1B1512" stroke-width="1.4" stroke-linejoin="round"/></svg>'

PREV = {}
def scene_shot(i, s, dur):
    sid = s['id']; g = frame_geometry(s['img']); box = focus_box(s, g)
    sc, ox, oy = camera(s, g, box)
    # the same screenshot as the scene before: the camera carries on from where it was
    start = PREV.get('cam') if PREV.get('img') == s['img'] else None
    PREV.update(img=s['img'], cam=(sc, ox, oy))
    phone = g['kind'] == 'phone'
    move_at, move_len = 1.1, 2.0
    ring_at = move_at + move_len - 0.2
    click_at = ring_at + 0.9
    device = ''
    if phone:
        device = f"""<div class="phone" style="left:{g['fx']:.1f}px;top:{g['fy']:.1f}px;width:{g['fw']:.1f}px;height:{g['fh']:.1f}px">
        <img class="screen" src="assets/shots/{E(s['img'])}.png" alt="" style="left:{PHONE['bezel']}px;top:{PHONE['bezel']}px;width:{g['cw']:.1f}px;height:{g['ch']:.1f}px"><div class="notch"></div></div>"""
    else:
        device = f"""<div class="browser" style="left:{g['fx']:.1f}px;top:{g['fy']:.1f}px;width:{g['fw']:.1f}px;height:{g['fh']:.1f}px">
        <div class="bar"><i></i><i></i><i></i><div class="url" data-layout-ignore>🔒 {E(s.get('url') or 'vandarmart.com')}</div></div>
        <img class="screen" src="assets/shots/{E(s['img'])}.png" alt="" style="left:0;top:{DESK['bar']}px;width:{g['cw']:.1f}px;height:{g['ch']:.1f}px"></div>"""
    ring = f'<div id="{sid}-ring" class="ring" style="left:{box["x"]:.1f}px;top:{box["y"]:.1f}px;width:{box["w"]:.1f}px;height:{box["h"]:.1f}px"><div id="{sid}-glow" class="glow"></div></div>' if box else ''
    cursor = ''
    tl = [
        f"tl.fromTo('#{sid}-card', {{opacity: 0, y: 24}}, {{opacity: 1, y: 0, duration: 0.55, ease: 'power3.out'}}, 0.25);",
        f"tl.fromTo('#{sid}-cam', {{x: {start[1] if start else 0:.1f}, y: {start[2] if start else 0:.1f}, scale: {start[0] if start else 1:.3f}}}, {{x: {ox:.1f}, y: {oy:.1f}, scale: {sc:.3f}, duration: {move_len}, ease: 'power2.inOut'}}, {0.3 if start else move_at});",
    ]
    if not phone and dur > 6:
        tl.append(f"tl.fromTo('#{sid}-card', {{scale: 1}}, {{scale: 0.88, duration: 0.6, ease: 'power2.inOut'}}, 4.2);")
    if box:
        tl.append(f"tl.fromTo('#{sid}-ring', {{opacity: 0, scale: 1.18}}, {{opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2)'}}, {ring_at:.2f});")
        tl.append(f"tl.fromTo('#{sid}-glow', {{opacity: 0.25}}, {{opacity: 0.95, duration: 0.7, ease: 'sine.inOut', repeat: {max(1, int((dur - ring_at - 1) / 0.7) // 2 * 2 - 1)}, yoyo: true}}, {ring_at + 0.45:.2f});")
    if box and s.get('cursor'):
        tx, ty = box['x'] + box['w'] * 0.5, box['y'] + box['h'] * 0.55
        cursor = f'<div id="{sid}-cursor" class="cursor" style="left:{tx:.1f}px;top:{ty:.1f}px">{CURSOR_SVG}<div id="{sid}-ripple" class="ripple"></div></div>'
        tl.append(f"tl.fromTo('#{sid}-cursor', {{opacity: 0, x: 220, y: 160}}, {{opacity: 1, x: 0, y: 0, duration: 0.8, ease: 'power3.out'}}, {click_at - 0.85:.2f});")
        tl.append(f"tl.fromTo('#{sid}-cursor svg', {{scale: 1}}, {{scale: 0.82, duration: 0.09, yoyo: true, repeat: 1, ease: 'power1.inOut'}}, {click_at:.2f});")
        tl.append(f"tl.fromTo('#{sid}-ripple', {{opacity: 0.9, scale: 0.2}}, {{opacity: 0, scale: 1.6, duration: 0.6, ease: 'power2.out'}}, {click_at:.2f});")
    path = f'<div class="path">{E(s["path"])}</div>' if s.get('path') else ''
    card_cls = 'card card-phone' if phone else 'card'
    html_ = f"""<template>
  <style>
    {BASE_CSS}
    #{sid}-cam {{ position: absolute; left: 0; top: 0; width: {W}px; height: {H}px; transform-origin: 0 0; }}
    #root .browser {{ position: absolute; border-radius: 16px; overflow: hidden; background: #fff; box-shadow: 0 40px 90px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08); }}
    #root .bar {{ position: absolute; left: 0; top: 0; right: 0; height: {DESK['bar']}px; background: #F1EAE0; display: flex; align-items: center; gap: 8px; padding: 0 16px; }}
    #root .bar i {{ width: 13px; height: 13px; border-radius: 50%; background: #E2574C; }} #root .bar i:nth-child(2) {{ background: #F4BE4F; }} #root .bar i:nth-child(3) {{ background: #61C454; }}
    #root .url {{ margin-left: 18px; flex: 1; max-width: 760px; height: 28px; border-radius: 14px; background: #fff; color: #5b4c43; font: 500 16px/28px 'Hind Siliguri', sans-serif; padding: 0 14px; }}
    #root .screen {{ position: absolute; display: block; }}
    #root .phone {{ position: absolute; border-radius: 58px; background: #0E0B09; box-shadow: 0 40px 90px rgba(0,0,0,.6), inset 0 0 0 2px #3a302a; }}
    #root .phone .screen {{ border-radius: 44px; overflow: hidden; }}
    #root .notch {{ position: absolute; left: 50%; top: 24px; width: 118px; height: 32px; margin-left: -59px; border-radius: 18px; background: #0E0B09; }}
    #root .ring {{ position: absolute; border-radius: 14px; border: 5px solid var(--orange); opacity: 0; }}
    #root .glow {{ position: absolute; inset: -5px; border-radius: 14px; box-shadow: 0 0 0 9px rgba(255,120,0,.28), 0 0 46px 6px rgba(255,140,30,.7); }}
    #root .cursor {{ position: absolute; width: 46px; height: 46px; margin: -4px 0 0 -6px; opacity: 0; filter: drop-shadow(0 6px 10px rgba(0,0,0,.45)); }}
    #root .cursor svg {{ display: block; transform-origin: 20% 20%; }}
    #root .ripple {{ position: absolute; left: -26px; top: -26px; width: 64px; height: 64px; border-radius: 50%; border: 4px solid var(--orange); opacity: 0; }}
    #root .card {{ position: absolute; left: 56px; top: 22px; transform-origin: 0 0; max-width: 1500px; padding: 14px 28px 16px; border-radius: 22px; background: rgba(255,248,236,.97); box-shadow: 0 24px 60px rgba(0,0,0,.35); opacity: 0; }}
    #root .card .kick {{ font: 600 32px/1.2 'Hind Siliguri', sans-serif; color: var(--chili); letter-spacing: .02em; }}
    #root .card .row {{ display: flex; align-items: center; gap: 22px; margin-top: 2px; }}
    #root .card h1 {{ margin: 0; font: 700 50px/1.2 'Hind Siliguri', sans-serif; color: var(--ink); white-space: nowrap; }}
    #root .card .path {{ display: inline-block; padding: 6px 18px; border-radius: 12px; background: var(--ink); color: var(--cream); font: 600 32px/1.35 'Hind Siliguri', 'Poppins', sans-serif; white-space: nowrap; }}
    #root .card-phone {{ left: 150px; top: 250px; max-width: 760px; background: transparent; box-shadow: none; padding: 0; }}
    #root .card-phone .kick {{ font-size: 30px; color: var(--amber); }}
    #root .card-phone .row {{ display: block; }}
    #root .card-phone h1 {{ font-size: 76px; color: var(--cream); margin-top: 10px; }}
    #root .card-phone .path {{ background: rgba(255,248,236,.12); }}
  </style>
  <div id="root" data-composition-id="{sid}" data-width="{W}" data-height="{H}">
    <div class="bg"></div><div class="grain"></div>
    <div id="{sid}-cam">{device}{ring}{cursor}</div>
    <div id="{sid}-card" class="{card_cls}"><div class="kick">{E(chapter_of(i))}</div><div class="row"><h1>{E(s['title'])}</h1>{path}</div></div>
  </div>
  <script>
    const tl = gsap.timeline({{ paused: true }});
    {chr(10).join('    ' + l for l in tl).strip()}
    window.__timelines["{sid}"] = tl;
  </script>
</template>
"""
    clicks = [click_at] if (box and s.get('cursor')) else []
    return html_, clicks, phone

def scene_title(s, dur):
    sid = s['id']
    return f"""<template>
  <style>
    {BASE_CSS}
    #root .wm {{ position: absolute; left: 0; right: 0; top: 250px; text-align: center; font: 800 150px/1 'Poppins', sans-serif; letter-spacing: -.02em; color: var(--cream); }}
    #root .wm b {{ color: var(--orange); font-weight: 800; }}
    #root .sub {{ position: absolute; left: 0; right: 0; top: 440px; text-align: center; font: 700 62px/1.25 'Hind Siliguri', sans-serif; color: var(--cream); }}
    #root .sub2 {{ position: absolute; left: 0; right: 0; top: 540px; text-align: center; font: 500 34px/1.3 'Hind Siliguri', sans-serif; color: rgba(255,248,236,.78); }}
    #root .pills {{ position: absolute; left: 0; right: 0; top: 640px; display: flex; justify-content: center; gap: 20px; }}
    #root .pill {{ padding: 12px 26px; border-radius: 999px; border: 2px solid rgba(255,179,71,.65); color: var(--amber); font: 600 30px/1.2 'Poppins', sans-serif; background: rgba(255,120,0,.10); }}
    #root .line {{ position: absolute; left: 760px; width: 400px; top: 420px; height: 5px; border-radius: 3px; background: linear-gradient(90deg, var(--orange), var(--amber)); transform-origin: 50% 50%; }}
  </style>
  <div id="root" data-composition-id="{sid}" data-width="{W}" data-height="{H}">
    <div class="bg"></div><div class="grain"></div>
    <div id="{sid}-wm" class="wm">Vandar<b>Mart</b></div>
    <div id="{sid}-line" class="line"></div>
    <div id="{sid}-sub" class="sub">সম্পূর্ণ গাইড: ওয়েবসাইট ও অ্যাডমিন ড্যাশবোর্ড</div>
    <div id="{sid}-sub2" class="sub2">অর্ডার, WhatsApp, ডেলিভারি, পণ্য আর সেটিংস, সব এক ভিডিওতে</div>
    <div id="{sid}-pills" class="pills"><div class="pill">vandarmart.com</div><div class="pill">vandarmart.com/admin</div></div>
  </div>
  <script>
    const tl = gsap.timeline({{ paused: true }});
    tl.fromTo('#{sid}-wm', {{opacity: 0, y: 40, scale: 0.94}}, {{opacity: 1, y: 0, scale: 1, duration: 0.9, ease: 'power3.out'}}, 0.3);
    tl.fromTo('#{sid}-line', {{scaleX: 0}}, {{scaleX: 1, duration: 0.7, ease: 'power3.inOut'}}, 0.9);
    tl.fromTo('#{sid}-sub', {{opacity: 0, y: 26}}, {{opacity: 1, y: 0, duration: 0.7, ease: 'power3.out'}}, 1.3);
    tl.fromTo('#{sid}-sub2', {{opacity: 0, y: 20}}, {{opacity: 1, y: 0, duration: 0.7, ease: 'power3.out'}}, 1.8);
    tl.fromTo('#{sid}-pills .pill', {{opacity: 0, y: 18}}, {{opacity: 1, y: 0, duration: 0.6, stagger: 0.15, ease: 'power3.out'}}, 2.4);
    window.__timelines["{sid}"] = tl;
  </script>
</template>
"""

def scene_chapter(s, dur):
    sid = s['id']
    return f"""<template>
  <style>
    {BASE_CSS}
    #root .num {{ position: absolute; left: 50%; top: 250px; width: 190px; height: 190px; margin-left: -95px; border-radius: 50%; background: linear-gradient(135deg, var(--orange), var(--chili)); color: #fff; text-align: center; font: 700 120px/196px 'Hind Siliguri', sans-serif; box-shadow: 0 30px 70px rgba(255,120,0,.35); }}
    #root .t {{ position: absolute; left: 0; right: 0; top: 490px; text-align: center; font: 700 96px/1.15 'Hind Siliguri', sans-serif; color: var(--cream); }}
    #root .s {{ position: absolute; left: 0; right: 0; top: 625px; text-align: center; font: 500 40px/1.3 'Hind Siliguri', sans-serif; color: var(--amber); }}
  </style>
  <div id="root" data-composition-id="{sid}" data-width="{W}" data-height="{H}">
    <div class="bg"></div><div class="grain"></div>
    <div id="{sid}-num" class="num">{E(s['num'])}</div>
    <div id="{sid}-t" class="t">{E(s['text'])}</div>
    <div id="{sid}-s" class="s">{E(s['sub'])}</div>
  </div>
  <script>
    const tl = gsap.timeline({{ paused: true }});
    tl.fromTo('#{sid}-num', {{opacity: 0, scale: 0.6, rotation: -20}}, {{opacity: 1, scale: 1, rotation: 0, duration: 0.6, ease: 'back.out(1.8)'}}, 0.15);
    tl.fromTo('#{sid}-t', {{opacity: 0, y: 40}}, {{opacity: 1, y: 0, duration: 0.6, ease: 'power3.out'}}, 0.4);
    tl.fromTo('#{sid}-s', {{opacity: 0, y: 24}}, {{opacity: 1, y: 0, duration: 0.6, ease: 'power3.out'}}, 0.7);
    window.__timelines["{sid}"] = tl;
  </script>
</template>
"""

def scene_outro(s, dur):
    sid = s['id']
    return f"""<template>
  <style>
    {BASE_CSS}
    #root .thanks {{ position: absolute; left: 0; right: 0; top: 230px; text-align: center; font: 700 120px/1.15 'Hind Siliguri', sans-serif; color: var(--cream); }}
    #root .wm {{ position: absolute; left: 0; right: 0; top: 420px; text-align: center; font: 800 92px/1 'Poppins', sans-serif; color: var(--cream); }}
    #root .wm b {{ color: var(--orange); font-weight: 800; }}
    #root .url {{ position: absolute; left: 0; right: 0; top: 540px; text-align: center; font: 600 40px/1.2 'Poppins', sans-serif; color: var(--amber); }}
    #root .credit {{ position: absolute; left: 50%; top: 700px; transform-origin: 50% 50%; margin-left: -330px; width: 660px; display: flex; align-items: center; justify-content: center; gap: 16px; padding: 20px 30px; border-radius: 999px;
      background: linear-gradient(135deg, rgba(255,120,0,.20), rgba(255,179,71,.08)); border: 2px solid rgba(255,140,40,.7); color: #FFD9B0; font: 500 30px/1.2 'Poppins', sans-serif; }}
    #root .credit b {{ font: 800 40px/1 'Poppins', sans-serif; color: var(--orange); }}
    #root .site {{ position: absolute; left: 0; right: 0; top: 806px; text-align: center; color: rgba(255,248,236,.75); font: 500 30px/1.2 'Poppins', sans-serif; }}
    #root .site b {{ color: var(--amber); font-weight: 700; }}
  </style>
  <div id="root" data-composition-id="{sid}" data-width="{W}" data-height="{H}">
    <div class="bg"></div><div class="grain"></div>
    <div id="{sid}-thanks" class="thanks">ধন্যবাদ</div>
    <div id="{sid}-wm" class="wm">Vandar<b>Mart</b></div>
    <div id="{sid}-url" class="url">vandarmart.com</div>
    <div id="{sid}-credit" class="credit"><span>Designed &amp; developed by</span><b>Bayezid</b></div>
    <div id="{sid}-site" class="site">sayadbayezid.com · YouTube: <b>{E(CHANNEL)}</b></div>
  </div>
  <script>
    const tl = gsap.timeline({{ paused: true }});
    tl.fromTo('#{sid}-thanks', {{opacity: 0, y: 40}}, {{opacity: 1, y: 0, duration: 0.8, ease: 'power3.out'}}, 0.2);
    tl.fromTo('#{sid}-wm', {{opacity: 0, y: 30}}, {{opacity: 1, y: 0, duration: 0.7, ease: 'power3.out'}}, 0.8);
    tl.fromTo('#{sid}-url', {{opacity: 0}}, {{opacity: 1, duration: 0.6}}, 1.2);
    tl.fromTo('#{sid}-credit', {{opacity: 0, scale: 0.9}}, {{opacity: 1, scale: 1, duration: 0.7, ease: 'back.out(1.6)'}}, 2.0);
    tl.fromTo('#{sid}-site', {{opacity: 0}}, {{opacity: 1, duration: 0.6}}, 2.5);
    window.__timelines["{sid}"] = tl;
  </script>
</template>
"""

# ── Assemble ──
t = 0.0
hosts, audio, sfx, caps, chapters, srt = [], [], [], [], [], []
phone_scene = {}
for i, s in enumerate(scenes):
    dur = timing[s['id']]['duration']
    if s['kind'] == 'shot':
        body, clicks, phone = scene_shot(i, s, dur)
        phone_scene[s['id']] = phone
        for c in clicks: sfx.append(('click-soft', t + c + 0.02, 0.55))
    elif s['kind'] == 'title': body = scene_title(s, dur); sfx.append(('whoosh', t + 0.25, 0.35))
    elif s['kind'] == 'chapter': body = scene_chapter(s, dur); sfx.append(('whoosh-short', t + 0.1, 0.45)); chapters.append((t, f"অংশ {s['num']}: {s['text']}"))
    else: body = scene_outro(s, dur); sfx.append(('pop', t + 2.05, 0.4))
    open(f"{G}/compositions/{s['id']}.html", 'w', encoding='utf-8').write(body)
    hosts.append(f'      <div id="{s["id"]}" data-composition-id="{s["id"]}" data-composition-src="compositions/{s["id"]}.html" data-start="{t:.3f}" data-duration="{dur:.3f}" data-track-index="1" data-track-kind="graphics" data-width="{W}" data-height="{H}"></div>')
    audio.append(f'      <audio id="vo-{s["id"]}" class="clip" src="assets/voice/{s["id"]}.wav" data-start="{t:.3f}" data-duration="{dur:.3f}" data-track-index="4" data-volume="1"></audio>')
    for j, ln in enumerate(timing[s['id']]['lines']):
        a, b = t + ln['start'] - 0.08, t + ln['end'] + 0.25
        caps.append((f"cap-{s['id']}-{j}", a, b - a, ln['text'], bool(s['kind'] == 'shot' and phone_scene.get(s['id']))))
        srt.append((t + ln['start'], t + ln['end'] + 0.1, ln['text']))
    t += dur
TOTAL = round(t, 3)

cap_html = '\n'.join(f'        <div id="{cid}" class="clip cap{" cap-side" if side else ""}" data-start="{a:.3f}" data-duration="{d:.3f}"><span class="t">{E(text)}</span></div>' for cid, a, d, text, side in caps)
cap_tl = '\n'.join(f"      tl.fromTo('#{cid} .t', {{opacity: 0, y: 14}}, {{opacity: 1, y: 0, duration: 0.22, ease: 'power2.out'}}, {a:.3f});" for cid, a, d, text, side in caps)
SFX_LEN = {'whoosh': 0.574, 'whoosh-short': 0.574, 'click-soft': 0.365, 'pop': 0.72}
sfx_html = '\n'.join(f'      <audio id="sfx-{k}" class="clip" src="assets/sfx/{n}.mp3" data-start="{a:.3f}" data-duration="{SFX_LEN[n]}" data-track-index="5" data-volume="{v}"></audio>' for k, (n, a, v) in enumerate(sfx))

index = f"""<!doctype html>
<html lang="bn">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="assets/gsap.min.js"></script>
    <style>
      {FONTS}
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #15100D; }}
      #root {{ position: relative; width: 100%; height: 100%; }}
      #captions {{ position: absolute; inset: 0; pointer-events: none; z-index: 50; }}
      #captions .cap {{ position: absolute; left: 50%; bottom: 46px; width: 1500px; margin-left: -750px; text-align: center; }}
      #captions .cap .t {{ display: inline-block; max-width: 1500px; padding: 14px 30px 16px; border-radius: 18px; background: rgba(21,16,13,.86); color: #FFF8EC; font: 600 38px/1.45 'Hind Siliguri', sans-serif; box-shadow: 0 12px 34px rgba(0,0,0,.35); }}
      #captions .cap-side {{ left: 150px; bottom: auto; top: 545px; width: 800px; margin-left: 0; text-align: left; }}
      #captions .cap-side .t {{ background: none; box-shadow: none; padding: 0; font: 500 44px/1.5 'Hind Siliguri', sans-serif; color: rgba(255,248,236,.92); }}
      #chrome {{ position: absolute; inset: 0; pointer-events: none; z-index: 60; }}
      #chrome .mark {{ position: absolute; right: 36px; top: 26px; display: flex; align-items: center; gap: 12px; padding: 9px 20px 9px 12px; border-radius: 999px; background: rgba(21,16,13,.78); box-shadow: 0 8px 24px rgba(0,0,0,.3); }}
      #chrome .mark i {{ width: 40px; height: 28px; border-radius: 8px; background: #FF0033; position: relative; }}
      #chrome .mark i::after {{ content: ""; position: absolute; left: 16px; top: 8px; border-style: solid; border-width: 6px 0 6px 11px; border-color: transparent transparent transparent #fff; }}
      #chrome .mark span {{ font: 500 28px/1 'Poppins', sans-serif; color: #FFF8EC; letter-spacing: -.005em; }}
      #chrome .mark b {{ font-weight: 800; color: #FF9A3C; }}
      #chrome .track {{ position: absolute; left: 0; right: 0; bottom: 0; height: 6px; background: rgba(255,255,255,.08); }}
      #chrome-bar {{ position: absolute; left: 0; bottom: 0; height: 6px; width: 1920px; transform-origin: 0 50%; background: linear-gradient(90deg, #FF7800, #FFB347); }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{TOTAL}" data-width="{W}" data-height="{H}">
{chr(10).join(hosts)}
      <div id="captions" data-composition-id="captions" data-track-kind="captions" data-start="0" data-duration="{TOTAL}" data-track-index="2" data-width="{W}" data-height="{H}">
{cap_html}
        <script>
          (function () {{
            const tl = gsap.timeline({{ paused: true }});
{cap_tl}
            window.__timelines = window.__timelines || {{}};
            window.__timelines["captions"] = tl;
          }})();
        </script>
      </div>
      <div id="chrome" data-composition-id="chrome" data-track-kind="graphics" data-start="0" data-duration="{TOTAL}" data-track-index="3" data-width="{W}" data-height="{H}">
        <div class="mark"><i></i><span>connect with <b>Bayezid</b></span></div>
        <div class="track"></div><div id="chrome-bar"></div>
        <script>
          (function () {{
            const tl = gsap.timeline({{ paused: true }});
            tl.fromTo('#chrome-bar', {{ scaleX: 0 }}, {{ scaleX: 1, duration: {TOTAL}, ease: 'none' }}, 0);
            window.__timelines = window.__timelines || {{}};
            window.__timelines["chrome"] = tl;
          }})();
        </script>
      </div>
{chr(10).join(audio)}
{sfx_html}
    </div>
    <script>
      window.__timelines = window.__timelines || {{}};
      window.__timelines["main"] = gsap.timeline({{ paused: true }});
    </script>
  </body>
</html>
"""
open(f'{G}/index.html', 'w', encoding='utf-8').write(index)

def ts(x, comma=True):
    h, m, s = int(x // 3600), int(x % 3600 // 60), x % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace('.', ',') if comma else f"{m}:{int(s):02d}" if h == 0 else f"{h}:{m:02d}:{int(s):02d}"
open(f'{OUT}/VandarMart-subtitles-bn.srt', 'w', encoding='utf-8').write('\n'.join(f"{k + 1}\n{ts(a)} --> {ts(b)}\n{text}\n" for k, (a, b, text) in enumerate(srt)))
MARKS = {'intro': 'শুরু', 'home': 'হোম পেজ ও পণ্য', 'checkout1': 'বাংলায় চেকআউট ও ডেলিভারি চার্জ', 'done': 'অর্ডার সম্পন্ন ও ইনভয়েস ডাউনলোড',
         'account': 'ক্রেতার অ্যাকাউন্ট, ট্র্যাকিং ও ল্যান্ডিং পেজ', 'login': 'অ্যাডমিনে লগইন', 'dash': 'ওভারভিউ ড্যাশবোর্ড', 'orders': 'অর্ডারের তালিকা ও বিস্তারিত',
         'wa1': 'WhatsApp-এ অর্ডার যাচাই', 'move': 'অর্ডার কনফার্ম করা', 'edit1': 'অর্ডার এডিট ও ফ্রি ডেলিভারি', 'courier': 'Steadfast ও Pathao কুরিয়ারে পাঠানো',
         'incomplete': 'অসম্পূর্ণ ও ম্যানুয়াল অর্ডার', 'reports': 'রিপোর্ট', 'products': 'নতুন পণ্য যোগ', 'quick': 'দাম ও স্টক আপডেট', 'zones': 'ডেলিভারি চার্জ ঠিক করা',
         'landing-admin': 'ল্যান্ডিং পেজ, কুপন ও রিভিউ', 'website': 'ওয়েবসাইট, ব্যানার ও ইমেইল', 'settings': 'সেটিংস ও হেল্প সেন্টার', 'outro': 'শেষ কথা'}
t, rows = 0.0, []
for s in scenes:
    if s['id'] in MARKS: rows.append(f"{int(t // 60)}:{int(t % 60):02d} {MARKS[s['id']]}")
    t += timing[s['id']]['duration']
open(f'{OUT}/YouTube-title-description.txt', 'w', encoding='utf-8').write(f"""শিরোনাম (Title):
Vandar Mart সম্পূর্ণ গাইড | ওয়েবসাইট ও অ্যাডমিন ড্যাশবোর্ড বাংলায় (অর্ডার, WhatsApp, ডেলিভারি)

বিবরণ (Description):
Vandar Mart (vandarmart.com)-এর সম্পূর্ণ বাংলা গাইড। ক্রেতারা কীভাবে অর্ডার করেন, আর অ্যাডমিন ড্যাশবোর্ড থেকে কীভাবে অর্ডার কনফার্ম করবেন, WhatsApp-এ ক্রেতাকে মেসেজ পাঠাবেন, অর্ডার এডিট করবেন, কুরিয়ারে পাঠাবেন, নতুন পণ্য যোগ করবেন আর ডেলিভারি চার্জ ঠিক করবেন, সব এক ভিডিওতে।

{chr(10).join(rows)}

🛒 ওয়েবসাইট: https://vandarmart.com
💻 Designed & developed by Bayezid: https://sayadbayezid.com
▶️ আরও ভিডিওর জন্য সাবস্ক্রাইব করুন: {CHANNEL}

#VandarMart #ConnectWithBayezid #বাংলাটিউটোরিয়াল #ecommerce #Bangladesh

ট্যাগ (Tags):
Vandar Mart, vandarmart, connect with Bayezid, Bayezid, অনলাইন শপ, ই-কমার্স, অ্যাডমিন ড্যাশবোর্ড, বাংলা টিউটোরিয়াল, ক্যাশ অন ডেলিভারি, রাজবাড়ী, WhatsApp অর্ডার
""")
print('total', TOTAL, 's,', len(scenes), 'scenes,', len(caps), 'captions,', len(sfx), 'sounds')
