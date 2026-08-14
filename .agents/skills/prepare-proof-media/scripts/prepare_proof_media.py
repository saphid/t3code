#!/usr/bin/env python3
"""Build matched clean and annotated UI proof media with FFmpeg/ImageMagick."""

from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


Interval = Tuple[float, float]


class ProofMediaError(RuntimeError):
    pass


def run(command: Sequence[str], *, capture: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(
        list(command),
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )


def require_tools() -> Dict[str, str]:
    tools: Dict[str, str] = {}
    for name in ("ffmpeg", "ffprobe", "magick"):
        resolved = shutil.which(name)
        if resolved is None:
            raise ProofMediaError("Required executable is unavailable: {0}".format(name))
        tools[name] = resolved
    return tools


def find_font() -> str:
    matcher = shutil.which("fc-match")
    if matcher:
        try:
            result = run([matcher, "-f", "%{file}", "sans"], capture=True)
            candidate = result.stdout.strip()
            if candidate and Path(candidate).is_file():
                return candidate
        except subprocess.CalledProcessError:
            pass
    candidates = (
        "/System/Library/Fonts/Supplemental/Verdana.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "C:/Windows/Fonts/arial.ttf",
    )
    for candidate in candidates:
        if Path(candidate).is_file():
            return candidate
    raise ProofMediaError("No readable sans-serif font was found for ImageMagick captions")


def tool_version(executable: str) -> str:
    result = run([executable, "-version"], capture=True)
    output = result.stdout or result.stderr
    return output.splitlines()[0] if output else "unknown"


def probe_video(ffprobe: str, source: Path) -> Dict[str, Any]:
    result = run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,width,height,r_frame_rate,nb_frames",
            "-of",
            "json",
            str(source),
        ],
        capture=True,
    )
    payload = json.loads(result.stdout)
    video = next((stream for stream in payload.get("streams", []) if stream.get("codec_type") == "video"), None)
    if video is None:
        raise ProofMediaError("Source contains no video stream: {0}".format(source))
    duration = float(payload.get("format", {}).get("duration", 0))
    if duration <= 0:
        raise ProofMediaError("Source has no positive duration: {0}".format(source))
    return {
        "duration": duration,
        "width": int(video["width"]),
        "height": int(video["height"]),
        "frame_rate": video.get("r_frame_rate", "30/1"),
        "frame_count": int(video["nb_frames"]) if str(video.get("nb_frames", "")).isdigit() else None,
        "has_audio": any(stream.get("codec_type") == "audio" for stream in payload.get("streams", [])),
    }


def probe_image(magick: str, source: Path) -> Tuple[int, int]:
    result = run([magick, "identify", "-format", "%w %h", str(source)], capture=True)
    parts = result.stdout.strip().split()
    if len(parts) != 2:
        raise ProofMediaError("Could not determine image dimensions: {0}".format(source))
    return (int(parts[0]), int(parts[1]))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_timeline(
    path: Path, duration: float, extra_secret_patterns: Sequence[str] = ()
) -> Dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ProofMediaError("Could not read timeline {0}: {1}".format(path, exc)) from exc
    if payload.get("version") != 1:
        raise ProofMediaError("Timeline version must be 1")
    coordinate_space = payload.get("coordinate_space", "normalized")
    if coordinate_space not in ("normalized", "pixels"):
        raise ProofMediaError("coordinate_space must be normalized or pixels")
    events = payload.get("events", [])
    if not isinstance(events, list):
        raise ProofMediaError("events must be a list")
    try:
        compiled_patterns = tuple(re.compile(pattern) for pattern in extra_secret_patterns)
    except re.error as exc:
        raise ProofMediaError("Invalid --deny-secret-pattern: {0}".format(exc)) from exc
    for index, event in enumerate(events):
        validate_event(event, index, duration, coordinate_space)
        reject_secrets(event, index, compiled_patterns)
    payload["events"] = sorted(events, key=event_start)
    payload["coordinate_space"] = coordinate_space
    return payload


SECRET_PATTERNS = (
    re.compile(r"#token=", re.IGNORECASE),
    re.compile(r"[?&#]token=[^&#\s]+", re.IGNORECASE),
    re.compile(
        r"\b(?:token|pairing(?:\s+code)?)\s*[:=]\s*[A-Z0-9_-]{12,}(?![A-Z0-9_-])",
        re.IGNORECASE,
    ),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{12,}", re.IGNORECASE),
    re.compile(r"\bsk-[A-Za-z0-9_-]{12,}"),
)

FREEZE_NOISE = 0.002
SILENCE_NOISE = "-45dB"


def reject_secrets(
    event: Dict[str, Any], index: int, extra_patterns: Sequence[re.Pattern[str]] = ()
) -> None:
    for field in ("caption", "label", "expect"):
        value = event.get(field)
        if value is None:
            continue
        if not isinstance(value, str):
            raise ProofMediaError("events[{0}].{1} must be a string".format(index, field))
        if value.lstrip().startswith("@"):
            raise ProofMediaError(
                "events[{0}].{1} must not start with @".format(index, field)
            )
        if any(pattern.search(value) for pattern in SECRET_PATTERNS + tuple(extra_patterns)):
            raise ProofMediaError("events[{0}].{1} appears to contain a credential".format(index, field))


def number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ProofMediaError("{0} must be a number".format(label))
    return float(value)


def validate_event(event: Any, index: int, duration: float, coordinate_space: str) -> None:
    if not isinstance(event, dict):
        raise ProofMediaError("events[{0}] must be an object".format(index))
    kind = event.get("kind")
    if kind not in ("tap", "swipe", "caption"):
        raise ProofMediaError("events[{0}].kind must be tap, swipe, or caption".format(index))
    at = number(event.get("at", event.get("start", 0)), "events[{0}] time".format(index))
    if at < 0 or at > duration:
        raise ProofMediaError("events[{0}] starts outside the source".format(index))
    end = event_end(event)
    if end < at or end > duration:
        raise ProofMediaError("events[{0}] ends outside the source or before it starts".format(index))
    if kind == "tap":
        coordinates = (
            number(event.get("x"), "events[{0}].x".format(index)),
            number(event.get("y"), "events[{0}].y".format(index)),
        )
        validate_coordinate_values(coordinates, coordinate_space, index)
    if kind == "swipe":
        if end <= at:
            raise ProofMediaError("events[{0}].duration must be positive".format(index))
        for field in ("from", "to"):
            point = event.get(field)
            if not isinstance(point, list) or len(point) != 2:
                raise ProofMediaError("events[{0}].{1} must be [x, y]".format(index, field))
            coordinates = (
                number(point[0], "events[{0}].{1}[0]".format(index, field)),
                number(point[1], "events[{0}].{1}[1]".format(index, field)),
            )
            validate_coordinate_values(coordinates, coordinate_space, index)
    if kind == "caption" and not event.get("caption"):
        raise ProofMediaError("events[{0}].caption is required".format(index))
    if event.get("caption_position", "bottom") not in ("top", "bottom"):
        raise ProofMediaError("events[{0}].caption_position must be top or bottom".format(index))
    caption_start = number(event.get("caption_start", at), "events[{0}].caption_start".format(index))
    caption_end = number(event.get("caption_end", max(end, caption_start)), "events[{0}].caption_end".format(index))
    if caption_start < 0 or caption_end < caption_start or caption_end > duration:
        raise ProofMediaError("events[{0}] caption timing falls outside the source".format(index))


def validate_coordinate_values(point: Sequence[float], coordinate_space: str, index: int) -> None:
    if coordinate_space == "normalized" and any(value < 0 or value > 1 for value in point):
        raise ProofMediaError("events[{0}] normalized coordinates must be between 0 and 1".format(index))
    if coordinate_space == "pixels" and any(value < 0 for value in point):
        raise ProofMediaError("events[{0}] pixel coordinates must be non-negative".format(index))


def event_start(event: Dict[str, Any]) -> float:
    return float(event.get("at", event.get("start", 0)))


def event_end(event: Dict[str, Any]) -> float:
    start = event_start(event)
    if "end" in event:
        return float(event["end"])
    return start + float(event.get("duration", 0.6 if event.get("kind") == "swipe" else 0.0))


def clamp_interval(interval: Interval, duration: float) -> Optional[Interval]:
    start = max(0.0, min(duration, interval[0]))
    end = max(0.0, min(duration, interval[1]))
    return (start, end) if end - start > 0.001 else None


def merge_intervals(intervals: Iterable[Interval], gap: float = 0.001) -> List[Interval]:
    ordered = sorted(intervals)
    merged: List[Interval] = []
    for start, end in ordered:
        if end <= start:
            continue
        if merged and start <= merged[-1][1] + gap:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def subtract_intervals(interval: Interval, protected: Sequence[Interval]) -> List[Interval]:
    pieces = [interval]
    for protect_start, protect_end in protected:
        next_pieces: List[Interval] = []
        for start, end in pieces:
            if protect_end <= start or protect_start >= end:
                next_pieces.append((start, end))
                continue
            if protect_start > start:
                next_pieces.append((start, protect_start))
            if protect_end < end:
                next_pieces.append((protect_end, end))
        pieces = next_pieces
    return pieces


def complement(intervals: Sequence[Interval], duration: float) -> List[Interval]:
    kept: List[Interval] = []
    cursor = 0.0
    for start, end in merge_intervals(intervals):
        if start > cursor:
            kept.append((cursor, start))
        cursor = max(cursor, end)
    if cursor < duration:
        kept.append((cursor, duration))
    return [(start, end) for start, end in kept if end - start >= 0.04]


FREEZE_START = re.compile(r"freeze_start(?:=|:)\s*([0-9.]+)")
FREEZE_END = re.compile(r"freeze_end(?:=|:)\s*([0-9.]+)")
SILENCE_START = re.compile(r"silence_start:\s*([0-9.]+)")
SILENCE_END = re.compile(r"silence_end:\s*([0-9.]+)")


def detect_freezes(ffmpeg: str, source: Path, minimum: float, duration: float) -> List[Interval]:
    process = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-nostats",
            "-i",
            str(source),
            "-vf",
            "freezedetect=n={0}:d={1:.3f}".format(FREEZE_NOISE, minimum),
            "-an",
            "-f",
            "null",
            "-",
        ],
        text=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    if process.returncode != 0:
        raise ProofMediaError("FFmpeg freeze detection failed:\n{0}".format(process.stderr[-2000:]))
    freezes: List[Interval] = []
    active: Optional[float] = None
    for line in process.stderr.splitlines():
        start_match = FREEZE_START.search(line)
        if start_match:
            active = float(start_match.group(1))
        end_match = FREEZE_END.search(line)
        if end_match and active is not None:
            freezes.append((active, float(end_match.group(1))))
            active = None
    if active is not None:
        freezes.append((active, duration))
    return freezes


def detect_silences(ffmpeg: str, source: Path, minimum: float, duration: float) -> List[Interval]:
    process = subprocess.run(
        [
            ffmpeg, "-hide_banner", "-nostats", "-i", str(source),
            "-af", "silencedetect=n={0}:d={1:.3f}".format(SILENCE_NOISE, minimum),
            "-vn", "-f", "null", "-",
        ],
        text=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    if process.returncode != 0:
        raise ProofMediaError("FFmpeg silence detection failed:\n{0}".format(process.stderr[-2000:]))
    silences: List[Interval] = []
    active: Optional[float] = None
    for line in process.stderr.splitlines():
        start_match = SILENCE_START.search(line)
        if start_match:
            active = float(start_match.group(1))
        end_match = SILENCE_END.search(line)
        if end_match and active is not None:
            silences.append((active, float(end_match.group(1))))
            active = None
    if active is not None:
        silences.append((active, duration))
    return silences


def intersect_intervals(left: Sequence[Interval], right: Sequence[Interval]) -> List[Interval]:
    return merge_intervals(
        (max(a_start, b_start), min(a_end, b_end))
        for a_start, a_end in left
        for b_start, b_end in right
        if min(a_end, b_end) - max(a_start, b_start) > 0.001
    )


def explicit_intervals(values: Any, label: str, duration: float) -> List[Interval]:
    if values is None:
        return []
    if not isinstance(values, list):
        raise ProofMediaError("{0} must be a list".format(label))
    result: List[Interval] = []
    for index, value in enumerate(values):
        if not isinstance(value, dict):
            raise ProofMediaError("{0}[{1}] must be an object".format(label, index))
        start = number(value.get("start"), "{0}[{1}].start".format(label, index))
        end = number(value.get("end"), "{0}[{1}].end".format(label, index))
        if start < 0 or end > duration:
            raise ProofMediaError("{0}[{1}] falls outside the source".format(label, index))
        current = (start, end)
        if end - start <= 0.001:
            raise ProofMediaError("{0}[{1}] must have positive duration".format(label, index))
        result.append(current)
    return merge_intervals(result)


def protected_intervals(timeline: Dict[str, Any], duration: float) -> List[Interval]:
    protected = explicit_intervals(timeline.get("keep"), "keep", duration)
    for event in timeline["events"]:
        start = event_start(event)
        end = event_end(event)
        if event["kind"] == "tap":
            interval = (start - 0.45, end + 1.25)
        elif event["kind"] == "swipe":
            interval = (start - 0.45, end + 1.25)
        else:
            interval = (start - 0.15, end + 0.15)
        current = clamp_interval(interval, duration)
        if current:
            protected.append(current)
    return merge_intervals(protected)


def choose_cuts(
    ffmpeg: str,
    source: Path,
    timeline: Dict[str, Any],
    duration: float,
    auto_trim: bool,
    freeze_minimum: float,
    max_freeze: float,
    has_audio: bool = False,
) -> Tuple[List[Interval], List[Interval]]:
    raw_cuts = timeline.get("cuts")
    if isinstance(raw_cuts, list):
        previous_end = -1.0
        for index, cut in enumerate(raw_cuts):
            if isinstance(cut, dict):
                start = number(cut.get("start"), "cuts[{0}].start".format(index))
                if start < previous_end:
                    raise ProofMediaError("cuts must be ordered and non-overlapping")
                previous_end = number(cut.get("end"), "cuts[{0}].end".format(index))
    explicit = explicit_intervals(timeline.get("cuts"), "cuts", duration)
    if explicit:
        for index, event in enumerate(timeline["events"]):
            start = event_start(event)
            end = event_end(event)
            if not any(start >= cut_start and start < cut_end and end <= cut_end for cut_start, cut_end in explicit):
                raise ProofMediaError("events[{0}] is not fully contained in an explicit cut".format(index))
        return explicit, []
    if not auto_trim:
        return [(0.0, duration)], []
    protected = protected_intervals(timeline, duration)
    freezes = detect_freezes(ffmpeg, source, freeze_minimum, duration)
    if has_audio:
        freezes = intersect_intervals(
            freezes,
            detect_silences(ffmpeg, source, freeze_minimum, duration),
        )
    removals: List[Interval] = []
    for start, end in freezes:
        excess = (end - start) - max_freeze
        if excess <= 0:
            continue
        remove_start = start + max_freeze / 2.0
        remove_end = end - max_freeze / 2.0
        removals.extend(subtract_intervals((remove_start, remove_end), protected))
    merged_removals = merge_intervals(removals)
    return complement(merged_removals, duration), merged_removals


def map_time(source_time: float, cuts: Sequence[Interval]) -> float:
    output_cursor = 0.0
    for start, end in cuts:
        if source_time < start:
            return output_cursor
        if source_time <= end:
            return output_cursor + source_time - start
        output_cursor += end - start
    return output_cursor


def build_normalized(ffmpeg: str, source: Path, destination: Path, cuts: Sequence[Interval], has_audio: bool) -> None:
    graph: List[str] = []
    concat_inputs: List[str] = []
    for index, (start, end) in enumerate(cuts):
        graph.append("[0:v]trim=start={0:.6f}:end={1:.6f},setpts=PTS-STARTPTS[v{2}]".format(start, end, index))
        concat_inputs.append("[v{0}]".format(index))
        if has_audio:
            graph.append("[0:a]atrim=start={0:.6f}:end={1:.6f},asetpts=PTS-STARTPTS[a{2}]".format(start, end, index))
            concat_inputs.append("[a{0}]".format(index))
    graph.append("{0}concat=n={1}:v=1:a={2}[vout]{3}".format("".join(concat_inputs), len(cuts), 1 if has_audio else 0, "[aout]" if has_audio else ""))
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-filter_complex", ";".join(graph), "-map", "[vout]"]
    if has_audio:
        command.extend(["-map", "[aout]", "-c:a", "pcm_s16le", "-flags:a", "+bitexact"])
    command.extend([
        "-map_metadata", "-1", "-map_chapters", "-1", "-fflags", "+bitexact",
        "-c:v", "ffv1", "-flags:v", "+bitexact", "-pix_fmt", "yuv420p",
        str(destination),
    ])
    run(command)


def encode_clean(ffmpeg: str, source: Path, destination: Path) -> None:
    run([
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
        "-map", "0:v", "-map", "0:a?", "-c:v", "libx264", "-crf", "20",
        "-preset", "medium", "-x264-params", "keyint=30:min-keyint=30:scenecut=0",
        "-pix_fmt", "yuv420p", "-flags:v", "+bitexact",
        "-c:a", "aac", "-b:a", "160k", "-flags:a", "+bitexact",
        "-map_metadata", "-1", "-map_chapters", "-1", "-fflags", "+bitexact",
        "-movflags", "+faststart", str(destination),
    ])


def normalized_point(point: Sequence[float], width: int, height: int, coordinate_space: str) -> Tuple[int, int]:
    if coordinate_space == "normalized":
        x = int(round(float(point[0]) * (width - 1)))
        y = int(round(float(point[1]) * (height - 1)))
    else:
        x = int(round(float(point[0])))
        y = int(round(float(point[1])))
    if x < 0 or x >= width or y < 0 or y >= height:
        raise ProofMediaError("Event coordinate falls outside the captured content")
    return (x, y)


def magick_color(hex_color: str, alpha: float) -> str:
    return "{0}{1:02X}".format(hex_color, int(round(alpha * 255)))


def make_tap_sprites(magick: str, directory: Path, base: int) -> List[Path]:
    size = max(64, int(round(base * 2.4)))
    center = size // 2
    sprites: List[Path] = []
    for index, scale in enumerate((0.55, 0.82, 1.0, 0.74)):
        radius = max(10, int(round(base * scale)))
        path = directory / "tap-{0}.png".format(index)
        run(
            [
                magick,
                "-size",
                "{0}x{0}".format(size),
                "xc:none",
                "-fill",
                magick_color("#00D4FF", 0.18),
                "-stroke",
                magick_color("#FFFFFF", 0.95),
                "-strokewidth",
                str(max(4, base // 7)),
                "-draw",
                "circle {0},{0} {1},{0}".format(center, center + radius),
                str(path),
            ]
        )
        sprites.append(path)
    return sprites


def make_swipe_sprites(
    magick: str,
    directory: Path,
    start: Tuple[int, int],
    end: Tuple[int, int],
    base: int,
) -> Tuple[List[Path], int, int]:
    margin = base * 2
    left = max(0, min(start[0], end[0]) - margin)
    top = max(0, min(start[1], end[1]) - margin)
    local_start = (start[0] - left, start[1] - top)
    local_end = (end[0] - left, end[1] - top)
    width = abs(end[0] - start[0]) + margin * 2 + 1
    height = abs(end[1] - start[1]) + margin * 2 + 1
    angle = math.atan2(local_end[1] - local_start[1], local_end[0] - local_start[0])
    head = max(16, base)
    wing_one = (local_end[0] - head * math.cos(angle - math.pi / 6), local_end[1] - head * math.sin(angle - math.pi / 6))
    wing_two = (local_end[0] - head * math.cos(angle + math.pi / 6), local_end[1] - head * math.sin(angle + math.pi / 6))
    sprites: List[Path] = []
    phases = 6
    prefix = len(list(directory.glob("swipe-*.png")))
    for index in range(phases):
        fraction = index / float(phases - 1)
        dot_x = local_start[0] + (local_end[0] - local_start[0]) * fraction
        dot_y = local_start[1] + (local_end[1] - local_start[1]) * fraction
        path = directory / "swipe-{0}-{1}.png".format(prefix, index)
        draw = "line {0},{1} {2},{3} line {2},{3} {4:.1f},{5:.1f} line {2},{3} {6:.1f},{7:.1f} circle {8:.1f},{9:.1f} {10:.1f},{9:.1f}".format(
            local_start[0], local_start[1], local_end[0], local_end[1], wing_one[0], wing_one[1], wing_two[0], wing_two[1], dot_x, dot_y, dot_x + max(9, base // 2)
        )
        run(
            [
                magick,
                "-size",
                "{0}x{1}".format(width, height),
                "xc:none",
                "-fill",
                magick_color("#00D4FF", 0.88),
                "-stroke",
                magick_color("#FFFFFF", 0.92),
                "-strokewidth",
                str(max(4, base // 6)),
                "-draw",
                draw,
                str(path),
            ]
        )
        sprites.append(path)
    return sprites, left, top


def caption_text(event: Dict[str, Any]) -> Optional[str]:
    exact = event.get("caption")
    if exact:
        return str(exact)
    label = event.get("label")
    expect = event.get("expect")
    if not label and not expect:
        return None
    if event["kind"] == "tap":
        action = "Next: tap {0}".format(label or "the highlighted control")
    elif event["kind"] == "swipe":
        action = "Next: swipe {0}".format(label or "along the highlighted path")
    else:
        action = str(label or "")
    return "{0}\nExpected: {1}".format(action, expect) if expect else action


def validate_caption_text(text: str) -> None:
    if text.lstrip().startswith("@"):
        raise ProofMediaError("Caption must not start with @")


def make_caption_card(
    magick: str,
    font: str,
    directory: Path,
    index: int,
    text: str,
    width: int,
    height: int,
    position: str = "bottom",
) -> Tuple[Path, int, int]:
    card_width = int(round(width * 0.9))
    point_size = max(22, int(round(min(width, height) * 0.033)))
    text_width = card_width - point_size * 2
    validate_caption_text(text)
    text_path = directory / "caption-text-{0}.png".format(index)
    run(
        [
            magick,
            "-background",
            "none",
            "-fill",
            "white",
            "-font",
            font,
            "-pointsize",
            str(point_size),
            "-size",
            "{0}x".format(text_width),
            "caption:{0}".format(text.replace("%", "%%")),
            "-strip",
            str(text_path),
        ]
    )
    _, text_height = probe_image(magick, text_path)
    line_limit_path = directory / "caption-limit-{0}.png".format(index)
    run(
        [
            magick,
            "-background",
            "none",
            "-fill",
            "white",
            "-font",
            font,
            "-pointsize",
            str(point_size),
            "-size",
            "{0}x".format(text_width),
            "caption:Ag\nAg\nAg",
            "-strip",
            str(line_limit_path),
        ]
    )
    _, maximum_text_height = probe_image(magick, line_limit_path)
    if text_height > maximum_text_height:
        raise ProofMediaError(
            "Caption exceeds three rendered lines; shorten the action or expected result"
        )
    card_height = text_height + point_size * 2
    path = directory / "caption-{0}.png".format(index)
    radius = max(16, point_size // 2)
    run(
        [
            magick,
            "-size",
            "{0}x{1}".format(card_width, card_height),
            "xc:none",
            "-fill",
            magick_color("#111827", 0.88),
            "-stroke",
            magick_color("#FFFFFF", 0.22),
            "-strokewidth",
            "2",
            "-draw",
            "roundrectangle 1,1 {0},{1} {2},{2}".format(card_width - 2, card_height - 2, radius),
            str(text_path),
            "-gravity",
            "center",
            "-composite",
            "-strip",
            str(path),
        ]
    )
    if position == "top":
        y = max(12, int(height * 0.04))
    else:
        y = max(12, height - card_height - int(height * 0.04))
    return path, (width - card_width) // 2, y


def build_annotations(
    ffmpeg: str,
    magick: str,
    font: str,
    clean: Path,
    destination: Path,
    timeline: Dict[str, Any],
    cuts: Sequence[Interval],
    width: int,
    height: int,
    duration: float,
    work: Path,
) -> List[Dict[str, Any]]:
    overlays: List[Tuple[Path, int, int, float, float]] = []
    mapped: List[Dict[str, Any]] = []
    base = max(24, int(round(min(width, height) * 0.035)))
    tap_sprites = make_tap_sprites(magick, work, base)
    for index, event in enumerate(timeline["events"]):
        source_at = event_start(event)
        output_at = map_time(source_at, cuts)
        output_end = map_time(event_end(event), cuts)
        mapped_event: Dict[str, Any] = {
            "index": index,
            "kind": event["kind"],
            "source_at": source_at,
            "output_at": output_at,
        }
        if event.get("action_id") is not None:
            mapped_event["action_id"] = event["action_id"]
        if event["kind"] == "tap":
            x, y = normalized_point((float(event["x"]), float(event["y"])), width, height, timeline["coordinate_space"])
            sprite_size = int(run([magick, "identify", "-format", "%w", str(tap_sprites[0])], capture=True).stdout)
            for phase, sprite in enumerate(tap_sprites):
                start = max(0.0, output_at - 0.08 + phase * 0.105)
                overlays.append((sprite, x - sprite_size // 2, y - sprite_size // 2, start, start + 0.13))
            mapped_event["point"] = [x, y]
        elif event["kind"] == "swipe":
            start_point = normalized_point(event["from"], width, height, timeline["coordinate_space"])
            end_point = normalized_point(event["to"], width, height, timeline["coordinate_space"])
            sprites, left, top = make_swipe_sprites(magick, work, start_point, end_point, base)
            gesture_duration = max(0.2, output_end - output_at)
            phase_duration = gesture_duration / len(sprites)
            for phase, sprite in enumerate(sprites):
                start = output_at + phase * phase_duration
                overlays.append((sprite, left, top, start, start + phase_duration + 0.02))
            mapped_event["from"] = list(start_point)
            mapped_event["to"] = list(end_point)
            mapped_event["output_end"] = output_end
        caption = caption_text(event)
        if caption:
            source_caption_start = float(event.get("caption_start", source_at - (0.35 if event["kind"] != "caption" else 0.0)))
            source_caption_end = float(event.get("caption_end", max(event_end(event) + 1.1, source_caption_start + 1.25)))
            caption_start = max(0.0, map_time(source_caption_start, cuts))
            caption_end = min(duration, map_time(source_caption_end, cuts))
            if caption_end - caption_start < 0.4:
                caption_end = min(duration, caption_start + 0.4)
            card, x, y = make_caption_card(
                magick,
                font,
                work,
                index,
                caption,
                width,
                height,
                str(event.get("caption_position", "bottom")),
            )
            overlays.append((card, x, y, caption_start, caption_end))
            mapped_event["caption"] = caption
            mapped_event["caption_output"] = [caption_start, caption_end]
        mapped.append(mapped_event)

    if not overlays:
        encode_clean(ffmpeg, clean, destination)
        return mapped

    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(clean)]
    for image, _, _, _, _ in overlays:
        command.extend(["-loop", "1", "-framerate", "30", "-i", str(image)])
    graph: List[str] = []
    previous = "[0:v]"
    for index, (_, x, y, start, end) in enumerate(overlays, start=1):
        output = "[ov{0}]".format(index)
        graph.append(
            "{0}[{1}:v]overlay=x={2}:y={3}:enable='between(t,{4:.6f},{5:.6f})'{6}".format(previous, index, x, y, start, end, output)
        )
        previous = output
    command.extend(
        [
            "-filter_complex",
            ";".join(graph),
            "-map",
            previous,
            "-map",
            "0:a?",
            "-t",
            "{0:.6f}".format(duration),
            "-c:v",
            "libx264",
            "-crf",
            "20",
            "-preset",
            "medium",
            "-x264-params",
            "keyint=30:min-keyint=30:scenecut=0",
            "-pix_fmt",
            "yuv420p",
            "-flags:v",
            "+bitexact",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-flags:a",
            "+bitexact",
            "-map_metadata",
            "-1",
            "-map_chapters",
            "-1",
            "-fflags",
            "+bitexact",
            "-movflags",
            "+faststart",
            str(destination),
        ]
    )
    run(command)
    return mapped


def extract_frame(ffmpeg: str, source: Path, timestamp: float, destination: Path) -> None:
    run([
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-ss", "{0:.6f}".format(timestamp), "-i", str(source),
        "-frames:v", "1", "-map_metadata", "-1", "-fflags", "+bitexact",
        "-flags:v", "+bitexact", str(destination),
    ])


def build_contact_sheet(ffmpeg: str, magick: str, font: str, source: Path, duration: float, destination: Path, work: Path) -> None:
    frames: List[Path] = []
    count = 6
    for index in range(count):
        timestamp = duration * (index + 1) / float(count + 1)
        frame = work / "sheet-{0}.png".format(index)
        extract_frame(ffmpeg, source, timestamp, frame)
        frames.append(frame)
    run(
        [magick, "montage"]
        + [str(frame) for frame in frames]
        + ["-font", font, "-thumbnail", "480x480>", "-tile", "3x2", "-geometry", "+8+8", "-background", "#111827", "-strip", str(destination)]
    )


def artifact_record(ffprobe: str, path: Path) -> Dict[str, Any]:
    record: Dict[str, Any] = {"path": str(path.resolve()), "bytes": path.stat().st_size, "sha256": sha256(path)}
    if path.suffix.lower() == ".mp4":
        info = probe_video(ffprobe, path)
        record.update(
            {
                "duration": info["duration"],
                "width": info["width"],
                "height": info["height"],
                "frame_rate": info["frame_rate"],
                "frame_count": info["frame_count"],
                "has_audio": info["has_audio"],
            }
        )
    return record


def staged_artifact_record(ffprobe: str, staged: Path, final: Path) -> Dict[str, Any]:
    record = artifact_record(ffprobe, staged)
    record["path"] = str(final.resolve())
    return record


def build_image_annotations(
    magick: str,
    font: str,
    clean: Path,
    annotated: Path,
    timeline: Dict[str, Any],
    event_index: Optional[int],
    width: int,
    height: int,
    work: Path,
) -> Optional[Dict[str, Any]]:
    events = timeline["events"]
    if not events:
        if event_index is not None:
            raise ProofMediaError("--event must identify an existing timeline event")
        shutil.copy2(clean, annotated)
        return None
    selected_index = len(events) - 1 if event_index is None else event_index
    if selected_index < 0 or selected_index >= len(events):
        raise ProofMediaError("--event must identify an existing timeline event")
    event = events[selected_index]
    overlays: List[Tuple[Path, int, int]] = []
    base = max(24, int(round(min(width, height) * 0.035)))
    mapped: Dict[str, Any] = {"index": selected_index, "kind": event["kind"]}
    if event.get("action_id") is not None:
        mapped["action_id"] = event["action_id"]
    if event["kind"] == "tap":
        x, y = normalized_point((float(event["x"]), float(event["y"])), width, height, timeline["coordinate_space"])
        sprite = make_tap_sprites(magick, work, base)[2]
        sprite_width, sprite_height = probe_image(magick, sprite)
        overlays.append((sprite, x - sprite_width // 2, y - sprite_height // 2))
        mapped["point"] = [x, y]
    elif event["kind"] == "swipe":
        start_point = normalized_point(event["from"], width, height, timeline["coordinate_space"])
        end_point = normalized_point(event["to"], width, height, timeline["coordinate_space"])
        sprites, left, top = make_swipe_sprites(magick, work, start_point, end_point, base)
        overlays.append((sprites[len(sprites) // 2], left, top))
        mapped["from"] = list(start_point)
        mapped["to"] = list(end_point)
    caption = caption_text(event)
    if caption:
        card, x, y = make_caption_card(
            magick,
            font,
            work,
            selected_index,
            caption,
            width,
            height,
            str(event.get("caption_position", "bottom")),
        )
        overlays.append((card, x, y))
        mapped["caption"] = caption
    if not overlays:
        shutil.copy2(clean, annotated)
        return mapped
    command = [magick, str(clean)]
    for overlay, x, y in overlays:
        geometry = "{0:+d}{1:+d}".format(x, y)
        command.extend([str(overlay), "-geometry", geometry, "-composite"])
    command.extend(["-strip", str(annotated)])
    run(command)
    return mapped


def verify_pair(ffprobe: str, clean: Path, annotated: Path) -> None:
    clean_info = probe_video(ffprobe, clean)
    annotated_info = probe_video(ffprobe, annotated)
    for field in ("width", "height", "frame_rate", "has_audio"):
        if clean_info[field] != annotated_info[field]:
            raise ProofMediaError("Clean and annotated outputs differ in {0}".format(field))
    if clean_info["frame_count"] != annotated_info["frame_count"]:
        raise ProofMediaError("Clean and annotated outputs differ in frame count")
    frame_duration = 1.0 / 24.0
    if abs(clean_info["duration"] - annotated_info["duration"]) > frame_duration:
        raise ProofMediaError("Clean and annotated outputs differ in duration")


def verified_attested_file(record: Any, label: str) -> Tuple[Path, Dict[str, Any]]:
    if not isinstance(record, dict):
        raise ProofMediaError("{0} has no artifact record".format(label))
    path_value = record.get("path")
    digest = record.get("sha256")
    size = record.get("bytes")
    if not isinstance(path_value, str) or not path_value:
        raise ProofMediaError("{0}.path is required".format(label))
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ProofMediaError("{0}.sha256 is invalid".format(label))
    if type(size) is not int or size < 1:
        raise ProofMediaError("{0}.bytes is invalid".format(label))
    path = Path(path_value).expanduser()
    if path.is_symlink() or not path.is_file():
        raise ProofMediaError("{0} is not a regular file".format(label))
    actual_size = path.stat().st_size
    actual_digest = sha256(path)
    if actual_size != size:
        raise ProofMediaError("{0}.bytes does not match its file".format(label))
    if actual_digest != digest:
        raise ProofMediaError("{0}.sha256 does not match its file".format(label))
    return path, {
        "path": str(path.resolve()),
        "bytes": actual_size,
        "sha256": actual_digest,
    }


def decoded_audio_hash(ffmpeg: str, source: Path) -> str:
    result = run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-map",
            "0:a:0",
            "-f",
            "hash",
            "-hash",
            "sha256",
            "-",
        ],
        capture=True,
    )
    match = re.search(r"SHA256=([0-9a-fA-F]{64})", result.stdout)
    if match is None:
        raise ProofMediaError("Could not hash decoded audio: {0}".format(source))
    return match.group(1).lower()


def video_ssim(ffmpeg: str, clean: Path, annotated: Path) -> float:
    result = run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "info",
            "-i",
            str(clean),
            "-i",
            str(annotated),
            "-filter_complex",
            "[0:v:0][1:v:0]ssim",
            "-an",
            "-f",
            "null",
            "-",
        ],
        capture=True,
    )
    matches = re.findall(r"All:([0-9.]+)", result.stderr)
    if not matches:
        raise ProofMediaError("Could not calculate clean/annotated video similarity")
    return float(matches[-1])


def verify_video_record_metadata(
    record: Dict[str, Any], actual: Dict[str, Any], label: str
) -> None:
    for field in ("width", "height", "frame_rate", "frame_count", "has_audio"):
        if record.get(field) != actual[field]:
            raise ProofMediaError(
                "{0}.{1} does not match its file".format(label, field)
            )
    recorded_duration = number(record.get("duration"), "{0}.duration".format(label))
    if abs(recorded_duration - actual["duration"]) > 0.001:
        raise ProofMediaError("{0}.duration does not match its file".format(label))


def compile_secret_patterns(values: Sequence[str]) -> Tuple[re.Pattern[str], ...]:
    try:
        return tuple(re.compile(pattern) for pattern in values)
    except re.error as exc:
        raise ProofMediaError("Invalid --deny-secret-pattern: {0}".format(exc)) from exc


def validate_history_actions(
    history: Dict[str, Any], expected_ids: Sequence[str], extra_patterns: Sequence[str]
) -> None:
    if history.get("schemaVersion") != 1 or not isinstance(history.get("events"), list):
        raise ProofMediaError(
            "App-flow history must use schemaVersion 1 with an events list"
        )
    patterns = compile_secret_patterns(extra_patterns)
    action_ids: List[str] = []
    assertions: List[Dict[str, Any]] = []
    for index, event in enumerate(history["events"]):
        if not isinstance(event, dict):
            raise ProofMediaError("App-flow events[{0}] must be an object".format(index))
        if event.get("phase") == "act":
            action_id = event.get("id")
            if not isinstance(action_id, str) or not action_id:
                raise ProofMediaError("App-flow act events require a non-empty id")
            for field in ("selector", "action", "postcondition"):
                if not isinstance(event.get(field), str) or not event[field].strip():
                    raise ProofMediaError(
                        "App-flow act event {0} requires {1}".format(action_id, field)
                    )
            action_ids.append(action_id)
            reject_secrets(
                {
                    "label": event.get("selector"),
                    "caption": event.get("action"),
                    "expect": event.get("postcondition"),
                },
                index,
                patterns,
            )
        elif event.get("phase") == "assert":
            assertions.append(event)
            reject_secrets(
                {"expect": event.get("observation")}, index, patterns
            )
    if len(action_ids) != len(set(action_ids)):
        raise ProofMediaError("App-flow history has duplicate action ids")
    if sorted(action_ids) != sorted(expected_ids):
        raise ProofMediaError("App-flow history actions do not match the proof timeline")
    for action_id in action_ids:
        if not any(
            assertion.get("result") == "passed"
            and assertion.get("actionid", assertion.get("action_id")) == action_id
            for assertion in assertions
        ):
            raise ProofMediaError(
                "App-flow action has no passed assertion: {0}".format(action_id)
            )


def validate_packet_action_ledger(
    timeline: Dict[str, Any],
    packet: Dict[str, Any],
    width: int,
    height: int,
    output_duration: float,
) -> List[Dict[str, Any]]:
    packet_events = packet.get("events")
    timeline_events = timeline["events"]
    if not isinstance(packet_events, list) or len(packet_events) != len(timeline_events):
        raise ProofMediaError("Proof receipt does not map every timeline event")
    action_ids: List[str] = []
    actions: List[Dict[str, Any]] = []
    for index, (event, mapped) in enumerate(zip(timeline_events, packet_events)):
        if not isinstance(mapped, dict):
            raise ProofMediaError("Proof receipt events[{0}] is invalid".format(index))
        if mapped.get("index") != index or mapped.get("kind") != event["kind"]:
            raise ProofMediaError("Proof receipt event order does not match the timeline")
        source_at = number(
            mapped.get("source_at"), "proof receipt events[{0}].source_at".format(index)
        )
        if abs(source_at - event_start(event)) > 0.000001:
            raise ProofMediaError("Proof receipt event time does not match the timeline")
        output_at = number(
            mapped.get("output_at"), "proof receipt events[{0}].output_at".format(index)
        )
        if output_at < 0 or output_at > output_duration:
            raise ProofMediaError("Proof receipt event output time is outside the video")
        expected_caption = caption_text(event)
        if mapped.get("caption") != expected_caption:
            raise ProofMediaError("Proof receipt caption does not match the timeline")
        if event["kind"] not in ("tap", "swipe"):
            continue
        action_id = event.get("action_id")
        if not isinstance(action_id, str) or not action_id:
            raise ProofMediaError("Every tap and swipe requires action_id")
        if mapped.get("action_id") != action_id:
            raise ProofMediaError("Proof receipt has an unmapped action id")
        action_ids.append(action_id)
        expected_result = event.get("expect")
        if not isinstance(expected_result, str) or not expected_result.strip():
            raise ProofMediaError(
                "Every tap and swipe requires an expected result: {0}".format(action_id)
            )
        if not isinstance(expected_caption, str) or "Expected:" not in expected_caption:
            raise ProofMediaError(
                "Every tap and swipe requires an Expected: caption: {0}".format(action_id)
            )
        caption_output = mapped.get("caption_output")
        if (
            not isinstance(caption_output, list)
            or len(caption_output) != 2
            or any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in caption_output)
            or caption_output[0] < 0
            or caption_output[1] <= caption_output[0]
            or caption_output[1] > output_duration
        ):
            raise ProofMediaError(
                "Proof receipt has no expected-result caption interval: {0}".format(
                    action_id
                )
            )
        action_record: Dict[str, Any] = {
            "action_id": action_id,
            "kind": event["kind"],
            "source_at": source_at,
            "output_at": output_at,
            "expect": expected_result,
            "caption_sha256": hashlib.sha256(
                expected_caption.encode("utf-8")
            ).hexdigest(),
        }
        if event["kind"] == "tap":
            expected_point = list(
                normalized_point(
                    (float(event["x"]), float(event["y"])),
                    width,
                    height,
                    timeline["coordinate_space"],
                )
            )
            if mapped.get("point") != expected_point:
                raise ProofMediaError("Proof receipt tap point does not match the timeline")
            action_record["point"] = expected_point
        else:
            expected_from = list(
                normalized_point(
                    event["from"], width, height, timeline["coordinate_space"]
                )
            )
            expected_to = list(
                normalized_point(
                    event["to"], width, height, timeline["coordinate_space"]
                )
            )
            if mapped.get("from") != expected_from or mapped.get("to") != expected_to:
                raise ProofMediaError("Proof receipt swipe path does not match the timeline")
            action_record.update({"from": expected_from, "to": expected_to})
        actions.append(action_record)
    if not action_ids:
        raise ProofMediaError("Proof timeline contains no tap or swipe actions")
    if len(action_ids) != len(set(action_ids)):
        raise ProofMediaError("Proof timeline has duplicate action ids")
    if sorted(action_ids) != sorted(
        mapped.get("action_id")
        for mapped in packet_events
        if mapped.get("kind") in ("tap", "swipe")
    ):
        raise ProofMediaError("Proof receipt has missing or duplicate mapped actions")
    return actions


def atomic_write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(".{0}.tmp".format(path.name))
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def read_json_object(path: Path, label: str) -> Dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ProofMediaError(
            "Could not read {0} {1}: {2}".format(label, path, exc)
        ) from exc
    if not isinstance(payload, dict):
        raise ProofMediaError("{0} must contain a JSON object".format(label))
    return payload


def parse_aware_datetime(value: Any, label: str) -> datetime:
    if not isinstance(value, str):
        raise ProofMediaError("{0} must be an ISO 8601 timestamp".format(label))
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ProofMediaError("{0} must be an ISO 8601 timestamp".format(label)) from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ProofMediaError("{0} must include a timezone".format(label))
    return parsed


def readable_semantic_text(value: Any, fallback: str) -> str:
    if not isinstance(value, str) or not value.strip():
        return fallback
    return re.sub(r"[-_]+", " ", value).strip()


def convert_app_flow_timeline(
    history: Dict[str, Any], action_map: Dict[str, Any]
) -> Dict[str, Any]:
    if history.get("schemaVersion") != 1 or not isinstance(
        history.get("events"), list
    ):
        raise ProofMediaError(
            "App-flow history must use schemaVersion 1 with an events list"
        )
    if action_map.get("version") != 1 or not isinstance(
        action_map.get("actions"), list
    ):
        raise ProofMediaError(
            "App-flow action map must use version 1 with an actions list"
        )

    actions: List[Dict[str, Any]] = []
    action_ids = set()
    assertions: List[Dict[str, Any]] = []
    for index, raw_event in enumerate(history["events"]):
        if not isinstance(raw_event, dict):
            raise ProofMediaError("App-flow events[{0}] must be an object".format(index))
        if raw_event.get("phase") == "act":
            action_id = raw_event.get("id")
            if not isinstance(action_id, str) or not action_id:
                raise ProofMediaError("App-flow act events require a non-empty id")
            if action_id in action_ids:
                raise ProofMediaError("Duplicate app-flow action id: {0}".format(action_id))
            action_ids.add(action_id)
            actions.append(raw_event)
        elif raw_event.get("phase") == "assert":
            assertions.append(raw_event)
    if not actions:
        raise ProofMediaError("App-flow history contains no act events")

    mappings: Dict[str, Dict[str, Any]] = {}
    for index, raw_mapping in enumerate(action_map["actions"]):
        if not isinstance(raw_mapping, dict):
            raise ProofMediaError(
                "App-flow action map actions[{0}] must be an object".format(index)
            )
        action_id = raw_mapping.get("action_id")
        if not isinstance(action_id, str) or not action_id:
            raise ProofMediaError("App-flow action mappings require action_id")
        if action_id in mappings:
            raise ProofMediaError("Duplicate mapped action id: {0}".format(action_id))
        mappings[action_id] = raw_mapping
    missing = sorted(action_ids - set(mappings))
    unknown = sorted(set(mappings) - action_ids)
    if missing:
        raise ProofMediaError(
            "Missing visual mapping for app-flow actions: {0}".format(", ".join(missing))
        )
    if unknown:
        raise ProofMediaError(
            "Visual mapping names unknown app-flow actions: {0}".format(
                ", ".join(unknown)
            )
        )

    recording_start: Optional[datetime] = None
    if action_map.get("recording_started_at") is not None:
        recording_start = parse_aware_datetime(
            action_map["recording_started_at"], "recording_started_at"
        )
    events: List[Dict[str, Any]] = []
    for action in actions:
        action_id = action["id"]
        mapping = mappings[action_id]
        passed = any(
            assertion.get("result") == "passed"
            and assertion.get("actionid", assertion.get("action_id")) == action_id
            for assertion in assertions
        )
        if not passed:
            raise ProofMediaError(
                "App-flow action has no passed assertion: {0}".format(action_id)
            )

        if "at" in mapping:
            at = number(mapping["at"], "mapping for {0}.at".format(action_id))
        else:
            if recording_start is None:
                raise ProofMediaError(
                    "recording_started_at is required when a mapped action has no at value"
                )
            event_time = parse_aware_datetime(
                action.get("at"), "App-flow action {0}.at".format(action_id)
            )
            at = round((event_time - recording_start).total_seconds(), 6)
        if at < 0:
            raise ProofMediaError(
                "App-flow action occurs before the recording: {0}".format(action_id)
            )

        semantic_action = str(action.get("action", "")).lower()
        inferred_kind = (
            "swipe"
            if "swipe" in semantic_action
            else "tap"
            if semantic_action in ("tap", "press")
            else None
        )
        kind = mapping.get("kind", inferred_kind)
        if kind not in ("tap", "swipe"):
            raise ProofMediaError(
                "Mapping for {0} must set kind to tap or swipe".format(action_id)
            )
        if inferred_kind is not None and kind != inferred_kind:
            raise ProofMediaError(
                "Mapping kind for {0} conflicts with semantic action {1}".format(
                    action_id, action.get("action")
                )
            )
        event: Dict[str, Any] = {
            "action_id": action_id,
            "kind": kind,
            "at": at,
            "label": mapping.get(
                "label", readable_semantic_text(action.get("selector"), action_id)
            ),
            "expect": mapping.get(
                "expect",
                readable_semantic_text(action.get("postcondition"), "Visible result"),
            ),
        }
        if kind == "tap":
            point = mapping.get("point")
            if not isinstance(point, list) or len(point) != 2:
                raise ProofMediaError(
                    "Tap mapping for {0} requires point [x, y]".format(action_id)
                )
            event.update({"x": point[0], "y": point[1]})
        else:
            event["from"] = mapping.get("from")
            event["to"] = mapping.get("to")
            event["duration"] = mapping.get("duration", 0.6)
        for field in ("caption", "caption_position"):
            if field in mapping:
                event[field] = mapping[field]
        validate_event(event, len(events), float("inf"), "normalized")
        reject_secrets(event, len(events))
        events.append(event)

    timeline: Dict[str, Any] = {
        "version": 1,
        "coordinate_space": "normalized",
        "events": sorted(events, key=event_start),
    }
    if action_map.get("title") is not None:
        if not isinstance(action_map["title"], str):
            raise ProofMediaError("App-flow action map title must be a string")
        timeline["title"] = action_map["title"]
    elif isinstance(history.get("plan"), str):
        timeline["title"] = "App-flow {0} proof".format(history["plan"])
    return timeline


def timeline_from_app_flow(args: argparse.Namespace) -> None:
    history_path = Path(args.history).resolve()
    action_map_path = Path(args.action_map).resolve()
    output_path = Path(args.output).resolve()
    if not history_path.is_file():
        raise ProofMediaError("App-flow history does not exist: {0}".format(history_path))
    if not action_map_path.is_file():
        raise ProofMediaError(
            "App-flow action map does not exist: {0}".format(action_map_path)
        )
    if output_path.exists() and not args.overwrite:
        raise ProofMediaError("Timeline exists; pass --overwrite to replace it")
    validate_packet_paths((history_path, action_map_path), (output_path,))
    history_hash = sha256(history_path)
    action_map_hash = sha256(action_map_path)
    timeline = convert_app_flow_timeline(
        read_json_object(history_path, "app-flow history"),
        read_json_object(action_map_path, "app-flow action map"),
    )
    if (
        sha256(history_path) != history_hash
        or sha256(action_map_path) != action_map_hash
    ):
        raise ProofMediaError("App-flow inputs changed while they were being read")
    timeline["source_history"] = {
        "kind": "app-flow-agent-session",
        "name": history_path.name,
        "sha256": history_hash,
    }
    timeline["action_map"] = {
        "name": action_map_path.name,
        "sha256": action_map_hash,
    }
    atomic_write_json(output_path, timeline)
    print(str(output_path))


def validation_seal(payload: Dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )
    return hashlib.sha256(canonical).hexdigest()


def validate_packet(args: argparse.Namespace) -> None:
    tools = require_tools()
    receipt_path = Path(args.receipt).resolve()
    timeline_path = Path(args.timeline).resolve()
    output_path = Path(args.output).resolve()
    history_path = Path(args.history).resolve() if args.history else None
    for path, label in (
        (receipt_path, "Proof edit receipt"),
        (timeline_path, "Proof timeline"),
    ):
        if path.is_symlink() or not path.is_file():
            raise ProofMediaError("{0} is not a regular file: {1}".format(label, path))
    if history_path is not None and (
        history_path.is_symlink() or not history_path.is_file()
    ):
        raise ProofMediaError(
            "App-flow history is not a regular file: {0}".format(history_path)
        )
    if output_path.exists() and not args.overwrite:
        raise ProofMediaError("Validation receipt exists; pass --overwrite to replace it")
    input_paths = [receipt_path, timeline_path]
    if history_path is not None:
        input_paths.append(history_path)
    validate_packet_paths(input_paths, (output_path,))
    input_hashes = {path: sha256(path) for path in input_paths}

    packet = read_json_object(receipt_path, "proof edit receipt")
    if packet.get("version") != 1 or not isinstance(packet.get("artifacts"), dict):
        raise ProofMediaError("Proof edit receipt must use version 1 with artifacts")
    edit = packet.get("edit")
    if not isinstance(edit, dict):
        raise ProofMediaError("Proof edit receipt has no video edit record")
    source_duration = number(edit.get("source_duration"), "edit.source_duration")
    timeline = load_timeline(
        timeline_path, source_duration, args.deny_secret_pattern
    )
    timeline_record = packet.get("timeline")
    if not isinstance(timeline_record, dict):
        raise ProofMediaError("Proof edit receipt has no timeline record")
    if timeline_record.get("sha256") != input_hashes[timeline_path]:
        raise ProofMediaError("Proof edit receipt does not bind the supplied timeline")

    source_path, source_record = verified_attested_file(
        packet.get("source"), "source"
    )
    artifacts: Dict[str, Dict[str, Any]] = {}
    artifact_paths: Dict[str, Path] = {}
    for name, record in packet["artifacts"].items():
        artifact_path, verified = verified_attested_file(record, "artifacts.{0}".format(name))
        artifact_paths[name] = artifact_path
        artifacts[name] = verified
    if "clean_video" not in artifacts or "annotated_video" not in artifacts:
        raise ProofMediaError("Proof packet requires clean_video and annotated_video")
    clean = artifact_paths["clean_video"]
    annotated = artifact_paths["annotated_video"]
    if artifacts["clean_video"]["sha256"] == artifacts["annotated_video"]["sha256"]:
        raise ProofMediaError("Clean and annotated videos must not be identical")

    verify_pair(tools["ffprobe"], clean, annotated)
    clean_info = probe_video(tools["ffprobe"], clean)
    annotated_info = probe_video(tools["ffprobe"], annotated)
    verify_video_record_metadata(
        packet["artifacts"]["clean_video"], clean_info, "artifacts.clean_video"
    )
    verify_video_record_metadata(
        packet["artifacts"]["annotated_video"],
        annotated_info,
        "artifacts.annotated_video",
    )
    similarity = video_ssim(tools["ffmpeg"], clean, annotated)
    minimum_ssim = number(args.minimum_ssim, "--minimum-ssim")
    if minimum_ssim < 0.75 or minimum_ssim > 1:
        raise ProofMediaError("--minimum-ssim must be between 0.75 and 1")
    if similarity < minimum_ssim:
        raise ProofMediaError(
            "Clean and annotated videos are not content-paired: SSIM {0:.6f} < {1:.6f}".format(
                similarity, minimum_ssim
            )
        )
    clean_audio_hash: Optional[str] = None
    if clean_info["has_audio"]:
        clean_audio_hash = decoded_audio_hash(tools["ffmpeg"], clean)
        annotated_audio_hash = decoded_audio_hash(tools["ffmpeg"], annotated)
        if clean_audio_hash != annotated_audio_hash:
            raise ProofMediaError("Clean and annotated decoded audio does not match")

    actions = validate_packet_action_ledger(
        timeline,
        packet,
        clean_info["width"],
        clean_info["height"],
        clean_info["duration"],
    )
    source_history = timeline.get("source_history")
    ledger: Dict[str, Any]
    if source_history is not None:
        if history_path is None:
            raise ProofMediaError(
                "This timeline requires its bound app-flow history via --history"
            )
        if (
            not isinstance(source_history, dict)
            or source_history.get("kind") != "app-flow-agent-session"
            or source_history.get("sha256") != input_hashes[history_path]
        ):
            raise ProofMediaError("Timeline does not bind the supplied app-flow history")
        validate_history_actions(
            read_json_object(history_path, "app-flow history"),
            [action["action_id"] for action in actions],
            args.deny_secret_pattern,
        )
        ledger = {
            "kind": "app-flow-agent-session",
            "path": str(history_path),
            "sha256": input_hashes[history_path],
        }
    else:
        if history_path is not None:
            raise ProofMediaError("Timeline does not declare an app-flow source history")
        ledger = {
            "kind": "proof-timeline",
            "path": str(timeline_path),
            "sha256": input_hashes[timeline_path],
        }

    for path, digest in input_hashes.items():
        if sha256(path) != digest:
            raise ProofMediaError("Validation input changed during verification: {0}".format(path))
    for name, path in artifact_paths.items():
        if sha256(path) != artifacts[name]["sha256"]:
            raise ProofMediaError("Proof artifact changed during verification: {0}".format(name))
    if sha256(source_path) != source_record["sha256"]:
        raise ProofMediaError("Raw source changed during verification")

    receipt: Dict[str, Any] = {
        "version": 1,
        "kind": "proof-packet-validation",
        "verdict": "passed",
        "packet_receipt": {
            "path": str(receipt_path),
            "sha256": input_hashes[receipt_path],
        },
        "timeline": {
            "path": str(timeline_path),
            "sha256": input_hashes[timeline_path],
        },
        "ledger": ledger,
        "source": source_record,
        "artifacts": artifacts,
        "actions": actions,
        "actionCount": len(actions),
        "pairing": {
            "width": clean_info["width"],
            "height": clean_info["height"],
            "frameRate": clean_info["frame_rate"],
            "frameCount": clean_info["frame_count"],
            "cleanDuration": clean_info["duration"],
            "annotatedDuration": annotated_info["duration"],
            "durationDelta": abs(clean_info["duration"] - annotated_info["duration"]),
            "videoSsim": similarity,
            "minimumVideoSsim": minimum_ssim,
            "decodedAudioSha256": clean_audio_hash,
        },
        "tools": {
            "ffmpeg": tool_version(tools["ffmpeg"]),
            "ffprobe": tool_version(tools["ffprobe"]),
        },
    }
    receipt["seal"] = {
        "algorithm": "sha256",
        "canonicalPayloadSha256": validation_seal(receipt),
    }
    atomic_write_json(output_path, receipt)
    print(
        json.dumps(
            {
                "verdict": "passed",
                "actions": len(actions),
                "receipt": str(output_path),
            },
            indent=2,
        )
    )


def validate_packet_paths(inputs: Sequence[Path], destinations: Sequence[Path]) -> None:
    for destination in destinations:
        if destination.is_symlink():
            raise ProofMediaError("Output path must not be a symlink: {0}".format(destination))
        for source in inputs:
            if destination == source:
                raise ProofMediaError("An output path would overwrite an input: {0}".format(source))
            if destination.exists():
                try:
                    if destination.samefile(source):
                        raise ProofMediaError("An output aliases an input: {0}".format(source))
                except OSError:
                    pass


def publish_packet(staged: Sequence[Tuple[Path, Path]], receipt_destination: Path) -> None:
    ordered = [pair for pair in staged if pair[1] != receipt_destination]
    ordered.extend(pair for pair in staged if pair[1] == receipt_destination)
    if not ordered:
        return
    backups: List[Tuple[Path, Path]] = []
    installed: List[Path] = []
    backup_root = Path(
        tempfile.mkdtemp(prefix=".prepare-proof-recovery-", dir=str(receipt_destination.parent))
    )
    try:
        for index, (source, destination) in enumerate(ordered):
            if destination.exists():
                backup = backup_root / "{0}-{1}".format(index, destination.name)
                destination.replace(backup)
                backups.append((backup, destination))
            source.replace(destination)
            installed.append(destination)
    except BaseException as publish_error:
        recovery_errors: List[str] = []
        for destination in reversed(installed):
            try:
                destination.unlink(missing_ok=True)
            except BaseException as exc:
                recovery_errors.append("remove {0}: {1}".format(destination, repr(exc)))
        for backup, destination in reversed(backups):
            try:
                backup.replace(destination)
            except BaseException as exc:
                recovery_errors.append(
                    "restore {0} to {1}: {2}".format(backup, destination, repr(exc))
                )
        if recovery_errors:
            evidence_path = backup_root / "recovery.json"
            evidence = {
                "version": 1,
                "publish_error": repr(publish_error),
                "recovery_errors": recovery_errors,
                "backups": [
                    {
                        "backup": str(backup),
                        "destination": str(destination),
                        "backup_exists": backup.exists(),
                        "backup_sha256": sha256(backup) if backup.is_file() else None,
                    }
                    for backup, destination in backups
                ],
            }
            try:
                atomic_write_json(evidence_path, evidence)
            except BaseException as evidence_error:
                recovery_errors.append(
                    "write recovery evidence {0}: {1}".format(
                        evidence_path, repr(evidence_error)
                    )
                )
            raise ProofMediaError(
                "Packet publication failed and rollback was incomplete. "
                "Recovery files remain at {0}: {1}".format(
                    backup_root, "; ".join(recovery_errors)
                )
            ) from publish_error
        shutil.rmtree(backup_root, ignore_errors=True)
        raise
    shutil.rmtree(backup_root, ignore_errors=True)


def timeline_init(args: argparse.Namespace) -> None:
    path = Path(args.path).resolve()
    if path.exists() and not args.overwrite:
        raise ProofMediaError("Timeline exists; pass --overwrite to replace it")
    payload: Dict[str, Any] = {
        "version": 1,
        "coordinate_space": args.coordinate_space,
        "events": [],
    }
    if args.title:
        payload["title"] = args.title
    atomic_write_json(path, payload)
    print(str(path))


def parse_point(value: str) -> List[float]:
    parts = value.split(",")
    if len(parts) != 2:
        raise argparse.ArgumentTypeError("point must be x,y")
    try:
        return [float(parts[0]), float(parts[1])]
    except ValueError as exc:
        raise argparse.ArgumentTypeError("point must contain numbers") from exc


def timeline_add(args: argparse.Namespace) -> None:
    path = Path(args.path).resolve()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ProofMediaError("Could not read timeline {0}: {1}".format(path, exc)) from exc
    if payload.get("version") != 1 or not isinstance(payload.get("events"), list):
        raise ProofMediaError("Timeline must use version 1 with an events list")
    if args.at < 0:
        raise ProofMediaError("--at must be non-negative")
    if args.kind in ("swipe", "caption") and args.duration <= 0:
        raise ProofMediaError("--duration must be positive for swipe and caption events")
    event: Dict[str, Any] = {"kind": args.kind}
    if args.kind == "caption":
        if not args.caption:
            raise ProofMediaError("caption events require --caption")
        event.update({"start": args.at, "end": args.at + args.duration, "caption": args.caption})
    else:
        event["at"] = args.at
        action_id = args.action_id
        if action_id is None:
            used_ids = {
                item.get("action_id")
                for item in payload["events"]
                if isinstance(item, dict)
            }
            candidate = 1
            while "action-{0}".format(candidate) in used_ids:
                candidate += 1
            action_id = "action-{0}".format(candidate)
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]*", action_id):
            raise ProofMediaError("--action-id has invalid characters")
        if any(
            isinstance(item, dict) and item.get("action_id") == action_id
            for item in payload["events"]
        ):
            raise ProofMediaError("--action-id must be unique")
        event["action_id"] = action_id
        if args.kind == "tap":
            if args.point is None:
                raise ProofMediaError("tap events require --point x,y")
            event.update({"x": args.point[0], "y": args.point[1]})
        else:
            if args.from_point is None or args.to_point is None:
                raise ProofMediaError("swipe events require --from x,y and --to x,y")
            event.update({"from": args.from_point, "to": args.to_point, "duration": args.duration})
        for field in ("label", "expect", "caption"):
            value = getattr(args, field)
            if value:
                event[field] = value
    if args.caption_position != "bottom":
        event["caption_position"] = args.caption_position
    reject_secrets(event, len(payload["events"]))
    payload["events"].append(event)
    payload["events"].sort(key=event_start)
    atomic_write_json(path, payload)
    print(json.dumps(event, indent=2))


def safe_stem(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", value):
        raise ProofMediaError("Output stem must contain only letters, digits, dot, underscore, or hyphen")
    return value


def build_image(args: argparse.Namespace) -> None:
    tools = require_tools()
    font = find_font()
    source = Path(args.source).resolve()
    timeline_path = Path(args.timeline).resolve()
    if not source.is_file():
        raise ProofMediaError("Source does not exist: {0}".format(source))
    if not timeline_path.is_file():
        raise ProofMediaError("Timeline does not exist: {0}".format(timeline_path))
    source_hash_before = sha256(source)
    timeline_hash_before = sha256(timeline_path)
    source_dimensions = probe_image(tools["magick"], source)
    timeline = load_timeline(timeline_path, float("inf"), args.deny_secret_pattern)
    if sha256(timeline_path) != timeline_hash_before:
        raise ProofMediaError("Timeline changed while it was being read")
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = safe_stem(args.stem or source.stem)
    clean = output_dir / "{0}-image-clean.png".format(stem)
    annotated = output_dir / "{0}-image-annotated.png".format(stem)
    receipt_path = output_dir / "{0}-image-receipt.json".format(stem)
    if not args.overwrite and any(path.exists() for path in (clean, annotated, receipt_path)):
        raise ProofMediaError("Output exists; choose another directory/stem or pass --overwrite")
    validate_packet_paths((source, timeline_path), (clean, annotated, receipt_path))
    with tempfile.TemporaryDirectory(prefix="prepare-proof-image-", dir=output_dir) as temporary:
        work = Path(temporary)
        staged_clean = work / clean.name
        staged_annotated = work / annotated.name
        staged_receipt = work / receipt_path.name
        run([tools["magick"], str(source), "-auto-orient", "-strip", str(staged_clean)])
        width, height = probe_image(tools["magick"], staged_clean)
        selected = build_image_annotations(
            tools["magick"], font, staged_clean, staged_annotated, timeline, args.event,
            width, height, work,
        )
        if sha256(source) != source_hash_before:
            raise ProofMediaError("Raw source changed during rendering")
        if sha256(timeline_path) != timeline_hash_before:
            raise ProofMediaError("Timeline changed during rendering")
        if probe_image(tools["magick"], staged_clean) != probe_image(tools["magick"], staged_annotated):
            raise ProofMediaError("Clean and annotated images differ in dimensions")
        receipt = {
            "version": 1,
            "title": timeline.get("title"),
            "source": artifact_record(tools["ffprobe"], source),
            "timeline": {"path": str(timeline_path), "sha256": sha256(timeline_path)},
            "event": selected,
            "artifacts": {
                "clean_image": staged_artifact_record(tools["ffprobe"], staged_clean, clean),
                "annotated_image": staged_artifact_record(tools["ffprobe"], staged_annotated, annotated),
            },
            "source_dimensions": {"width": source_dimensions[0], "height": source_dimensions[1]},
            "dimensions": {"width": width, "height": height},
            "parameters": {
                "event": args.event,
                "deny_secret_patterns": list(args.deny_secret_pattern),
            },
            "tools": {name: tool_version(path) for name, path in tools.items()},
            "font": font,
        }
        atomic_write_json(staged_receipt, receipt)
        publish_packet(
            ((staged_clean, clean), (staged_annotated, annotated), (staged_receipt, receipt_path)),
            receipt_path,
        )
    print(json.dumps({"clean": str(clean), "annotated": str(annotated), "receipt": str(receipt_path)}, indent=2))


def build(args: argparse.Namespace) -> None:
    tools = require_tools()
    font = find_font()
    source = Path(args.source).resolve()
    timeline_path = Path(args.timeline).resolve()
    if not source.is_file():
        raise ProofMediaError("Source does not exist: {0}".format(source))
    if not timeline_path.is_file():
        raise ProofMediaError("Timeline does not exist: {0}".format(timeline_path))
    source_hash_before = sha256(source)
    timeline_hash_before = sha256(timeline_path)
    info = probe_video(tools["ffprobe"], source)
    timeline = load_timeline(timeline_path, info["duration"], args.deny_secret_pattern)
    if sha256(timeline_path) != timeline_hash_before:
        raise ProofMediaError("Timeline changed while it was being read")
    poster_override = args.poster_at if args.poster_at is not None else timeline.get("poster_at")
    if poster_override is not None:
        poster_at = number(poster_override, "poster_at")
        if poster_at < 0 or poster_at > info["duration"]:
            raise ProofMediaError("poster_at falls outside the source")
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = safe_stem(args.stem or source.stem)
    clean = output_dir / "{0}-clean.mp4".format(stem)
    annotated = output_dir / "{0}-annotated.mp4".format(stem)
    clean_poster = output_dir / "{0}-clean.png".format(stem)
    annotated_poster = output_dir / "{0}-annotated.png".format(stem)
    contact_sheet = output_dir / "{0}-contact-sheet.png".format(stem)
    receipt_path = output_dir / "{0}-receipt.json".format(stem)
    destinations = (clean, annotated, clean_poster, annotated_poster, contact_sheet, receipt_path)
    if not args.overwrite and any(path.exists() for path in destinations):
        raise ProofMediaError("Output exists; choose another directory/stem or pass --overwrite")
    validate_packet_paths((source, timeline_path), destinations)
    if args.freeze_minimum <= 0 or args.max_freeze <= 0:
        raise ProofMediaError("Freeze durations must be positive")

    cuts, removals = choose_cuts(
        tools["ffmpeg"],
        source,
        timeline,
        info["duration"],
        not args.no_auto_trim,
        args.freeze_minimum,
        args.max_freeze,
        info["has_audio"],
    )
    if not cuts:
        raise ProofMediaError("Editing removed the complete source")
    requested_output_duration = sum(end - start for start, end in cuts)
    with tempfile.TemporaryDirectory(prefix="prepare-proof-media-", dir=output_dir) as temporary:
        work = Path(temporary)
        staged = {destination: work / destination.name for destination in destinations}
        normalized = work / "normalized.mkv"
        build_normalized(tools["ffmpeg"], source, normalized, cuts, info["has_audio"])
        encode_clean(tools["ffmpeg"], normalized, staged[clean])
        clean_info = probe_video(tools["ffprobe"], staged[clean])
        if (clean_info["width"], clean_info["height"]) != (info["width"], info["height"]):
            raise ProofMediaError(
                "Rendered dimensions differ from the source dimensions; normalize display rotation before building proof media"
            )
        output_duration = clean_info["duration"]
        mapped = build_annotations(
            tools["ffmpeg"],
            tools["magick"],
            font,
            normalized,
            staged[annotated],
            timeline,
            cuts,
            clean_info["width"],
            clean_info["height"],
            output_duration,
            work,
        )
        default_poster_source = event_end(timeline["events"][-1]) + 0.6 if timeline["events"] else info["duration"] * 0.75
        poster_source = float(poster_override if poster_override is not None else default_poster_source)
        poster_output = max(0.0, min(output_duration - 0.04, map_time(poster_source, cuts)))
        extract_frame(tools["ffmpeg"], staged[clean], poster_output, staged[clean_poster])
        extract_frame(tools["ffmpeg"], staged[annotated], poster_output, staged[annotated_poster])
        build_contact_sheet(
            tools["ffmpeg"], tools["magick"], font, staged[annotated], output_duration,
            staged[contact_sheet], work,
        )

        if sha256(source) != source_hash_before:
            raise ProofMediaError("Raw source changed during rendering")
        if sha256(timeline_path) != timeline_hash_before:
            raise ProofMediaError("Timeline changed during rendering")
        verify_pair(tools["ffprobe"], staged[clean], staged[annotated])

        receipt = {
            "version": 1,
            "title": timeline.get("title"),
            "source": artifact_record(tools["ffprobe"], source),
            "timeline": {"path": str(timeline_path), "sha256": sha256(timeline_path)},
            "edit": {
                "source_duration": info["duration"],
                "output_duration": output_duration,
                "requested_output_duration": requested_output_duration,
                "removed_duration": info["duration"] - output_duration,
                "cuts": [{"start": start, "end": end} for start, end in cuts],
                "removed": [{"start": start, "end": end} for start, end in removals],
                "auto_trim": not args.no_auto_trim and "cuts" not in timeline,
                "no_auto_trim": args.no_auto_trim,
                "freeze_minimum": args.freeze_minimum,
                "max_freeze": args.max_freeze,
                "freeze_noise": FREEZE_NOISE,
                "silence_noise": SILENCE_NOISE,
                "poster_at": args.poster_at,
                "timeline_poster_at": timeline.get("poster_at"),
                "effective_poster_source_at": poster_source,
                "deny_secret_patterns": list(args.deny_secret_pattern),
                "digest": hashlib.sha256(json.dumps(cuts, separators=(",", ":")).encode("utf-8")).hexdigest(),
            },
            "events": mapped,
            "artifacts": {
                "clean_video": staged_artifact_record(tools["ffprobe"], staged[clean], clean),
                "annotated_video": staged_artifact_record(tools["ffprobe"], staged[annotated], annotated),
                "clean_poster": staged_artifact_record(tools["ffprobe"], staged[clean_poster], clean_poster),
                "annotated_poster": staged_artifact_record(tools["ffprobe"], staged[annotated_poster], annotated_poster),
                "contact_sheet": staged_artifact_record(tools["ffprobe"], staged[contact_sheet], contact_sheet),
            },
            "tools": {name: tool_version(path) for name, path in tools.items()},
            "font": font,
        }
        atomic_write_json(staged[receipt_path], receipt)
        publish_packet(tuple((staged[path], path) for path in destinations), receipt_path)
    print(json.dumps({"clean": str(clean), "annotated": str(annotated), "receipt": str(receipt_path)}, indent=2))


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    init_parser = commands.add_parser("timeline-init", help="create an empty version 1 timeline")
    init_parser.add_argument("path")
    init_parser.add_argument("--title")
    init_parser.add_argument("--coordinate-space", choices=("normalized", "pixels"), default="normalized")
    init_parser.add_argument("--overwrite", action="store_true")
    init_parser.set_defaults(handler=timeline_init)

    add_parser = commands.add_parser("timeline-add", help="append one timed action or caption")
    add_parser.add_argument("path")
    add_parser.add_argument("--kind", choices=("tap", "swipe", "caption"), required=True)
    add_parser.add_argument("--at", type=float, required=True)
    add_parser.add_argument("--duration", type=float, default=0.6)
    add_parser.add_argument("--action-id")
    add_parser.add_argument("--point", type=parse_point)
    add_parser.add_argument("--from", dest="from_point", type=parse_point)
    add_parser.add_argument("--to", dest="to_point", type=parse_point)
    add_parser.add_argument("--label")
    add_parser.add_argument("--expect")
    add_parser.add_argument("--caption")
    add_parser.add_argument("--caption-position", choices=("top", "bottom"), default="bottom")
    add_parser.set_defaults(handler=timeline_add)

    app_flow_parser = commands.add_parser(
        "timeline-from-app-flow",
        help="convert an app-flow agent history and normalized action map to a timeline",
    )
    app_flow_parser.add_argument("history")
    app_flow_parser.add_argument("--action-map", required=True)
    app_flow_parser.add_argument("--output", required=True)
    app_flow_parser.add_argument("--overwrite", action="store_true")
    app_flow_parser.set_defaults(handler=timeline_from_app_flow)

    validate_parser = commands.add_parser(
        "validate-packet",
        help="verify a video packet against its timeline and optional app-flow ledger",
    )
    validate_parser.add_argument("receipt")
    validate_parser.add_argument("--timeline", required=True)
    validate_parser.add_argument("--history")
    validate_parser.add_argument("--output", required=True)
    validate_parser.add_argument("--minimum-ssim", type=float, default=0.75)
    validate_parser.add_argument("--deny-secret-pattern", action="append", default=[])
    validate_parser.add_argument("--overwrite", action="store_true")
    validate_parser.set_defaults(handler=validate_packet)

    image_parser = commands.add_parser("image", help="build paired clean and annotated PNG proof")
    image_parser.add_argument("source")
    image_parser.add_argument("--timeline", required=True)
    image_parser.add_argument("--output-dir", required=True)
    image_parser.add_argument("--stem")
    image_parser.add_argument("--event", type=int, help="zero-based event to annotate; defaults to the last event")
    image_parser.add_argument("--overwrite", action="store_true")
    image_parser.add_argument("--deny-secret-pattern", action="append", default=[])
    image_parser.set_defaults(handler=build_image)

    build_parser = commands.add_parser("build", help="build clean and annotated proof media")
    build_parser.add_argument("source")
    build_parser.add_argument("--timeline", required=True)
    build_parser.add_argument("--output-dir", required=True)
    build_parser.add_argument("--stem")
    build_parser.add_argument("--poster-at", type=float, help="source timestamp for the paired poster images")
    build_parser.add_argument("--freeze-minimum", type=float, default=2.5, help="minimum frozen interval detected by FFmpeg")
    build_parser.add_argument("--max-freeze", type=float, default=2.0, help="maximum unprotected frozen time retained")
    build_parser.add_argument("--no-auto-trim", action="store_true")
    build_parser.add_argument("--overwrite", action="store_true")
    build_parser.add_argument("--deny-secret-pattern", action="append", default=[])
    build_parser.set_defaults(handler=build)
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        args.handler(args)
    except (ProofMediaError, subprocess.CalledProcessError) as exc:
        print("prepare-proof-media: {0}".format(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
