"""Demo-only: frames + timestamps (record.mjs) -> 1080p30 H.264, optionally with music.

usage: python3 encode.py FRAMES_DIR OUT.mp4 [MUSIC.wav]
"""
import json
import os
import subprocess
import sys

frames_dir, out = sys.argv[1], sys.argv[2]
music = sys.argv[3] if len(sys.argv) > 3 else None
meta = json.load(open(os.path.join(frames_dir, "frames.json")))
frames = meta["frames"]
speedups = meta.get("speedups", [])


def speed(t):
    return next((s["factor"] for s in speedups if s["from"] <= t < s["to"]), 1)


lines = ["ffconcat version 1.0"]
duration = 0.0
for frame, nxt in zip(frames, frames[1:] + [None]):
    until = nxt["t"] if nxt else meta["end"]
    seconds = max(until - frame["t"], 0.001) / speed(frame["t"])
    duration += seconds
    lines += [f"file {frame['file']}", f"duration {seconds:.4f}"]
lines.append(f"file {frames[-1]['file']}")  # concat needs it to honor the last duration
listing = os.path.join(frames_dir, "list.ffconcat")
open(listing, "w").write("\n".join(lines) + "\n")

video = out if not music else out.replace(".mp4", ".video.mp4")
fade_out = max(duration - 0.9, 0)
subprocess.run(
    [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", listing,
        "-vf", f"fps=30,fade=t=in:st=0:d=0.5,fade=t=out:st={fade_out:.2f}:d=0.9,format=yuv420p",
        "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high",
        "-movflags", "+faststart", video,
    ],
    check=True,
)
if music:
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", video, "-i", music,
            "-filter_complex",
            f"[1:a]atrim=0:{duration:.3f},afade=t=out:st={max(duration - 2.5, 0):.2f}:d=2.5[a]",
            "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-shortest", "-movflags", "+faststart", out,
        ],
        check=True,
    )
    os.remove(video)
print(f"{out}: {duration:.2f}s from {len(frames)} frames")
