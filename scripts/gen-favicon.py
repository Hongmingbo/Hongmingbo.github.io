# -*- coding: utf-8 -*-
"""favicon 生成（PIL 版本，替代 sharp 渲染失败的方案）。"""
from PIL import Image, ImageDraw

BG_TOP = (24, 40, 46)
BG_BOTTOM = (14, 24, 28)
BORDER = (110, 184, 200, 150)
STROKE = (150, 216, 230)
ARROW = (120, 200, 216)


def make(size: int) -> Image.Image:
    S = 4  # supersample
    W = size * S
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    pad = int(W * 0.03)
    radius = int(W * 0.22)

    # 渐变底
    base = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    bd = ImageDraw.Draw(base)
    for y in range(W):
        t = y / W
        r = int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t)
        g = int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t)
        b = int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
        bd.line([(0, y), (W, y)], fill=(r, g, b, 255))
    mask = Image.new("L", (W, W), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([pad, pad, W - pad, W - pad], radius=radius, fill=255)
    img.paste(base, (0, 0), mask)

    d = ImageDraw.Draw(img)
    d.rounded_rectangle(
        [pad, pad, W - pad, W - pad], radius=radius, outline=BORDER, width=max(2, W // 40)
    )

    lw = max(3, W // 11)
    # H 左竖
    x1 = int(W * 0.22)
    d.line([(x1, int(W * 0.28)), (x1, int(W * 0.74))], fill=STROKE, width=lw)
    # H 右竖
    x2 = int(W * 0.46)
    d.line([(x2, int(W * 0.28)), (x2, int(W * 0.74))], fill=STROKE, width=lw)
    # H 横
    d.line([(x1, int(W * 0.5)), (x2, int(W * 0.5))], fill=STROKE, width=lw)
    # 箭头 ❯
    ax = int(W * 0.62)
    ay = int(W * 0.32)
    mid = int(W * 0.51)
    by = int(W * 0.70)
    ex = int(W * 0.82)
    d.line([(ax, ay), (ex, mid)], fill=ARROW, width=lw)
    d.line([(ex, mid), (ax, by)], fill=ARROW, width=lw)

    return img.resize((size, size), Image.LANCZOS)


import os

out_dir = r"D:/tools/blog-redesign/Hongmingbo.github.io/public/favicon"
os.makedirs(out_dir, exist_ok=True)
for s in (32, 128, 180, 192):
    im = make(s)
    for theme in ("light", "dark"):
        im.save(os.path.join(out_dir, f"favicon-{theme}-{s}.png"), "PNG", optimize=True)
print("done")

# 自检
import numpy as np

arr = np.asarray(make(192).convert("L"), dtype=float)
print("stdev:", round(arr.std(), 2))
