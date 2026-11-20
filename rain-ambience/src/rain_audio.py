#!/usr/bin/env python3
"""
Procedural rain-on-window ambience: fully synthesized (no samples), 48 kHz / 24-bit stereo.

Layers (all generated from noise and physical models, mixed in a block-streaming engine so an hour
of audio is unique and never repeats):
  1. outside wash     dense rain heard through the glass: decorrelated pink-ish noise, band-limited
  2. near rain grains thousands of tiny drop impacts per second (impulse trains x short noise kernels)
  3. puddle bubbles   the soft "plip" of drops on water (Minnaert-style rising chirps)
  4. window taps      drops striking the glass close to the listener (crisp tick + glass resonance)
  5. sill drips       occasional water drips, very quiet, irregular
  6. low rumble       deep, soft roof/room rumble that gives the sound its body
  7. distant thunder  rare, soft, far-away rolls (never sharp cracks)
Then: small-room convolution reverb, gentle tone shaping (soft top end for sleep), loudness
normalization to a target LUFS, and a soft limiter. The file loops seamlessly: the stream is
rendered X seconds longer than requested and the tail is equal-power crossfaded into the head.

usage: rain_audio.py OUT.wav --minutes 60 [--lufs -20] [--seed 7] [--preview]
"""
import argparse, os, sys, math, tempfile
import numpy as np
import soundfile as sf
from scipy import signal

SR = 48000
BLOCK = SR * 10            # 10 s processing blocks
XFADE = 12.0               # seconds of loop crossfade


# ---------------------------------------------------------------- streaming helpers
class SOS:
    """Streaming IIR filter (second-order sections) that keeps its state between blocks."""
    def __init__(self, sos, ch=2):
        self.sos = sos
        self.zi = np.zeros((ch, sos.shape[0], 2))
    def __call__(self, x):  # x: (ch, n)
        y = np.empty_like(x)
        for c in range(x.shape[0]):
            y[c], self.zi[c] = signal.sosfilt(self.sos, x[c], zi=self.zi[c])
        return y


class Conv:
    """Streaming FIR convolution (overlap-add); kernel per channel, tail carried to the next block."""
    def __init__(self, kernels):
        self.k = kernels                      # (ch, m)
        self.tail = np.zeros((kernels.shape[0], kernels.shape[1] - 1))
    def __call__(self, x):
        n = x.shape[1]; out = np.empty_like(x)
        for c in range(x.shape[0]):
            y = signal.oaconvolve(x[c], self.k[c])
            y[: self.tail.shape[1]] += self.tail[c]
            out[c] = y[:n]
            t = y[n:]
            self.tail[c] = np.pad(t, (0, max(0, self.tail.shape[1] - len(t))))[: self.tail.shape[1]]
        return out


class Events:
    """Scheduled grains, synthesized lazily per block from their own seed (memory stays tiny for hours)."""
    MAXLEN = SR * 20
    def __init__(self):
        self.rows = []  # (start, kind, pan, gain, seed)
    def add(self, start, kind, p, gain, seed):
        self.rows.append((start, kind, p, gain, seed))
    def finalize(self):
        self.rows.sort(key=lambda r: r[0]); self.starts = np.array([r[0] for r in self.rows])
    def render(self, b0, n, gens):
        out = np.zeros((2, n), np.float32)
        i0, i1 = np.searchsorted(self.starts, [b0 - self.MAXLEN, b0 + n])
        for s, kind, p, gain, seed in self.rows[i0:i1]:
            g = gens[kind](np.random.default_rng(seed)) * gain
            g = pan(g, p) if g.ndim == 1 else g
            e = s + g.shape[1]
            if e <= b0: continue
            a, z = max(s, b0), min(e, b0 + n)
            out[:, a - b0:z - b0] += g[:, a - s:z - s]
        return out


def pan(g, p):
    """constant-power pan of mono grain g to stereo, p in [-1, 1]"""
    a = (p + 1) * math.pi / 4
    return np.stack([g * math.cos(a), g * math.sin(a)]).astype(np.float32)


def lowpass(f, order=2): return signal.butter(order, f, 'low', fs=SR, output='sos')
def highpass(f, order=2): return signal.butter(order, f, 'high', fs=SR, output='sos')
def bandpass(a, b, order=2): return signal.butter(order, [a, b], 'band', fs=SR, output='sos')
def shelf(f, gain_db, kind='high', q=0.707):
    """RBJ shelving biquad as SOS"""
    A = 10 ** (gain_db / 40); w = 2 * math.pi * f / SR; cw, sw = math.cos(w), math.sin(w); al = sw / (2 * q)
    if kind == 'high':
        b0 = A * ((A + 1) + (A - 1) * cw + 2 * math.sqrt(A) * al); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - 2 * math.sqrt(A) * al)
        a0 = (A + 1) - (A - 1) * cw + 2 * math.sqrt(A) * al; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - 2 * math.sqrt(A) * al
    else:
        b0 = A * ((A + 1) - (A - 1) * cw + 2 * math.sqrt(A) * al); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - 2 * math.sqrt(A) * al)
        a0 = (A + 1) + (A - 1) * cw + 2 * math.sqrt(A) * al; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - 2 * math.sqrt(A) * al
    return np.array([[b0 / a0, b1 / a0, b2 / a0, 1, a1 / a0, a2 / a0]])


def room_ir(rng, seconds=0.55):
    """Small bedroom: early reflections + short diffuse tail, decorrelated L/R, darker over time."""
    m = int(SR * seconds); t = np.arange(m) / SR; ir = np.zeros((2, m))
    for c in range(2):
        n = rng.standard_normal(m) * np.exp(-t / 0.11)
        n = signal.sosfilt(lowpass(5500), n) * 0.6 + signal.sosfilt(lowpass(1800), n) * 0.4
        for d in rng.uniform(0.004, 0.035, 9):             # early reflections
            k = int(d * SR); n[k] += rng.uniform(0.25, 0.6) * (1 if rng.random() < 0.5 else -1)
        ir[c] = n / np.sqrt((n ** 2).sum())
    ir[:, 0] = 0
    return ir


# ---------------------------------------------------------------- grain models
def window_tap(rng):
    """Drop hitting the glass: short broadband tick + a few glassy resonances, ~25 ms."""
    n = int(SR * 0.03); t = np.arange(n) / SR
    tick = rng.standard_normal(n) * np.exp(-t / rng.uniform(0.0006, 0.0016))
    tick = signal.sosfilt(highpass(rng.uniform(1500, 2600)), tick)
    res = sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / rng.uniform(0.004, 0.012)) * a
              for f, a in zip(rng.uniform(2200, 6500, 3), (0.25, 0.15, 0.1)))
    g = tick + res * 0.6
    g = signal.sosfilt(lowpass(9000), g)
    return g * rng.lognormal(-0.2, 0.55)


def bubble(rng):
    """Raindrop on water: Minnaert bubble ringing with an upward chirp (soft 'plip')."""
    f0 = rng.uniform(900, 3200); d = rng.uniform(0.008, 0.03); n = int(SR * d * 4); t = np.arange(n) / SR
    f = f0 * (1 + rng.uniform(0.1, 0.5) * t / (d * 4))
    ph = 2 * np.pi * np.cumsum(f) / SR
    g = np.sin(ph) * np.exp(-t / d) * np.clip(t / 0.0005, 0, 1)
    return g * rng.lognormal(-1.2, 0.5)


def drip(rng):
    """Single water drip from the sill: low 'plink' with a short resonant body."""
    n = int(SR * 0.18); t = np.arange(n) / SR; f0 = rng.uniform(450, 900)
    g = np.sin(2 * np.pi * f0 * (1 + 0.6 * t) * t) * np.exp(-t / 0.035) + 0.3 * np.sin(2 * np.pi * f0 * 2.7 * t) * np.exp(-t / 0.012)
    g = signal.sosfilt(lowpass(3500), g)
    return g * rng.lognormal(-0.3, 0.3)


def thunder(rng, dur):
    """Far-away thunder roll: low band-limited noise with several soft swells; no sharp crack."""
    n = int(SR * dur); t = np.arange(n) / SR
    env = np.zeros(n)
    for k in range(rng.integers(3, 6)):
        c = rng.uniform(0.12, 0.55) * dur; w = rng.uniform(0.8, 2.6)
        env += rng.uniform(0.4, 1.0) * np.exp(-0.5 * ((t - c) / w) ** 2)
    env += np.exp(-np.clip(t - 0.35 * dur, 0, None) / (0.25 * dur)) * np.clip(t / (0.2 * dur), 0, 1) * 0.6
    env /= env.max()
    out = np.zeros((2, n))
    for c in range(2):
        x = rng.standard_normal(n)
        x = signal.sosfilt(lowpass(160, 4), signal.sosfilt(highpass(28, 2), x))
        rum = signal.sosfilt(lowpass(70, 2), rng.standard_normal(n)) * 3
        out[c] = (x + rum) * env
    out /= np.abs(out).max()
    # fade edges so it never starts or stops abruptly
    f = int(SR * 1.5); out[:, :f] *= np.linspace(0, 1, f); out[:, -f:] *= np.linspace(1, 0, f)
    return out.astype(np.float32)


# ---------------------------------------------------------------- engine
class RainEngine:
    def __init__(self, total_samples, seed=7):
        self.rng = np.random.default_rng(seed)
        self.N = total_samples
        r = self.rng
        # 1. outside wash (through glass): band-limited, slightly dark
        self.wash_f = SOS(np.vstack([highpass(180), lowpass(5200, 4), shelf(1500, -3, 'high')]))
        # 6. low rumble
        self.rumble_f = SOS(np.vstack([lowpass(170, 4), highpass(25)]))
        # 2. near grains: three kernel families convolved with sparse impulse trains
        def kern(lo, hi, tau):
            m = int(SR * 0.012); t = np.arange(m) / SR
            ks = []
            for _ in range(2):
                k = r.standard_normal(m) * np.exp(-t / tau)
                k = signal.sosfilt(bandpass(lo, hi), k); ks.append(k / np.abs(k).max())
            return np.stack(ks)
        self.grain_convs = [Conv(kern(1200, 7000, 0.0012)), Conv(kern(500, 3500, 0.0025)), Conv(kern(2500, 9000, 0.0007))]
        self.grain_rate = [900, 380, 500]          # impacts per second per family
        self.grain_gain = [0.10, 0.12, 0.05]
        self.grain_f = SOS(lowpass(8000))
        # room reverb for close layers
        self.room = Conv(room_ir(r))
        # master tone: gentle low shelf lift + soft top end (sleep friendly)
        self.master = SOS(np.vstack([shelf(220, 3.0, 'low'), shelf(2600, -2.5, 'high'), shelf(7000, -3.0, 'high'), lowpass(15000, 2), highpass(22, 2)]))
        # slow, natural intensity drift: sum of very slow sines (+-1.2 dB max), never sudden
        self.lfo = [(r.uniform(1 / 240, 1 / 90), r.uniform(0, 6.28)) for _ in range(3)]
        # schedule events across the whole timeline
        self.ev = Events()
        self._schedule()

    def _schedule(self):
        r, N = self.rng, self.N
        sd = lambda: int(r.integers(0, 2**31))
        self.gens = {'tap': window_tap, 'bubble': bubble, 'drip': drip, 'thunder': lambda g: thunder(g, g.uniform(11, 18))}
        t = 0   # window taps: Poisson ~5/s spread across the window (stereo field)
        while True:
            t += int(r.exponential(SR / 5.0))
            if t >= N: break
            self.ev.add(t, 'tap', r.uniform(-0.85, 0.85), 0.32, sd())
        t = 0   # puddle bubbles: ~45/s, wide and soft
        while True:
            t += int(r.exponential(SR / 45.0))
            if t >= N: break
            self.ev.add(t, 'bubble', r.uniform(-1, 1), 0.22, sd())
        t = int(SR * 3)   # sill drips: one source slightly right, irregular 1.6-5 s
        while t < N:
            self.ev.add(t, 'drip', 0.45 + r.uniform(-0.05, 0.05), 0.05, sd())
            t += int(SR * r.uniform(1.6, 5.0))
        t = int(SR * r.uniform(70, 150))   # thunder: every 4-9 min, quiet, outside the loop crossfade zones
        self.thunders = []
        while t < N - SR * 60:
            if t > SR * (XFADE + 20):
                self.ev.add(t, 'thunder', 0, 0.22, sd()); self.thunders.append(t / SR)
            t += int(SR * r.uniform(240, 540))
        self.ev.finalize()

    def block(self, b0, n):
        r = self.rng
        tt = (b0 + np.arange(n)) / SR
        drift = 1 + sum(0.045 * np.sin(2 * np.pi * f * tt + p) for f, p in self.lfo)   # about +-1.2 dB
        # 1. wash (decorrelated L/R)
        wash = self.wash_f(r.standard_normal((2, n))) * 0.30 * drift
        # 6. rumble
        rumble = self.rumble_f(r.standard_normal((2, n))) * 0.55 * (0.8 + 0.2 * drift)
        # 2. near grains
        grains = np.zeros((2, n))
        for conv, rate, gain in zip(self.grain_convs, self.grain_rate, self.grain_gain):
            imp = np.zeros((2, n))
            for c in range(2):
                k = r.poisson(rate * n / SR)
                pos = r.integers(0, n, k)
                np.add.at(imp[c], pos, r.lognormal(-1.0, 0.7, k) * (r.random(k) < 1) * np.sign(r.random(k) - 0.5))
            grains += conv(imp) * gain
        grains = self.grain_f(grains) * drift
        # 3/4/5/7 events
        ev = self.ev.render(b0, n, self.gens)
        close = grains + ev
        wet = self.room(close)
        mix = wash + rumble + close * 0.75 + wet * 0.45
        return self.master(mix)


def soft_limit(x, ceiling=0.89):
    """transparent below ~-3 dBFS, smooth saturation above, never exceeds the ceiling"""
    k = 0.75 * ceiling
    y = x.copy(); m = np.abs(x) > k
    y[m] = np.sign(x[m]) * (k + (ceiling - k) * np.tanh((np.abs(x[m]) - k) / (ceiling - k)))
    return y


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out'); ap.add_argument('--minutes', type=float, default=60); ap.add_argument('--lufs', type=float, default=-20.0)
    ap.add_argument('--seed', type=int, default=7)
    a = ap.parse_args()
    L = int(a.minutes * 60 * SR); X = int(XFADE * SR); total = L + X
    eng = RainEngine(total, a.seed)
    print(f"rendering {a.minutes:.1f} min + {XFADE:.0f}s crossfade, thunder at {[round(x / 60, 1) for x in eng.thunders]} min", flush=True)

    # ---- pass 1: render raw stream to a temp float file, measure loudness on the fly (sampled)
    import pyloudnorm as pyln
    meter = pyln.Meter(SR)
    tmp = tempfile.NamedTemporaryFile(suffix='.f32', delete=False, dir=os.path.dirname(os.path.abspath(a.out))); tmp.close()
    head = None; tail = None; meas = []
    with open(tmp.name, 'wb') as fh:
        b0 = 0
        while b0 < total:
            n = min(BLOCK, total - b0)
            y = eng.block(b0, n).astype(np.float32)
            if b0 < X:
                head = y[:, :X].copy() if head is None else np.concatenate([head, y], 1)[:, :X]
            if (b0 // BLOCK) % 6 == 1:
                meas.append(y.T.copy())
            fh.write(y.T.astype(np.float32).tobytes())
            b0 += n
            if (b0 // BLOCK) % 30 == 0: print(f"  {b0 / SR / 60:5.1f} / {total / SR / 60:.1f} min", flush=True)
    loud = meter.integrated_loudness(np.concatenate(meas))
    gain = 10 ** ((a.lufs - loud) / 20)
    print(f"measured {loud:.2f} LUFS -> gain {20 * math.log10(gain):+.2f} dB", flush=True)

    # ---- pass 2: equal-power loop crossfade + gain + limiter, write 24-bit WAV
    raw = np.memmap(tmp.name, dtype=np.float32, mode='r').reshape(-1, 2)
    fade = np.linspace(0, 1, X)
    fin, fout = np.sin(fade * np.pi / 2), np.cos(fade * np.pi / 2)
    with sf.SoundFile(a.out, 'w', SR, 2, 'PCM_24') as w:
        h = raw[:X] * fin[:, None] + raw[L:L + X] * fout[:, None]
        w.write(soft_limit(h * gain))
        for s in range(X, L, BLOCK):
            e = min(L, s + BLOCK)
            w.write(soft_limit(np.asarray(raw[s:e]) * gain))
    del raw; os.unlink(tmp.name)
    print(f"done -> {a.out}", flush=True)


if __name__ == '__main__':
    main()
