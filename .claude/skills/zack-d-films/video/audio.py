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
    raise ValueError(f"unknown sfx {kind!r}; use whoosh boom hit crack glitch riser ding pop heartbeat")


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


def timings_silence(spec, timings):
    return [{"start": tm["start"], "duration": tm["duration"], "silence": sc["silence"]} for sc, tm in zip(spec["scenes"], timings)]


def main(proj):
    build = os.path.join(proj, "build")
    spec = json.load(open(os.path.join(build, "narration.json")))
    kok = None
    lead = 0.15  # seconds of air before each line
    voices, timings, t = [], [], 0.0
    for i, s in enumerate(spec["scenes"]):
        vo = s["vo"].strip()
        if vo:
            if kok is None:
                from kokoro_onnx import Kokoro
                model = os.path.join(CACHE, "kokoro-v1.0.onnx")
                if not os.path.exists(model): model = os.path.join(CACHE, "kokoro-v1.0.int8.onnx")
                kok = Kokoro(model, os.path.join(CACHE, "voices-v1.0.bin"))
            audio, sr = kok.create(vo, voice=spec["voice"], speed=spec["speed"], lang="en-gb" if spec["voice"].startswith("b") else "en-us")
            assert sr == SR
            audio = trim(np.asarray(audio, np.float32))
        else:
            audio = np.zeros(0, np.float32)
        speech = len(audio) / SR
        dur = s["duration"] or max(s["minDuration"], (lead + speech + s["hold"]) if vo else 1.5)
        timings.append({"start": round(t, 3), "duration": round(dur, 3), "vo": vo, "words": word_times(vo, speech, lead)})
        voices.append((t + lead, audio))
        t += dur
        print(f"scene {i + 1:2d}: {dur:5.2f}s  {vo[:60]}")
    total = t
    n = int(total * SR) + SR
    voice = np.zeros(n, np.float32); fxbus = np.zeros(n, np.float32)
    for start, a in voices:
        p = int(start * SR); voice[p:p + len(a)] += a[: n - p]
    for s, tm in zip(spec["scenes"], timings):
        items = s["sfx"] if isinstance(s["sfx"], list) else [s["sfx"]]
        for it in items:
            if isinstance(it, str): it = {"type": it}
            kind = it["type"]; at = tm["start"] + float(it.get("at", 0))
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
    mix = voice * 1.0 + fxbus * 0.8 + music_bus + drone * drone_gain * gate * fade
    mix = mix[: int(total * SR)]
    mix = mix / max(1e-6, np.abs(mix).max()) * 0.89
    sf.write(os.path.join(build, "audio.wav"), mix, SR)
    json.dump({"total": round(total, 3), "scenes": timings}, open(os.path.join(build, "timings.json"), "w"), indent=1)
    print(f"total {total:.1f}s -> build/audio.wav, build/timings.json")


if __name__ == "__main__":
    main(os.path.abspath(sys.argv[1]))
