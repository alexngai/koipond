"""Renders the extension's icons and its Chrome Web Store images, with headless Chrome and Pillow.

    npm run build && python3 store/render.py

- public/icons/icon{16,32,48,128}.png, from store/icon.svg (the 128 with the store's 16 px margin);
- store/screenshots/*.png, 1280x800: the new tab page in each scene;
- store/promo-440x280.png, the small promo tile.
"""

import os
import subprocess
import tempfile
import time
import urllib.request
from datetime import datetime, timezone

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORE = os.path.join(ROOT, 'store')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PORT = 4179
PROFILE = tempfile.mkdtemp()


def zone(hour):
    """A time zone where it's now about `hour` o'clock, so the clock in a shot suits its scene."""
    ahead = (hour - datetime.now(timezone.utc).hour) % 24
    ahead = ahead - 24 if ahead > 14 else ahead
    return f'Etc/GMT{-ahead:+d}' if ahead else 'Etc/GMT'  # (Etc/GMT-5 is 5 hours ahead of UTC)


def shoot(url, out, w, h, wait_ms=0, hour=None):
    flags = ['--headless=new', f'--user-data-dir={PROFILE}', '--hide-scrollbars', '--force-device-scale-factor=1',
             '--default-background-color=00000000', f'--window-size={w},{h}', f'--screenshot={out}']
    if wait_ms:  # a page that animates: let it run a while first (WebGL in software)
        flags += [f'--virtual-time-budget={wait_ms}', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    env = {**os.environ, 'TZ': zone(hour)} if hour is not None else None
    subprocess.run([CHROME, *flags, url], check=True, capture_output=True, env=env)


def icons():
    big = os.path.join(PROFILE, 'icon.png')
    shoot('file://' + os.path.join(STORE, 'icon.svg'), big, 512, 512)
    art = Image.open(big).convert('RGBA')
    os.makedirs(os.path.join(ROOT, 'public/icons'), exist_ok=True)
    for size in (16, 32, 48):
        art.resize((size, size), Image.LANCZOS).save(os.path.join(ROOT, f'public/icons/icon{size}.png'))
    store = Image.new('RGBA', (128, 128))  # the store wants the art 96 px across, in 16 px of margin
    store.paste(art.resize((96, 96), Image.LANCZOS), (16, 16))
    store.save(os.path.join(ROOT, 'public/icons/icon128.png'))


SHOTS = [
    ('1-pond-day', 'scene=pond&time=day'),
    ('2-reef-day', 'scene=ocean&time=day'),
    ('3-stream-day', 'scene=stream&time=day'),
    ('4-pond-night', 'scene=pond&time=night'),
    ('5-reef-night', 'scene=ocean&time=night&search=0'),
]


def foam(path):
    """How much of a shot is near-white (foam, mostly)."""
    grey = Image.open(path).convert('L')
    return sum(grey.histogram()[226:]) / (grey.width * grey.height)


def screenshots(base):
    os.makedirs(os.path.join(STORE, 'screenshots'), exist_ok=True)
    for name, query in SHOTS:
        # Each visit lays the stream out afresh, sometimes with its foam all over the middle: take a few
        # and keep the clearest. (The other scenes need just the one.)
        tries = [os.path.join(PROFILE, f'{name}-{k}.png') for k in range(6 if 'stream' in query else 1)]
        for t in tries:
            shoot(f'{base}?{query}', t, 1280, 800, wait_ms=6000, hour=21 if 'night' in query else 10)
        best = min(tries, key=foam)
        Image.open(best).convert('RGB').save(os.path.join(STORE, 'screenshots', name + '.png'))  # plain RGB, as the store wants


def promo(base):
    """The pond, with the name over it."""
    raw = os.path.join(PROFILE, 'promo.png')
    shoot(f'{base}?scene=pond&time=day&clock=0&search=0', raw, 880, 560, wait_ms=6000)
    tile = Image.open(raw).convert('RGB').resize((440, 280), Image.LANCZOS)
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 34)
    text, at = 'Koi Pond Simulator', (220, 140)
    shadow = Image.new('RGBA', tile.size)
    ImageDraw.Draw(shadow).text(at, text, font=font, anchor='mm', fill=(0, 0, 0, 170))
    tile.paste(shadow.filter(ImageFilter.GaussianBlur(6)), (0, 2), shadow.filter(ImageFilter.GaussianBlur(6)))
    ImageDraw.Draw(tile).text(at, text, font=font, anchor='mm', fill=(255, 255, 255))
    tile.save(os.path.join(STORE, 'promo-440x280.png'))


if __name__ == '__main__':
    icons()
    server = subprocess.Popen(['npx', 'vite', 'preview', '--port', str(PORT), '--strictPort'], cwd=ROOT,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        base = f'http://localhost:{PORT}/newtab.html'
        for _ in range(50):
            try:
                urllib.request.urlopen(base)
                break
            except OSError:
                time.sleep(0.2)
        screenshots(base)
        promo(base)
    finally:
        server.terminate()
