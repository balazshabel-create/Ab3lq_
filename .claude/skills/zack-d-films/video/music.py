"""Procedural background music for zack-d-films videos (no samples, no licensing).

compose(total_seconds, sr, style, scenes, seed) -> mono float32 array, peak ~1.0
styles: 'space' (wonder, minor), 'tense' (dark pulse), 'chill' (warm major), 'epic' (big build)
Arrangement follows the video: soft intro, layers build through the middle, a breakdown
in scenes marked silence, and a fade at the end.
"""
import numpy as np

STYLES = {
    #        bpm  chords (semitones from A2 = 110 Hz, minor/major triads)                arp   kick  hats
    "space": (84, [(0, "m"), (-4, "M"), (3, "M"), (-2, "M")], True, True, False),
    "tense": (96, [(-7, "m"), (-11, "M"), (-2, "m"), (-5, "M")], False, True, True),
    "chill": (78, [(3, "M"), (-2, "M"), (0, "m"), (-4, "M")], True, False, True),
    "epic": (90, [(0, "m"), (-4, "M"), (-9, "M"), (-2, "M")], True, True, True),
}


def _hz(semi, octave=0):
    return 110.0 * 2 ** ((semi + 12 * octave) / 12)


def _triad(root, kind):
    return [root, root + (3 if kind == "m" else 4), root + 7]


def _lp(x, cutoff, sr):
    """One-pole low-pass, vectorised via FFT (cheap, good enough for pads)."""
    n = len(x)
    f = np.fft.rfftfreq(n, 1 / sr)
    h = 1 / np.sqrt(1 + (f / cutoff) ** 4)
    return np.fft.irfft(np.fft.rfft(x) * h, n)


def _reverb(x, sr, seconds=2.2, mix=0.35, seed=1):
    rs = np.random.default_rng(seed)
    m = int(sr * seconds)
    ir = rs.standard_normal(m) * np.exp(-np.arange(m) / (sr * seconds / 6))
    ir = _lp(ir, 3500, sr); ir /= np.sqrt((ir ** 2).sum())
    n = 1 << int(np.ceil(np.log2(len(x) + m)))
    wet = np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(ir, n), n)[: len(x)]
    return x * (1 - mix) + wet * mix * 1.6


def _osc(freq, t, harmonics=(1, 0.45, 0.22, 0.1), detune=0.0):
    y = np.zeros_like(t)
    for k, a in enumerate(harmonics, 1):
        y += a * np.sin(2 * np.pi * freq * k * (1 + detune) * t + k)
    return y


def compose(total, sr, style="space", scenes=(), seed=3):
    bpm, prog, use_arp, use_kick, use_hats = STYLES.get(style, STYLES["space"])
    rs = np.random.default_rng(seed)
    n = int(total * sr)
    t = np.arange(n) / sr
    beat = 60 / bpm
    bar = 4 * beat
    chord_len = 2 * bar
    pos = t / max(total, 1e-6)

    # arrangement curves (0..1)
    build = np.clip((pos - 0.08) / 0.25, 0, 1)            # bass/arp come in after the hook
    drive = np.clip((pos - 0.35) / 0.1, 0, 1) * np.clip((0.88 - pos) / 0.06, 0, 1)  # kick section
    fade = np.clip(np.minimum(t / 1.5, (total - t) / 2.5), 0, 1)
    breakdown = np.ones(n)
    for s in scenes:
        if s.get("silence"):
            a, b = int(s["start"] * sr), int((s["start"] + s["duration"]) * sr)
            breakdown[a:b] = 0.12
    k = int(sr * 0.25); breakdown = np.convolve(breakdown, np.ones(k) / k, mode="same")

    pad = np.zeros(n); bass = np.zeros(n); arp = np.zeros(n); drums = np.zeros(n)
    n_chords = int(np.ceil(total / chord_len)) + 1
    xf = 0.6  # crossfade seconds
    for ci in range(n_chords):
        root, kind = prog[ci % len(prog)]
        a0 = ci * chord_len
        a, b = int(max(0, a0 - xf) * sr), min(n, int((a0 + chord_len + xf) * sr))
        if a >= n: break
        tt = t[a:b]; lt = tt - a0
        envp = np.clip((lt + xf) / (2 * xf), 0, 1) * np.clip((chord_len + xf - lt) / (2 * xf), 0, 1)
        for i, semi in enumerate(_triad(root, kind)):
            f = _hz(semi, 1)
            pad[a:b] += envp * (_osc(f, tt, detune=0.003) + _osc(f, tt, detune=-0.003)) * (0.9 - i * 0.15)
        pad[a:b] += envp * 0.5 * np.sin(2 * np.pi * _hz(root, 2) * tt)  # shimmer octave
        # bass: root on every bar, soft pluck
        for bi in range(2):
            s0 = a0 + bi * bar; p = int(s0 * sr); m = min(n - p, int(bar * sr))
            if p < 0 or m <= 0: continue
            bt = np.arange(m) / sr
            bass[p:p + m] += (np.sin(2 * np.pi * _hz(root, 0) * bt) + 0.3 * np.sin(4 * np.pi * _hz(root, 0) * bt)) * np.exp(-bt / 1.4) * np.clip(bt / 0.02, 0, 1)
        # arpeggio: eighth notes over chord tones, two octaves up
        if use_arp:
            tones = _triad(root, kind) + [root + 12]
            for e in range(16):
                s0 = a0 + e * beat / 2; p = int(s0 * sr); m = min(n - max(p, 0), int(beat * 1.5 * sr))
                if p < 0 or m <= 0: continue
                at = np.arange(m) / sr
                f = _hz(tones[[0, 1, 2, 3, 2, 1, 0, 2][e % 8]], 2)
                arp[p:p + m] += (np.sin(2 * np.pi * f * at) + 0.25 * np.sin(4 * np.pi * f * at)) * np.exp(-at / 0.35) * np.clip(at / 0.005, 0, 1)
    # drums
    n_beats = int(total / beat) + 1
    for bi in range(n_beats):
        p = int(bi * beat * sr)
        if p >= n: break
        if use_kick and bi % 2 == 0:
            m = min(n - p, int(sr * 0.5)); kt = np.arange(m) / sr
            drums[p:p + m] += np.sin(2 * np.pi * (52 * kt + 40 * (1 - np.exp(-kt / 0.03)) * 0.03)) * np.exp(-kt / 0.18) * 0.9
        if use_hats:
            q = int((bi + 0.5) * beat * sr); m = min(n - q, int(sr * 0.06))
            if m > 0:
                hn = rs.standard_normal(m); hn = hn - np.convolve(hn, np.ones(4) / 4, mode="same")
                drums[q:q + m] += hn * np.exp(-np.arange(m) / (sr * 0.012)) * 0.12

    pad = _lp(pad, 900, sr)
    arp = _lp(arp, 2500, sr)
    bass = _lp(bass, 300, sr)
    mix = (pad * 0.32 * (0.55 + 0.45 * build)
           + bass * 0.55 * build
           + arp * 0.16 * build
           + drums * 0.5 * drive)
    mix = _reverb(mix, sr, seed=seed) * breakdown * fade
    # slow swell so it never feels static
    mix *= 0.85 + 0.15 * np.sin(2 * np.pi * t / (chord_len * 4))
    return (mix / max(1e-6, np.abs(mix).max())).astype(np.float32)


def duck(music, voice, sr, depth=0.6, attack=0.03, release=0.35):
    """Lower the music while the narrator talks."""
    env = np.abs(voice)
    k = int(sr * 0.04); env = np.convolve(env, np.ones(k) / k, mode="same")
    env = np.clip(env / (np.percentile(env[env > 1e-4], 90) if (env > 1e-4).any() else 1), 0, 1)
    out = np.empty_like(env); g = 0.0
    a, r = 1 - np.exp(-1 / (sr * attack)), 1 - np.exp(-1 / (sr * release))
    # decimate the follower for speed, then upsample
    step = 48; ds = env[::step]; o = np.empty_like(ds)
    a, r = 1 - np.exp(-step / (sr * attack)), 1 - np.exp(-step / (sr * release))
    for i, x in enumerate(ds):
        g += (x - g) * (a if x > g else r); o[i] = g
    out = np.repeat(o, step)[: len(music)]
    return music * (1 - depth * out)
