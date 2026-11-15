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
for cut in "${CUTS[@]}"; do
  [[ -f "$cut.html" ]] || { echo "no $cut.html (its scenes are not all written yet)"; continue; }
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
  [[ -f "$cut.html" ]] || continue
  $HF render --composition "$cut.html" --quality "$QUALITY" --fps 30 -o "$OUT/${NAME[$cut]}.mp4"
done
