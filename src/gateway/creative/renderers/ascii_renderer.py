#!/usr/bin/env python3
"""Prometheus Creative Python ASCII render lane.

This renderer intentionally stays self-contained: Pillow draws the source-
driven glyph frames, ffmpeg encodes the final asset, and the TypeScript runtime
wraps the output as a normal Creative Video asset.
"""

from __future__ import annotations

import json
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


GLYPH_SETS = {
    "ascii": " .,:;irsXA253hMHGS#9B&@",
    "binary": " 001101011011001111",
    "blocks": "  .:-=+*#%@",
    "matrix": " 01ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ",
    "braille": " ⠁⠃⠇⠧⠷⣿",
    "dense": " .'`^\",:;Il!i><~+_-?][}{1)(|\\/*tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
}

PALETTES = {
    "nous-cyan-magenta": ["#00f0ff", "#22ff88", "#ff2bd6", "#d4ff3a", "#7df9ff"],
    "phosphor-green": ["#0cff6a", "#8dffb0", "#eaffd1", "#00aa55"],
    "amber": ["#ffb000", "#ffd166", "#fff0b3", "#ff5a1f"],
    "mono": ["#e8f7ff", "#9eb8c2", "#f8ffff"],
    "source": [],
}


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def hex_to_rgb(value: str) -> Tuple[int, int, int]:
    text = str(value or "").strip().lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    if len(text) != 6:
        return (0, 240, 255)
    return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))


def parse_palette(raw: Any) -> List[Tuple[int, int, int]]:
    if isinstance(raw, str):
        if raw in PALETTES:
            return [hex_to_rgb(color) for color in PALETTES[raw]]
        colors = [part.strip() for part in raw.split(",") if part.strip()]
        return [hex_to_rgb(color) for color in colors]
    if isinstance(raw, list):
        return [hex_to_rgb(color) for color in raw if isinstance(color, str)]
    return [hex_to_rgb(color) for color in PALETTES["nous-cyan-magenta"]]


def safe_int(value: Any, fallback: int, low: int, high: int) -> int:
    try:
        parsed = int(float(value))
    except Exception:
        parsed = fallback
    return int(clamp(parsed, low, high))


def safe_float(value: Any, fallback: float, low: float, high: float) -> float:
    try:
        parsed = float(value)
    except Exception:
        parsed = fallback
    return float(clamp(parsed, low, high))


def load_font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/consola.ttf",
        "C:/Windows/Fonts/lucon.ttf",
        "C:/Windows/Fonts/cour.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/Library/Fonts/Menlo.ttc",
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            try:
                return ImageFont.truetype(candidate, size=size)
            except Exception:
                pass
    return ImageFont.load_default()


def contain_cover(image: Image.Image, width: int, height: int, fit: str) -> Image.Image:
    image = image.convert("RGBA")
    iw, ih = image.size
    if iw <= 0 or ih <= 0:
        return Image.new("RGBA", (width, height), (0, 0, 0, 0))
    mode = "cover" if str(fit or "cover").lower() == "cover" else "contain"
    scale = max(width / iw, height / ih) if mode == "cover" else min(width / iw, height / ih)
    nw, nh = max(1, int(round(iw * scale))), max(1, int(round(ih * scale)))
    resized = image.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((width - nw) // 2, (height - nh) // 2))
    return canvas


def create_generative_source(width: int, height: int, frame_index: int, frame_count: int) -> Image.Image:
    t = frame_index / max(1, frame_count - 1)
    img = Image.new("RGBA", (width, height), (0, 0, 0, 255))
    draw = ImageDraw.Draw(img, "RGBA")
    cx, cy = width * 0.5, height * 0.48
    radius = min(width, height) * (0.18 + 0.035 * math.sin(t * math.tau))
    for idx in range(7):
        angle = t * math.tau * (0.8 + idx * 0.05) + idx * math.tau / 7
        x = cx + math.cos(angle) * radius * (1.0 + idx * 0.04)
        y = cy + math.sin(angle * 1.2) * radius * 0.72
        color = (0, 240, 255, 120) if idx % 2 == 0 else (255, 43, 214, 120)
        draw.line((cx, cy, x, y), fill=color, width=max(2, width // 180))
        draw.ellipse((x - 12, y - 12, x + 12, y + 12), fill=color)
    box_w = width * 0.54
    box_h = height * 0.24
    draw.rounded_rectangle(
        (cx - box_w / 2, cy - box_h / 2, cx + box_w / 2, cy + box_h / 2),
        radius=max(4, width // 36),
        outline=(212, 255, 58, 210),
        width=max(4, width // 120),
    )
    return img.filter(ImageFilter.GaussianBlur(radius=0.5))


def sample_video_frame(source: Path, frame_time: float, temp_dir: Path, log_path: Path) -> Optional[Image.Image]:
    target = temp_dir / f"source_{int(frame_time * 1000):08d}.png"
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{frame_time:.3f}",
        "-i",
        str(source),
        "-frames:v",
        "1",
        str(target),
    ]
    with open(log_path, "a", encoding="utf-8", errors="replace") as log:
        proc = subprocess.run(cmd, stdout=log, stderr=log)
    if proc.returncode == 0 and target.exists():
        return Image.open(target).convert("RGBA")
    return None


def image_stats(cell: Image.Image) -> Tuple[float, float, Tuple[int, int, int], float]:
    rgba = cell.convert("RGBA")
    pixels = list(rgba.getdata())
    total_alpha = 0
    lum_sum = 0.0
    sat_sum = 0.0
    r_sum = g_sum = b_sum = 0.0
    for r, g, b, a in pixels:
        alpha = a / 255.0
        if alpha <= 0.01:
            continue
        lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
        maxc = max(r, g, b) / 255.0
        minc = min(r, g, b) / 255.0
        sat = 0.0 if maxc <= 0 else (maxc - minc) / maxc
        total_alpha += a
        lum_sum += lum * alpha
        sat_sum += sat * alpha
        r_sum += r * alpha
        g_sum += g * alpha
        b_sum += b * alpha
    weight = max(1.0, total_alpha / 255.0)
    alpha_avg = clamp(weight / max(1, len(pixels)), 0, 1)
    return (
        clamp(lum_sum / weight, 0, 1),
        clamp(sat_sum / weight, 0, 1),
        (int(r_sum / weight), int(g_sum / weight), int(b_sum / weight)),
        alpha_avg,
    )


def blend_color(a: Tuple[int, int, int], b: Tuple[int, int, int], amount: float) -> Tuple[int, int, int]:
    mix = clamp(amount, 0, 1)
    return (
        int(a[0] * (1 - mix) + b[0] * mix),
        int(a[1] * (1 - mix) + b[1] * mix),
        int(a[2] * (1 - mix) + b[2] * mix),
    )


def draw_scanlines(draw: ImageDraw.ImageDraw, width: int, height: int, frame_index: int) -> None:
    for y in range(0, height, 6):
        alpha = 18 if ((y // 6 + frame_index) % 3) else 30
        draw.line((0, y, width, y), fill=(0, 240, 255, alpha), width=1)
    draw.rectangle((0, 0, width - 1, height - 1), outline=(0, 240, 255, 80), width=max(1, width // 360))


def draw_glyph_frame(
    source: Image.Image,
    width: int,
    height: int,
    frame_index: int,
    frame_count: int,
    cfg: Dict[str, Any],
) -> Image.Image:
    quality = str(cfg.get("quality") or "balanced").lower()
    if quality == "draft":
        cell_w = max(7, width // 72)
    elif quality == "premium":
        cell_w = max(5, width // 122)
    else:
        cell_w = max(6, width // 96)
    font_size = max(7, int(cell_w * 1.45))
    cell_h = max(font_size, int(font_size * 1.18))
    font = load_font(font_size)
    glyphs = GLYPH_SETS.get(str(cfg.get("glyphSet") or "dense").lower(), GLYPH_SETS["dense"])
    palette = parse_palette(cfg.get("palette") or "nous-cyan-magenta")
    use_source_color = str(cfg.get("palette") or "").lower() == "source"
    background = hex_to_rgb(str(cfg.get("background") or "#020506"))
    glitch = safe_float(cfg.get("glitch"), 0.2, 0, 1)
    glow = safe_float(cfg.get("glow"), 0.42, 0, 1)
    reveal = str(cfg.get("motion") or "resolve").lower()

    t = frame_index / max(1, frame_count - 1)
    img = Image.new("RGBA", (width, height), (*background, 255))
    glow_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    text_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(text_layer, "RGBA")
    glow_draw = ImageDraw.Draw(glow_layer, "RGBA")

    enhanced = ImageEnhance.Contrast(source.convert("RGBA")).enhance(1.28)
    luma = enhanced.convert("L").filter(ImageFilter.FIND_EDGES)

    random.seed(int(cfg.get("seed") or 12345) + frame_index * 917)
    cols = math.ceil(width / cell_w)
    rows = math.ceil(height / cell_h)
    reveal_progress = 1.0
    if reveal == "resolve":
        reveal_progress = clamp((t - 0.05) / 0.58, 0, 1)
    elif reveal == "scan":
        reveal_progress = clamp((t - 0.02) / 0.78, 0, 1)

    for row in range(rows):
        y = row * cell_h
        scan_threshold = (row + 1) / max(1, rows)
        for col in range(cols):
            x = col * cell_w
            crop = enhanced.crop((x, y, min(width, x + cell_w), min(height, y + cell_h)))
            lum, sat, avg, alpha = image_stats(crop)
            edge_crop = luma.crop((x, y, min(width, x + cell_w), min(height, y + cell_h)))
            edge = sum(edge_crop.getdata()) / max(1, edge_crop.width * edge_crop.height) / 255.0
            signal = clamp(alpha * 1.2 + edge * 0.85 + sat * 0.18 + (1 - lum) * 0.18, 0, 1)
            if signal < 0.04 and random.random() > 0.025:
                continue
            if reveal == "scan" and scan_threshold > reveal_progress + random.random() * 0.18:
                signal *= 0.25
            if reveal == "resolve" and random.random() > reveal_progress + signal * 0.35:
                signal *= 0.42
            idx = int(clamp(signal ** 0.72, 0, 0.999) * (len(glyphs) - 1))
            if random.random() < glitch * 0.055:
                idx = random.randrange(0, len(glyphs))
            glyph = glyphs[idx]
            if not glyph.strip():
                continue
            pal = palette[(col * 3 + row * 5 + frame_index) % max(1, len(palette))] if palette else (0, 240, 255)
            color = avg if use_source_color else blend_color(avg, pal, 0.68 + 0.22 * sat)
            pulse = 0.78 + 0.22 * math.sin(t * math.tau * 2.0 + col * 0.17 + row * 0.11)
            alpha_out = int(clamp((signal * 0.78 + edge * 0.38 + 0.08) * pulse, 0, 1) * 255)
            jitter_x = int((random.random() - 0.5) * glitch * 2.8) if random.random() < glitch * 0.18 else 0
            jitter_y = int((random.random() - 0.5) * glitch * 2.2) if random.random() < glitch * 0.12 else 0
            pos = (x + jitter_x, y + jitter_y)
            glow_draw.text(pos, glyph, font=font, fill=(*color, int(alpha_out * glow)))
            draw.text(pos, glyph, font=font, fill=(*color, alpha_out))

    if glitch > 0:
        band_count = int(1 + glitch * 5)
        for _ in range(band_count):
            if random.random() > glitch * 0.38:
                continue
            y = random.randrange(0, max(1, height - cell_h))
            h = random.randrange(2, max(3, cell_h // 2))
            offset = random.randrange(-int(width * 0.035), int(width * 0.035) + 1)
            band = text_layer.crop((0, y, width, min(height, y + h)))
            text_layer.alpha_composite(band, (offset, y))

    if glow > 0:
        img.alpha_composite(glow_layer.filter(ImageFilter.GaussianBlur(radius=max(1.0, cell_w * 0.55))))
    img.alpha_composite(text_layer)
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay, "RGBA")
    draw_scanlines(overlay_draw, width, height, frame_index)
    vignette = Image.new("L", (width, height), 0)
    vd = ImageDraw.Draw(vignette)
    vd.ellipse((-width * 0.15, -height * 0.1, width * 1.15, height * 1.1), fill=210)
    vignette = Image.eval(vignette.filter(ImageFilter.GaussianBlur(radius=max(width, height) // 10)), lambda p: 255 - int(p * 0.45))
    overlay.putalpha(ImageChops_multiply(overlay.getchannel("A"), vignette))
    img.alpha_composite(overlay)
    return img.convert("RGB")


def ImageChops_multiply(a: Image.Image, b: Image.Image) -> Image.Image:
    # Avoid importing the whole module at top just for one tiny operation.
    from PIL import ImageChops

    return ImageChops.multiply(a, b)


def run(config_path: Path) -> Dict[str, Any]:
    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    output = Path(str(cfg.get("output") or "")).resolve()
    if not output:
        raise ValueError("output is required")
    output.parent.mkdir(parents=True, exist_ok=True)

    width = safe_int(cfg.get("width"), 1080, 160, 3840)
    height = safe_int(cfg.get("height"), 1920, 160, 3840)
    duration_ms = safe_int(cfg.get("durationMs"), 6000, 250, 120000)
    frame_rate = safe_int(cfg.get("frameRate"), 30, 1, 60)
    frame_count = max(1, int(math.ceil(duration_ms / 1000.0 * frame_rate)))
    mode = str(cfg.get("mode") or "image-to-ascii").lower()
    fit = str(cfg.get("fit") or "cover").lower()
    source_raw = str(cfg.get("source") or "").strip()
    log_path = Path(str(cfg.get("logPath") or output.with_suffix(".log"))).resolve()
    log_path.parent.mkdir(parents=True, exist_ok=True)

    temp_root = Path(str(cfg.get("tempDir") or tempfile.mkdtemp(prefix="prometheus_ascii_"))).resolve()
    frames_dir = temp_root / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    source_path = Path(source_raw).resolve() if source_raw else None
    is_video = bool(source_path and source_path.suffix.lower() in {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"})
    is_audio = bool(source_path and source_path.suffix.lower() in {".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac"})
    source_image: Optional[Image.Image] = None
    if source_path and source_path.exists() and not is_video and not is_audio:
        source_image = Image.open(source_path).convert("RGBA")

    for index in range(frame_count):
        if mode == "generative" or not source_path:
            frame_source = create_generative_source(width, height, index, frame_count)
        elif is_video:
            sampled = sample_video_frame(source_path, index / frame_rate, temp_root, log_path)
            frame_source = sampled if sampled is not None else create_generative_source(width, height, index, frame_count)
        elif is_audio:
            # The integrated MVP keeps audio-reactive requests render-safe by
            # producing a cinematic generative glyph field; richer beat analysis
            # can layer in later without changing the Creative tool contract.
            frame_source = create_generative_source(width, height, index, frame_count)
        else:
            assert source_image is not None
            drift = int(math.sin(index / max(1, frame_count - 1) * math.tau) * width * 0.012)
            base = contain_cover(source_image, width, height, fit)
            frame_source = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            frame_source.alpha_composite(base, (drift, 0))
        frame_source = contain_cover(frame_source, width, height, fit)
        rendered = draw_glyph_frame(frame_source, width, height, index, frame_count, cfg)
        rendered.save(frames_dir / f"frame_{index:06d}.png", optimize=False)

    cmd = [
        "ffmpeg",
        "-y",
        "-framerate",
        str(frame_rate),
        "-i",
        str(frames_dir / "frame_%06d.png"),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-r",
        str(frame_rate),
        str(output),
    ]
    with open(log_path, "a", encoding="utf-8", errors="replace") as log:
        log.write("\n[encode]\n" + " ".join(cmd) + "\n")
        proc = subprocess.run(cmd, stdout=log, stderr=log)
    if proc.returncode != 0 or not output.exists():
        raise RuntimeError(f"ffmpeg failed with code {proc.returncode}; see {log_path}")

    if cfg.get("keepFrames") is not True:
        shutil.rmtree(temp_root, ignore_errors=True)

    return {
        "ok": True,
        "output": str(output),
        "logPath": str(log_path),
        "width": width,
        "height": height,
        "durationMs": duration_ms,
        "frameRate": frame_rate,
        "frameCount": frame_count,
        "mode": mode,
        "quality": str(cfg.get("quality") or "balanced"),
    }


def main(argv: List[str]) -> int:
    if len(argv) < 2:
        print(json.dumps({"ok": False, "error": "Usage: ascii_renderer.py <config.json>"}))
        return 2
    try:
        result = run(Path(argv[1]).resolve())
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc), "traceback": traceback.format_exc()}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
