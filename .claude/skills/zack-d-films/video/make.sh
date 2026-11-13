#!/usr/bin/env bash
# Render a zack-d-films project folder (containing scenes.mjs) to <folder>/<folder-name>.mp4
#   make.sh <projectDir>            full render (voice, sfx, 3D frames, mux)
#   make.sh <projectDir> --stills   one still per scene + build/contact.jpg (fast preview)
#   extra options pass through to render.mjs, e.g. --fps 24 --w 1080 --h 1920
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PROJ="$(cd "$1" && pwd)"; shift
bash "$HERE/setup.sh"
node "$HERE/render.mjs" extract "$PROJ"
python3 "$HERE/audio.py" "$PROJ"
if [ "${1:-}" = "--stills" ]; then shift; node "$HERE/render.mjs" stills "$PROJ" "$@"; exit 0; fi
node "$HERE/render.mjs" frames "$PROJ" "$@"
OUT="$PROJ/$(basename "$PROJ").mp4"
ffmpeg -y -loglevel error -i "$PROJ/build/video.mp4" -i "$PROJ/build/audio.wav" -c:v copy -c:a aac -b:a 160k -shortest -movflags +faststart "$OUT"
echo "DONE -> $OUT"
