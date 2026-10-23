#!/usr/bin/env python3
"""「いろ あて クイズ！」— a YouTube video for small children.

Builds the whole video offline:
  1. narration with Open JTalk (HTS voice "Mei", CC BY 3.0)
  2. original background music and sound effects, synthesized with numpy
  3. animation drawn frame by frame with cairo, encoded with ffmpeg

Usage: python3 make_video.py OUT_DIR
Env:   MEI_VOICE=/path/to/mei_happy.htsvoice
"""
import json
import math
import os
import random
import subprocess
import sys
import wave
from multiprocessing import Pool

import cairo
import numpy as np

W, H, FPS = 1920, 1080, 30
SR = 48000
FONT = "M PLUS 2"
DIC = "/var/lib/mecab/dic/open-jtalk/naist-jdic"
VOICE = os.environ.get("MEI_VOICE", "mei_happy.htsvoice")

# color word, fruit, voice for English, English text, rgb
COLORS = [
    ("あか", "りんご", "レッド", "RED", (0.90, 0.22, 0.21), "apple"),
    ("オレンジ", "みかん", "オレンジ", "ORANGE", (0.98, 0.55, 0.10), "mikan"),
    ("きいろ", "バナナ", "イエロー", "YELLOW", (0.99, 0.82, 0.15), "banana"),
    ("みどり", "メロン", "グリーン", "GREEN", (0.30, 0.69, 0.31), "melon"),
    ("あお", "ブルーベリー", "ブルー", "BLUE", (0.12, 0.53, 0.90), "blueberry"),
    ("むらさき", "ぶどう", "パープル", "PURPLE", (0.56, 0.20, 0.67), "grape"),
    ("ピンク", "もも", "ピンク", "PINK", (0.96, 0.45, 0.62), "peach"),
]

CREAM = (1.0, 0.97, 0.88)
INK = (0.23, 0.20, 0.27)
CHICK = (1.0, 0.85, 0.25)


# --------------------------------------------------------------- voice

def say(text, path, speed=0.92, tone=1.5):
    subprocess.run(
        ["open_jtalk", "-x", DIC, "-m", VOICE, "-r", str(speed), "-fm", str(tone),
         "-a", "0.5", "-ow", path],
        input=text.encode("utf-8"), check=True)
    with wave.open(path) as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        sr = w.getframerate()
    x = data.astype(np.float32) / 32768.0
    if sr != SR:
        x = np.interp(np.arange(0, len(x), sr / SR), np.arange(len(x)), x).astype(np.float32)
    # trim leading/trailing silence
    idx = np.nonzero(np.abs(x) > 0.01)[0]
    x = x[max(idx[0] - 200, 0): idx[-1] + 1200]
    return x / (np.abs(x).max() + 1e-9) * 0.9


def build_lines():
    lines = {
        "intro": "こんにちは！ ぴよちゃん だよ。 きょうは、 くだものの いろ あて クイズ！ いっしょに やってみよう！",
        "review": "さいごに、 おさらい しよう！",
        "outro": "みんな、 ななつの いろ、 ぜんぶ いえたね！ よく できました！ また あそぼうね！ ばいばい！",
    }
    for i, (word, fruit, en_voice, _, _, _) in enumerate(COLORS):
        lines[f"q{i}"] = "これは なにいろ かな？"
        lines[f"a{i}"] = f"{word}！ {fruit}は、 {word}いろ！"
        lines[f"e{i}"] = f"えいごで いうと、 {en_voice}！"
        lines[f"r{i}"] = f"{word}！"
    return lines


# --------------------------------------------------------------- timeline

def build_timeline(dur):
    """Return scenes and voice cues. Every time is in seconds."""
    scenes, cues, sfx = [], [], []
    t = 0.0

    d = 1.0 + dur["intro"] + 1.2
    scenes.append({"kind": "intro", "start": t, "end": t + d})
    cues.append(("intro", t + 1.0))
    sfx.append(("sparkle", t + 0.3))
    t += d

    for i in range(len(COLORS)):
        q0 = 0.6
        c0 = q0 + dur[f"q{i}"] + 0.3
        r = c0 + 2.7
        a0 = r + 0.35
        e0 = a0 + dur[f"a{i}"] + 0.4
        end = e0 + dur[f"e{i}"] + 1.1
        scenes.append({"kind": "color", "i": i, "start": t, "end": t + end,
                       "c0": c0, "r": r, "a0": a0, "e0": e0})
        sfx.append(("whoosh", t + 0.05))
        sfx.append(("boing", t + 0.25))
        cues.append((f"q{i}", t + q0))
        for k in range(3):
            sfx.append(("tick", t + c0 + 0.9 * k))
        sfx.append(("pop", t + r))
        sfx.append(("sparkle", t + r + 0.05))
        cues.append((f"a{i}", t + a0))
        cues.append((f"e{i}", t + e0))
        t += end

    # review: fruits pop in one at a time, each named
    rv = {"kind": "review", "start": t, "slots": []}
    sfx.append(("whoosh", t + 0.05))
    cues.append(("review", t + 0.6))
    s = 0.6 + dur["review"] + 0.4
    for i in range(len(COLORS)):
        rv["slots"].append(s)
        sfx.append(("pop", t + s))
        cues.append((f"r{i}", t + s + 0.1))
        s += max(dur[f"r{i}"] + 0.45, 1.1)
    rv["end"] = t + s + 1.0
    scenes.append(rv)
    t = rv["end"]

    d = 0.8 + dur["outro"] + 2.5
    scenes.append({"kind": "outro", "start": t, "end": t + d})
    cues.append(("outro", t + 0.8))
    sfx.append(("tada", t + 0.3))
    t += d
    return scenes, cues, sfx, t


# --------------------------------------------------------------- audio

def env_decay(n, tau):
    return np.exp(-np.arange(n) / (tau * SR))


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def marimba(freq, length=0.5, vol=0.3):
    n = int(length * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * freq * 4 * t) * env_decay(n, 0.03)
    att = np.minimum(1, np.arange(n) / (0.003 * SR))
    return (x * env_decay(n, length / 3.5) * att * vol).astype(np.float32)


def bell(freq, length=0.8, vol=0.25):
    n = int(length * SR)
    t = np.arange(n) / SR
    x = (np.sin(2 * np.pi * freq * t) + 0.4 * np.sin(2 * np.pi * freq * 2.76 * t)
         + 0.2 * np.sin(2 * np.pi * freq * 5.4 * t))
    return (x * env_decay(n, length / 4) * vol).astype(np.float32)


def add(buf, x, at):
    i = int(at * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(x))
    buf[i:j] += x[: j - i]


def make_music(total):
    buf = np.zeros(int(total * SR) + SR, np.float32)
    bpm = 112
    beat = 60 / bpm
    chords = [(48, [60, 64, 67]), (43, [59, 62, 67]), (45, [60, 64, 69]), (41, [60, 65, 69])]
    melody = [
        76, 79, 81, 79, 76, None, 72, 74,
        74, None, 79, None, 74, 72, 71, None,
        72, 76, 81, None, 79, 76, 72, None,
        77, 76, 74, 72, 74, None, None, None,
    ]
    rng = np.random.default_rng(1)
    hat = (rng.standard_normal(int(0.04 * SR)) * env_decay(int(0.04 * SR), 0.008) * 0.05).astype(np.float32)
    kn = int(0.2 * SR)
    kt = np.arange(kn) / SR
    kick = (np.sin(2 * np.pi * (50 + 90 * np.exp(-kt * 30)) * kt) * env_decay(kn, 0.06) * 0.35).astype(np.float32)
    bar = 0
    t = 0.0
    while t < total:
        root, triad = chords[bar % 4]
        add(buf, marimba(mtof(root), beat * 1.8, 0.35), t)
        add(buf, marimba(mtof(root), beat * 1.8, 0.30), t + 2 * beat)
        for b in (1, 3):
            for m in triad:
                add(buf, marimba(mtof(m), beat * 0.9, 0.09), t + b * beat)
        for b in range(4):
            if b % 2 == 0:
                add(buf, kick, t + b * beat)
            add(buf, hat, t + b * beat + beat / 2)
        if bar % 8 < 4 or bar % 8 >= 6:  # melody rests now and then
            for k in range(8):
                m = melody[(bar % 4) * 8 + k]
                if m is not None:
                    add(buf, bell(mtof(m), 0.6, 0.10), t + k * beat / 2)
        bar += 1
        t += 4 * beat
    return buf[: int(total * SR)]


def make_sfx(kind):
    if kind == "pop":
        n = int(0.15 * SR)
        t = np.arange(n) / SR
        f = 500 + 1400 * t / 0.15
        return (np.sin(2 * np.pi * np.cumsum(f) / SR) * env_decay(n, 0.04) * 0.5).astype(np.float32)
    if kind == "tick":
        n = int(0.12 * SR)
        t = np.arange(n) / SR
        return (np.sin(2 * np.pi * 1250 * t) * env_decay(n, 0.02) * 0.45).astype(np.float32)
    if kind == "boing":
        n = int(0.35 * SR)
        t = np.arange(n) / SR
        f = 220 + 160 * np.sin(2 * np.pi * 9 * t) * np.exp(-t * 6) + 200 * t
        return (np.sin(2 * np.pi * np.cumsum(f) / SR) * env_decay(n, 0.12) * 0.3).astype(np.float32)
    if kind == "whoosh":
        n = int(0.45 * SR)
        rng = np.random.default_rng(2)
        x = rng.standard_normal(n).astype(np.float32)
        # moving one-pole low-pass for a sweep
        y = np.zeros(n, np.float32)
        a = np.linspace(0.02, 0.35, n)
        acc = 0.0
        for k in range(n):
            acc += a[k] * (x[k] - acc)
            y[k] = acc
        e = np.sin(np.pi * np.arange(n) / n)
        return (y * e * 0.25).astype(np.float32)
    if kind == "sparkle":
        out = np.zeros(int(1.0 * SR), np.float32)
        for k, m in enumerate([84, 88, 91, 96, 100]):
            add(out, bell(mtof(m), 0.6, 0.12), k * 0.06)
        return out
    if kind == "tada":
        out = np.zeros(int(2.0 * SR), np.float32)
        for k, m in enumerate([72, 76, 79]):
            add(out, bell(mtof(m), 0.4, 0.18), k * 0.09)
        for m in [72, 76, 79, 84]:
            add(out, bell(mtof(m), 1.6, 0.14), 0.32)
        return out
    raise ValueError(kind)


def mix(total, voices, cues, sfx):
    music = make_music(total)
    vtrack = np.zeros_like(music)
    for name, at in cues:
        add(vtrack, voices[name], at)
    # duck the music under the narration
    speaking = (np.abs(vtrack) > 0.02).astype(np.float32)
    k = int(0.25 * SR)
    hold = np.convolve(speaking, np.ones(k, np.float32), "same") > 0
    gain = np.where(hold, 0.35, 1.0).astype(np.float32)
    gain = np.convolve(gain, np.ones(4800, np.float32) / 4800, "same")
    out = music * 0.55 * gain + vtrack
    cache = {}
    for kind, at in sfx:
        if kind not in cache:
            cache[kind] = make_sfx(kind)
        add(out, cache[kind], at)
    out = np.tanh(out * 1.1) / np.tanh(1.1)
    out = out / np.abs(out).max() * 0.92
    # per-frame loudness of the voice, used to move the chick's beak
    hop = SR // FPS
    nf = int(total * FPS)
    lip = [float(np.sqrt(np.mean(vtrack[f * hop:(f + 1) * hop] ** 2))) if f * hop < len(vtrack) else 0.0
           for f in range(nf)]
    return out, lip


def write_wav(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    st = np.stack([pcm, pcm], axis=1)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(st.tobytes())


# --------------------------------------------------------------- easing

def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def ease_out_back(x):
    x = clamp(x)
    c1, c3 = 1.9, 2.9
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2


def ease_out_elastic(x):
    x = clamp(x)
    if x in (0, 1):
        return x
    return 2 ** (-10 * x) * math.sin((x * 10 - 0.75) * (2 * math.pi) / 3) + 1


def ease_in_out(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(len(a)))


def tint(c, k):
    return lerp(c, (1, 1, 1), k)


def shade(c, k):
    return lerp(c, (0, 0, 0), k)


# --------------------------------------------------------------- drawing helpers

def text(ctx, s, x, y, size, fill, outline=INK, white=True, anchor="center", weight=True):
    ctx.save()
    ctx.select_font_face(FONT, cairo.FONT_SLANT_NORMAL,
                         cairo.FONT_WEIGHT_BOLD if weight else cairo.FONT_WEIGHT_NORMAL)
    ctx.set_font_size(size)
    e = ctx.text_extents(s)
    if anchor == "center":
        x -= e.x_advance / 2
    y += size * 0.36
    ctx.move_to(x, y)
    ctx.text_path(s)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    if outline:
        ctx.set_source_rgb(*outline)
        ctx.set_line_width(size * 0.30)
        ctx.stroke_preserve()
    if white:
        ctx.set_source_rgb(1, 1, 1)
        ctx.set_line_width(size * 0.16)
        ctx.stroke_preserve()
    ctx.set_source_rgb(*fill)
    ctx.fill()
    ctx.restore()
    return e.x_advance


def circle(ctx, x, y, r, col, alpha=1.0):
    ctx.arc(x, y, r, 0, 2 * math.pi)
    ctx.set_source_rgba(*col, alpha)
    ctx.fill()


def star(ctx, x, y, r, col, alpha=1.0, rot=0.0):
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rot)
    ctx.move_to(0, -r)
    for k in range(1, 10):
        a = -math.pi / 2 + k * math.pi / 5
        rr = r if k % 2 == 0 else r * 0.45
        ctx.line_to(rr * math.cos(a), rr * math.sin(a))
    ctx.close_path()
    ctx.set_source_rgba(*col, alpha)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    ctx.set_line_width(r * 0.25)
    ctx.stroke_preserve()
    ctx.fill()
    ctx.restore()


def face(ctx, x, y, s, blink=False, mood=1.0):
    """Cute face: two eyes, cheeks and a smile, size s."""
    ex = s * 0.32
    for sx in (-1, 1):
        if blink:
            ctx.set_source_rgb(*INK)
            ctx.set_line_width(s * 0.06)
            ctx.set_line_cap(cairo.LINE_CAP_ROUND)
            ctx.move_to(x + sx * ex - s * 0.09, y)
            ctx.line_to(x + sx * ex + s * 0.09, y)
            ctx.stroke()
        else:
            ctx.save()
            ctx.translate(x + sx * ex, y)
            ctx.scale(1, 1.25)
            circle(ctx, 0, 0, s * 0.095, INK)
            ctx.restore()
            circle(ctx, x + sx * ex + s * 0.03, y - s * 0.05, s * 0.035, (1, 1, 1))
        circle(ctx, x + sx * s * 0.52, y + s * 0.2, s * 0.11, (1.0, 0.55, 0.6), 0.55)
    ctx.set_source_rgb(*INK)
    ctx.set_line_width(s * 0.055)
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.arc(x, y + s * 0.12, s * 0.13 * mood, 0.15 * math.pi, 0.85 * math.pi)
    ctx.stroke()


def outline_fill(ctx, col, sil, lw=10):
    """Fill current path with col (or silhouette) and a dark outline."""
    ctx.set_source_rgb(*(sil if sil else col))
    ctx.fill_preserve()
    ctx.set_source_rgb(*(sil if sil else shade(col, 0.45)))
    ctx.set_line_width(lw)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    ctx.stroke()


def leaf(ctx, x, y, s, ang, sil):
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(ang)
    ctx.move_to(0, 0)
    ctx.curve_to(s * 0.4, -s * 0.5, s * 1.0, -s * 0.4, s * 1.2, 0)
    ctx.curve_to(s * 1.0, s * 0.4, s * 0.4, s * 0.5, 0, 0)
    outline_fill(ctx, (0.35, 0.72, 0.3), sil, s * 0.08)
    ctx.restore()


def draw_fruit(ctx, kind, x, y, s, col, sil=None, blink=False):
    """Draw a fruit centred on (x, y) with radius about s. sil: flat silhouette color."""
    ctx.save()
    ctx.translate(x, y)
    lw = s * 0.045
    fy = 0.0  # face offset
    if kind == "apple":
        ctx.set_source_rgb(*(sil or (0.45, 0.28, 0.15)))
        ctx.set_line_width(s * 0.09)
        ctx.set_line_cap(cairo.LINE_CAP_ROUND)
        ctx.move_to(0, -s * 0.75)
        ctx.curve_to(0, -s * 0.95, s * 0.05, -s * 1.05, s * 0.12, -s * 1.12)
        ctx.stroke()
        leaf(ctx, s * 0.06, -s * 0.95, s * 0.42, -0.5, sil)
        ctx.move_to(0, -s * 0.72)
        ctx.curve_to(s * 0.5, -s * 1.05, s * 1.15, -s * 0.7, s * 0.95, s * 0.1)
        ctx.curve_to(s * 0.8, s * 0.75, s * 0.4, s * 0.98, 0, s * 0.82)
        ctx.curve_to(-s * 0.4, s * 0.98, -s * 0.8, s * 0.75, -s * 0.95, s * 0.1)
        ctx.curve_to(-s * 1.15, -s * 0.7, -s * 0.5, -s * 1.05, 0, -s * 0.72)
        outline_fill(ctx, col, sil, lw)
        fy = 0.05
    elif kind == "mikan":
        ctx.save()
        ctx.scale(1.05, 0.9)
        ctx.arc(0, 0, s, 0, 2 * math.pi)
        ctx.restore()
        outline_fill(ctx, col, sil, lw)
        if not sil:
            for dx, dy in [(-0.5, -0.3), (0.55, -0.15), (-0.2, 0.55), (0.35, 0.5), (0.65, 0.3)]:
                circle(ctx, dx * s, dy * s, s * 0.03, shade(col, 0.15))
        leaf(ctx, 0, -s * 0.85, s * 0.45, -0.3, sil)
        circle(ctx, 0, -s * 0.86, s * 0.07, sil or (0.3, 0.55, 0.2))
    elif kind == "banana":
        ctx.save()
        ctx.rotate(-0.35)
        ctx.move_to(-s * 1.1, -s * 0.35)
        ctx.curve_to(-s * 0.6, s * 0.75, s * 0.7, s * 0.8, s * 1.15, -s * 0.45)
        ctx.curve_to(s * 0.7, s * 0.25, -s * 0.5, s * 0.2, -s * 1.1, -s * 0.35)
        ctx.close_path()
        outline_fill(ctx, col, sil, lw)
        circle(ctx, s * 1.15, -s * 0.47, s * 0.08, sil or (0.42, 0.3, 0.15))
        ctx.set_source_rgb(*(sil or (0.45, 0.5, 0.2)))
        ctx.set_line_width(s * 0.1)
        ctx.set_line_cap(cairo.LINE_CAP_ROUND)
        ctx.move_to(-s * 1.1, -s * 0.35)
        ctx.line_to(-s * 1.25, -s * 0.55)
        ctx.stroke()
        ctx.restore()
        fy = 0.32
    elif kind == "melon":
        ctx.arc(0, 0, s, 0, 2 * math.pi)
        outline_fill(ctx, col, sil, lw)
        if not sil:
            ctx.save()
            ctx.arc(0, 0, s * 0.97, 0, 2 * math.pi)
            ctx.clip()
            ctx.set_source_rgba(1, 1, 1, 0.45)
            ctx.set_line_width(s * 0.025)
            for k in range(-4, 5):
                ctx.move_to(k * s * 0.32 - s, -s)
                ctx.line_to(k * s * 0.32 + s, s)
                ctx.move_to(k * s * 0.32 + s, -s)
                ctx.line_to(k * s * 0.32 - s, s)
            ctx.stroke()
            ctx.restore()
        ctx.set_source_rgb(*(sil or (0.3, 0.45, 0.2)))
        ctx.set_line_width(s * 0.1)
        ctx.set_line_cap(cairo.LINE_CAP_ROUND)
        ctx.move_to(0, -s * 0.95)
        ctx.line_to(0, -s * 1.2)
        ctx.move_to(-s * 0.2, -s * 1.2)
        ctx.line_to(s * 0.2, -s * 1.2)
        ctx.stroke()
    elif kind == "blueberry":
        for dx, dy, r in [(-0.55, 0.3, 0.55), (0.55, 0.3, 0.55), (0, -0.25, 0.68)]:
            ctx.arc(dx * s, dy * s, r * s, 0, 2 * math.pi)
            outline_fill(ctx, col, sil, lw)
            if not sil:
                star(ctx, dx * s, (dy - r * 0.72) * s, r * s * 0.2, shade(col, 0.45))
        fy = -0.25
    elif kind == "grape":
        ctx.set_source_rgb(*(sil or (0.45, 0.3, 0.15)))
        ctx.set_line_width(s * 0.09)
        ctx.set_line_cap(cairo.LINE_CAP_ROUND)
        ctx.move_to(0, -s * 0.85)
        ctx.line_to(s * 0.05, -s * 1.15)
        ctx.stroke()
        leaf(ctx, s * 0.05, -s * 1.0, s * 0.5, -0.2, sil)
        rows = [(-0.75, [-0.6, -0.2, 0.2, 0.6]), (-0.35, [-0.4, 0.0, 0.4]),
                (0.05, [-0.4, 0.0, 0.4]), (0.45, [-0.2, 0.2]), (0.82, [0.0])]
        for ry, xs in rows:
            for rx in xs:
                ctx.arc(rx * s * 1.2, ry * s, s * 0.26, 0, 2 * math.pi)
                outline_fill(ctx, col, sil, lw * 0.8)
                if not sil:
                    circle(ctx, rx * s * 1.2 - s * 0.08, ry * s - s * 0.08, s * 0.06, (1, 1, 1), 0.5)
        fy = -0.15
    elif kind == "peach":
        leaf(ctx, 0, -s * 0.82, s * 0.45, -0.6, sil)
        leaf(ctx, 0, -s * 0.82, s * 0.45, math.pi + 0.6, sil)
        ctx.move_to(0, -s * 0.8)
        ctx.curve_to(s * 0.6, -s * 1.1, s * 1.05, -s * 0.3, s * 0.85, s * 0.3)
        ctx.curve_to(s * 0.65, s * 0.85, s * 0.2, s * 0.95, 0, s * 0.95)
        ctx.curve_to(-s * 0.2, s * 0.95, -s * 0.65, s * 0.85, -s * 0.85, s * 0.3)
        ctx.curve_to(-s * 1.05, -s * 0.3, -s * 0.6, -s * 1.1, 0, -s * 0.8)
        outline_fill(ctx, col, sil, lw)
        if not sil:
            ctx.set_source_rgba(*shade(col, 0.25), 0.7)
            ctx.set_line_width(s * 0.035)
            ctx.move_to(-s * 0.05, -s * 0.75)
            ctx.curve_to(-s * 0.45, -s * 0.3, -s * 0.45, s * 0.3, -s * 0.2, s * 0.6)
            ctx.stroke()
        fy = 0.1
    if not sil:
        # shine
        ctx.save()
        ctx.translate(-s * 0.45, -s * 0.35)
        ctx.rotate(-0.6)
        ctx.scale(1, 0.55)
        circle(ctx, 0, 0, s * 0.14, (1, 1, 1), 0.55 if kind != "banana" else 0)
        ctx.restore()
        face(ctx, 0, fy * s, s * 0.6, blink)
    else:
        ctx.save()
        ctx.select_font_face(FONT, cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
        ctx.set_font_size(s * 0.9)
        e = ctx.text_extents("?")
        ctx.move_to(-e.x_advance / 2, fy * s + s * 0.32)
        ctx.set_source_rgba(1, 1, 1, 0.9)
        ctx.show_text("?")
        ctx.restore()
    ctx.restore()


def draw_chick(ctx, x, y, s, t, talk=0.0, wave=0.0):
    """Mascot ぴよちゃん. talk 0..1 opens the beak, wave 0..1 lifts a wing."""
    ctx.save()
    bounce = abs(math.sin(t * 3.2)) * s * 0.08
    squash = 1 + 0.04 * math.sin(t * 6.4)
    ctx.translate(x, y - bounce)
    ctx.scale(1 / squash, squash)
    # feet
    for sx in (-1, 1):
        ctx.save()
        ctx.translate(sx * s * 0.35, s * 0.95)
        ctx.scale(1, 0.45)
        circle(ctx, 0, 0, s * 0.22, (1.0, 0.55, 0.15))
        ctx.restore()
    # wings
    for sx in (-1, 1):
        ctx.save()
        lift = wave * (0.6 + 0.4 * math.sin(t * 12)) if sx == 1 else 0
        ctx.translate(sx * s * 0.88, s * 0.15)
        ctx.rotate(sx * (0.5 + 1.4 * lift))
        ctx.scale(0.45, 0.8)
        ctx.arc(0, 0, s * 0.42, 0, 2 * math.pi)
        ctx.restore()
        outline_fill(ctx, shade(CHICK, 0.06), None, s * 0.05)
    # tuft
    for a in (-0.35, 0, 0.35):
        ctx.save()
        ctx.translate(0, -s * 0.9)
        ctx.rotate(a)
        ctx.scale(0.35, 1)
        ctx.arc(0, -s * 0.18, s * 0.2, 0, 2 * math.pi)
        ctx.restore()
        outline_fill(ctx, CHICK, None, s * 0.05)
    ctx.arc(0, 0, s, 0, 2 * math.pi)
    outline_fill(ctx, CHICK, None, s * 0.05)
    # belly
    ctx.save()
    ctx.scale(1, 0.8)
    circle(ctx, 0, s * 0.55, s * 0.55, tint(CHICK, 0.55))
    ctx.restore()
    blink = (t % 3.7) < 0.12
    ey = -s * 0.15
    for sx in (-1, 1):
        if blink:
            ctx.set_source_rgb(*INK)
            ctx.set_line_width(s * 0.05)
            ctx.move_to(sx * s * 0.35 - s * 0.08, ey)
            ctx.line_to(sx * s * 0.35 + s * 0.08, ey)
            ctx.stroke()
        else:
            ctx.save()
            ctx.translate(sx * s * 0.35, ey)
            ctx.scale(1, 1.2)
            circle(ctx, 0, 0, s * 0.1, INK)
            ctx.restore()
            circle(ctx, sx * s * 0.35 + s * 0.035, ey - s * 0.05, s * 0.04, (1, 1, 1))
        circle(ctx, sx * s * 0.6, s * 0.12, s * 0.12, (1.0, 0.5, 0.55), 0.6)
    # beak
    o = s * 0.22 * clamp(talk)
    beak = (1.0, 0.55, 0.15)
    ctx.move_to(-s * 0.17, s * 0.05)
    ctx.line_to(s * 0.17, s * 0.05)
    ctx.line_to(0, s * 0.05 - s * 0.14)
    ctx.close_path()
    outline_fill(ctx, beak, None, s * 0.035)
    ctx.move_to(-s * 0.15, s * 0.07 + o * 0.2)
    ctx.line_to(s * 0.15, s * 0.07 + o * 0.2)
    ctx.line_to(0, s * 0.07 + s * 0.12 + o)
    ctx.close_path()
    outline_fill(ctx, beak, None, s * 0.035)
    ctx.restore()


DOTS = [(random.Random(k).random(), random.Random(k + 99).random(), random.Random(k + 7).random())
        for k in range(26)]


def background(ctx, t, col):
    ctx.set_source_rgb(*col)
    ctx.paint()
    # soft drifting polka dots
    for k, (a, b, c) in enumerate(DOTS):
        x = (a * W + t * (20 + 30 * c)) % (W + 200) - 100
        y = (b * H + math.sin(t * 0.7 + k) * 25)
        circle(ctx, x, y, 25 + 50 * c, (1, 1, 1), 0.35)
    # hills
    ctx.move_to(0, H)
    ctx.line_to(0, H - 120)
    ctx.curve_to(W * 0.25, H - 220, W * 0.45, H - 60, W * 0.7, H - 140)
    ctx.curve_to(W * 0.85, H - 190, W * 0.95, H - 150, W, H - 170)
    ctx.line_to(W, H)
    ctx.close_path()
    ctx.set_source_rgb(0.62, 0.85, 0.45)
    ctx.fill()
    ctx.move_to(0, H)
    ctx.line_to(0, H - 50)
    ctx.curve_to(W * 0.3, H - 120, W * 0.6, H - 20, W, H - 90)
    ctx.line_to(W, H)
    ctx.close_path()
    ctx.set_source_rgb(0.5, 0.78, 0.38)
    ctx.fill()


def rays(ctx, x, y, t, col, alpha):
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(t * 0.4)
    n = 16
    for k in range(n):
        a0 = k * 2 * math.pi / n
        ctx.move_to(0, 0)
        ctx.arc(0, 0, 1600, a0, a0 + math.pi / n)
        ctx.close_path()
    ctx.set_source_rgba(*col, alpha)
    ctx.fill()
    ctx.restore()


def iris(ctx, k, col=CHICK):
    """k=0 open, k=1 closed; a circle wipe toward the centre."""
    if k <= 0:
        return
    r = (1 - ease_in_out(k)) * 1150
    ctx.save()
    ctx.rectangle(0, 0, W, H)
    ctx.arc_negative(W / 2, H / 2, max(r, 0.1), 2 * math.pi, 0)
    ctx.set_fill_rule(cairo.FILL_RULE_EVEN_ODD)
    ctx.set_source_rgb(*col)
    ctx.fill()
    ctx.restore()


def bubble(ctx, x, y, w, h, col):
    r = h / 2
    ctx.new_sub_path()
    ctx.arc(x - w / 2 + r, y, r, math.pi / 2, 3 * math.pi / 2)
    ctx.arc(x + w / 2 - r, y, r, -math.pi / 2, math.pi / 2)
    ctx.close_path()
    ctx.set_source_rgb(*col)
    ctx.fill_preserve()
    ctx.set_source_rgb(*INK)
    ctx.set_line_width(8)
    ctx.stroke()


# --------------------------------------------------------------- scenes

def scene_intro(ctx, t, lt, sc, talk):
    background(ctx, t, CREAM)
    rays(ctx, W / 2, H * 0.62, t, (1.0, 0.9, 0.55), 0.45)
    title = "いろ あて クイズ！"
    rainbow = [c[4] for c in COLORS]
    ctx.select_font_face(FONT, cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
    size = 150
    ctx.set_font_size(size)
    widths = [ctx.text_extents(ch).x_advance for ch in title]
    x = W / 2 - sum(widths) / 2
    for k, ch in enumerate(title):
        p = ease_out_back((lt - 0.2 - k * 0.08) / 0.4)
        if p > 0:
            yy = 200 + math.sin(t * 4 + k * 0.6) * 10
            ctx.save()
            ctx.translate(x + widths[k] / 2, yy)
            ctx.scale(p, p)
            text(ctx, ch, 0, 0, size, rainbow[k % len(rainbow)])
            ctx.restore()
        x += widths[k]
    p = ease_out_back((lt - 1.2) / 0.5)
    if p > 0:
        ctx.save()
        ctx.translate(W / 2, 360)
        ctx.scale(p, p)
        bubble(ctx, 0, 0, 900, 100, (1, 1, 1))
        text(ctx, "くだもので いろを おぼえよう", 0, 0, 56, INK, outline=None, white=False)
        ctx.restore()
    p = ease_out_elastic((lt - 0.4) / 1.0)
    draw_chick(ctx, W / 2, 700 + (1 - p) * 700, 220, t, talk)
    # fruits circling around
    end = sc["end"] - sc["start"]
    for k, c in enumerate(COLORS):
        p = ease_out_back((lt - 1.6 - k * 0.12) / 0.4)
        if p <= 0:
            continue
        side = -1 if k < 4 else 1
        idx = k if k < 4 else k - 4
        fx = W / 2 + side * (520 + 170 * (idx % 2))
        fy = 520 + idx * 140 if k < 4 else 590 + idx * 150
        draw_fruit(ctx, c[5], fx, fy + math.sin(t * 3 + k) * 12, 70 * p, c[4], blink=(t + k) % 3 < 0.1)
    iris(ctx, (lt - (end - 0.45)) / 0.45)


def scene_color(ctx, t, lt, sc, talk):
    word, fruit, _, en, col, kind = COLORS[sc["i"]]
    end = sc["end"] - sc["start"]
    r = sc["r"]
    rk = ease_in_out((lt - r) / 0.35)
    background(ctx, t, lerp(CREAM, tint(col, 0.72), rk))
    fx, fy = W / 2, 430
    if lt < r:
        # question: wobbling silhouette and floating question marks
        drop = ease_out_back((lt - 0.2) / 0.6)
        ctx.save()
        ctx.translate(fx, fy - (1 - drop) * 900)
        ctx.rotate(math.sin(lt * 5) * 0.08)
        draw_fruit(ctx, kind, 0, 0, 230, col, sil=(0.36, 0.38, 0.45))
        ctx.restore()
        for k in range(6):
            a = k * math.pi / 3 + t * 0.6
            qx = fx + math.cos(a) * 420
            qy = fy + math.sin(a) * 250
            qp = ease_out_back((lt - 0.4 - k * 0.1) / 0.4)
            if qp > 0:
                ctx.save()
                ctx.translate(qx, qy)
                ctx.scale(qp, qp)
                ctx.rotate(math.sin(t * 3 + k) * 0.2)
                text(ctx, "？", 0, 0, 90, COLORS[(sc["i"] + k + 1) % len(COLORS)][4])
                ctx.restore()
        p = ease_out_back((lt - 0.4) / 0.4)
        if p > 0:
            ctx.save()
            ctx.translate(W / 2, 860)
            ctx.scale(p, p)
            text(ctx, "これは なにいろ かな？", 0, 0, 100, INK, outline=None)
            ctx.restore()
        # countdown 3-2-1
        c0 = sc["c0"]
        if lt >= c0:
            n = 3 - int((lt - c0) / 0.9)
            if n >= 1:
                k = ((lt - c0) % 0.9) / 0.9
                s = ease_out_back(k / 0.35)
                cx, cy = 1640, 260
                circle(ctx, cx, cy, 120 * s, (1, 1, 1))
                ctx.arc(cx, cy, 120 * s, 0, 2 * math.pi)
                ctx.set_source_rgb(*INK)
                ctx.set_line_width(10)
                ctx.stroke()
                # progress ring
                ctx.arc(cx, cy, 100 * s, -math.pi / 2, -math.pi / 2 + 2 * math.pi * (1 - k))
                ctx.set_source_rgb(*COLORS[sc["i"]][4])
                ctx.set_line_width(14)
                ctx.stroke()
                text(ctx, str(n), cx, cy, 150 * s, INK, outline=None, white=False)
    else:
        rays(ctx, fx, fy, t, (1, 1, 1), 0.35 * rk)
        p = ease_out_elastic((lt - r) / 0.9)
        s = 230 * (0.5 + 0.5 * p)
        bob = math.sin((lt - r) * 4) * 12
        draw_fruit(ctx, kind, fx, fy + bob, s, col, blink=(lt % 3.1) < 0.12)
        # burst of stars
        bk = (lt - r) / 1.1
        if bk < 1:
            for k in range(12):
                a = k * math.pi / 6 + 0.2
                d = 200 + 380 * ease_in_out(bk)
                star(ctx, fx + math.cos(a) * d, fy + math.sin(a) * d * 0.8, 30 * (1 - bk) + 6,
                     COLORS[k % len(COLORS)][4], 1 - bk, rot=bk * 3)
        # color word, with the fruit name on its left and English on its right
        ctx.select_font_face(FONT, cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
        ctx.set_font_size(190)
        half = ctx.text_extents(word).x_advance / 2
        p = ease_out_back((lt - sc["a0"]) / 0.45)
        if p > 0:
            ctx.save()
            ctx.translate(W / 2, 800)
            ctx.scale(p, p)
            text(ctx, word, 0, 0, 190, col)
            ctx.restore()
        p = ease_out_back((lt - sc["a0"] - 0.6) / 0.4)
        if p > 0:
            ctx.save()
            ctx.translate(W / 2 - half - 210, 800)
            ctx.scale(p, p)
            bubble(ctx, 0, 0, 300, 90, (1, 1, 1))
            text(ctx, fruit, 0, 0, 50 if len(fruit) < 5 else 40, INK, outline=None, white=False)
            ctx.restore()
        p = ease_out_back((lt - sc["e0"]) / 0.45)
        if p > 0:
            ctx.save()
            ctx.translate(W / 2 + half + 240, 800)
            ctx.scale(p, p)
            ctx.rotate(math.sin(t * 3) * 0.05)
            bubble(ctx, 0, 0, 380, 120, col)
            text(ctx, en, 0, 0, 80 if len(en) < 6 else 66, (1, 1, 1), outline=None, white=False)
            ctx.restore()
    draw_chick(ctx, 190, 900, 110, t, talk)
    iris(ctx, 1 - lt / 0.45)
    iris(ctx, (lt - (end - 0.45)) / 0.45)


def scene_review(ctx, t, lt, sc, talk):
    end = sc["end"] - sc["start"]
    background(ctx, t, (0.88, 0.95, 1.0))
    p = ease_out_back((lt - 0.3) / 0.5)
    if p > 0:
        ctx.save()
        ctx.translate(W / 2, 170)
        ctx.scale(p, p)
        text(ctx, "おさらい しよう！", 0, 0, 130, (1.0, 0.5, 0.2))
        ctx.restore()
    n = len(COLORS)
    gap = W / (n + 0.6)
    for k, c in enumerate(COLORS):
        s0 = sc["slots"][k]
        p = ease_out_elastic((lt - s0) / 0.8)
        if p <= 0:
            continue
        x = gap * (k + 0.8)
        hop = max(0, math.sin(clamp((lt - s0) / 0.5) * math.pi)) * 60
        draw_fruit(ctx, c[5], x, 480 - hop, 95 * p, c[4], blink=(t + k * 0.7) % 3 < 0.1)
        ctx.save()
        ctx.translate(x, 680)
        ctx.scale(p, p)
        text(ctx, c[0], 0, 0, 70 if len(c[0]) < 4 else 50, c[4])
        text(ctx, c[3], 0, 85, 34, INK, outline=None)
        ctx.restore()
    draw_chick(ctx, W / 2, 940, 95, t, talk)
    iris(ctx, 1 - lt / 0.45)
    iris(ctx, (lt - (end - 0.45)) / 0.45)


CONFETTI = [(random.Random(k * 3).random(), random.Random(k * 5 + 1).random(),
             random.Random(k * 7 + 2).random()) for k in range(90)]


def scene_outro(ctx, t, lt, sc, talk):
    end = sc["end"] - sc["start"]
    background(ctx, t, CREAM)
    rays(ctx, W / 2, 620, t, (1.0, 0.88, 0.6), 0.5)
    draw_chick(ctx, W / 2, 650, 230, t, talk, wave=1.0)
    p = ease_out_back((lt - 0.4) / 0.5)
    if p > 0:
        ctx.save()
        ctx.translate(W / 2, 190)
        ctx.scale(p, p)
        text(ctx, "よく できました！", 0, 0, 140, (0.95, 0.35, 0.45))
        ctx.restore()
    p = ease_out_back((lt - (end - 3.5)) / 0.5)
    if p > 0:
        ctx.save()
        ctx.translate(W / 2, 980)
        ctx.scale(p, p)
        text(ctx, "またね！", 0, 0, 110, (0.2, 0.6, 0.95))
        ctx.restore()
    for k, (a, b, c) in enumerate(CONFETTI):
        y = ((lt * (180 + 160 * c)) + b * H) % (H + 100) - 80 - (0 if lt > 0.3 else H)
        x = a * W + math.sin(lt * 2 + k) * 40
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(lt * (2 + 3 * c) + k)
        ctx.rectangle(-12, -7, 24, 14)
        ctx.set_source_rgb(*COLORS[k % len(COLORS)][4])
        ctx.fill()
        ctx.restore()
    for k, c in enumerate(COLORS):
        x = 240 if k < 4 else W - 240
        y = 330 + (k % 4) * 180 if k < 4 else 420 + (k - 4) * 180
        x += math.sin(t * 2 + k) * 15
        draw_fruit(ctx, c[5], x, y, 65, c[4], blink=(t + k) % 3 < 0.1)
    iris(ctx, 1 - lt / 0.45)
    # fade to white at the very end
    fk = clamp((lt - (end - 0.6)) / 0.6)
    if fk > 0:
        ctx.set_source_rgba(1, 1, 1, fk)
        ctx.paint()


SCENES = {"intro": scene_intro, "color": scene_color, "review": scene_review, "outro": scene_outro}
STATE = {}


def init_worker(tl_path):
    with open(tl_path) as f:
        STATE.update(json.load(f))


def render(frame):
    t = frame / FPS
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    ctx = cairo.Context(surf)
    sc = next((s for s in STATE["scenes"] if s["start"] <= t < s["end"]), STATE["scenes"][-1])
    lip = STATE["lip"]
    talk = clamp(lip[frame] * 9) if frame < len(lip) else 0.0
    SCENES[sc["kind"]](ctx, t, t - sc["start"], sc, talk)
    surf.flush()
    return bytes(surf.get_data())


def render_still(path, frame):
    surf = cairo.ImageSurface.create_for_data(bytearray(render(frame)), cairo.FORMAT_ARGB32, W, H)
    surf.write_to_png(path)


def thumbnail(path):
    """1280x720 thumbnail: all fruits, title and the chick."""
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    ctx = cairo.Context(surf)
    background(ctx, 2.0, (1.0, 0.93, 0.6))
    rays(ctx, W / 2, H / 2, 0.3, (1, 1, 1), 0.45)
    text(ctx, "いろ あて", W / 2, 170, 210, (0.95, 0.3, 0.3))
    text(ctx, "クイズ！", W / 2, 400, 210, (0.15, 0.5, 0.95))
    draw_chick(ctx, 260, 760, 190, 0.5, 0.8)
    for k, c in enumerate(COLORS):
        x = 620 + (k % 4) * 340 + (170 if k >= 4 else 0)
        y = 680 if k < 4 else 920
        draw_fruit(ctx, c[5], x, y, 105, c[4])
    small = cairo.ImageSurface(cairo.FORMAT_ARGB32, 1280, 720)
    sctx = cairo.Context(small)
    sctx.scale(1280 / W, 720 / H)
    sctx.set_source_surface(surf)
    sctx.get_source().set_filter(cairo.FILTER_BEST)
    sctx.paint()
    small.write_to_png(path)


# --------------------------------------------------------------- main

def main():
    out = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "out")
    os.makedirs(out, exist_ok=True)
    vdir = os.path.join(out, "voice")
    os.makedirs(vdir, exist_ok=True)

    print("narration ...")
    voices = {}
    for name, line in build_lines().items():
        voices[name] = say(line, os.path.join(vdir, f"{name}.wav"))
    dur = {k: len(v) / SR for k, v in voices.items()}

    scenes, cues, sfx, total = build_timeline(dur)
    print(f"length {total:.1f}s")

    print("audio ...")
    audio, lip = mix(total, voices, cues, sfx)
    wav = os.path.join(out, "audio.wav")
    write_wav(wav, audio)

    tl = os.path.join(out, "timeline.json")
    with open(tl, "w") as f:
        json.dump({"scenes": scenes, "lip": lip, "total": total}, f)

    init_worker(tl)
    thumbnail(os.path.join(out, "thumbnail.png"))
    if os.environ.get("STILLS"):
        for fr in [int(float(x) * FPS) for x in os.environ["STILLS"].split(",")]:
            render_still(os.path.join(out, f"still_{fr:05d}.png"), fr)
        return

    print("video ...")
    nf = int(total * FPS)
    mp4 = os.path.join(out, "iro_ate_quiz.mp4")
    ff = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "bgra", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-i", wav,
         "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", mp4],
        stdin=subprocess.PIPE)
    with Pool(os.cpu_count(), initializer=init_worker, initargs=(tl,)) as pool:
        for k, data in enumerate(pool.imap(render, range(nf), chunksize=6)):
            ff.stdin.write(data)
            if k % 300 == 0:
                print(f"  {k}/{nf}", flush=True)
    ff.stdin.close()
    ff.wait()
    print("done:", mp4)


if __name__ == "__main__":
    main()
