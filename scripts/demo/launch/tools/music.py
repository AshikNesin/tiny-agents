#!/usr/bin/env python3
"""
music.py -- the film's score and its effects stem, synthesised with numpy (no
samples, so both are royalty-free). The instruments come from the earlier
teaser's score (scripts/demo/teaser/music.py); the arrangement is new and is
laid out from a cue sheet, so each cut gets a score timed to its own scenes.

    python3 tools/music.py --cues assets/audio/cues.index.json \
        --music assets/audio/music.index.wav --sfx assets/audio/sfx.index.wav

The cue sheet (written by tools/cues.mjs) is:
    { "length": 76, "sections": [{"t": 0, "kind": "open"}, ...],
      "cues": [{"t": 6.42, "name": "click"}, ...] }

Section kinds: open (pads and plucks, no drums), beat (the groove; each new
beat section adds a layer), more (the busiest bars), hold (pads only) and end
(the logo: an impact on the tonic that rings out).

120 BPM in D major, bars every 2 s from 0. The chords are counted back from
the end section so the last bar before it is IV and the logo lands on I.
"""

import argparse
import json
import wave

import numpy as np

SR = 44100
BEAT = 0.5
BAR = 2.0
rng = np.random.default_rng(11)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


CHORDS = {
    "D": (38, [62, 66, 69, 73]),
    "A": (45, [61, 64, 69, 71]),
    "Bm": (47, [62, 66, 69, 71]),
    "G": (43, [62, 66, 67, 71]),
}
ORDER = ["D", "A", "Bm", "G"]


class Mix:
    def __init__(self, length):
        self.n = int(length * SR)
        self.length = length

    def buf(self):
        return np.zeros((self.n, 2))

    def add(self, dst, sig, t0, pan=0.0, gain=1.0):
        i = int(round(t0 * SR))
        if i >= self.n:
            return
        if i < 0:
            sig = sig[-i:]
            i = 0
        sig = sig[: self.n - i]
        a = (pan + 1) * np.pi / 4
        dst[i : i + len(sig), 0] += sig * np.cos(a) * gain
        dst[i : i + len(sig), 1] += sig * np.sin(a) * gain


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def fft_filter(x, lo=None, hi=None):
    n = x.shape[0]
    f = np.fft.rfftfreq(n, 1 / SR)
    m = np.ones_like(f)
    if lo:
        m *= 1 / (1 + (lo / np.maximum(f, 1)) ** 4)
    if hi:
        m *= 1 / (1 + (f / hi) ** 4)
    X = np.fft.rfft(x, axis=0)
    if x.ndim == 2:
        m = m[:, None]
    return np.fft.irfft(X * m, n=n, axis=0)


# ── Instruments (from the teaser's score) ────────────────────────────────
def pad_note(freq, dur, bright=1.0):
    t = tt(dur)
    s = np.zeros_like(t)
    for det in (-0.07, 0.0, 0.065):
        f = freq * 2 ** (det / 12)
        ph = rng.uniform(0, 2 * np.pi)
        for k in range(1, 9):
            if f * k > 9000:
                break
            s += np.sin(2 * np.pi * f * k * t + ph * k) / (k ** (1.9 - 0.4 * bright))
    att = np.minimum(1, t / 0.35)
    rel = np.minimum(1, (dur - t) / 0.4).clip(0)
    return s * att * rel / 3


def pluck(freq, dur=0.6, bright=1.0):
    t = tt(dur)
    s = np.zeros_like(t)
    for k in range(1, 10):
        if freq * k > 12000:
            break
        s += np.sin(2 * np.pi * freq * k * t) * np.exp(-t * (5 + k * 3.2 / bright)) / k
    return s * np.minimum(1, t / 0.003) * np.minimum(1, (dur - t) / 0.05)


def bell(freq, dur=2.5, index=2.4):
    t = tt(dur)
    mod = np.sin(2 * np.pi * freq * 3.5 * t) * index * np.exp(-t * 3)
    s = np.sin(2 * np.pi * freq * t + mod) * np.exp(-t * 1.6)
    s += 0.35 * np.sin(2 * np.pi * freq * 2 * t) * np.exp(-t * 2.6)
    return s * np.minimum(1, t / 0.002)


def bass_note(freq, dur):
    t = tt(dur)
    s = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * 2 * freq * t)
    s = np.tanh(1.6 * s) / 1.1
    return s * np.minimum(1, t / 0.008) * np.minimum(1, (dur - t) / 0.03).clip(0)


def kick():
    t = tt(0.55)
    f = 46 + 110 * np.exp(-t * 32)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6.5) * np.minimum(1, (0.55 - t) / 0.05)
    click = fft_filter(rng.standard_normal(len(t)), lo=1200, hi=4500) * np.exp(-t * 300) * 0.12
    return np.tanh(1.4 * (s + click))


def clap():
    t = tt(0.35)
    n = rng.standard_normal(len(t))
    env = np.zeros_like(t)
    for d in (0, 0.011, 0.022):
        env += (t >= d) * np.exp(-(t - d).clip(0) * 140)
    env += (t >= 0.03) * np.exp(-(t - 0.03).clip(0) * 18) * 0.5
    return fft_filter(n * env, lo=900, hi=6000) * 1.6


def hat(open_=False):
    t = tt(0.25 if open_ else 0.06)
    return fft_filter(rng.standard_normal(len(t)), lo=7000, hi=14000) * np.exp(-t * (14 if open_ else 70))


def riser(dur):
    t = tt(dur)
    n = rng.standard_normal(len(t))
    x = t / dur
    s = fft_filter(n, lo=300, hi=2000) * (1 - x) + fft_filter(n, lo=2000, hi=12000) * x
    tone = np.sin(2 * np.pi * np.cumsum(200 + 900 * x**2) / SR) * 0.15
    return (s * 0.6 + tone) * x**2.2


def impact():
    t = tt(3.0)
    f = 30 + 50 * np.exp(-t * 8)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.6)
    crash = fft_filter(rng.standard_normal(len(t)), lo=3500) * np.exp(-t * 1.4) * 0.35
    return boom + crash


def shimmer(dur=2.0):
    t = tt(dur)
    s = np.zeros_like(t)
    for k, m in enumerate([86, 90, 93, 97, 98]):
        s += np.sin(2 * np.pi * midi(m) * t) * np.exp(-t * (1.2 + k * 0.4)) * (t >= k * 0.04)
    return s * 0.3


def reverb(x, decay=1.6, mix=0.3):
    t = tt(decay * 2.2)
    ir = rng.standard_normal((len(t), 2)) * np.exp(-t * 6.9 / (decay * 2.2))[:, None]
    ir = fft_filter(ir, lo=200, hi=7000)
    ir /= np.sqrt((ir**2).sum(axis=0))
    size = 1 << (len(x) + len(ir) - 1).bit_length()
    wet = np.fft.irfft(np.fft.rfft(x, size, axis=0) * np.fft.rfft(ir, size, axis=0), size, axis=0)[: len(x)]
    return x + wet * mix


def delay(x, time=0.375, fb=0.35, mix=0.28):
    d = int(time * SR)
    out = x.copy()
    tap = x * mix
    for i in range(1, 5):
        tap = tap[:, ::-1] * fb if i > 1 else tap[:, ::-1]
        if d * i >= len(x):
            break
        out[d * i :] += tap[: len(x) - d * i]
    return out


# ── Effects, each tied to something that happens on screen ───────────────
def fx_click():
    t = tt(0.05)
    return fft_filter(rng.standard_normal(len(t)), lo=1500, hi=6500) * np.exp(-t * 190) * 1.5


def fx_tap():
    t = tt(0.07)
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 80)
    return body * 0.7 + fft_filter(rng.standard_normal(len(t)), lo=900, hi=3500) * np.exp(-t * 140) * 0.6


def fx_key():
    t = tt(0.035)
    return fft_filter(rng.standard_normal(len(t)), lo=2200, hi=7500) * np.exp(-t * 260)


def fx_pop():
    t = tt(0.09)
    f = 520 + 380 * np.exp(-t * 60)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 55) * np.minimum(1, t / 0.002)


def fx_whoosh(dur=0.45):
    t = tt(dur)
    x = t / dur
    n = rng.standard_normal(len(t))
    s = fft_filter(n, lo=500, hi=2500) * (1 - x) + fft_filter(n, lo=1800, hi=9000) * x
    return s * np.sin(np.pi * x) ** 2 * 0.9


def fx_buzz(dur=0.42):
    t = tt(dur)
    s = np.tanh(3 * np.sin(2 * np.pi * 165 * t)) * (0.55 + 0.45 * np.sin(2 * np.pi * 31 * t))
    env = np.minimum(1, t / 0.01) * np.minimum(1, (dur - t) / 0.03).clip(0)
    return fft_filter(s * env, lo=120, hi=1400) * 0.8


def fx_thud():
    t = tt(0.3)
    f = 70 + 60 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 16)


def build(sheet):
    length = float(sheet["length"])
    mx = Mix(length)
    n_all = mx.n
    t = np.arange(n_all) / SR
    sections = sorted(sheet["sections"], key=lambda s: s["t"])

    def kind_at(time):
        k = sections[0]["kind"]
        for s in sections:
            if s["t"] <= time + 1e-6:
                k = s["kind"]
        return k

    def level_at(time):
        """How many beat sections have started by now: each one adds a layer."""
        return sum(1 for s in sections if s["kind"] in ("beat", "more") and s["t"] <= time + 1e-6)

    t_end = next((s["t"] for s in sections if s["kind"] == "end"), length)
    end_bar = int(round(t_end / BAR))
    bars = int(np.ceil(length / BAR))

    def chord_of(n):
        return ORDER[(n - end_bar) % 4]

    pads, plucks, bass, drums, fx, bells = (mx.buf() for _ in range(6))
    kicks = []

    for n in range(bars):
        bt = n * BAR
        kind = kind_at(bt)
        root, notes = CHORDS[chord_of(n)]
        if bt >= t_end - 1e-6:
            if n == end_bar:
                for m in notes + [74, 78]:
                    mx.add(pads, pad_note(midi(m), length - bt + 0.3, 0.8), bt, pan=rng.uniform(-0.5, 0.5), gain=0.11)
            continue
        end = min(bt + BAR, t_end)
        g = {"open": 0.26, "hold": 0.3}.get(kind, 0.34)
        for m in notes:
            mx.add(pads, pad_note(midi(m), end - bt + 0.3, 0.75 if kind in ("open", "hold") else 1.0), bt, pan=rng.uniform(-0.5, 0.5), gain=g / len(notes) * 1.6)

        level = level_at(bt)
        groove = kind in ("beat", "more")
        full = kind == "more" or level >= 4
        pool = sorted(notes) + [m + 12 for m in sorted(notes)]
        pattern = [0, 2, 4, 1, 3, 5, 2, 6, 4, 1, 5, 3, 7, 4, 2, 5]
        if kind != "hold":
            bright = 0.55 + 0.45 * min(1, level / 3)
            for st, idx in enumerate(pattern):
                if kind == "open" and st % 2:
                    continue
                mx.add(plucks, pluck(midi(pool[idx]), 0.5, bright), bt + st * BEAT / 4, pan=0.45 if st % 2 else -0.45, gain=0.15)
        if groove:
            for b in range(4):
                kt = bt + b * BEAT
                if kt >= t_end:
                    break
                kicks.append(kt)
                mx.add(drums, kick(), kt, gain=0.8)
                mx.add(drums, hat(open_=(full and b == 3)), kt + BEAT / 2, pan=0.25, gain=0.2)
                if full:
                    mx.add(drums, hat(), kt + BEAT / 4, pan=-0.3, gain=0.085)
                    mx.add(drums, hat(), kt + 3 * BEAT / 4, pan=-0.3, gain=0.085)
                if level >= 2 and b in (1, 3):
                    mx.add(drums, clap(), kt, pan=0.05, gain=0.36)
            for step, octv in [(0.5, 0), (1.0, 0), (1.5, 12), (2.5, 0), (3.0, 0), (3.5, 12)]:
                mx.add(bass, bass_note(midi(root + octv), 0.22), bt + step * BEAT, gain=0.5)
            if level >= 3:
                for beat, m in [(0, 81), (0.75, 78), (1.5, 76), (2.5, 74), (3.0, 76)]:
                    mm = m + (2 if chord_of(n) in ("A", "Bm") and m == 74 else 0)
                    mx.add(bells, bell(midi(mm), 1.6, 1.8), bt + beat * BEAT, pan=0.15, gain=0.11)

    # The opening lands on a soft hit; each new section is lifted into.
    mx.add(fx, impact(), 0.0, gain=0.22)
    for m in (74, 78, 81):
        mx.add(bells, bell(midi(m), 2.0, 1.6), 0.0, pan=(m - 78) / 10, gain=0.1)
    for s in sections[1:]:
        if s["kind"] in ("beat", "more") and s["t"] >= 1.0:
            mx.add(fx, riser(0.9), s["t"] - 0.9, gain=0.16)
    if t_end < length:
        mx.add(fx, riser(1.4), t_end - 1.4, gain=0.24)
        mx.add(fx, impact(), t_end, gain=0.55)
        mx.add(fx, shimmer(2.2), t_end, gain=0.6)
        for m in (74, 78, 81, 86):
            mx.add(bells, bell(midi(m), 2.1, 1.6), t_end, pan=(m - 80) / 12, gain=0.15)

    # Sidechain to the kick.
    duck = np.ones(n_all)
    for kt in kicks:
        m = t >= kt
        dt = t[m] - kt
        duck[m] = np.minimum(duck[m], 1 - 0.5 * np.minimum(1, dt / 0.006) * np.exp(-dt * 9))
    for b in (pads, plucks, bass):
        b *= duck[:, None]

    plucks = delay(plucks)
    music = (
        reverb(pads, 2.4, 0.35)
        + reverb(plucks, 1.2, 0.22)
        + reverb(bells, 2.2, 0.4)
        + fft_filter(bass, hi=900)
        + reverb(drums, 0.8, 0.08)
        + reverb(fx, 1.8, 0.25)
    )
    music *= np.minimum(1, t / 0.03)[:, None]
    music *= np.clip((length - t) / 1.0, 0, 1)[:, None] ** 1.5
    music = music / np.abs(music).max() * 0.82

    # The effects stem.
    stem = mx.buf()
    for c in sheet.get("cues", []):
        at, name = float(c["t"]), c["name"]
        if name == "click":
            mx.add(stem, fx_click(), at, gain=0.5)
        elif name == "tap":
            mx.add(stem, fx_tap(), at, gain=0.6)
        elif name == "type":
            k, d = 0.0, float(c.get("d", 0.5))
            while k < d:
                mx.add(stem, fx_key(), at + k, pan=rng.uniform(-0.2, 0.2), gain=rng.uniform(0.16, 0.3))
                k += rng.uniform(0.055, 0.1)
        elif name == "pop":
            mx.add(stem, fx_pop(), at, pan=float(c.get("pan", 0)), gain=0.32)
        elif name == "whoosh":
            mx.add(stem, fx_whoosh(float(c.get("d", 0.45))), at, gain=0.3)
        elif name == "buzz":
            mx.add(stem, fx_buzz(), at, gain=0.5)
            mx.add(stem, fx_buzz(), at + 0.55, gain=0.5)
        elif name == "thud":
            mx.add(stem, fx_thud(), at, gain=0.55)
        elif name == "tick":
            mx.add(stem, hat(), at, gain=0.5)
            mx.add(stem, bell(midi(86), 0.9, 1.0), at, gain=0.09)
        elif name == "cut":
            mx.add(stem, hat(open_=True), at, gain=0.34)
        elif name == "bell":
            mx.add(stem, bell(midi(86), 1.8, 1.2), at, gain=0.2)
            mx.add(stem, bell(midi(93), 1.8, 1.2), at + 0.13, gain=0.18)
    stem = reverb(stem, 0.6, 0.1)
    peak = np.abs(stem).max()
    if peak > 0.7:
        stem *= 0.7 / peak
    return music, stem


def write_wav(path, x):
    y = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(y.tobytes())


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--cues", required=True)
    ap.add_argument("--music", required=True)
    ap.add_argument("--sfx", required=True)
    a = ap.parse_args()
    with open(a.cues) as f:
        sheet = json.load(f)
    music, stem = build(sheet)
    write_wav(a.music, music)
    write_wav(a.sfx, stem)
    print(f"wrote {a.music} and {a.sfx} ({sheet['length']} s)")
