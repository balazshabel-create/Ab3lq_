# Rain ambience production

Original, fully procedural rain-on-window ambience for YouTube, with no samples and no copyrighted material.

| Step | Command |
|---|---|
| Audio (any length, seamless loop, 48 kHz/24-bit) | `python3 src/rain_audio.py output/rain.wav --minutes 60 --lufs -20` |
| Visual loop: macro rain on glass | `node scene/render.mjs loop output/closeup.mp4 --page closeup --loop 24` |
| Visual loop: cozy bedroom | `node scene/render.mjs loop output/bedroom.mp4 --loop 24` |
| Re-encode a loop to YouTube bitrate | `ffmpeg -i loop.mp4 -c:v libx264 -preset slow -crf 20 -maxrate 8M -bufsize 16M -g 60 -pix_fmt yuv420p loop-yt.mp4` |
| Final long video (loops the clip under the audio) | `bash src/assemble.sh loop-yt.mp4 rain.wav out.mp4` |
| Thumbnail | `node scene/render.mjs still base.jpg --page closeup --w 1280 --h 720` then `python3 src/thumbnail.py base.jpg thumb.jpg` |
| Vertical Short | render with `--w 1080 --h 1920`, then `python3 src/make_short.py loop.mp4 rain.wav short.mp4 --start 600 --dur 30 --hook "line|line"` |

Requirements: Python with `numpy scipy soundfile pyloudnorm pillow`, plus Node with Playwright/Chromium, Three.js (`~/.cache/zack-d-films/node_modules/three`) and ffmpeg.
Large renders go to `output/`, which is git-ignored. YouTube text, thumbnails and Shorts captions are in `youtube/`.
