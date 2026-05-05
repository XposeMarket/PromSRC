#!/usr/bin/env python3
"""Extract representative video frames for Prometheus video QA."""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
from pathlib import Path
from typing import Any


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
    samples = max(2, min(samples, 8))
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
    parser.add_argument("--samples", type=int, default=6)
    parser.add_argument("--extract-audio", action="store_true")
    parser.add_argument("--transcribe", action="store_true")
    args = parser.parse_args()

    video_path = Path(args.video_path).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    ffprobe = shutil.which("ffprobe")
    ffmpeg = shutil.which("ffmpeg")
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
    times = sample_times(duration, int(args.samples or 6))
    written: list[str] = []
    errors: list[str] = []

    for index, at_seconds in enumerate(times, start=1):
        frame_path = output_dir / f"frame_{index:02d}_{math.floor(at_seconds * 1000):06d}ms.jpg"
        try:
            extract_frame(ffmpeg, video_path, frame_path, at_seconds)
            if frame_path.exists() and frame_path.stat().st_size > 0:
                written.append(str(frame_path))
        except Exception as exc:
            errors.append(f"{frame_path.name}: {exc}")

    audio = maybe_extract_audio(ffmpeg, video_path, output_dir, bool(args.extract_audio))
    print(json.dumps({
        "ok": bool(written),
        "probe": {"json": probe},
        "video_summary": {
            "duration_seconds": duration,
            "sample_times_seconds": times,
            "written": written,
            "errors": errors,
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
