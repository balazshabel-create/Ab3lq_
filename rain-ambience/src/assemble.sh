#!/usr/bin/env bash
# Loop a seamless visual clip under the full audio track -> YouTube-ready MP4 (no re-encode of video).
#   assemble.sh <loop.mp4> <audio.wav> <out.mp4>
set -euo pipefail
LOOP="$1"; AUDIO="$2"; OUT="$3"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$AUDIO")
ffmpeg -y -v error -stream_loop -1 -i "$LOOP" -i "$AUDIO" -map 0:v:0 -map 1:a:0 -t "$DUR" \
  -c:v copy -c:a aac -b:a 384k -ar 48000 -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate,bit_rate -of compact "$OUT"
