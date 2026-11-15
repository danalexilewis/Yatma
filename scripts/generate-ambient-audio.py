"""Generate deterministic original stereo soundscapes with continuous loop joins.

Uses Python's standard library. No sampled recordings, network assets, or runtime
synthesis dependencies are required by the app. Run this file to regenerate all
three 36-second, 24 kHz, 16-bit PCM assets and print decoded-signal diagnostics.
"""

from array import array
import json
import math
from pathlib import Path
import random
import sys
import wave

RATE = 24000
SECONDS = 36
OVERLAP_SECONDS = 3
TAU = 2 * math.pi


def add_bird_phrase(left, right, rng, start, duration, frequency, pan):
    """A quiet, breathy phrase with an evolving pitch rather than a fixed beep."""
    phase = 0.0
    length = int(duration * RATE)
    offset = int(start * RATE)
    for index in range(length):
        at = offset + index
        if at >= len(left):
            break
        progress = index / length
        contour = frequency * (1 - 0.22 * progress + 0.055 * math.sin(progress * TAU * 2.4))
        phase += TAU * contour / RATE
        envelope = math.sin(math.pi * progress) ** 2
        breath = rng.uniform(-1, 1) * 0.09
        value = 0.024 * envelope * (math.sin(phase) + 0.12 * math.sin(phase * 2) + breath)
        left[at] += value * math.sqrt(1 - pan)
        right[at] += value * math.sqrt(pan)


def texture(scene, seed):
    rng = random.Random(seed)
    frames = RATE * (SECONDS + OVERLAP_SECONDS)
    left = array("f")
    right = array("f")
    low_l = low_r = mid_l = mid_r = air_l = air_r = common = 0.0
    for index in range(frames):
        t = index / RATE
        common = common * 0.992 + rng.uniform(-1, 1) * 0.008
        white_l = rng.uniform(-1, 1)
        white_r = rng.uniform(-1, 1)
        low_l = low_l * 0.995 + white_l * 0.005
        low_r = low_r * 0.995 + white_r * 0.005
        mid_l = mid_l * 0.93 + white_l * 0.07
        mid_r = mid_r * 0.93 + white_r * 0.07
        air_l = air_l * 0.55 + white_l * 0.45
        air_r = air_r * 0.55 + white_r * 0.45
        if scene == "forest":
            wind = 0.82 + 0.18 * math.sin(t * 0.37 + 1.1) + 0.10 * math.sin(t * 0.89)
            l = wind * (low_l * 0.95 + mid_l * 0.18 + air_l * 0.055 + common * 0.32)
            r = wind * (low_r * 0.95 + mid_r * 0.18 + air_r * 0.055 + common * 0.32)
        elif scene == "rain":
            gust = 0.90 + 0.07 * math.sin(t * 0.23) + 0.06 * math.sin(t * 0.71 + 2.2)
            l = gust * (low_l * 0.45 + mid_l * 0.24 + air_l * 0.20 + common * 0.26)
            r = gust * (low_r * 0.45 + mid_r * 0.24 + air_r * 0.20 + common * 0.26)
        else:
            swell = (0.5 + 0.5 * math.sin(t * 0.70 + 0.48 * math.sin(t * 0.19))) ** 1.7
            distant = 0.10 + 0.035 * math.sin(t * 0.31 + 0.9)
            foam = 0.025 + 0.13 * swell
            l = low_l * (0.45 + swell * 1.2) + mid_l * (distant + swell * 0.26) + air_l * foam + common * (0.35 + 0.4 * swell)
            r = low_r * (0.45 + swell * 1.2) + mid_r * (distant + swell * 0.26) + air_r * foam + common * (0.35 + 0.4 * swell)
        left.append(l)
        right.append(r)

    if scene == "forest":
        for start in [2.4, 8.7, 15.2, 23.8, 31.1, 37.0]:
            pan = rng.uniform(0.15, 0.85)
            base = rng.uniform(2400, 3700)
            for note in range(rng.randint(2, 3)):
                add_bird_phrase(left, right, rng, start + note * rng.uniform(0.35, 0.62), rng.uniform(0.20, 0.48), base * rng.uniform(0.85, 1.12), pan)
    elif scene == "rain":
        # Quiet broadband droplet details; no pitched or metronomic pings.
        for _ in range(110):
            offset = rng.randrange(len(left) - 1800)
            length = rng.randrange(180, 900)
            pan = rng.uniform(0.1, 0.9)
            amplitude = rng.uniform(0.006, 0.022)
            smooth = 0.0
            for index in range(length):
                smooth = 0.6 * smooth + 0.4 * rng.uniform(-1, 1)
                value = amplitude * smooth * math.sin(math.pi * index / length) ** 1.5
                left[offset + index] += value * math.sqrt(1 - pan)
                right[offset + index] += value * math.sqrt(pan)
    return left, right


def seamless_pcm(left, right, target_rms):
    frames = RATE * SECONDS
    overlap = RATE * OVERLAP_SECONDS
    channels = []
    for source in (left, right):
        output = array("f", source[:frames])
        for index in range(overlap):
            angle = (index / (overlap - 1)) * math.pi / 2
            # Tail continues the final sample, then blends into the beginning.
            # Equal-power weights keep the noise floor alive throughout the join.
            output[index] = source[frames + index] * math.cos(angle) + source[index] * math.sin(angle)
        dc = sum(output) / frames
        channels.append(array("f", (value - dc for value in output)))
    rms = math.sqrt(sum(value * value for channel in channels for value in channel) / (frames * 2))
    gain = target_rms / rms
    channels = [array("f", (math.tanh(value * gain) for value in channel)) for channel in channels]
    peak = max(abs(value) for channel in channels for value in channel)
    headroom = min(1.0, 0.79 / peak)
    # Choose a low-gradient cut in the already continuous loop, without a fade.
    cut = min(range(1, 2048), key=lambda index: sum(abs(channel[index] - channel[index - 1]) for channel in channels))
    interleaved = array("h")
    for index in range(frames):
        source_index = (index + cut) % frames
        for channel in channels:
            interleaved.append(round(channel[source_index] * headroom * 32767))
    if sys.byteorder != "little":
        interleaved.byteswap()
    return interleaved.tobytes()


def inspect(path):
    with wave.open(str(path), "rb") as audio:
        assert audio.getnchannels() == 2
        assert audio.getsampwidth() == 2
        assert audio.getframerate() == RATE
        assert audio.getnframes() == RATE * SECONDS
        pcm = array("h", audio.readframes(audio.getnframes()))
    if sys.byteorder != "little":
        pcm.byteswap()
    left, right = pcm[::2], pcm[1::2]
    peak = max(abs(value) for value in pcm) / 32768
    rms = math.sqrt(sum(value * value for value in pcm) / len(pcm)) / 32768
    seam = max(abs(channel[0] - channel[-1]) for channel in (left, right)) / 32768
    edge = RATE
    start_rms = math.sqrt(sum(value * value for channel in (left, right) for value in channel[:edge]) / (edge * 2)) / 32768
    end_rms = math.sqrt(sum(value * value for channel in (left, right) for value in channel[-edge:]) / (edge * 2)) / 32768
    correlation = sum(l * r for l, r in zip(left, right)) / math.sqrt(sum(l * l for l in left) * sum(r * r for r in right))
    assert 0.05 < rms < 0.3, (path.name, "unexpected overall level", rms)
    assert peak < 0.80, (path.name, "insufficient headroom", peak)
    assert seam < 0.01, (path.name, "discontinuous seam", seam)
    assert min(start_rms, end_rms) > rms * 0.30, (path.name, "silent loop edge")
    assert abs(correlation) < 0.95, (path.name, "stereo channels unexpectedly identical")
    return {"file": path.name, "seconds": SECONDS, "sampleRate": RATE, "channels": 2, "bytes": path.stat().st_size, "peakDbFS": round(20 * math.log10(peak), 2), "rmsDbFS": round(20 * math.log10(rms), 2), "seamJumpFullScale": round(seam, 6), "startRmsDbFS": round(20 * math.log10(start_rms), 2), "endRmsDbFS": round(20 * math.log10(end_rms), 2), "stereoCorrelation": round(correlation, 3)}


def generate():
    output = Path(__file__).resolve().parents[1] / "apps/mobile/assets/ambience"
    output.mkdir(parents=True, exist_ok=True)
    results = []
    for scene, seed, rms in [("forest", 11, 0.13), ("rain", 22, 0.15), ("ocean", 33, 0.16)]:
        left, right = texture(scene, seed)
        path = output / f"{scene}.wav"
        with wave.open(str(path), "wb") as audio:
            audio.setnchannels(2)
            audio.setsampwidth(2)
            audio.setframerate(RATE)
            audio.writeframes(seamless_pcm(left, right, rms))
        results.append(inspect(path))
    assert sum(result["bytes"] for result in results) < 12_000_000
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    generate()
