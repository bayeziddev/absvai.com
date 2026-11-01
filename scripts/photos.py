#!/usr/bin/env python3
"""
Turns source photos into the responsive WebP sets the storefront serves (worker/src/lib/images.ts, PHOTO_SETS):

  wide  full-width banners   <name>.webp 2560 px wide + copies 640, 960, 1280, 1920
  sq    square pictures      <name>.webp 1024 x 1024  + copies 240, 480, 720

Usage: python3 scripts/photos.py public/img/photos < list
  (one "name kind zoom source" per line; source is a URL or a file path; zoom 1 keeps the whole picture)
"""
import io
import os
import sys
import urllib.request

from PIL import Image, ImageFilter, ImageOps

SETS = {
    'wide': {'main': 2560, 'copies': [640, 960, 1280, 1920], 'quality': 80},
    'sq': {'main': 1024, 'copies': [240, 480, 720], 'quality': 82},
}


def load(source: str) -> Image.Image:
    if source.startswith('https://'):
        req = urllib.request.Request(source, headers={'User-Agent': 'Mozilla/5.0 (photo import)'})
        data = urllib.request.urlopen(req, timeout=60).read()
    else:
        with open(source, 'rb') as f:
            data = f.read()
    im = Image.open(io.BytesIO(data))
    return ImageOps.exif_transpose(im).convert('RGB')


def crop(im: Image.Image, kind: str, zoom: float) -> Image.Image:
    w, h = im.size
    if kind == 'sq':
        side = min(w, h)
        w = h = side
    cw, ch = w / zoom, h / zoom
    left, top = (im.width - cw) / 2, (im.height - ch) / 2
    return im.crop((round(left), round(top), round(left + cw), round(top + ch)))


def resized(im: Image.Image, width: int) -> Image.Image:
    if im.width <= width:
        return im
    out = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    # Shrinking a photo a lot softens it a little: a light sharpen keeps small copies crisp.
    if width / im.width <= 0.75:
        out = out.filter(ImageFilter.UnsharpMask(radius=0.7, percent=45, threshold=2))
    return out


def main() -> None:
    out_dir = sys.argv[1]
    for line in sys.stdin.read().splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        name, kind, zoom, source = line.split()
        spec = SETS[kind]
        im = crop(load(source), kind, float(zoom))
        folder = os.path.join(out_dir, kind)
        os.makedirs(folder, exist_ok=True)
        for width, path in [(spec['main'], f'{name}.webp')] + [(w, f'{name}-{w}.webp') for w in spec['copies']]:
            resized(im, width).save(os.path.join(folder, path), 'WEBP', quality=spec['quality'], method=6)
        print(f'{kind}/{name}: from {im.width}x{im.height}')


if __name__ == '__main__':
    main()
