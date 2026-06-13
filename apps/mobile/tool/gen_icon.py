"""
Generates the Tashfeen launcher-icon source PNGs from the in-app brand mark
(the metallic "T" monogram in lib/core/widgets/logo.dart), rendered onto the
brand navy (#0D1B3A). Supersamples 4x then downsamples for smooth edges.

Outputs (consumed by flutter_launcher_icons):
  assets/icon/tashfeen_icon.png  — 1024 navy squircle + light "T" (legacy icon)
  assets/icon/tashfeen_fg.png    — 1024 transparent + "T" padded to the
                                    adaptive-icon safe zone (foreground layer)

Run: python tool/gen_icon.py   (from apps/mobile)
"""
import os
from PIL import Image, ImageDraw

S = 1024            # final icon size
SS = 4              # supersample factor
BIG = S * SS

NAVY = (13, 27, 58, 255)     # #0D1B3A — AppTokens.brandNavy ("logo background")
GRAD_TOP = (255, 255, 255)   # bright top
GRAD_BOT = (201, 205, 214)   # light silver bottom — stays legible on navy

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "icon")


def t_points(canvas, glyph_h):
    """The 'T' monogram polygon (mirrors _TLogoPainter), centred in `canvas`."""
    w = glyph_h * 0.75
    h = glyph_h
    cross = h * 0.32
    stem_w = w * 0.34
    stem_x = (w - stem_w) / 2
    bevel = w * 0.06
    pts = [
        (0, 0),
        (w, 0),
        (w, cross),
        (stem_x + stem_w + bevel, cross),
        (stem_x + stem_w, cross + h * 0.06),
        (stem_x + stem_w, h),
        (stem_x, h),
        (stem_x - bevel, cross + h * 0.06),
        (0, cross),
    ]
    ox = (canvas - w) / 2
    oy = (canvas - h) / 2
    return [(x + ox, y + oy) for (x, y) in pts]


def vertical_gradient(size, top, bottom):
    col = Image.new("RGBA", (1, size))
    for y in range(size):
        t = y / (size - 1)
        col.putpixel((0, y), (
            int(top[0] + (bottom[0] - top[0]) * t),
            int(top[1] + (bottom[1] - top[1]) * t),
            int(top[2] + (bottom[2] - top[2]) * t),
            255,
        ))
    return col.resize((size, size))


def t_mask(glyph_h):
    m = Image.new("L", (BIG, BIG), 0)
    ImageDraw.Draw(m).polygon(t_points(BIG, glyph_h), fill=255)
    return m


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    grad = vertical_gradient(BIG, GRAD_TOP, GRAD_BOT)

    # ── Legacy icon: navy rounded squircle + T at ~52% height ──
    icon = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    bg_mask = Image.new("L", (BIG, BIG), 0)
    ImageDraw.Draw(bg_mask).rounded_rectangle(
        [0, 0, BIG - 1, BIG - 1], radius=int(BIG * 0.22), fill=255)
    icon.paste(Image.new("RGBA", (BIG, BIG), NAVY), (0, 0), bg_mask)
    icon.paste(grad, (0, 0), t_mask(BIG * 0.52))
    icon.resize((S, S), Image.LANCZOS).save(
        os.path.join(OUT_DIR, "tashfeen_icon.png"))

    # ── Adaptive foreground: transparent + T at ~42% (within safe zone) ──
    fg = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    fg.paste(grad, (0, 0), t_mask(BIG * 0.42))
    fg.resize((S, S), Image.LANCZOS).save(
        os.path.join(OUT_DIR, "tashfeen_fg.png"))

    print("wrote tashfeen_icon.png + tashfeen_fg.png to", os.path.abspath(OUT_DIR))


if __name__ == "__main__":
    main()
