#!/usr/bin/env bash
# Idempotent: installs Three.js, Kokoro TTS and its voice model into ~/.cache/zack-d-films.
set -euo pipefail
CACHE="${ZDF_CACHE:-$HOME/.cache/zack-d-films}"
mkdir -p "$CACHE" && cd "$CACHE"
command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }
node -e "require('playwright')" 2>/dev/null || { echo "playwright (with Chromium) is required" >&2; exit 1; }
if [ ! -f node_modules/three/build/three.module.js ]; then
  [ -f package.json ] || npm init -y >/dev/null
  npm install --silent three@0.170.0 >/dev/null
fi
python3 -c "import kokoro_onnx, soundfile, numpy" 2>/dev/null || pip install -q kokoro-onnx soundfile numpy
BASE=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
[ -s kokoro-v1.0.onnx ] || curl -fsSL -o kokoro-v1.0.onnx "$BASE/kokoro-v1.0.onnx"   # full-quality model (~325 MB)
[ -s voices-v1.0.bin ] || curl -fsSL -o voices-v1.0.bin "$BASE/voices-v1.0.bin"
