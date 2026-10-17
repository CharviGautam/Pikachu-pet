"""Prepare Ishq's Pikachu reference screenshots as transparent runtime sprites.

Reads  assets/reference/ishq/{happy,jump,sleep,angry,pokeball}.png
Writes public/assets/ishq/<name>.png  (transparent, cropped, <=512px)

Two background-removal paths:
  * flood fill (happy/jump/sleep/pokeball): border-seeded fill that grows across
    local colour steps (handles white, baked-in checkerboards and flat orange
    backstops) while capping total drift from the seed colour.
  * predicate fill (angry): that frame is a screengrab with a gold radial burst
    behind the character, so a plain colour-distance fill either eats the body or
    keeps the rays. Instead: seed from the border and keep filling only while a
    pixel is ray-coloured (warm hue, red above blue) or vignette-dark-and-grey.
    The character's green-olive body and its dark outline stop the fill.
    The kept frame is then hue-corrected from the screengrab's green cast back
    to Pikachu yellow.
A 1px alpha erosion removes the leftover halo.

Run:  .venv/Scripts/python tools/prepare_ishq_sprites.py
"""

from __future__ import annotations

import colorsys
import os
from collections import deque

from PIL import Image, ImageFilter

SRC = os.path.join("assets", "reference", "ishq")
DST = os.path.join("public", "assets", "ishq")

STEP_TOL = 26.0     # max colour jump between adjacent background pixels
SEED_TOL = 90.0     # max total drift from the seed colour that started the fill
ERODE_PX = 1
MAX_SIDE = 512


def dist(a, b):
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2]))


def border_seed_colors(px, w, h) -> set[tuple[int, int, int]]:
    """Border colours that look like background (dominant perimeter clusters).

    Characters that touch the frame (Pikachu's feet) would otherwise seed the
    fill and eat the body, so only quantised colours covering >=5% of the
    perimeter may act as background roots.
    """
    counts: dict[tuple[int, int, int], int] = {}

    def bump(x, y):
        r, g, b = px[x, y][:3]
        key = (r // 32, g // 32, b // 32)
        counts[key] = counts.get(key, 0) + 1

    for x in range(w):
        bump(x, 0)
        bump(x, h - 1)
    for y in range(h):
        bump(0, y)
        bump(w - 1, y)
    perimeter = 2 * (w + h)
    need = max(4, int(0.05 * perimeter))
    keys = {k for k, c in counts.items() if c >= need}
    seeds: set[tuple[int, int, int]] = set()
    for x in range(w):
        for y in (0, h - 1):
            r, g, b = px[x, y][:3]
            if (r // 32, g // 32, b // 32) in keys:
                seeds.add((r, g, b))
    for y in range(h):
        for x in (0, w - 1):
            r, g, b = px[x, y][:3]
            if (r // 32, g // 32, b // 32) in keys:
                seeds.add((r, g, b))
    return seeds


def is_angry_background(r: int, g: int, b: int) -> bool:
    """True for the gold burst + dark vignette, False for the character.

    Rays: warm (red clearly above blue) and red >= green — every gold/brown tone
    of the burst matches. The body is olive-green (green above red), the outline
    is neutral dark, so neither is touched.
    Vignette: dark AND near-grey (the outline is dark too but neutral-grey test
    keeps only the bluish slate of the screengrab's border).
    """
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    if max(r, g, b) - min(r, g, b) <= 25 and luma < 75:
        return True
    if r > 50 and (r - b) > 35 and g <= r:
        return True
    return False


def drop_small_fragments(fg: Image.Image, min_px: int) -> Image.Image:
    """Keep only the large foreground blobs (character), drop ray crumbs/flies."""
    w, h = fg.size
    src = fg.load()
    seen = bytearray(w * h)
    comps: list[list[int]] = []
    for start in range(w * h):
        if seen[start] or src[start % w, start // w] == 0:
            continue
        stack = [start]
        seen[start] = 1
        cells: list[int] = []
        while stack:
            i = stack.pop()
            cells.append(i)
            x, y = i % w, i // w
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    j = ny * w + nx
                    if not seen[j] and src[nx, ny] != 0:
                        seen[j] = 1
                        stack.append(j)
        comps.append(cells)
    if not comps:
        return fg
    keep = {i for cells in comps if len(cells) >= min_px for i in cells}
    out = fg.copy()
    op = out.load()
    for i in range(w * h):
        if i not in keep:
            op[i % w, i // w] = 0
    return out


def remove_background_predicate(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()

    bg = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()

    def seed(x: int, y: int) -> None:
        i = y * w + x
        if bg[i]:
            return
        if is_angry_background(*px[x, y][:3]):
            bg[i] = 1
            q.append((x, y))

    for x in range(w):
        seed(x, 0)
        seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        seed(w - 1, y)

    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h:
                j = ny * w + nx
                if not bg[j] and is_angry_background(*px[nx, ny][:3]):
                    bg[j] = 1
                    q.append((nx, ny))

    r, g, b, a = im.split()
    fg = Image.frombytes("L", (w, h), bytes(0 if v else 255 for v in bg))
    fg = fg.filter(ImageFilter.MinFilter(3))
    fg = drop_small_fragments(fg, min_px=max(400, (w * h) // 260))
    a = Image.composite(a, Image.new("L", (w, h), 0), fg)
    return Image.merge("RGBA", (r, g, b, a))


def drop_white_pockets(im: Image.Image, min_px: int = 500) -> Image.Image:
    """Remove large enclosed near-white background pockets.

    The border-seeded fill cannot reach white patches that the character's own
    outline encloses (e.g. the patch between Pikachu's ears in `happy`), which
    show up as white blobs behind the sprite at runtime. Any connected
    near-white region with a pure-white core and >= `min_px` pixels is dropped;
    small white details (eye glints, teeth) are far below the threshold.
    """
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()

    def is_white(x: int, y: int) -> bool:
        r, g, b, a = px[x, y]
        return a > 150 and min(r, g, b) >= 230

    seen = bytearray(w * h)
    for y0 in range(h):
        for x0 in range(w):
            i = y0 * w + x0
            if seen[i] or not is_white(x0, y0):
                continue
            q: deque[tuple[int, int]] = deque([(x0, y0)])
            seen[i] = 1
            cells: list[tuple[int, int]] = []
            has_core = False
            while q:
                x, y = q.popleft()
                cells.append((x, y))
                r, g, b, _a = px[x, y]
                if min(r, g, b) >= 250:
                    has_core = True
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        j = ny * w + nx
                        if not seen[j] and is_white(nx, ny):
                            seen[j] = 1
                            q.append((nx, ny))
            if has_core and len(cells) >= min_px:
                for x, y in cells:
                    px[x, y] = (0, 0, 0, 0)
    return im


def warm_to_pikachu_yellow(im: Image.Image) -> Image.Image:
    """Hue-correct the screengrab's olive-green cast back to Pikachu yellow.

    Only pixels whose hue sits in the green band are touched; cheeks, eyes and
    line art keep their colour.
    """
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            hh, ss, vv = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            hue = hh * 360
            if 55 <= hue <= 115 and ss > 0.12:
                # pull hue down to the 47-50° band Pikachu yellow lives in and
                # lift the screengrab's dull value up to the art-bible yellow
                new_hue = 47.0 + (115.0 - hue) / (115.0 - 55.0) * 3.0
                new_ss = min(1.0, ss * 1.45)
                new_vv = min(1.0, vv * 1.55)
                nr, ng, nb = colorsys.hsv_to_rgb(new_hue / 360, new_ss, new_vv)
                px[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), a)
    return im


def remove_background(im: Image.Image, barrier_luma: int | None = None) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()

    bg = bytearray(w * h)          # 1 = background
    seen = bytearray(w * h)
    q: deque[tuple[int, int, tuple]] = deque()
    seed_colors = border_seed_colors(px, w, h)

    def is_barrier(x, y) -> bool:
        if barrier_luma is None:
            return False
        r, g, b = px[x, y][:3]
        return (0.299 * r + 0.587 * g + 0.114 * b) < barrier_luma

    def seed(x, y):
        i = y * w + x
        if seen[i]:
            return
        c = px[x, y][:3]
        if c not in seed_colors or is_barrier(x, y):
            return
        seen[i] = 1
        bg[i] = 1
        q.append((x, y, c))

    for x in range(w):
        seed(x, 0)
        seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        seed(w - 1, y)

    while q:
        x, y, root = q.popleft()
        c = px[x, y][:3]
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h:
                j = ny * w + nx
                if seen[j] or is_barrier(nx, ny):
                    continue
                nc = px[nx, ny][:3]
                if dist(nc, c) <= STEP_TOL and dist(nc, root) <= SEED_TOL:
                    seen[j] = 1
                    bg[j] = 1
                    q.append((nx, ny, root))

    # apply mask: fg = 255 (keep), bg = 0 (drop); erode 1px to kill the halo
    r, g, b, a = im.split()
    fg = Image.frombytes("L", (w, h), bytes(0 if v else 255 for v in bg))
    if ERODE_PX:
        fg = fg.filter(ImageFilter.MinFilter(3))
    a = Image.composite(a, Image.new("L", (w, h), 0), fg)
    out = Image.merge("RGBA", (r, g, b, a))

    # crop to content
    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    if max(out.size) > MAX_SIDE:
        out.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    return out


def main() -> None:
    os.makedirs(DST, exist_ok=True)
    for name in ("happy", "jump", "sleep", "angry", "pokeball"):
        src = os.path.join(SRC, f"{name}.png")
        if not os.path.exists(src):
            print(f"missing {src}")
            continue
        im = Image.open(src)
        if name == "angry":
            # screengrab with a gold burst: predicate fill + colour correction,
            # and trim the vignette border first so it never seeds the fill
            crop = 6
            w0, h0 = im.size
            out = remove_background_predicate(im.crop((crop, crop, w0 - crop, h0 - crop)))
            out = warm_to_pikachu_yellow(out)
        else:
            out = remove_background(im)
            if name == "happy":
                # Enclosed white pocket between the ears that the border fill
                # cannot reach — drop it, then re-tighten the crop.
                out = drop_white_pockets(out)
                bbox = out.getbbox()
                if bbox:
                    out = out.crop(bbox)
        dst = os.path.join(DST, f"{name}.png")
        out.save(dst)
        hist = out.getchannel("A").histogram()
        frac = 100.0 * sum(hist[8:]) / (out.size[0] * out.size[1])
        print(f"{name}: {im.size} -> {out.size}  ({frac:.0f}% opaque)")


if __name__ == "__main__":
    main()
