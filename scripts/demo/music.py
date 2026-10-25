#!/usr/bin/env python3
"""
music.py -- original, procedurally synthesised background track for a SaaS
product demo ("light deep-house / chill electronic", 112 BPM, 4/4, F major).

Every sound is generated from scratch with numpy (band-limited wavetables and
additive synthesis, filtered noise).  No samples, loops or third-party material
are used, so the output is original and royalty-free.

    python3 music.py --duration 125            # default
    python3 music.py --duration 97.5 --seed 7  # any length from ~60 s up

Writes music.wav (44.1 kHz / 16-bit PCM) and music.mp3 (192 kbps CBR) into the
repo's tmp/demo/ (or --out-dir).  The length is exact to the sample.

Pipeline
  1. arrangement plan (whole bars at 112 BPM, outro + final chord land on the end)
  2. per-instrument stems (pad, pluck arp, sub bass, kick, clap, hats, bell lead, fx)
  3. stem level calibration (approx. K-weighted loudness in the Groove C section)
  4. time-varying STFT low-pass on pad/arp, sidechain ducking, ping-pong
     dotted-1/8 delay, FFT-convolution reverb with a synthesised IR
  5. float premaster -> ffmpeg master: glue acompressor -> alimiter ->
     2-pass loudnorm (linear) to -16 LUFS / -1.5 dBTP
  6. 16-bit TPDF-dithered WAV + MP3, followed by a verification report
"""

import argparse
import json
import math
import os
import re
import struct
import subprocess
import sys
import time

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

# --------------------------------------------------------------------------
# constants
# --------------------------------------------------------------------------
SR = 44100
BPM = 112.0
BEAT = 60.0 / BPM            # 0.5357 s
BAR = 4.0 * BEAT             # 2.1429 s
STEP = BEAT / 4.0            # 1/16 note
SWING = 0.55                 # 55 % swing on 16ths
SWING_OFFSET = (SWING - 0.5) * 2.0 * STEP   # delay of off-16ths (~13 ms)
TAIL_MIN = 4.0               # minimum ring-out time for the final chord (s)
TWO_PI = 2.0 * math.pi
SQ2 = math.sqrt(2.0)

TARGET_LUFS = -16.0
TARGET_TP = -1.5

_NOTE_RE = re.compile(r"^([A-G])([#b]?)(-?\d)$")
_SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi(name):
    m = _NOTE_RE.match(name)
    if not m:
        raise ValueError(name)
    letter, acc, octave = m.groups()
    return 12 * (int(octave) + 1) + _SEMI[letter] + (1 if acc == "#" else -1 if acc == "b" else 0)


def hz(m):
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


# --------------------------------------------------------------------------
# harmony / patterns
# --------------------------------------------------------------------------
# Voicings are chosen so that no two simultaneously sounding notes form a
# minor 2nd / minor 9th (e.g. the maj7 is always *above* the root it would
# clash with, never below).  Pad lives in F3..A4, arp A4..G5, lead C5..C6,
# bass A1..F2 (+ octave).
CHORDS = {
    "F":    dict(name="Fmaj9",  bass="F2",  pad=["A3", "C4", "E4", "G4"], arp=["A4", "C5", "E5", "G5"]),
    "Am":   dict(name="Am7",    bass="A1",  pad=["G3", "C4", "E4", "A4"], arp=["E4", "A4", "C5", "E5"]),
    "Dm":   dict(name="Dm9",    bass="D2",  pad=["F3", "C4", "E4", "A4"], arp=["A4", "C5", "D5", "E5"]),
    "Bb":   dict(name="Bbmaj7", bass="Bb1", pad=["F3", "Bb3", "D4", "A4"], arp=["F4", "A4", "D5", "F5"]),
    "Gm":   dict(name="Gm7",    bass="G1",  pad=["F3", "Bb3", "D4", "G4"], arp=["G4", "Bb4", "D5", "F5"]),
    "Csus": dict(name="C9sus4", bass="C2",  pad=["G3", "Bb3", "D4", "F4"], arp=["G4", "Bb4", "C5", "F5"]),
}
PROG = ["F", "Am", "Dm", "Bb"]
# extra outro bars when the bar count is not a multiple of 4 (vi-ii-V turnaround)
OUTRO_EXTRA = {0: [], 1: ["Csus"], 2: ["Gm", "Csus"], 3: ["Dm", "Gm", "Csus"]}
FINAL_PAD = ["F3", "A3", "C4", "E4", "G4"]
FINAL_BELL = ["A4", "C5", "E5", "G5"]

ARP_PATTERN = [0, 1, 2, 3, 1, 2, 3, 2]                     # 8th notes, index into chord arp pool
ARP_ACCENT = [1.0, 0.72, 0.86, 0.72, 0.93, 0.72, 0.86, 0.76]
# (16th step, semitones above root, velocity)
BASS_PATTERN = [(2, 0, 0.95), (6, 0, 0.86), (10, 12, 0.80), (14, 0, 0.88)]
BASS_LEN = 1.6 * STEP

# Lead: C-major pentatonic (C D E G A -- all diatonic to F major, no F so it
# never rubs against the maj7/9 E in the voicings).  8-bar call & response.
# (16th step, note, length in 16ths, velocity)
LEAD_PHRASE = [
    [(0, "A5", 3, 1.00), (3, "G5", 3, 0.85), (6, "E5", 4, 0.90), (10, "C5", 6, 0.80)],   # Fmaj9
    [(2, "C5", 2, 0.75), (4, "D5", 2, 0.80), (6, "E5", 8, 0.90)],                        # Am7
    [(0, "A5", 3, 1.00), (3, "G5", 3, 0.85), (6, "E5", 4, 0.90), (10, "D5", 6, 0.80)],   # Dm9
    [(2, "C5", 2, 0.75), (4, "D5", 2, 0.80), (6, "G5", 8, 0.90)],                        # Bbmaj7
    [(0, "A5", 3, 1.00), (3, "C6", 3, 0.90), (6, "A5", 4, 0.85), (10, "G5", 6, 0.80)],   # Fmaj9
    [(2, "E5", 2, 0.75), (4, "G5", 2, 0.80), (6, "A5", 8, 0.90)],                        # Am7
    [(0, "C6", 3, 0.95), (3, "A5", 3, 0.85), (6, "G5", 4, 0.85), (10, "E5", 6, 0.80)],   # Dm9
    [(2, "D5", 2, 0.75), (4, "C5", 2, 0.75), (6, "D5", 10, 0.85)],                       # Bbmaj7
]

# stem loudness targets (approx. K-weighted, measured over Groove C, pre-master scale)
STEM_TARGETS = {
    "kick": -20.0, "bass": -21.0, "pad": -21.5, "arp": -25.0,
    "lead": -26.0, "clap": -27.5, "hats": -31.5,
}
FX_TARGET = -27.5            # loudness of the main riser over its 2 bars

# --------------------------------------------------------------------------
# DSP helpers (numpy only)
# --------------------------------------------------------------------------


def next_fast_len(n):
    """Smallest 2^a 3^b 5^c >= n."""
    best = 1 << int(n - 1).bit_length()
    p5 = 1
    while p5 < best:
        p35 = p5
        while p35 < best:
            q = p35
            while q < n:
                q *= 2
            best = min(best, q)
            p35 *= 3
        p5 *= 5
    return best


def lp_mag(f, fc, order=2):
    return 1.0 / np.sqrt(1.0 + (np.asarray(f, float) / fc) ** (2 * order))


def hp_mag(f, fc, order=2):
    f = np.asarray(f, float)
    with np.errstate(divide="ignore", over="ignore"):
        r = np.where(f > 0, fc / np.maximum(f, 1e-9), np.inf)
        return 1.0 / np.sqrt(1.0 + r ** (2 * order))


def peak_gain(f, fc, gain_db, width_oct):
    x = np.log2(np.maximum(np.asarray(f, float), 1.0) / fc) / width_oct
    return 10.0 ** (gain_db * np.exp(-0.5 * x * x) / 20.0)


def shelf_gain(f, fc, gain_db):
    """Smooth high shelf (gain_db above fc, transition ~1.5 oct)."""
    x = np.log2(np.maximum(np.asarray(f, float), 1.0) / fc)
    return 10.0 ** ((gain_db / (1.0 + np.exp(-3.0 * x))) / 20.0)


def fft_filter(x, mag_fn, pad_s=0.25):
    """Zero-phase filtering by multiplying the spectrum with mag_fn(freqs)."""
    x = np.asarray(x)
    n = x.shape[0]
    L = next_fast_len(n + int(pad_s * SR))
    X = np.fft.rfft(x.astype(np.float64), n=L, axis=0)
    g = mag_fn(np.fft.rfftfreq(L, 1.0 / SR))
    X *= g[:, None] if x.ndim == 2 else g
    return np.fft.irfft(X, n=L, axis=0)[:n].astype(np.float32 if x.dtype == np.float32 else np.float64)


def stft_filter(x, gain_fn, nfft=2048, hop=512, batch=256):
    """Time-varying zero-phase filter: Hann-windowed STFT, per-frame real gain
    gain_fn(frame_times[B], freqs[nb]) -> [B, nb], weighted overlap-add."""
    x2 = x[:, None] if x.ndim == 1 else x
    n, nch = x2.shape
    R = nfft // hop
    win = 0.5 - 0.5 * np.cos(TWO_PI * np.arange(nfft) / nfft)
    ola_norm = np.sum(win ** 2) / hop
    pad = nfft
    n_frames = int(math.ceil((n + 2 * pad - nfft) / hop)) + 1
    Lp = (n_frames + R) * hop
    freqs = np.fft.rfftfreq(nfft, 1.0 / SR)
    out = np.zeros((n, nch), dtype=np.float32)
    for c in range(nch):
        xp = np.zeros(Lp)
        xp[pad:pad + n] = x2[:, c]
        frames = sliding_window_view(xp, nfft)[::hop][:n_frames]
        acc = np.zeros((n_frames + R, hop))
        for b0 in range(0, n_frames, batch):
            fr = frames[b0:b0 + batch] * win
            nb = fr.shape[0]
            S = np.fft.rfft(fr, axis=1)
            tc = ((b0 + np.arange(nb)) * hop + nfft / 2 - pad) / SR
            S *= gain_fn(tc, freqs)
            y = np.fft.irfft(S, nfft, axis=1) * win
            for j in range(R):
                acc[b0 + j:b0 + j + nb] += y[:, j * hop:(j + 1) * hop]
        out[:, c] = (acc.reshape(-1) / ola_norm)[pad:pad + n]
    return out if x.ndim == 2 else out[:, 0]


def fft_convolve(x, h, full=False):
    """Stereo linear convolution (channel c of x with channel c of h)."""
    n, m = len(x), len(h)
    L = next_fast_len(n + m - 1)
    out_len = n + m - 1 if full else n
    out = np.empty((out_len, 2), dtype=np.float32)
    for c in range(2):
        X = np.fft.rfft(x[:, c].astype(np.float64), L)
        H = np.fft.rfft(h[:, c].astype(np.float64), L)
        out[:, c] = np.fft.irfft(X * H, L)[:out_len]
    return out


def place(buf, t, sig, gain=1.0, pan=0.0):
    """Mix sig (mono or stereo) into buf at time t (s); equal-power pan."""
    i = int(round(t * SR))
    if i >= len(buf) or gain == 0.0:
        return
    if i < 0:
        sig = sig[-i:]
        i = 0
    n = min(len(sig), len(buf) - i)
    if n <= 0:
        return
    if sig.ndim == 1:
        th = (pan + 1.0) * math.pi / 4.0
        buf[i:i + n, 0] += sig[:n] * (gain * math.cos(th) * SQ2)
        buf[i:i + n, 1] += sig[:n] * (gain * math.sin(th) * SQ2)
    else:
        buf[i:i + n] += sig[:n] * gain


def fade_tail(n, k):
    e = np.ones(n)
    k = min(k, n)
    e[n - k:] = np.cos(np.linspace(0.0, math.pi / 2, k)) ** 2
    return e


def sin2_ramp(t, a):
    return np.where(t < a, np.sin(0.5 * math.pi * np.clip(t / a, 0, 1)) ** 2, 1.0)


def kweight_loudness(x):
    """Approximate BS.1770 loudness (ungated, K-weighting magnitude only)."""
    if len(x) == 0:
        return -120.0
    y = fft_filter(x, lambda f: hp_mag(f, 40.0, 2) * shelf_gain(f, 1600.0, 4.0), pad_s=0.05)
    ms = float(np.sum(np.mean(y.astype(np.float64) ** 2, axis=0)))
    return -0.691 + 10.0 * math.log10(ms + 1e-20)


# --------------------------------------------------------------------------
# instruments
# --------------------------------------------------------------------------
TABLE_N = 4096


class Synth:
    PAD_DET = ((-9.0, -1.5, 6.0), (-6.0, 2.0, 9.5))   # cents per voice, L / R

    def __init__(self, rng):
        self.rng = rng
        self._tables = {}
        self._pluck = {}
        self._bass = {}
        self.kicks = [self._make_kick() for _ in range(4)]
        self.claps = [self._make_clap() for _ in range(4)]
        self.hats = [self._make_hat(0.030, 0.12) for _ in range(6)]
        self.ghosts = [self._make_hat(0.016, 0.08) for _ in range(6)]
        self.opens = [self._make_hat(0.16, 0.50) for _ in range(3)]

    # ---- pad: band-limited, low-passed saw wavetables, 3 detuned voices/side
    def _table(self, m, cutoff=2600.0):
        key = (m, cutoff)
        if key not in self._tables:
            f0 = hz(m)
            nh = int(min(0.45 * SR / f0, TABLE_N // 2 - 1))
            k = np.arange(1, nh + 1)
            amps = (1.0 / k) * lp_mag(k * f0, cutoff, 2)
            spec = np.zeros(TABLE_N // 2 + 1, dtype=complex)
            spec[k] = -1j * amps * (TABLE_N / 2)
            tab = np.fft.irfft(spec, TABLE_N)
            self._tables[key] = tab / np.max(np.abs(tab))
        return self._tables[key]

    @staticmethod
    def _osc(tab, f_inst, phase0):
        ph = phase0 + np.cumsum(f_inst) / SR
        ph -= np.floor(ph)
        pos = ph * TABLE_N
        i0 = pos.astype(np.int64)
        fr = pos - i0
        i0 &= TABLE_N - 1
        i1 = (i0 + 1) & (TABLE_N - 1)
        return tab[i0] * (1.0 - fr) + tab[i1] * fr

    def pad_chord(self, notes, hold, attack, rel_tau=0.38, tail=1.5, decay_tau=None):
        r = self.rng
        n = int((hold + tail) * SR)
        t = np.arange(n) / SR
        env = sin2_ramp(t, attack)
        if decay_tau:
            env = env * np.exp(-np.maximum(t - attack, 0) / decay_tau)
        env = np.where(t > hold, env * np.exp(-(t - hold) / rel_tau), env)
        env *= fade_tail(n, int(0.05 * SR))
        out = np.zeros((n, 2))
        for m in notes:
            f0 = hz(m)
            tab = self._table(m)
            for ch in (0, 1):
                for d in self.PAD_DET[ch]:
                    cents = d + r.uniform(1.0, 2.5) * np.sin(TWO_PI * r.uniform(0.08, 0.25) * t + r.uniform(0, TWO_PI))
                    out[:, ch] += self._osc(tab, f0 * 2.0 ** (cents / 1200.0), r.random())
        out *= env[:, None] / (3.0 * len(notes))
        return out.astype(np.float32)

    # ---- pluck: additive soft saw, upper harmonics decay faster (= closing filter)
    def pluck(self, m):
        if m not in self._pluck:
            r = self.rng
            f0 = hz(m)
            n = int(0.7 * SR)
            t = np.arange(n) / SR
            sig = np.zeros(n)
            for k in range(1, int(min(12, 8000.0 / f0)) + 1):
                amp = 1.0 if k == 1 else 0.42 / k
                tau = 0.20 / (1.0 + 0.55 * (k - 1))
                ph = 0.0 if k == 1 else r.uniform(0, TWO_PI)
                sig += amp * np.exp(-t / tau) * np.sin(TWO_PI * k * f0 * t + ph)
            sig *= np.minimum(1.0, t / 0.002) * fade_tail(n, int(0.03 * SR))
            self._pluck[m] = sig.astype(np.float32)
        return self._pluck[m]

    # ---- bell lead: harmonic partials with partial-dependent decay (soft mallet/bell)
    def bell(self, m, dur, bright=1.0):
        f0 = hz(m)
        n = int((dur + 1.0) * SR)
        t = np.arange(n) / SR
        sig = np.zeros(n)
        for ratio, amp, tau in ((1.0, 1.0, 1.3), (2.0, 0.30, 0.55), (3.0, 0.11, 0.30),
                                (4.0, 0.05, 0.18), (6.0, 0.022, 0.08)):
            if ratio * f0 > 9500:
                continue
            a = amp if ratio == 1.0 else amp * bright
            sig += a * np.exp(-t / tau) * np.sin(TWO_PI * ratio * f0 * t)
        env = sin2_ramp(t, 0.004)
        env = np.where(t > dur, env * np.exp(-(t - dur) / 0.22), env)
        sig *= env * fade_tail(n, int(0.05 * SR))
        return sig.astype(np.float32)

    # ---- sub bass: sine + tiny 2nd (and a hint of 3rd for small speakers)
    def bass(self, m, dur, decay=0.6):
        key = (m, round(dur, 4), decay)
        if key not in self._bass:
            f0 = hz(m)
            n = int((dur + 0.06) * SR)
            t = np.arange(n) / SR
            ph = TWO_PI * f0 * t
            sig = np.sin(ph) + 0.15 * np.sin(2 * ph) + 0.035 * np.sin(3 * ph)
            env = sin2_ramp(t, 0.006) * np.exp(-t / decay)
            rel = np.clip((t - dur) / 0.05, 0, 1)
            env *= np.cos(0.5 * math.pi * rel) ** 2
            self._bass[key] = (sig * env).astype(np.float32)
        return self._bass[key]

    # ---- drums
    def _make_kick(self):
        r = self.rng
        n = int(0.42 * SR)
        t = np.arange(n) / SR
        f_hi, f_lo, tp = 120.0 * r.uniform(0.98, 1.02), 45.0, 0.034
        phase = TWO_PI * (f_lo * t + (f_hi - f_lo) * tp * (1.0 - np.exp(-t / tp)))
        sig = np.sin(phase) * np.exp(-t / 0.12) * fade_tail(n, int(0.12 * SR))
        sig = np.tanh(1.3 * sig) / np.tanh(1.3)
        click = r.standard_normal(n) * np.exp(-t / 0.0018)
        click = fft_filter(click, lambda f: lp_mag(f, 3500, 2) * hp_mag(f, 300, 1))
        sig = sig + 0.06 * click / (np.max(np.abs(click)) + 1e-12)
        return (sig / np.max(np.abs(sig))).astype(np.float32)

    def _make_clap(self):
        r = self.rng
        n = int(0.42 * SR)
        t = np.arange(n) / SR
        env = np.zeros(n)
        for j, d in enumerate((0.0, 0.0085 + r.uniform(-1e-3, 1e-3), 0.0175 + r.uniform(-1.5e-3, 1.5e-3))):
            m = t >= d
            env[m] += (0.75 + 0.1 * j) * np.exp(-(t[m] - d) / 0.0032)
        m = t >= 0.026
        env[m] += 0.7 * np.exp(-(t[m] - 0.026) / 0.085)
        sig = r.standard_normal(n) * env * fade_tail(n, int(0.08 * SR))
        sig = fft_filter(sig, lambda f: hp_mag(f, 700, 2) * lp_mag(f, 4500, 2) * peak_gain(f, 1300, 4.0, 0.7))
        return (sig / np.max(np.abs(sig))).astype(np.float32)

    def _make_hat(self, decay, length):
        r = self.rng
        n = int(length * SR)
        t = np.arange(n) / SR
        env = np.exp(-t / decay) * np.minimum(1.0, t / 0.0005) * fade_tail(n, int(0.02 * SR))
        sig = fft_filter(r.standard_normal(n) * env, lambda f: hp_mag(f, 6000, 3) * lp_mag(f, 10000, 2))
        return (sig / np.max(np.abs(sig))).astype(np.float32)

    # ---- transitions
    def riser(self, length, f_lo=250.0, f_hi=6000.0, width=0.6):
        n = int(length * SR)
        noise = self.rng.standard_normal((n + int(0.3 * SR), 2))
        lpf = lp_mag(np.fft.rfftfreq(2048, 1.0 / SR), 7000, 2)

        def g(tc, f):
            x = np.clip(tc / length, 0, 1)[:, None]
            fc = f_lo * (f_hi / f_lo) ** (x ** 1.3)
            lf = np.log2(np.maximum(f, 20.0)[None, :] / fc)
            return np.exp(-0.5 * (lf / width) ** 2) * x ** 2.2 * (tc[:, None] <= length) * lpf[None, :]

        y = stft_filter(noise, g)[:n]
        k = int(0.015 * SR)
        y[n - k:] *= np.linspace(1, 0, k)[:, None]
        return y

    def impact(self):
        r = self.rng
        n = int(1.6 * SR)
        t = np.arange(n) / SR
        phase = TWO_PI * (38.0 * t + 30.0 * 0.12 * (1.0 - np.exp(-t / 0.12)))
        boom = np.sin(phase) * np.exp(-t / 0.45) * fade_tail(n, int(0.3 * SR))
        nz = r.standard_normal((n, 2)) * np.exp(-t / 0.18)[:, None] * np.minimum(1, t / 0.003)[:, None]
        nz = fft_filter(nz, lambda f: lp_mag(f, 1800, 2) * hp_mag(f, 120, 1))
        nz /= np.max(np.abs(nz)) + 1e-12
        return (0.8 * boom[:, None] + 0.25 * nz).astype(np.float32)

    def reverse_swell(self, ir, notes, length):
        n0 = int(0.35 * SR)
        t = np.arange(n0) / SR
        burst = np.zeros(n0)
        for m in notes:
            burst += np.sin(TWO_PI * hz(m) * t)
        burst *= np.minimum(1, t / 0.005) * np.exp(-t / 0.12)
        wet = fft_convolve(np.stack([burst, burst], 1), ir, full=True)[::-1]
        k = int(length * SR)
        y = wet[-k:].copy()
        y *= (np.linspace(0, 1, k) ** 2)[:, None]
        y *= fade_tail(k, int(0.012 * SR))[:, None]
        y = fft_filter(y, lambda f: hp_mag(f, 200, 2) * lp_mag(f, 6000, 1))
        return y / (np.max(np.abs(y)) + 1e-12)


def make_ir(rng, length=2.6, predelay=0.020):
    """Stereo reverb IR: decorrelated noise with frequency-dependent exponential
    decay (RT60 ~1.9 s lows .. 0.45 s highs => ~1.8 s mid RT, damped highs)."""
    n = int(length * SR)
    noise = rng.standard_normal((n, 2))
    lf = np.log10([80, 250, 500, 1000, 2000, 4000, 8000, 16000, 22050])
    rts = np.array([1.95, 1.9, 1.85, 1.75, 1.5, 1.15, 0.75, 0.45, 0.35])
    shape = None

    def gain(tc, f):
        nonlocal shape
        if shape is None:
            shape = (np.interp(np.log10(np.maximum(f, 20.0)), lf, rts),
                     hp_mag(f, 150, 1) * lp_mag(f, 9000, 1))
        rt, sh = shape
        tt = np.maximum(tc, 0.0)[:, None]
        return np.exp(-6.9078 * tt / rt[None, :]) * sh[None, :]

    ir = stft_filter(noise, gain, nfft=1024, hop=256)
    k = int(0.012 * SR)
    ir[:k] *= (np.linspace(0, 1, k) ** 1.5)[:, None]
    ir *= fade_tail(n, int(0.3 * SR))[:, None]
    ir = np.vstack([np.zeros((int(predelay * SR), 2), np.float32), ir])
    ir /= np.sqrt(np.sum(ir.astype(np.float64) ** 2, axis=0, keepdims=True))
    return ir.astype(np.float32)


def pingpong(x, delay_s, fb, first, n_rep=7):
    """Ping-pong echo (dotted 1/8): mono-summed input, repeats alternate L/R,
    darkened and thinned (HP 300 Hz, LP 3.5 kHz)."""
    mono = x.mean(axis=1)
    n = len(mono)
    D = int(round(delay_s * SR))
    out = np.zeros((n, 2), np.float32)
    g = first
    for r in range(1, n_rep + 1):
        off = r * D
        if off >= n:
            break
        out[off:, (r - 1) % 2] += g * mono[:n - off]
        g *= fb
    return fft_filter(out, lambda f: hp_mag(f, 300, 1) * lp_mag(f, 3500, 2))


def sidechain_env(n, kick_times, depth, tau=0.09, att=0.004):
    sl = int(0.45 * SR)
    t = np.arange(sl) / SR
    shape = np.where(t < att, t / att, np.exp(-(t - att) / tau))
    env = np.ones(n, np.float32)
    for kt in kick_times:
        i = int(round(kt * SR))
        j = min(n, i + sl)
        if i < n:
            env[i:j] = np.minimum(env[i:j], 1.0 - depth * shape[:j - i])
    return env


# --------------------------------------------------------------------------
# arrangement
# --------------------------------------------------------------------------


def plan(duration):
    N = int(round(duration * SR))
    n_body = int(math.floor((duration - TAIL_MIN) / BAR + 1e-9))
    rem = n_body % 4
    k = (n_body - 12 - rem) // 4          # 4-bar blocks to share between grooves A/B/C
    if k < 3:
        raise SystemExit("duration too short (need >= ~60 s)")
    center = 0.58 * duration / BAR        # aim the breakdown centre at ~58 %
    pre = int(round((center - 2.0 - 4.0) / 4.0))
    pre = max(2, min(pre, k - 2 if k >= 5 else k - 1))
    a = max(1, min(pre - 1, 3, int(round(pre * 0.35))))   # Groove A: 4..12 bars
    b, c = pre - a, k - pre
    sections = [("Intro", 4), ("Groove A", 4 * a), ("Groove B", 4 * b),
                ("Breakdown", 4), ("Groove C", 4 * c), ("Outro", 4 + rem)]
    bars, secs, start = [], [], 0
    for name, nb in sections:
        chords = (PROG + OUTRO_EXTRA[rem]) if name == "Outro" else [PROG[i % 4] for i in range(nb)]
        secs.append(dict(name=name, bar0=start, bar1=start + nb, t0=start * BAR, t1=(start + nb) * BAR))
        for i in range(nb):
            bars.append(dict(idx=start + i, sec=name, i=i, nb=nb, t0=(start + i) * BAR, chord=chords[i]))
        start += nb
    T_final = n_body * BAR
    secs.append(dict(name="Final chord + fade", bar0=n_body, bar1=duration / BAR, t0=T_final, t1=duration))
    for bar in bars:
        bar["L"] = layers(bar)
    return dict(N=N, duration=duration, n_body=n_body, rem=rem, bars=bars, secs=secs,
                T_final=T_final, sec={s["name"]: s for s in secs})


def lead_start(nb):
    return 4 if nb >= 12 else 0


def layers(bar):
    s, i, nb = bar["sec"], bar["i"], bar["nb"]
    L = dict(pad=1.0, arp=0.85, kick=False, hat=False, ghost=False, open=False, bass=False,
             clap=False, lead=None, lead_oct=False, gap=False, fill=False, pickup=False)
    if s == "Intro":
        L.update(pad=0.70 + 0.05 * i, arp=0.55 + 0.07 * i)
    elif s == "Groove A":
        L.update(kick=True, hat=True, bass=True, ghost=(nb >= 8 and i >= nb // 2),
                 open=(i == nb - 1), pickup=(i % 2 == 1))
    elif s in ("Groove B", "Groove C"):
        L.update(kick=True, hat=True, bass=True, clap=True, ghost=True, open=(i % 2 == 1), pickup=(i % 2 == 1))
        ls = lead_start(nb) if s == "Groove B" else 0
        if i >= ls:
            L["lead"] = (i - ls) % 8
        if s == "Groove C":
            L["lead_oct"] = True
            L["arp"] = 0.9
        if s == "Groove B" and i == nb - 1:
            L["gap"] = True                    # last beat empties out before the breakdown
        L["fill"] = (i % 8 == 7) and not L["gap"]
    elif s == "Breakdown":
        L.update(pad=0.85, arp=0.80)
    elif s == "Outro":
        L.update(kick=i < nb - 2, hat=i < nb - 2, ghost=i < nb - 3, open=(i < nb - 3 and i % 2 == 1),
                 clap=i < nb - 3, bass=i < nb - 1, arp=0.85 - 0.4 * i / max(1, nb - 1))
    return L


def step_time(t0, s):
    return t0 + s * STEP + (SWING_OFFSET if s % 2 == 1 else 0.0)


def filter_curve(arr):
    """Pad/arp low-pass cutoff vs time: intro opens 300 Hz -> 3.8 kHz, open in the
    grooves, dips to 1.1 kHz in the breakdown and re-opens with the riser,
    closes through the outro and the final ring-out."""
    sec, D, T_fin = arr["sec"], arr["duration"], arr["T_final"]
    T_A, T_bd, T_C, T_out = sec["Groove A"]["t0"], sec["Breakdown"]["t0"], sec["Groove C"]["t0"], sec["Outro"]["t0"]
    OPEN = 20000.0

    def ll(a, b, x):
        return a * (b / a) ** np.clip(x, 0.0, 1.0)

    def fc(t):
        t = np.asarray(t, float)
        out = np.full(t.shape, OPEN)
        m = t < T_A
        out[m] = ll(300.0, 3800.0, (np.maximum(t[m], 0) / T_A) ** 0.85)
        m = (t >= T_bd) & (t < T_C)
        tb = t[m]
        v = np.where(tb - T_bd < BEAT, ll(OPEN, 1100.0, (tb - T_bd) / BEAT), 1100.0)
        rise = tb >= T_C - 2 * BAR
        v = np.where(rise, ll(1100.0, 7000.0, np.clip((tb - (T_C - 2 * BAR)) / (2 * BAR), 0, 1) ** 1.4), v)
        out[m] = v
        m = (t >= T_out) & (t < T_fin)
        out[m] = ll(OPEN, 1500.0, (t[m] - T_out) / (T_fin - T_out))
        m = t >= T_fin
        out[m] = ll(1500.0, 700.0, (t[m] - T_fin) / (D - T_fin))
        return out

    def gain(tc, f):
        fcs = fc(tc)[:, None]
        g = 1.0 / np.sqrt(1.0 + (f[None, :] / fcs) ** 4)
        res = np.clip((9000.0 - fcs) / 5000.0, 0, 1) * 0.3       # slight resonance while swept
        return g * (1.0 + res * np.exp(-0.5 * (np.log2(np.maximum(f[None, :], 1.0) / fcs) / 0.4) ** 2))

    return gain


# --------------------------------------------------------------------------
# rendering
# --------------------------------------------------------------------------


def render_stems(arr, rng):
    N = arr["N"]
    syn = Synth(rng)
    st = {k: np.zeros((N, 2), np.float32) for k in ("kick", "bass", "pad", "arp", "lead", "clap", "hats", "fx")}
    kick_times = []

    def hum(v, s=0.07):
        return float(np.clip(v * (1.0 + s * rng.standard_normal()), 0.3, 1.15))

    def jit(s=0.002):
        return float(rng.normal(0.0, s))

    for bar in arr["bars"]:
        L, ch, t0, sec = bar["L"], CHORDS[bar["chord"]], bar["t0"], bar["sec"]

        # pad
        if bar["idx"] == 0:
            attack = 1.8
        elif sec in ("Intro", "Breakdown", "Outro"):
            attack = 0.7
        else:
            attack = 0.4
        place(st["pad"], t0, syn.pad_chord([midi(x) for x in ch["pad"]], BAR, attack), gain=L["pad"])

        # arp (8ths; dotted-1/8 echo fills the 16ths), alternating slight pan
        pool = [midi(x) for x in ch["arp"]]
        for e in range(8):
            s = 2 * e
            v = hum(L["arp"] * ARP_ACCENT[e])
            place(st["arp"], step_time(t0, s) + jit(), syn.pluck(pool[ARP_PATTERN[e]]), v, pan=0.22 if e % 2 else -0.22)
        if L["pickup"]:
            place(st["arp"], step_time(t0, 15) + jit(), syn.pluck(pool[3]), hum(0.5 * L["arp"]), pan=0.3)

        # lead (bell) + soft octave double in Groove C
        if L["lead"] is not None:
            for s, note, ln, v in LEAD_PHRASE[L["lead"]]:
                tt = step_time(t0, s) + jit(0.003)
                dur = ln * STEP * 0.92
                place(st["lead"], tt, syn.bell(midi(note), dur), hum(v, 0.05))
                if L["lead_oct"]:
                    place(st["lead"], tt + 0.004, syn.bell(midi(note) + 12, dur * 0.8, bright=0.6), hum(0.2 * v, 0.05))

        # bass
        if L["bass"]:
            root = midi(ch["bass"])
            for s, semi, v in BASS_PATTERN:
                if L["gap"] and s >= 12:
                    continue
                if bar["i"] % 8 == 7 and s == 14:
                    semi = 7                                   # fifth as a lead-in every 8 bars
                place(st["bass"], step_time(t0, s), syn.bass(root + semi, BASS_LEN), hum(v, 0.04))

        # drums
        if L["kick"]:
            for s in (0, 4, 8, 12):
                if L["gap"] and s == 12:
                    continue
                tt = step_time(t0, s)
                kick_times.append(tt)
                place(st["kick"], tt, syn.kicks[rng.integers(4)], hum(1.0, 0.03))
        if L["clap"]:
            for s in (4, 12):
                place(st["clap"], step_time(t0, s) + 0.003 + jit(0.001), syn.claps[rng.integers(4)], hum(0.9, 0.05))
            if L["fill"]:
                place(st["clap"], step_time(t0, 14) + 0.003, syn.claps[rng.integers(4)], hum(0.32, 0.05), pan=-0.15)
                place(st["clap"], step_time(t0, 15) + 0.003, syn.claps[rng.integers(4)], hum(0.48, 0.05), pan=0.15)
        if L["hat"]:
            for s in (2, 6, 10, 14):
                if L["gap"] and s >= 12:
                    continue
                if s == 14 and L["open"]:
                    place(st["hats"], step_time(t0, s) + jit(0.0015), syn.opens[rng.integers(3)], hum(0.75, 0.06), pan=0.1)
                else:
                    place(st["hats"], step_time(t0, s) + jit(0.0015), syn.hats[rng.integers(6)], hum(0.8, 0.08), pan=0.15)
        if L["ghost"]:
            for s in range(1, 16, 2):
                if L["gap"] and s >= 11:
                    continue
                place(st["hats"], step_time(t0, s) + jit(0.0015), syn.ghosts[rng.integers(6)],
                      hum(0.36 if s % 4 == 3 else 0.28, 0.12), pan=-0.22)

    # final chord: pad + strummed bell + deep sub, ringing out
    T_fin = arr["T_final"]
    tail = arr["duration"] - T_fin
    place(st["pad"], T_fin, syn.pad_chord([midi(x) for x in FINAL_PAD], tail, 0.12, tail=0.2, decay_tau=2.8), 1.05)
    for j, nm in enumerate(FINAL_BELL):
        place(st["lead"], T_fin + 0.03 * j, syn.bell(midi(nm), 2.5), 0.5)
    place(st["bass"], T_fin, syn.bass(midi("F1"), 3.0, decay=1.3), 0.85)

    # transitions
    sec = arr["sec"]
    T_A, T_B, T_C, T_out = sec["Groove A"]["t0"], sec["Groove B"]["t0"], sec["Groove C"]["t0"], sec["Outro"]["t0"]
    for t_end, nbars, lvl in ((T_A, 2, 0.85), (T_B, 1, 0.55), (T_C, 2, 1.0)):
        place(st["fx"], t_end - nbars * BAR, syn.riser(nbars * BAR), lvl)
    imp = syn.impact()
    place(st["fx"], T_A, imp, 0.45)
    place(st["fx"], T_C, imp, 0.6)
    return st, syn, kick_times


def render(duration, seed, verbose=True):
    t_start = time.time()
    rng = np.random.default_rng(seed)
    arr = plan(duration)
    N = arr["N"]
    st, syn, kick_times = render_stems(arr, rng)
    if verbose:
        print(f"  stems synthesised        {time.time() - t_start:6.1f} s")

    # time-varying low-pass on pad + arp
    g = filter_curve(arr)
    st["pad"] = stft_filter(st["pad"], g)
    st["arp"] = stft_filter(st["arp"], g)
    st["pad"] = fft_filter(st["pad"], lambda f: hp_mag(f, 120, 2))
    st["arp"] = fft_filter(st["arp"], lambda f: hp_mag(f, 250, 1) * lp_mag(f, 5000, 1))
    st["lead"] = fft_filter(st["lead"], lambda f: hp_mag(f, 300, 1) * lp_mag(f, 6500, 2))
    st["bass"] = fft_filter(st["bass"], lambda f: lp_mag(f, 200, 4) * hp_mag(f, 28, 2))

    # stem calibration over Groove C
    c0, c1 = int(arr["sec"]["Groove C"]["t0"] * SR), int(arr["sec"]["Groove C"]["t1"] * SR)
    cal = {}
    for name, target in STEM_TARGETS.items():
        lv = kweight_loudness(st[name][c0:c1])
        gain = 10.0 ** ((target - lv) / 20.0)
        st[name] *= np.float32(gain)
        cal[name] = (lv, 20 * math.log10(gain))
    r0, r1 = int((arr["sec"]["Groove C"]["t0"] - 2 * BAR) * SR), c0
    lv = kweight_loudness(st["fx"][r0:r1])
    st["fx"] *= np.float32(10.0 ** ((FX_TARGET - lv) / 20.0))

    # reverse swell into the outro (scaled relative to the riser level)
    ir = make_ir(rng)
    swell = syn.reverse_swell(ir, [midi(x) for x in ("F3", "A3", "C4", "F4", "A4")], BAR)
    sw_buf = np.zeros_like(st["fx"])
    place(sw_buf, arr["sec"]["Outro"]["t0"] - BAR, swell)
    sw_lv = kweight_loudness(swell)
    st["fx"] += sw_buf * np.float32(10.0 ** ((FX_TARGET - 1.0 - sw_lv) / 20.0))
    del sw_buf

    # sidechain ducking from the kick
    sc_pad = sidechain_env(N, kick_times, 0.35)[:, None]
    st["pad"] *= sc_pad
    st["bass"] *= sidechain_env(N, kick_times, 0.30)[:, None]
    st["arp"] *= sidechain_env(N, kick_times, 0.12)[:, None]

    # delay + reverb
    dly = pingpong(st["arp"], 0.75 * BEAT, fb=0.42, first=0.42) + pingpong(st["lead"], 0.75 * BEAT, fb=0.33, first=0.30)
    send = (0.30 * st["pad"] + 0.30 * st["arp"] + 0.35 * st["lead"] + 0.22 * st["clap"]
            + 0.07 * st["hats"] + 0.50 * st["fx"] + 0.30 * dly)
    rev = fft_convolve(send, ir)
    del send
    rev = fft_filter(rev, lambda f: hp_mag(f, 220, 1)) * sidechain_env(N, kick_times, 0.22)[:, None]

    mix = np.zeros((N, 2), np.float64)
    for k in st:
        mix += st[k]
    mix += 0.8 * dly + 0.9 * rev
    del dly, rev

    # master pre-processing: DC / rumble removal, final fade to digital silence
    mix = fft_filter(mix, lambda f: hp_mag(f, 25, 2) * shelf_gain(f, 9000.0, -2.5) * lp_mag(f, 16000.0, 1))
    mix -= mix.mean(axis=0, keepdims=True)
    tail = duration - arr["T_final"]
    fade_len = min(4.8, tail - 0.25)
    fe = N - int(0.05 * SR)
    fs = fe - int(fade_len * SR)
    x = np.linspace(0.0, 1.0, fe - fs)
    mix[fs:fe] *= (np.cos(0.5 * math.pi * x) ** 2)[:, None]
    mix[fe:] = 0.0
    lv = kweight_loudness(mix[c0:c1])
    mix *= 10.0 ** ((-17.0 - lv) / 20.0)          # premaster at ~ -17 LUFS(ish) in Groove C
    if verbose:
        print(f"  mix done                 {time.time() - t_start:6.1f} s   premaster peak {20 * math.log10(np.max(np.abs(mix))):.1f} dBFS")
        print("  stem calibration (measured -> gain):  " +
              ", ".join(f"{k} {v[0]:.1f}->{v[1]:+.1f}dB" for k, v in cal.items()))
    arr["fade"] = (fs / SR, fe / SR)
    return mix.astype(np.float32), arr


# --------------------------------------------------------------------------
# mastering (ffmpeg) + output
# --------------------------------------------------------------------------


def ffmpeg(args):
    p = subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-y"] + args, capture_output=True, text=True)
    if p.returncode != 0:
        sys.stderr.write(p.stderr[-4000:])
        raise RuntimeError("ffmpeg failed")
    return p.stderr


def parse_loudnorm(stderr):
    i, j = stderr.rfind("{"), stderr.rfind("}")
    return json.loads(stderr[i:j + 1])


def master(pre_raw, out_raw):
    inp = ["-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", pre_raw]
    comp = "acompressor=threshold=-18dB:ratio=2:attack=25:release=250:makeup=1"
    ln_base = f"loudnorm=I={TARGET_LUFS}:TP={TARGET_TP}:LRA=20"
    m0 = parse_loudnorm(ffmpeg(inp + ["-af", f"{comp},{ln_base}:print_format=json", "-f", "null", "-"]))
    pre_gain = TARGET_LUFS - float(m0["input_i"]) + 0.3
    for ceiling in (-2.5, -3.0, -3.5, -4.0, -5.0):
        lim = f"alimiter=limit={10 ** (ceiling / 20):.4f}:attack=5:release=60:level=disabled:latency=1"
        chain = f"{comp},volume={pre_gain:.2f}dB,{lim}"
        m1 = parse_loudnorm(ffmpeg(inp + ["-af", f"{chain},{ln_base}:print_format=json", "-f", "null", "-"]))
        ln = (f"{ln_base}:measured_I={m1['input_i']}:measured_LRA={m1['input_lra']}:measured_TP={m1['input_tp']}"
              f":measured_thresh={m1['input_thresh']}:offset={m1['target_offset']}:linear=true:print_format=json")
        m2 = parse_loudnorm(ffmpeg(inp + ["-af", f"{chain},{ln},aresample={SR}",
                                          "-c:a", "pcm_f32le", "-f", "f32le", out_raw]))
        if m2.get("normalization_type") == "linear":
            break
        print(f"  loudnorm fell back to {m2.get('normalization_type')} at ceiling {ceiling} dB; retrying lower")
    return dict(pre_gain=pre_gain, ceiling=ceiling, pass1=m1, pass2=m2, comp_in=m0)


def write_wav16(path, x):
    q = x.astype("<i2")
    n = len(q)
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 36 + n * 4) + b"WAVE")
        f.write(b"fmt " + struct.pack("<IHHIIHH", 16, 1, 2, SR, SR * 4, 4, 16))
        f.write(b"data" + struct.pack("<I", n * 4))
        f.write(q.tobytes())


def read_wav16(path):
    with open(path, "rb") as f:
        data = f.read()
    pos = 12
    fmt = None
    while pos < len(data):
        cid, size = data[pos:pos + 4], struct.unpack("<I", data[pos + 4:pos + 8])[0]
        if cid == b"fmt ":
            fmt = struct.unpack("<HHIIHH", data[pos + 8:pos + 24])
        if cid == b"data":
            assert fmt and fmt[0] == 1 and fmt[5] == 16
            return np.frombuffer(data[pos + 8:pos + 8 + size], "<i2").reshape(-1, fmt[1])
        pos += 8 + size + (size & 1)
    raise ValueError("no data chunk")


def finalize(mastered_raw, N, wav_path, rng):
    y = np.fromfile(mastered_raw, dtype="<f4").reshape(-1, 2).astype(np.float64)
    got = len(y)
    if got < N:
        y = np.vstack([y, np.zeros((N - got, 2))])
    y = y[:N]
    silent = np.abs(y) < 1e-7
    d = (rng.random((N, 2)) - rng.random((N, 2)))        # TPDF dither, +-1 LSB
    q = np.round(y * 32768.0 + d)
    q[silent] = 0.0
    q[-int(0.05 * SR):] = 0.0                              # end on digital silence
    clipped = int(np.sum((q > 32767) | (q < -32768)))
    write_wav16(wav_path, np.clip(q, -32768, 32767).astype(np.int16))
    return got, clipped


# --------------------------------------------------------------------------
# verification
# --------------------------------------------------------------------------


def ffprobe_duration(path):
    p = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=sample_rate,channels,codec_name,bit_rate",
                        "-of", "json", path], capture_output=True, text=True)
    return json.loads(p.stdout)


def ebur128(path):
    e = ffmpeg(["-i", path, "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"])
    s = e[e.rfind("Summary:"):]
    get = lambda key: float(re.search(key + r":\s+(-?[\d.]+|-inf)", s).group(1))
    return dict(I=get(r"I"), LRA=get(r"LRA"), TP=get(r"Peak"))


def report(arr, wav_path, mp3_path, mres):
    x = read_wav16(wav_path).astype(np.float64) / 32768.0
    N = len(x)
    print("\n=== sections ===")
    print(f"  {'section':20s} {'bars':>11s} {'start s':>8s} {'end s':>8s}  {'%':>5s}")
    for s in arr["secs"]:
        b1 = s["bar1"] if isinstance(s["bar1"], int) else f"{s['bar1']:.2f}"
        print(f"  {s['name']:20s} {s['bar0']:>4d}-{b1!s:>6s} {s['t0']:8.2f} {s['t1']:8.2f}  {100 * s['t0'] / arr['duration']:5.1f}")
    print(f"  fade-out: {arr['fade'][0]:.2f} -> {arr['fade'][1]:.2f} s, then digital silence")

    print("\n=== RMS per 4 bars (final WAV) ===")
    names = {}
    for b in arr["bars"]:
        names.setdefault(b["idx"] // 4, set()).add(b["sec"])
    nb4 = int(math.ceil(N / (4 * BAR * SR)))
    for w in range(nb4):
        a, b = int(w * 4 * BAR * SR), min(N, int((w + 1) * 4 * BAR * SR))
        rms = math.sqrt(np.mean(x[a:b] ** 2) + 1e-20)
        db = 20 * math.log10(rms)
        label = "/".join(sorted(names.get(w, {"Final"}), key=lambda n: [s["name"] for s in arr["secs"]].index(n) if n in arr["sec"] else 99))
        bar = "#" * max(0, int((db + 40) * 1.2))
        print(f"  bars {4 * w:3d}-{min(4 * w + 4, N / (BAR * SR)):6.2f}  {a / SR:6.1f}s  {db:6.1f} dBFS  {label:22s} {bar}")

    peak = np.max(np.abs(x))
    dc = x.mean(axis=0)
    spec = np.abs(np.fft.rfft(x.mean(axis=1))) ** 2
    f = np.fft.rfftfreq(N, 1.0 / SR)
    tot = spec.sum()
    print("\n=== spectrum (share of energy) ===")
    edges = [20, 60, 120, 250, 500, 1000, 2000, 4000, 8000, 12000, 22050]
    print("  " + "  ".join(f"{edges[i]}-{edges[i + 1]}Hz:{10 * math.log10(spec[(f >= edges[i]) & (f < edges[i + 1])].sum() / tot + 1e-20):5.1f}dB"
                           for i in range(len(edges) - 1)))

    w_info, m_info = ffprobe_duration(wav_path), ffprobe_duration(mp3_path)
    ew, em = ebur128(wav_path), ebur128(mp3_path)
    print("\n=== loudness / format ===")
    print(f"  WAV: duration {float(w_info['format']['duration']):.6f} s ({N} samples), "
          f"{w_info['streams'][0]['codec_name']} {w_info['streams'][0]['sample_rate']} Hz x{w_info['streams'][0]['channels']}")
    print(f"       I {ew['I']:.1f} LUFS, LRA {ew['LRA']:.1f} LU, true peak {ew['TP']:.1f} dBTP, "
          f"sample peak {20 * math.log10(peak):.2f} dBFS, DC L/R {dc[0]:+.1e}/{dc[1]:+.1e}")
    print(f"  MP3: duration {float(m_info['format']['duration']):.6f} s, {m_info['streams'][0]['codec_name']} "
          f"{int(m_info['streams'][0].get('bit_rate', 0)) // 1000} kbps; I {em['I']:.1f} LUFS, LRA {em['LRA']:.1f} LU, TP {em['TP']:.1f} dBTP")
    p2 = mres["pass2"]
    print(f"  master: glue comp -> +{mres['pre_gain']:.2f} dB -> alimiter {mres['ceiling']} dBFS -> loudnorm "
          f"({p2.get('normalization_type')}, in {mres['pass1']['input_i']} LUFS / {mres['pass1']['input_tp']} dBTP, "
          f"out {p2.get('output_i')} LUFS / {p2.get('output_tp')} dBTP)")
    return dict(wav=ew, mp3=em, peak=peak, dc=dc)


# --------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--duration", type=float, default=125.0, help="exact output length in seconds (default 125)")
    ap.add_argument("--seed", type=int, default=20261025, help="random seed (humanisation, noise)")
    ap.add_argument("--out-dir", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tmp", "demo"))
    ap.add_argument("--name", default="music", help="output basename (default: music)")
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    build = os.path.join(args.out_dir, "build")
    os.makedirs(build, exist_ok=True)
    t0 = time.time()
    print(f"Rendering {args.duration:.3f} s @ {BPM:g} BPM (bar = {BAR:.4f} s), seed {args.seed}")
    mix, arr = render(args.duration, args.seed)
    pre_raw = os.path.join(build, "premaster_f32.raw")
    mst_raw = os.path.join(build, "mastered_f32.raw")
    mix.tofile(pre_raw)
    print(f"  mastering with ffmpeg ...")
    mres = master(pre_raw, mst_raw)
    wav = os.path.join(args.out_dir, args.name + ".wav")
    mp3 = os.path.join(args.out_dir, args.name + ".mp3")
    got, clipped = finalize(mst_raw, arr["N"], wav, np.random.default_rng(args.seed + 1))
    ffmpeg(["-i", wav, "-c:a", "libmp3lame", "-b:a", "192k", mp3])
    print(f"  ffmpeg returned {got} samples (target {arr['N']}); clipped samples: {clipped}; total {time.time() - t0:.1f} s")
    report(arr, wav, mp3, mres)
    print(f"\nWrote {wav}\n      {mp3}")


if __name__ == "__main__":
    main()
