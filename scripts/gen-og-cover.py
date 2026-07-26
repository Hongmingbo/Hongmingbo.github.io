# -*- coding: utf-8 -*-
"""og-cover.png 生成器（PIL + 微软雅黑，CJK 可靠）。"""
from PIL import Image, ImageDraw, ImageFont
import math

W, H = 1200, 630

# 品牌冷青（近似 oklch hue200 的 sRGB 观感）
BG_TOP = (18, 28, 32)
BG_BOTTOM = (12, 20, 24)
GRID = (58, 92, 102, 34)
FRAME = (94, 168, 186, 96)
NEON = (120, 200, 216)
TITLE = (226, 240, 243)
SUB = (166, 198, 206)
META = (120, 160, 170)
URL = (96, 132, 142)

img = Image.new("RGB", (W, H), BG_TOP)
d = ImageDraw.Draw(img, "RGBA")

# 垂直渐变
for y in range(H):
    t = y / H
    r = int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t)
    g = int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t)
    b = int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
    d.line([(0, y), (W, y)], fill=(r, g, b))

# 顶部光晕
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
cx, cy, R = W // 2, 40, 520
for i in range(R, 0, -4):
    a = int(20 * (i / R) ** 2)
    gd.ellipse([cx - i, cy - i // 2, cx + i, cy + i // 2], fill=(NEON[0], NEON[1], NEON[2], max(0, 18 - a)))
img = Image.alpha_composite(img.convert("RGBA"), glow)
d = ImageDraw.Draw(img, "RGBA")

# 网格
for x in range(0, W, 48):
    d.line([(x, 0), (x, H)], fill=GRID, width=1)
for y in range(0, H, 48):
    d.line([(0, y), (W, y)], fill=GRID, width=1)

# 外框
d.rounded_rectangle([60, 60, W - 60, H - 60], radius=24, outline=FRAME, width=2)

# 字体
def font(path, size):
    return ImageFont.truetype(path, size)

yahei_bold = "C:/Windows/Fonts/msyhbd.ttc"
yahei = "C:/Windows/Fonts/msyh.ttc"
mono_candidates = [
    "C:/Windows/Fonts/consola.ttf",
    "C:/Windows/Fonts/CascadiaMono.ttf",
]
mono_path = None
for p in mono_candidates:
    try:
        ImageFont.truetype(p, 20)
        mono_path = p
        break
    except OSError:
        continue
if mono_path is None:
    mono_path = yahei

f_prompt = font(mono_path, 30)
f_title = font(yahei_bold, 150)
f_sub = font(yahei, 42)
f_meta = font(mono_path, 26)
f_url = font(mono_path, 22)

d.text((96, 118), "\u276f notes --by", font=f_prompt, fill=NEON)
d.text((92, 190), "衡堕", font=f_title, fill=TITLE)
d.text((96, 384), "学习笔记与项目记录", font=f_sub, fill=SUB)
d.text((96, 470), "AI Agent · Frontend · Self-hosted · PKM", font=f_meta, fill=META)
d.text((96, 522), "hongmingbo.github.io", font=f_url, fill=URL)

# 右侧小节点装饰
import random
random.seed(7)
pts = [(random.randint(760, 1100), random.randint(140, 520)) for _ in range(14)]
for i, (x, y) in enumerate(pts):
    for j in range(i + 1, len(pts)):
        x2, y2 = pts[j]
        if math.hypot(x - x2, y - y2) < 150:
            d.line([(x, y), (x2, y2)], fill=(NEON[0], NEON[1], NEON[2], 40), width=1)
for x, y in pts:
    d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(NEON[0], NEON[1], NEON[2], 170))

out = r"D:/tools/blog-redesign/Hongmingbo.github.io/public/og-cover.png"
img.convert("RGB").save(out, "PNG", optimize=True)
print("saved", out)

# 自检：标题区方差
import numpy as np
arr = np.asarray(img.convert("L").crop((92, 190, 560, 360)), dtype=float)
print("title stdev:", round(arr.std(), 2))
