#!/usr/bin/env python3
"""
music.py -- the teaser's original score, synthesised from scratch with numpy
(no samples or loops, so it is royalty-free). 120 BPM in D major, scored to
the film's timeline in teaser.html (bars start at 0.5 s + 2 s * n):

  0.0  bell notes on "Say" / "it" / "once.", pad swell, riser
  2.5  groove drops as the app window lands (bar 1)
 12.5  claps join (computer use);  18.35 a chime on the "Approve" click
 20.5  full groove: 16th hats, then a bell lead from 24.5 (terminal)
 40.5  breakdown under the durable scene; the music tape-stops when the
       server restarts (42.0) and powers back up on reconnect (43.0)
 44.5  impact into the team shot (IV chord), half-time pulse
 46.5  logo hit on the tonic, rings out to the end at 49.6 s

    python3 music.py [--out music.wav]

Writes a 44.1 kHz 16-bit WAV premaster; build.sh masters it with ffmpeg.
"""

import argparse
import wave

import numpy as np

SR = 44100
LEN = 49.6
BEAT = 0.5
BAR = 2.0
OFF = 0.5  # bar 0 starts here
N = int(LEN * SR)
rng = np.random.default_rng(7)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def bar_t(n, beat=0.0):
    return OFF + n * BAR + beat * BEAT


# I–V–vi–IV in D, counted back from the logo bar: the team shot is G (IV)
# and the logo resolves on D (I).
CHORDS = {
    "D": (38, [62, 66, 69, 73]),  # Dmaj7
    "A": (45, [61, 64, 69, 71]),  # Aadd9
    "Bm": (47, [62, 66, 69, 71]),  # Bm7
    "G": (43, [62, 66, 67, 71]),  # Gmaj7
}
ORDER = ["D", "A", "Bm", "G"]


def chord_of(n):
    # Anchored on the logo bar (I), so the bar before it is IV however long
    # the film runs.
    return ORDER[(n - LOGO_BAR) % 4]


# ── Buffers ──────────────────────────────────────────────────────────────
def buf():
    return np.zeros((N, 2))


def add(dst, sig, t0, pan=0.0, gain=1.0):
    """Mix a mono signal into a stereo buffer at time t0 with equal-power pan."""
    i = int(round(t0 * SR))
    if i >= N:
        return
    if i < 0:
        sig = sig[-i:]
        i = 0
    sig = sig[: N - i]
    a = (pan + 1) * np.pi / 4
    dst[i : i + len(sig), 0] += sig * np.cos(a) * gain
    dst[i : i + len(sig), 1] += sig * np.sin(a) * gain


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def fft_filter(x, lo=None, hi=None):
    """Brick-ish band filter with soft edges, applied along axis 0."""
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


# ── Instruments ──────────────────────────────────────────────────────────
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
    env = np.minimum(1, t / 0.008) * np.minimum(1, (dur - t) / 0.03).clip(0)
    return s * env


def kick():
    t = tt(0.55)
    f = 46 + 110 * np.exp(-t * 32)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t * 6.5) * np.minimum(1, (0.55 - t) / 0.05)
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
    n = rng.standard_normal(len(t))
    return fft_filter(n, lo=7000, hi=14000) * np.exp(-t * (14 if open_ else 70))


def riser(dur):
    t = tt(dur)
    n = rng.standard_normal(len(t))
    x = t / dur
    # Stack of progressively brighter noise for a rising sweep.
    lo = fft_filter(n, lo=300, hi=2000)
    hi = fft_filter(n, lo=2000, hi=12000)
    s = lo * (1 - x) + hi * x
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
    n = len(x) + len(ir)
    size = 1 << (n - 1).bit_length()
    wet = np.fft.irfft(np.fft.rfft(x, size, axis=0) * np.fft.rfft(ir, size, axis=0), size, axis=0)[: len(x)]
    return x + wet * mix


def delay(x, time=0.375, fb=0.35, mix=0.28):
    d = int(time * SR)
    out = x.copy()
    tap = x * mix
    for i in range(1, 5):
        tap = tap[:, ::-1] * fb if i > 1 else tap[:, ::-1]  # ping-pong
        if d * i >= len(x):
            break
        out[d * i :] += tap[: len(x) - d * i]
    return out


# ── Arrangement ──────────────────────────────────────────────────────────
GROOVE = range(1, 20)  # bars 1–19: 2.5 – 40.5 s
CLAPS_FROM = 6  # 12.5 s, computer use
FULL_FROM = 10  # 20.5 s, permissions onward
LEAD = range(12, 20)  # 24.5 – 40.5 s, terminal onward
BREAK = range(20, 22)  # 40.5 – 44.5 s, durable
TEAM_BAR, LOGO_BAR = 22, 23  # 44.5 s, 46.5 s
APPROVE_AT = 18.35
RESTART_AT, RECONNECT_AT = 42.0, 43.0


def build():
    pads, plucks, bass, drums, fx, bells = buf(), buf(), buf(), buf(), buf(), buf()
    kicks = []
    T_TEAM, T_LOGO = bar_t(TEAM_BAR), bar_t(LOGO_BAR)

    # Pads: every bar from the start, held to the end on the final chord.
    for n in range(-1, LOGO_BAR + 1):
        start = max(0.0, bar_t(n))
        end = bar_t(n + 1) if n < LOGO_BAR else LEN
        root, notes = CHORDS[chord_of(max(n, 0))]
        bright = 1.0 if 2.5 <= start < T_TEAM else 0.7
        g = 0.2 if start < 2.5 else 0.34
        if n == LOGO_BAR:
            notes = notes + [74, 78]  # wider voicing for the logo
            g = 0.42
        for m in notes:
            add(pads, pad_note(midi(m), end - start + 0.3, bright), start, pan=rng.uniform(-0.5, 0.5), gain=g / len(notes) * 1.6)

    # Opening bells on each word of "Say it once." and the subline.
    for t0, m in [(0.3, 74), (0.52, 78), (0.74, 81), (1.15, 85)]:
        add(bells, bell(midi(m)), t0, pan=(m - 79) / 10, gain=0.15)
    add(fx, shimmer(), 1.15, gain=0.3)
    add(fx, riser(2.0), 0.5, gain=0.3)

    pattern = [0, 2, 4, 1, 3, 5, 2, 6, 4, 1, 5, 3, 7, 4, 2, 5]
    for n in list(GROOVE) + list(BREAK):
        root, notes = CHORDS[chord_of(n)]
        brk = n in BREAK
        full = n >= FULL_FROM and not brk
        for b in range(4):
            kt = bar_t(n, b)
            if not brk:
                kicks.append(kt)
                add(drums, kick(), kt, gain=0.85)
            # Off-beat hats; 16ths in the full section; a light tick in the break.
            add(drums, hat(open_=(full and b == 3)), bar_t(n, b + 0.5), pan=0.25, gain=0.12 if brk else 0.22)
            if full:
                add(drums, hat(), bar_t(n, b + 0.25), pan=-0.3, gain=0.09)
                add(drums, hat(), bar_t(n, b + 0.75), pan=-0.3, gain=0.09)
            if n >= CLAPS_FROM and not brk and b in (1, 3):
                add(drums, clap(), kt, pan=0.05, gain=0.42)
        if not brk:
            # Bass: syncopated 8ths on the root.
            for step, octv in [(0.5, 0), (1.0, 0), (1.5, 12), (2.5, 0), (3.0, 0), (3.5, 12)]:
                add(bass, bass_note(midi(root + octv), 0.22), bar_t(n, step), gain=0.5)
        # Pluck arpeggio, 16ths across two octaves; it opens up over the first bars.
        pool = sorted(notes) + [m + 12 for m in sorted(notes)]
        bright = 0.6 + 0.4 * min(1, (n - 1) / 3)
        for st, idx in enumerate(pattern):
            add(plucks, pluck(midi(pool[idx]), 0.5, bright), bar_t(n, st / 4), pan=0.45 if st % 2 else -0.45, gain=0.12 if brk else 0.16)

    # Bell lead.
    lead = [(0, 81), (0.75, 78), (1.5, 76), (2.5, 74), (3.0, 76)]
    for n in LEAD:
        for beat, m in lead:
            mm = m + (2 if chord_of(n) in ("A", "Bm") and m == 74 else 0)
            add(bells, bell(midi(mm), 1.6, 1.8), bar_t(n, beat), pan=0.15, gain=0.14)

    # "Approve" chime.
    add(bells, bell(midi(86), 1.8, 1.2), APPROVE_AT, gain=0.2)
    add(bells, bell(midi(93), 1.8, 1.2), APPROVE_AT + 0.13, gain=0.18)

    # Lift into the breakdown, then into the finale.
    add(fx, riser(1.6), bar_t(BREAK[0]) - 1.6, gain=0.25)
    add(fx, impact(), bar_t(BREAK[0]), gain=0.3)
    add(fx, riser(0.5), RECONNECT_AT - 0.5, gain=0.3)  # power-up
    add(fx, riser(1.3), T_TEAM - 1.3, gain=0.4)
    add(fx, impact(), T_TEAM, gain=0.7)

    # Half-time pulse under the team shot, then the logo hit.
    for kt in (T_TEAM, T_TEAM + 1.0):
        add(drums, kick(), kt, gain=0.65)
        kicks.append(kt)
    for m in (62, 66, 69, 74):
        add(plucks, pluck(midi(m + 12), 0.9, 0.8), T_TEAM, gain=0.12)
    add(fx, riser(1.4), T_LOGO - 1.4, gain=0.22)
    add(fx, impact(), T_LOGO, gain=0.55)
    add(fx, shimmer(2.2), T_LOGO, gain=0.7)
    for m in (74, 78, 81, 86):
        add(bells, bell(midi(m), 2.1, 1.6), T_LOGO, pan=(m - 80) / 12, gain=0.16)

    # Sidechain the pads, plucks and bass to the kick.
    t = np.arange(N) / SR
    duck = np.ones(N)
    for kt in kicks:
        m = t >= kt
        dt = t[m] - kt
        # 6 ms attack: an instant gain step would click on the sustained pads.
        duck[m] = np.minimum(duck[m], 1 - 0.55 * np.minimum(1, dt / 0.006) * np.exp(-dt * 9))
    for b in (pads, plucks, bass):
        b *= duck[:, None]

    # Energy builds section by section, dips for the breakdown, swells at the end.
    def ramp(a, b):
        return np.clip((t - a) / (b - a), 0, 1)

    energy = 0.62 + 0.18 * ramp(bar_t(CLAPS_FROM) - 0.2, bar_t(CLAPS_FROM)) + 0.2 * ramp(bar_t(FULL_FROM) - 0.2, bar_t(FULL_FROM))
    for b in (drums, plucks, bass):
        b *= energy[:, None]
    pads *= (0.85 + 0.3 * ramp(T_TEAM - 0.2, T_TEAM))[:, None]

    plucks = delay(plucks)
    music = (
        reverb(pads, 2.4, 0.35)
        + reverb(plucks, 1.2, 0.22)
        + reverb(bells, 2.2, 0.4)
        + fft_filter(bass, hi=900)
        + reverb(drums, 0.8, 0.08)
    )
    music = tape_stop(music, RESTART_AT, RECONNECT_AT) + reverb(fx, 1.8, 0.25)
    # Fade-in from silence and out to the final black.
    music *= np.minimum(1, t / 0.05)[:, None]
    music *= np.clip((LEN - t) / 0.9, 0, 1)[:, None] ** 1.5
    return music / np.abs(music).max() * 0.89


def tape_stop(x, start, resume, spin=0.4):
    """The music winds down at `start` (the server restart), stays silent,
    and drops back in at `resume` exactly where the beat grid has got to."""
    out = x.copy()
    i0, i1, i2 = int(start * SR), int((start + spin) * SR), int(resume * SR)
    k = np.arange(i1 - i0) / SR
    speed = 1 - k / spin  # linear slow-down to a stop
    pos = start * SR + np.cumsum(speed)
    lo = np.clip(pos.astype(int), 0, len(x) - 2)
    frac = (pos - lo)[:, None]
    wound = x[lo] * (1 - frac) + x[lo + 1] * frac
    out[i0:i1] = wound * np.linspace(1, 0, i1 - i0)[:, None] ** 0.7
    out[i1:i2] = 0
    fade = int(0.04 * SR)
    out[i2 : i2 + fade] *= np.linspace(0, 1, fade)[:, None]
    return out


def write_wav(path, x):
    y = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(y.tobytes())


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="tmp/demo/teaser-music.wav")
    a = ap.parse_args()
    write_wav(a.out, build())
    print(f"wrote {a.out} ({LEN:.1f} s)")
