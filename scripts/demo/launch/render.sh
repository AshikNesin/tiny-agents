#!/usr/bin/env bash
# Builds and renders the launch film's three cuts into docs/demo/:
#   tiny-agents-launch.mp4           1920x1080
#   tiny-agents-launch-vertical.mp4  1080x1920
#   tiny-agents-launch-teaser.mp4    1920x1080, 15 s
#
#   ./render.sh                 all three
#   ./render.sh teaser          one cut (index, vertical or teaser)
#   QUALITY=draft ./render.sh   a fast pass while working
#
# Needs Node 22+, FFmpeg, Python 3 with numpy, and the Playwright that
# tools/cues.mjs loads. Steps: scenes -> cue sheets -> score and effects,
# mastered -> scenes again, now with their audio -> render.
set -euo pipefail
cd "$(dirname "$0")"
export HYPERFRAMES_NO_TELEMETRY=1
HF="npx --yes hyperframes@0.9.53"
OUT="${OUT:-../../../docs/demo}"
QUALITY="${QUALITY:-delivery}"
declare -A NAME=([index]=tiny-agents-launch [vertical]=tiny-agents-launch-vertical [teaser]=tiny-agents-launch-teaser)
CUTS=("${@:-index vertical teaser}")
[[ $# -eq 0 ]] && CUTS=(index vertical teaser)

node tools/build.mjs
node tools/cues.mjs
mkdir -p assets/audio "$OUT"
OUT_ABS="$(cd "$OUT" && pwd)"
for cut in "${CUTS[@]}"; do
  [[ -f ".film/$cut/index.html" ]] || { echo "no .film/$cut (its scenes are not all written yet)"; continue; }
  python3 tools/music.py --cues "assets/audio/cues.$cut.json" \
    --music "assets/audio/music.$cut.raw.wav" --sfx "assets/audio/sfx.$cut.raw.wav"
  # The bed sits under the picture: glue, limit, then a linear loudness pass so
  # the score keeps its build. Effects are levelled against it, a few dB above.
  PRE="acompressor=threshold=-16dB:ratio=2:attack=15:release=180,alimiter=limit=0.7:level=false"
  M=$(ffmpeg -hide_banner -i "assets/audio/music.$cut.raw.wav" -af "$PRE,loudnorm=I=-19:TP=-2:print_format=json" -f null - 2>&1 | sed -n '/^{/,/^}/p')
  val() { echo "$M" | python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
  ffmpeg -v error -y -i "assets/audio/music.$cut.raw.wav" \
    -af "$PRE,loudnorm=I=-19:TP=-2:linear=true:measured_I=$(val input_i):measured_TP=$(val input_tp):measured_LRA=$(val input_lra):measured_thresh=$(val input_thresh):offset=$(val target_offset),aresample=48000" \
    -c:a pcm_s16le "assets/audio/music.$cut.wav"
  ffmpeg -v error -y -i "assets/audio/sfx.$cut.raw.wav" -af "volume=-7dB,aresample=48000" -c:a pcm_s16le "assets/audio/sfx.$cut.wav"
  rm -f "assets/audio/music.$cut.raw.wav" "assets/audio/sfx.$cut.raw.wav"
done

node tools/build.mjs
for cut in "${CUTS[@]}"; do
  [[ -f ".film/$cut/index.html" ]] || continue
  (cd ".film/$cut" && $HF render --quality "$QUALITY" --fps 30 -o "$OUT_ABS/${NAME[$cut]}.mp4")
done

# The film's poster (the inbox at 2.4 s, every row landed) and the site's web encode.
if [[ " ${CUTS[*]} " == *" index "* && -f "$OUT_ABS/tiny-agents-launch.mp4" ]]; then
  ffmpeg -v error -y -ss 2.4 -i "$OUT_ABS/tiny-agents-launch.mp4" -frames:v 1 -q:v 3 "$OUT_ABS/launch-poster.jpg"
  if [[ "$OUT_ABS" == "$(cd ../../../docs/demo && pwd)" ]]; then
    ffmpeg -v error -y -i "$OUT_ABS/tiny-agents-launch.mp4" -c:v libx264 -preset slow -crf 23 -tune animation \
      -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart ../../../site/media/tiny-agents-demo.mp4
    cp "$OUT_ABS/launch-poster.jpg" ../../../site/media/demo-poster.jpg
  fi
fi
