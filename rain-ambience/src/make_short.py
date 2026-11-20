#!/usr/bin/env python3
"""
Make a vertical (1080x1920) Shorts/TikTok/Reels clip from the seamless visual loop + a slice of the long rain track,
with a hook text and a call-to-action burned in (kept inside the UI-safe zone of TikTok/Shorts/Reels).

usage: make_short.py LOOP.mp4 AUDIO.wav OUT.mp4 --start 600 --dur 30 --hook "line1|line2" --cta "text"
"""
import argparse, os, subprocess, tempfile
import numpy as np, soundfile as sf, pyloudnorm as pyln
from PIL import Image, ImageDraw, ImageFilter, ImageFont

F = '/usr/share/fonts/opentype/inter/'
ap = argparse.ArgumentParser()
ap.add_argument('loop'); ap.add_argument('audio'); ap.add_argument('out')
ap.add_argument('--start', type=float, required=True); ap.add_argument('--dur', type=float, default=30)
ap.add_argument('--hook', required=True); ap.add_argument('--cta', default='Full 1-hour version on my channel')
ap.add_argument('--lufs', type=float, default=-16)
a = ap.parse_args()
tmp = tempfile.mkdtemp()

# ---- audio slice: loudness-matched for mobile, soft fades
with sf.SoundFile(a.audio) as f:
    sr = f.samplerate; f.seek(int(a.start * sr)); x = f.read(int(a.dur * sr))
loud = pyln.Meter(sr).integrated_loudness(x)
x = x * 10 ** ((a.lufs - loud) / 20)
fi, fo = int(sr * 1.2), int(sr * 2.0)
x[:fi] *= np.linspace(0, 1, fi)[:, None]; x[-fo:] *= np.linspace(1, 0, fo)[:, None]
x = np.clip(x, -0.95, 0.95)
wav = os.path.join(tmp, 'a.wav'); sf.write(wav, x, sr, 'PCM_24')

# ---- text overlay (transparent PNG)
W, H = 1080, 1920
ov = Image.new('RGBA', (W, H), (0, 0, 0, 0))
def block(lines, font, y, fill, glow=18, gap=1.18):
    global ov
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ds = ImageDraw.Draw(sh)
    lh = int(font.size * gap)
    for i, ln in enumerate(lines):
        w = d.textlength(ln, font=font); x0 = (W - w) / 2; yy = y + i * lh
        ds.text((x0 + 2, yy + 4), ln, font=font, fill=(0, 0, 20, 235)); d.text((x0, yy), ln, font=font, fill=fill)
    ov = Image.alpha_composite(ov, sh.filter(ImageFilter.GaussianBlur(glow)))
    ov = Image.alpha_composite(ov, sh.filter(ImageFilter.GaussianBlur(4)))
    ov = Image.alpha_composite(ov, layer)
    return y + len(lines) * lh

hook = a.hook.split('|')
size = 92 if max(len(l) for l in hook) <= 16 else 80
block(hook, ImageFont.truetype(F + 'Inter-ExtraBold.otf', size), 470, (255, 255, 255, 255))
# CTA pill above the bottom UI area
cta_font = ImageFont.truetype(F + 'Inter-Bold.otf', 44)
d = ImageDraw.Draw(ov); tw = d.textlength(a.cta, font=cta_font)
x0, y0 = (W - tw) / 2 - 34, 1300
pill = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(pill).rounded_rectangle([x0, y0, x0 + tw + 68, y0 + 84], radius=42, fill=(10, 18, 40, 170))
ov = Image.alpha_composite(ov, pill)
ImageDraw.Draw(ov).text((x0 + 34, y0 + 16), a.cta, font=cta_font, fill=(190, 215, 255, 255))
png = os.path.join(tmp, 'ov.png'); ov.save(png)

# ---- compose: loop video + text (fades in after 0.4 s) + audio
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-stream_loop', '-1', '-i', a.loop, '-loop', '1', '-i', png, '-i', wav,
                '-filter_complex', f"[1:v]format=rgba,fade=t=in:st=0.4:d=0.8:alpha=1,fade=t=out:st={a.dur - 1.2}:d=1.0:alpha=1[t];[0:v][t]overlay=0:0:shortest=1,fade=t=in:st=0:d=0.6,fade=t=out:st={a.dur - 0.8}:d=0.8[v]",
                '-map', '[v]', '-map', '2:a', '-t', str(a.dur), '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-maxrate', '12M', '-bufsize', '20M',
                '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', a.out], check=True)
print('short ->', a.out)
