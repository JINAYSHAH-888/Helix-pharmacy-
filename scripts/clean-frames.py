#!/usr/bin/env python3
"""Remove baked-in reference-site chrome (nav, logo, side text, pagination dots,
chat widget, sparkle) from the capsule frame sequence by reconstructing the
locked-camera paper background from adjacent clean pixels."""
import os, sys, numpy as np
from PIL import Image

W, H = 1920, 1080

# box = (x1, y1, x2, y2), direction: 'h' samples left/right paper, 'v' samples top/bottom
BOXES = [
    ((36, 20, 366, 104), 'v'),      # top-left HELIXIS logo
    ((1355, 24, 1902, 98), 'v'),    # top-right nav (Our work / Our method / search / menu)
    ((92, 108, 1850, 128), 'v'),    # full-width horizontal rule under header
    ((28, 130, 98, 1072), 'h'),     # left side: rotated text, ticks, dots, "+"
    ((1844, 150, 1908, 1072), 'h'), # right side: rotated text, ticks, small marker
    ((832, 992, 1082, 1030), 'v'),  # bottom-center pagination dots
    ((1774, 944, 1900, 1058), 'h'), # bottom-right chat widget bubble
    ((1714, 862, 1812, 962), 'h'),  # sparkle / 4-point star
    ((1498, 480, 1646, 526), 'h'),  # media controls glyph (late frames)
]

RING = 9          # pixels of paper to sample just outside the box
rng = np.random.default_rng(7)

def fill(arr, box, direction):
    x1, y1, x2, y2 = box
    x1 = max(0, x1); y1 = max(0, y1); x2 = min(W, x2); y2 = min(H, y2)
    bw, bh = x2 - x1, y2 - y1
    if bw <= 0 or bh <= 0:
        return
    if direction == 'h':
        for j, y in enumerate(range(y1, y2)):
            left = arr[y, max(0, x1 - RING):x1].astype(np.float64)
            right = arr[y, x2:min(W, x2 + RING)].astype(np.float64)
            lc = left.mean(0) if len(left) else None
            rc = right.mean(0) if len(right) else None
            if lc is None: lc = rc
            if rc is None: rc = lc
            t = np.linspace(0, 1, bw)[:, None]
            row = lc[None, :] * (1 - t) + rc[None, :] * t
            arr[y, x1:x2] = row
    else:  # vertical
        for i, x in enumerate(range(x1, x2)):
            top = arr[max(0, y1 - RING):y1, x].astype(np.float64)
            bot = arr[y2:min(H, y2 + RING), x].astype(np.float64)
            tc = top.mean(0) if len(top) else None
            bc = bot.mean(0) if len(bot) else None
            if tc is None: tc = bc
            if bc is None: bc = tc
            t = np.linspace(0, 1, bh)[:, None]
            col = tc[None, :] * (1 - t) + bc[None, :] * t
            arr[y1:y2, x] = col

def process(src, dst):
    im = Image.open(src).convert('RGB')
    arr = np.asarray(im).astype(np.float64).copy()
    for box, d in BOXES:
        fill(arr, box, d)
    # subtle paper grain over the reconstructed regions so they match texture
    for (x1, y1, x2, y2), _ in BOXES:
        x1 = max(0, x1); y1 = max(0, y1); x2 = min(W, x2); y2 = min(H, y2)
        noise = rng.normal(0, 2.1, (y2 - y1, x2 - x1, 1))
        arr[y1:y2, x1:x2] += noise
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    Image.fromarray(arr).save(dst, quality=92)

if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'test'
    srcdir = 'frames'
    if mode == 'test':
        out = sys.argv[2]
        os.makedirs(out, exist_ok=True)
        for n in (1, 25, 50, 75, 100):
            f = f'frame_{n:03d}.jpg'
            process(os.path.join(srcdir, f), os.path.join(out, f))
        print('test frames written to', out)
    else:
        out = 'frames_clean'
        os.makedirs(out, exist_ok=True)
        files = sorted(os.listdir(srcdir))
        for f in files:
            if f.lower().endswith('.jpg'):
                process(os.path.join(srcdir, f), os.path.join(out, f))
        print('cleaned', len(files), 'frames ->', out)
