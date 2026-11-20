#!/usr/bin/env python3
"""Compose the YouTube thumbnail (1280x720) from a rendered still: grade for small-size readability + title text."""
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance, ImageFont

src, out = sys.argv[1], sys.argv[2]
F = '/usr/share/fonts/opentype/inter/'
img = Image.open(src).convert('RGB').resize((1280, 720), Image.LANCZOS)
img = ImageEnhance.Brightness(img).enhance(1.24)
img = ImageEnhance.Contrast(img).enhance(1.12)
img = ImageEnhance.Color(img).enhance(1.15)
# soft dark gradient behind the text (top-left) for contrast
shade = Image.new('L', img.size, 0); d = ImageDraw.Draw(shade)
for i in range(520):
    d.line([(0, i * 0.6), (720 - i, 0)], fill=int(170 * (1 - i / 520)), width=3)
img = Image.composite(Image.new('RGB', img.size, (4, 6, 14)), img, shade.filter(ImageFilter.GaussianBlur(60)))

def text(draw, xy, s, font, fill, shadow=(0, 0, 0), blur=10, spacing=0):
    # glow/shadow layer for legibility at thumbnail size
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0)); ld = ImageDraw.Draw(layer)
    ld.text((xy[0] + 3, xy[1] + 4), s, font=font, fill=shadow + (220,), spacing=spacing)
    img.paste(Image.alpha_composite(img.convert('RGBA'), layer.filter(ImageFilter.GaussianBlur(blur))).convert('RGB'))
    ImageDraw.Draw(img).text(xy, s, font=font, fill=fill, spacing=spacing)

big = ImageFont.truetype(F + 'Inter-Black.otf', 150)
mid = ImageFont.truetype(F + 'Inter-ExtraBold.otf', 50)
small = ImageFont.truetype(F + 'Inter-Bold.otf', 34)
text(None, (52, 26), 'RAIN', big, (246, 242, 233))
text(None, (60, 206), 'ON THE WINDOW', mid, (255, 196, 120))
text(None, (60, 266), 'for Deep Sleep', ImageFont.truetype(F + 'Inter-MediumItalic.otf', 46), (225, 230, 245))
# "1 HOUR" pill
d = ImageDraw.Draw(img)
d.rounded_rectangle([60, 362, 254, 418], radius=28, fill=(255, 176, 86))
d.text((85, 369), '1 HOUR', font=small, fill=(30, 20, 10))
d.text((272, 373), 'NO MUSIC', font=ImageFont.truetype(F + 'Inter-SemiBold.otf', 28), fill=(205, 212, 230))
img.save(out, 'JPEG', quality=93, optimize=True)
print('thumbnail ->', out, img.size)
