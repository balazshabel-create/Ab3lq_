#!/usr/bin/env python3
"""Voice-over (Kokoro TTS), procedural sound effects and timing for a zack-d-films project.

Reads  <project>/build/narration.json  (written by `render.mjs extract`)
Writes <project>/build/timings.json    (scene starts/durations + per-word caption timing)
       <project>/build/audio.wav       (final mixed soundtrack)
"""
import json, os, re, sys
import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SR = 24000
CACHE = os.environ.get("ZDF_CACHE", os.path.expanduser("~/.cache/zack-d-films"))
rs = np.random.default_rng(7)


def env(n, attack=0.01, release=None):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    r = np.exp(-t / release) if release else np.ones(n)
    return a * r


def lowpass(x, k):
    k = max(1, int(k))
    return np.convolve(x, np.ones(k) / k, mode="same")


def sfx(kind, length=None):
    """Procedural sound effects. Each returns a mono float array."""
    if kind == "whoosh":
        n = int(SR * 0.9); x = rs.standard_normal(n); t = np.linspace(0, 1, n)
        y = (lowpass(x, 30) * (1 - t) + lowpass(x, 4) * t) * np.sin(np.pi * t) ** 2
        return y * 0.5
    if kind == "boom":
        n = int(SR * 2.2); t = np.arange(n) / SR
        y = np.sin(2 * np.pi * (60 * t - 15 * t * t)) * np.exp(-t / 0.6) + lowpass(rs.standard_normal(n), 40) * np.exp(-t / 0.25) * 2
        return y * 0.8
    if kind == "hit":
        n = int(SR * 0.6); t = np.arange(n) / SR
        return (np.sin(2 * np.pi * 90 * t) * np.exp(-t / 0.12) + rs.standard_normal(n) * np.exp(-t / 0.03) * 0.5) * 0.8
    if kind == "crack":
        n = int(SR * 1.4); y = np.zeros(n)
        for i in range(9):
            p = int(SR * (0.02 + 0.06 * i + rs.random() * 0.04)); m = int(SR * 0.05)
            if p + m < n: y[p:p + m] += rs.standard_normal(m) * np.exp(-np.arange(m) / (SR * 0.006)) * (1 - i * 0.07)
        t = np.arange(n) / SR
        for f in (2900, 4100, 5300, 6700):
            y += np.sin(2 * np.pi * f * t) * np.exp(-t / 0.35) * 0.06
        return y * 0.9
    if kind == "glitch":
        n = int(SR * 0.5); t = np.arange(n) / SR
        steps = ((rs.random(n) > 0.997).cumsum() % 5).astype(float)
        sq = np.sign(np.sin(2 * np.pi * np.cumsum(220 + 300 * steps) / SR))
        return np.round(sq * 4) / 4 * 0.25 * (np.sin(2 * np.pi * 18 * t) > 0)
    if kind == "riser":
        d = length or 2.5; n = int(SR * d); t = np.arange(n) / SR; k = t / d
        y = np.sin(2 * np.pi * (80 * t + 200 * t * k)) * 0.3 + lowpass(rs.standard_normal(n), 6) * 0.3
        return y * k ** 2 * 0.7
    if kind == "ding":
        n = int(SR * 1.2); t = np.arange(n) / SR
        return (np.sin(2 * np.pi * 1320 * t) + 0.5 * np.sin(2 * np.pi * 1980 * t)) * np.exp(-t / 0.3) * 0.35
    if kind == "pop":
        n = int(SR * 0.15); t = np.arange(n) / SR
        return np.sin(2 * np.pi * (500 - 1800 * t) * t) * np.exp(-t / 0.03) * 0.6
    if kind == "heartbeat":
        n = int(SR * 0.9); t = np.arange(n) / SR; y = np.zeros(n)
        for s in (0.0, 0.28):
            tt = np.clip(t - s, 0, None); y += np.sin(2 * np.pi * 55 * tt) * np.exp(-tt / 0.07) * (t >= s)
        return y * 0.9
    if kind == "static":
        d = length or 1.2; n = int(SR * d); x = rs.standard_normal(n)
        crackle = (rs.random(n) > 0.997) * rs.standard_normal(n) * 6
        y = (x - lowpass(x, 3)) * 0.25 + lowpass(crackle, 2)
        return y * np.clip(np.minimum(np.arange(n) / (SR * 0.05), (n - np.arange(n)) / (SR * 0.2)), 0, 1) * 0.5
    if kind == "buzz":
        n = int(SR * 1.6); t = np.arange(n) / SR
        on = ((t % 0.8) < 0.45).astype(float)
        return np.sign(np.sin(2 * np.pi * 150 * t)) * 0.18 * lowpass(on, SR * 0.01) * (1 + 0.3 * np.sin(2 * np.pi * 9 * t))
    if kind == "hatch":
        n = int(SR * 0.9); t = np.arange(n) / SR
        return (np.sin(2 * np.pi * 70 * t) * np.exp(-t / 0.15) + lowpass(rs.standard_normal(n), 8) * np.exp(-t / 0.06) * 1.5 + np.sin(2 * np.pi * 1800 * t) * np.exp(-t / 0.2) * 0.08) * 0.9
    if kind == "footsteps":
        d = length or 2.0; n = int(SR * d); y = np.zeros(n)
        for k in np.arange(0, d, 0.32):
            p = int(k * SR); m = min(n - p, int(SR * 0.08))
            if m > 0: y[p:p + m] += lowpass(rs.standard_normal(m), 12) * np.exp(-np.arange(m) / (SR * 0.02)) * 2
        return y * 0.5
    if kind == "thuds":  # slow, heavy steps on metal (something in the vent)
        d = length or 3.0; n = int(SR * d); y = np.zeros(n); t = np.arange(n) / SR
        for k in np.arange(0.1, d - 0.3, 0.85):
            p = int(k * SR); m = min(n - p, int(SR * 0.6)); tt = np.arange(m) / SR
            y[p:p + m] += (np.sin(2 * np.pi * 48 * tt) * np.exp(-tt / 0.12) + lowpass(rs.standard_normal(m), 20) * np.exp(-tt / 0.04) * 1.2 + np.sin(2 * np.pi * 410 * tt) * np.exp(-tt / 0.25) * 0.15)
        return y * 0.7
    if kind == "scratch":  # three long scrapes on metal
        d = length or 2.6; n = int(SR * d); y = np.zeros(n)
        for k in (0.1, 0.9, 1.7):
            p = int(k * SR); m = min(n - p, int(SR * 0.55)); tt = np.arange(m) / SR
            if m <= 0: continue
            x = rs.standard_normal(m); x = x - lowpass(x, 2)
            y[p:p + m] += x * (0.6 + 0.4 * np.sin(2 * np.pi * 23 * tt)) * np.sin(np.pi * tt / (m / SR)) * 0.5 + np.sin(2 * np.pi * (1900 + 600 * tt) * tt) * np.sin(np.pi * tt / (m / SR)) * 0.05
        return y
    raise ValueError(f"unknown sfx {kind!r}; use whoosh boom hit crack glitch riser ding pop heartbeat static buzz hatch footsteps thuds scratch")


def pitch_shift(x, factor):
    """Lower/raise pitch without changing speed (ffmpeg rubberband, formants preserved)."""
    import subprocess, tempfile
    if abs(factor - 1) < 1e-3 or not len(x): return x
    with tempfile.TemporaryDirectory() as d:
        a, b = os.path.join(d, "a.wav"), os.path.join(d, "b.wav")
        sf.write(a, x, SR)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", a, "-af", f"rubberband=pitch={factor}:formant=preserved", "-ar", str(SR), b], check=True)
        y, _ = sf.read(b, dtype="float32")
    return y[: len(x)] if len(y) >= len(x) else np.pad(y, (0, len(x) - len(y)))


def radio_fx(x):
    """Old-radio voice: band-limited, a bit distorted, with static underneath."""
    n = len(x); f = np.fft.rfftfreq(n, 1 / SR); X = np.fft.rfft(x)
    X *= (f > 350) * (f < 3200)
    y = np.fft.irfft(X, n)
    y = np.tanh(y / (np.abs(y).max() + 1e-9) * 2.5) * 0.8
    noise = rs.standard_normal(n); noise = noise - lowpass(noise, 3)
    crack = lowpass((rs.random(n) > 0.998) * rs.standard_normal(n) * 4, 2)
    return (y + noise * 0.05 + crack * 0.3).astype(np.float32)


def trim(x, thr=0.004):
    """Cut leading/trailing silence but keep word endings (breaths, soft consonants) intact."""
    idx = np.where(np.abs(x) > thr)[0]
    if len(idx) == 0: return x
    y = x[max(0, idx[0] - int(SR * 0.03)): idx[-1] + int(SR * 0.18)].copy()
    f = min(len(y), int(SR * 0.06)); y[-f:] *= np.linspace(1, 0, f)
    return y


def word_times(text, dur, offset):
    words = re.findall(r"\S+", text)
    if not words: return []
    weights = np.array([len(re.sub(r"\W", "", w)) + 2.5 + (3 if re.search(r"[.,!?;:]$", w) else 0) for w in words], float)
    edges = np.concatenate([[0], np.cumsum(weights)]) / weights.sum() * dur
    return [{"w": re.sub(r"^[\"'(]+|[\"')]+$", "", w), "start": round(offset + edges[i], 3), "end": round(offset + edges[i + 1], 3)} for i, w in enumerate(words)]


def voice_style(kok, voice):
    """'am_michael' or a blend like 'am_michael:0.5,am_fenrir:0.3,am_puck:0.2'."""
    if ":" not in voice and "," not in voice: return voice
    parts = [(v.split(":")[0].strip(), float(v.split(":")[1]) if ":" in v else 1.0) for v in voice.split(",")]
    total = sum(w for _, w in parts)
    return sum(kok.get_voice_style(v) * (w / total) for v, w in parts)


def timings_silence(spec, timings):
    return [{"start": tm["start"], "duration": tm["duration"], "silence": sc["silence"]} for sc, tm in zip(spec["scenes"], timings)]


def main(proj):
    build = os.path.join(proj, "build")
    spec = json.load(open(os.path.join(build, "narration.json")))
    kok = None
    lead = 0.15  # seconds of air before each line
    voices, timings, t = [], [], 0.0
    for i, s in enumerate(spec["scenes"]):
        raw = s["vo"].strip()
        chunks_txt = [c.strip() for c in raw.split("|") if c.strip()]  # "|" = a deliberate pause (lists, dramatic beats)
        vo = " ".join(chunks_txt)
        pieces, words, chunk_starts, cur = [], [], [], 0.0
        pause = float(s.get("pause") or 0.38)
        for ci, txt in enumerate(chunks_txt):
            if kok is None:
                from kokoro_onnx import Kokoro
                model = os.path.join(CACHE, "kokoro-v1.0.onnx")
                if not os.path.exists(model): model = os.path.join(CACHE, "kokoro-v1.0.int8.onnx")
                kok = Kokoro(model, os.path.join(CACHE, "voices-v1.0.bin"))
            v = s.get("voice") or spec["voice"]
            a, sr = kok.create(txt, voice=voice_style(kok, v), speed=s.get("speed") or spec["speed"], lang="en-gb" if v.startswith("b") else "en-us")
            assert sr == SR
            a = trim(np.asarray(a, np.float32))
            if ci: pieces.append(np.zeros(int(SR * pause), np.float32)); cur += pause
            chunk_starts.append(round(lead + cur, 3))
            words += word_times(txt, len(a) / SR, lead + cur)
            pieces.append(a); cur += len(a) / SR
        audio = np.concatenate(pieces) if pieces else np.zeros(0, np.float32)
        pf = s.get("pitch") or (spec.get("voicePitch") if not s.get("voice") else None) or 1.0
        audio = pitch_shift(audio, pf)
        if s.get("radio") and len(audio): audio = radio_fx(audio)
        speech = len(audio) / SR
        dur = s["duration"] or max(s["minDuration"], (lead + speech + s["hold"]) if vo else 1.5)
        timings.append({"start": round(t, 3), "duration": round(dur, 3), "vo": vo, "words": words, "chunks": chunk_starts})
        voices.append((t + lead, audio, bool(s.get("keepVoice"))))
        t += dur
        print(f"scene {i + 1:2d}: {dur:5.2f}s  {vo[:60]}")
    total = t
    n = int(total * SR) + SR
    voice = np.zeros(n, np.float32); fxbus = np.zeros(n, np.float32)
    narrate = spec.get("narration", True) is not False
    heard = np.zeros(n, np.float32)  # what ends up in the mix (narration off = only in-world voices like a radio)
    for start, a, keep in voices:
        p = int(start * SR); voice[p:p + len(a)] += a[: n - p]
        if narrate or keep: heard[p:p + len(a)] += a[: n - p]
    for s, tm in zip(spec["scenes"], timings):
        items = s["sfx"] if isinstance(s["sfx"], list) else [s["sfx"]]
        for it in items:
            if isinstance(it, str): it = {"type": it}
            kind = it["type"]; at = tm["start"] + (tm["chunks"][int(it["chunk"])] + float(it.get("at", 0)) if "chunk" in it and tm["chunks"] else float(it.get("at", 0)))
            y = sfx(kind, it.get("length") or (tm["duration"] if kind == "riser" else None)) * float(it.get("gain", 1))
            if kind == "riser" and "at" not in it: at = tm["start"]
            p = int(at * SR); fxbus[p:p + len(y)] += y[: max(0, n - p)]
    # ambient drone bed, muted in scenes marked silence
    tt = np.arange(n) / SR
    drone = (np.sin(2 * np.pi * 55 * tt) + 0.6 * np.sin(2 * np.pi * 82.4 * tt) + 0.4 * np.sin(2 * np.pi * 110.3 * tt)) * (0.75 + 0.25 * np.sin(2 * np.pi * 0.13 * tt))
    gate = np.ones(n)
    for s, tm in zip(spec["scenes"], timings):
        if s["silence"]: gate[int(tm["start"] * SR): int((tm["start"] + tm["duration"]) * SR)] = 0
    gate = lowpass(gate, SR * 0.15)
    fade = np.clip(np.minimum(tt / 1.0, (total - tt) / 1.0), 0, 1)
    music_cfg = spec.get("music")
    if isinstance(music_cfg, str): music_cfg = {"style": music_cfg}
    if music_cfg:
        from music import compose, duck
        mus = compose(total, SR, music_cfg.get("style", "space"), timings_silence(spec, timings), music_cfg.get("seed", 3))
        mus = np.pad(mus, (0, n - len(mus)))
        mus = duck(mus, voice, SR, depth=music_cfg.get("duck", 0.55))
        music_bus = mus * float(music_cfg.get("volume", 0.16))
        drone_gain = spec["drone"] if "drone" in spec.get("_explicit", []) else 0.0
    else:
        music_bus, drone_gain = 0.0, spec["drone"]
    mix = heard * 1.0 + fxbus * 0.8 + music_bus + drone * drone_gain * gate * fade
    mix = mix[: int(total * SR)]
    mix = mix / max(1e-6, np.abs(mix).max()) * 0.89
    sf.write(os.path.join(build, "audio.wav"), mix, SR)
    json.dump({"total": round(total, 3), "scenes": timings}, open(os.path.join(build, "timings.json"), "w"), indent=1)
    print(f"total {total:.1f}s -> build/audio.wav, build/timings.json")


if __name__ == "__main__":
    main(os.path.abspath(sys.argv[1]))
