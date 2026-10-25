#!/bin/bash
# Demo-only: frames -> silent cut -> music rendered to the exact length ->
# EQ + loudness master -> final MP4.   usage: finish.sh [FRAMES_DIR] [OUT.mp4]
set -euo pipefail
cd "$(dirname "$0")/../.."
W=tmp/demo
FRAMES=${1:-$W/frames}
OUT=${2:-docs/demo/tiny-agents-demo.mp4}
mkdir -p "$W"
python3 scripts/demo/encode.py "$FRAMES" "$W/cut-silent.mp4"
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$W/cut-silent.mp4")
python3 scripts/demo/music.py --duration "$D" --out-dir "$W" > /dev/null
# Lift the mids and tame the sub so it carries on laptop and phone speakers.
EQ="highpass=f=30:p=2,equalizer=f=55:t=q:w=1.0:g=-3.5,equalizer=f=220:t=q:w=1.0:g=-1,equalizer=f=2600:t=q:w=1.2:g=3,highshelf=f=7500:g=2"
J=$(ffmpeg -hide_banner -i "$W/music.wav" -af "$EQ,loudnorm=I=-16:TP=-1.5:LRA=8:print_format=json" -f null - 2>&1 | sed -n '/^{/,/^}/p')
MI=$(echo "$J" | python3 -c "import json,sys; d=json.load(sys.stdin); print(f\"measured_I={d['input_i']}:measured_TP={d['input_tp']}:measured_LRA={d['input_lra']}:measured_thresh={d['input_thresh']}:offset={d['target_offset']}\")")
ffmpeg -hide_banner -loglevel error -y -i "$W/music.wav" -af "$EQ,loudnorm=I=-16:TP=-1.5:LRA=8:$MI:linear=true" -ar 44100 "$W/music-master.wav"
FADE=$(python3 -c "print(max(float('$D') - 2.5, 0))")
mkdir -p "$(dirname "$OUT")"
ffmpeg -hide_banner -loglevel error -y -i "$W/cut-silent.mp4" -i "$W/music-master.wav" \
  -filter_complex "[1:a]afade=t=in:st=0:d=0.3,afade=t=out:st=$FADE:d=2.5[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration,size -of compact "$OUT"
ffmpeg -hide_banner -i "$OUT" -af ebur128 -f null - 2>&1 | grep -E "^\s+I:" | tail -1
