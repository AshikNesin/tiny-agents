#!/usr/bin/env bash
# Renders the 45-second teaser: frames (render.mjs), score (music.py),
# master to -16 LUFS, and mux into docs/demo/tiny-agents-teaser.mp4.
set -euo pipefail
cd "$(dirname "$0")/../../.."

FRAMES="${FRAMES_DIR:-tmp/demo/teaser-frames}"
OUT="${1:-docs/demo/tiny-agents-teaser.mp4}"
mkdir -p tmp/demo "$(dirname "$OUT")"

[[ "${SKIP_FRAMES:-}" == 1 ]] || FRAMES_DIR="$FRAMES" node scripts/demo/teaser/render.mjs
python3 scripts/demo/teaser/music.py --out tmp/demo/teaser-music.wav

# Glue, limit, then two-pass *linear* loudnorm to -16 LUFS so the score keeps
# its build (dynamic loudnorm would flatten the quiet intro into the drop).
PRE="acompressor=threshold=-16dB:ratio=2:attack=15:release=180,alimiter=limit=0.7:level=false"
M=$(ffmpeg -hide_banner -i tmp/demo/teaser-music.wav -af "$PRE,loudnorm=I=-16:TP=-1.5:print_format=json" -f null - 2>&1 | sed -n '/^{/,/^}/p')
val() { echo "$M" | python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
ffmpeg -v error -y -i tmp/demo/teaser-music.wav \
  -af "$PRE,loudnorm=I=-16:TP=-1.5:linear=true:measured_I=$(val input_i):measured_TP=$(val input_tp):measured_LRA=$(val input_lra):measured_thresh=$(val input_thresh):offset=$(val target_offset),aresample=48000" \
  -c:a pcm_s16le tmp/demo/teaser-music-master.wav

ffmpeg -v error -y -framerate 60 -i "$FRAMES/f%05d.png" -i tmp/demo/teaser-music-master.wav \
  -c:v libx264 -preset slow -crf 17 -tune film -pix_fmt yuv420p -profile:v high \
  -c:a aac -b:a 192k -shortest -movflags +faststart "$OUT"

# Poster: the logo frame.
ffmpeg -v error -y -ss 44.6 -i "$OUT" -frames:v 1 -q:v 3 "$(dirname "$OUT")/teaser-poster.jpg"
echo "wrote $OUT"
