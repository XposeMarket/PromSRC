#!/usr/bin/env python3
"""Extract overview and detail video frames for Prometheus video QA."""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

try:
    from PIL import Image, ImageDraw, ImageFont
except Exception:
    Image = None
    ImageDraw = None
    ImageFont = None


def run_json(command: list[str]) -> dict[str, Any]:
    result = subprocess.run(command, capture_output=True, text=True, check=True)
    return json.loads(result.stdout or "{}")


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, check=True)


def parse_duration(probe: dict[str, Any]) -> float:
    for stream in probe.get("streams", []):
        if stream.get("codec_type") == "video":
            value = stream.get("duration")
            if value:
                try:
                    return max(0.0, float(value))
                except (TypeError, ValueError):
                    pass
    value = probe.get("format", {}).get("duration")
    if value:
        try:
            return max(0.0, float(value))
        except (TypeError, ValueError):
            pass
    return 0.0


def sample_times(duration: float, samples: int) -> list[float]:
    samples = max(1, samples)
    if duration <= 0:
        return [0.0]
    if samples == 1:
        return [min(duration, 0.1)]
    start = min(0.15, duration * 0.05)
    end = max(start, duration - min(0.2, duration * 0.05))
    if samples == 2:
        return [start, end]
    span = max(0.001, end - start)
    return [start + (span * idx / (samples - 1)) for idx in range(samples)]


def clamp_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def choose_detail_sample_count(duration: float, requested: int | None, maximum: int) -> int:
    if requested:
        return clamp_int(requested, requested, 2, maximum)
    if duration <= 0:
        return min(6, maximum)
    if duration <= 10:
        return min(maximum, max(6, math.ceil(duration * 1.5)))
    if duration <= 60:
        return min(maximum, 18)
    if duration <= 300:
        return min(maximum, 30)
    return min(maximum, 42)


def extract_frame(ffmpeg: str, video_path: Path, output_path: Path, at_seconds: float) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    run([
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{max(0.0, at_seconds):.3f}",
        "-i",
        str(video_path),
        "-frames:v",
        "1",
        "-q:v",
        "2",
        str(output_path),
    ])


def escape_concat_path(frame: str) -> str:
    return str(Path(frame).resolve()).replace("\\", "/").replace("'", "'\\''")


def escape_drawtext(value: str) -> str:
    return value.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace("%", "\\%")


def format_timestamp(seconds: float) -> str:
    mm = int(seconds // 60)
    ss = seconds - mm * 60
    return f"{mm:02d}:{ss:05.2f}"


def make_ffmpeg_contact_sheet(
    ffmpeg: str,
    frame_paths: list[str],
    output_path: Path,
    times: list[float] | None = None,
) -> dict[str, Any] | None:
    if len(frame_paths) < 2:
        return None
    sheet_inputs = frame_paths
    labeled = False
    if times:
        label_dir = output_path.parent / f"{output_path.stem}_labeled"
        label_dir.mkdir(parents=True, exist_ok=True)
        labeled_paths: list[str] = []
        try:
            for index, frame in enumerate(frame_paths):
                seconds = times[index] if index < len(times) else 0
                label = escape_drawtext(f"{index + 1:02d} {format_timestamp(seconds)}")
                labeled_path = label_dir / f"tile_{index + 1:03d}.jpg"
                run([
                    ffmpeg,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    frame,
                    "-vf",
                    f"drawtext=text='{label}':fontcolor=white:fontsize=22:box=1:boxcolor=black@0.72:boxborderw=8:x=8:y=h-th-12",
                    "-frames:v",
                    "1",
                    str(labeled_path),
                ])
                if labeled_path.exists() and labeled_path.stat().st_size > 0:
                    labeled_paths.append(str(labeled_path))
            if len(labeled_paths) == len(frame_paths):
                sheet_inputs = labeled_paths
                labeled = True
        except Exception:
            sheet_inputs = frame_paths
            labeled = False
    list_path = output_path.with_suffix(".inputs.txt")
    list_path.write_text(
        "\n".join(f"file '{escape_concat_path(frame)}'" for frame in sheet_inputs),
        encoding="utf-8",
    )
    cols = math.ceil(math.sqrt(len(sheet_inputs)))
    rows = math.ceil(len(sheet_inputs) / cols)
    run([
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(list_path),
        "-vf",
        f"scale=320:-1,tile={cols}x{rows}",
        "-frames:v",
        "1",
        str(output_path),
    ])
    return {"path": str(output_path), "frame_count": len(sheet_inputs), "cols": cols, "rows": rows, "labeled": labeled}


def make_labeled_contact_sheet(
    ffmpeg: str,
    video_path: Path,
    frame_paths: list[str],
    times: list[float],
    output_path: Path,
    title: str,
) -> dict[str, Any] | None:
    if len(frame_paths) < 2:
        return None
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if Image is None or ImageDraw is None or ImageFont is None:
        return make_ffmpeg_contact_sheet(ffmpeg, frame_paths, output_path, times)

    thumb_w = 320
    label_h = 34
    pad = 10
    cols = 4 if len(frame_paths) <= 24 else 5
    rows = math.ceil(len(frame_paths) / cols)
    try:
        font = ImageFont.truetype("arial.ttf", 16)
        small_font = ImageFont.truetype("arial.ttf", 13)
    except Exception:
        font = ImageFont.load_default()
        small_font = ImageFont.load_default()

    tiles = []
    for index, frame_path in enumerate(frame_paths):
        try:
            img = Image.open(frame_path).convert("RGB")
            aspect = img.height / img.width if img.width else 9 / 16
            thumb_h = max(1, int(thumb_w * aspect))
            img = img.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
            tile = Image.new("RGB", (thumb_w, thumb_h + label_h), (18, 18, 18))
            tile.paste(img, (0, 0))
            draw = ImageDraw.Draw(tile)
            seconds = times[index] if index < len(times) else 0
            mm = int(seconds // 60)
            ss = seconds - mm * 60
            label = f"{index + 1:02d}  {mm:02d}:{ss:05.2f}"
            draw.rectangle((0, thumb_h, thumb_w, thumb_h + label_h), fill=(10, 10, 10))
            draw.text((8, thumb_h + 8), label, fill=(238, 238, 238), font=small_font)
            tiles.append(tile)
        except Exception:
            continue
    if len(tiles) < 2:
        return make_ffmpeg_contact_sheet(ffmpeg, frame_paths, output_path, times)

    max_tile_h = max(tile.height for tile in tiles)
    sheet_w = cols * thumb_w + (cols + 1) * pad
    header_h = 72
    sheet_h = header_h + rows * max_tile_h + (rows + 1) * pad
    sheet = Image.new("RGB", (sheet_w, sheet_h), (242, 240, 235))
    draw = ImageDraw.Draw(sheet)
    draw.text((pad, 12), title[:120], fill=(20, 20, 20), font=font)
    meta = f"{len(tiles)} sampled frames • {video_path.name}"
    draw.text((pad, 40), meta, fill=(70, 70, 70), font=small_font)
    for i, tile in enumerate(tiles):
        row = i // cols
        col = i % cols
        x = pad + col * (thumb_w + pad)
        y = header_h + pad + row * (max_tile_h + pad)
        sheet.paste(tile, (x, y))
    sheet.save(output_path, quality=95)
    return {"path": str(output_path), "frame_count": len(tiles), "cols": cols, "rows": rows, "labeled": True}


def extract_sample_set(
    ffmpeg: str,
    video_path: Path,
    output_dir: Path,
    label: str,
    times: list[float],
) -> dict[str, Any]:
    set_dir = output_dir / label
    set_dir.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    errors: list[str] = []
    frames: list[dict[str, Any]] = []
    for index, at_seconds in enumerate(times, start=1):
        frame_path = set_dir / f"{label}_{index:03d}_{math.floor(at_seconds * 1000):08d}ms.jpg"
        try:
            extract_frame(ffmpeg, video_path, frame_path, at_seconds)
            if frame_path.exists() and frame_path.stat().st_size > 0:
                written.append(str(frame_path))
                frames.append({
                    "index": index,
                    "at_seconds": at_seconds,
                    "at_ms": int(round(at_seconds * 1000)),
                    "path": str(frame_path),
                })
        except Exception as exc:
            errors.append(f"{frame_path.name}: {exc}")
    return {"label": label, "times_seconds": times, "written": written, "frames": frames, "errors": errors}


def make_batches(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[index:index + size] for index in range(0, len(items), size)]


def maybe_extract_audio(ffmpeg: str, video_path: Path, output_dir: Path, enabled: bool) -> dict[str, Any]:
    if not enabled:
        return {"requested": False, "available": False}
    audio_path = output_dir / "audio.wav"
    try:
        run([
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(video_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            str(audio_path),
        ])
        return {"requested": True, "available": audio_path.exists(), "path": str(audio_path)}
    except Exception as exc:
        return {"requested": True, "available": False, "error": str(exc)}


def print_failure(error: str) -> None:
    print(json.dumps({
        "ok": False,
        "error": error,
        "video_summary": {"written": []},
        "transcript": {"available": False, "text": ""},
    }))


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract sample frames from a video.")
    parser.add_argument("video_path")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--mode", choices=["quick", "detail", "both"], default="quick")
    parser.add_argument("--samples", type=int, default=6)
    parser.add_argument("--quick-samples", type=int, default=16)
    parser.add_argument("--detail-samples", type=int, default=0)
    parser.add_argument("--max-detail-frames", type=int, default=42)
    parser.add_argument("--batch-size", type=int, default=12)
    parser.add_argument("--extract-audio", action="store_true")
    parser.add_argument("--transcribe", action="store_true")
    parser.add_argument("--ffmpeg", default="")
    parser.add_argument("--ffprobe", default="")
    args = parser.parse_args()

    video_path = Path(args.video_path).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    ffprobe = args.ffprobe or os.environ.get("PROMETHEUS_FFPROBE_PATH") or shutil.which("ffprobe")
    ffmpeg = args.ffmpeg or os.environ.get("PROMETHEUS_FFMPEG_PATH") or shutil.which("ffmpeg")
    if not ffprobe or not ffmpeg:
        print_failure("ffmpeg and ffprobe are required for video analysis but were not found on PATH.")
        return 0

    if not video_path.exists():
        print_failure(f"Video file not found: {video_path}")
        return 0

    probe = run_json([
        ffprobe,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(video_path),
    ])
    duration = parse_duration(probe)
    mode = args.mode or "quick"
    quick_count = clamp_int(args.quick_samples or args.samples, 16, 2, 24)
    detail_max = clamp_int(args.max_detail_frames, 42, 2, 72)
    detail_count = choose_detail_sample_count(duration, args.detail_samples or None, detail_max)
    batch_size = clamp_int(args.batch_size, 12, 4, 18)

    quick = None
    detail = None
    all_written: list[str] = []
    all_errors: list[str] = []

    if mode in ("quick", "both"):
        quick_times = sample_times(duration, quick_count)
        quick = extract_sample_set(ffmpeg, video_path, output_dir, "quick", quick_times)
        quick["contact_sheet"] = make_labeled_contact_sheet(
            ffmpeg,
            video_path,
            quick["written"],
            quick["times_seconds"],
            output_dir / "quick_contact_sheet.jpg",
            "Quick video contact sheet",
        )
        all_written.extend(quick["written"])
        all_errors.extend(quick["errors"])

    if mode in ("detail", "both"):
        detail_times = sample_times(duration, detail_count)
        detail = extract_sample_set(ffmpeg, video_path, output_dir, "detail", detail_times)
        detail["contact_sheet"] = make_labeled_contact_sheet(
            ffmpeg,
            video_path,
            detail["written"],
            detail["times_seconds"],
            output_dir / "detail_contact_sheet.jpg",
            "Detailed video contact sheet",
        )
        batch_sheets = []
        for batch_index, batch in enumerate(make_batches(detail["frames"], batch_size), start=1):
            batch_paths = [frame["path"] for frame in batch]
            batch_times = [frame["at_seconds"] for frame in batch]
            sheet = make_labeled_contact_sheet(
                ffmpeg,
                video_path,
                batch_paths,
                batch_times,
                output_dir / f"detail_batch_{batch_index:02d}.jpg",
                f"Detailed video batch {batch_index}",
            )
            if sheet:
                batch_sheets.append(sheet)
        detail["batch_sheets"] = batch_sheets
        detail["sampling_plan"] = {
            "duration_seconds": duration,
            "requested_detail_samples": int(args.detail_samples or 0) or None,
            "chosen_detail_samples": len(detail["written"]),
            "max_detail_frames": detail_max,
            "batch_size": batch_size,
            "note": "Detail mode is budgeted; it samples across the full duration instead of extracting every frame.",
        }
        all_written.extend(detail["written"])
        all_errors.extend(detail["errors"])

    audio = maybe_extract_audio(ffmpeg, video_path, output_dir, bool(args.extract_audio))
    print(json.dumps({
        "ok": bool(all_written),
        "probe": {"json": probe},
        "video_summary": {
            "duration_seconds": duration,
            "mode": mode,
            "sample_times_seconds": (quick or detail or {}).get("times_seconds", []),
            "written": all_written,
            "errors": all_errors,
            "quick": quick,
            "detail": detail,
        },
        "audio": audio,
        "transcript": {
            "requested": bool(args.transcribe),
            "available": False,
            "text": "",
            "note": "Local transcription is not bundled with this analyzer; visual frame QA remains available.",
        },
    }))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print_failure(exc.stderr or exc.stdout or str(exc))
        raise SystemExit(0)
    except Exception as exc:
        print_failure(str(exc))
        raise SystemExit(0)
