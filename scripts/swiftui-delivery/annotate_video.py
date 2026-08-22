#!/usr/bin/env python3
"""Trim and annotate proof video with FFmpeg, leaving an exact edit receipt."""

import argparse
import hashlib
import json
import math
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def finite_number(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool) and
            math.isfinite(value))


def validate_plan(plan, check_source=True):
    errors = []
    if not isinstance(plan, dict):
        return ["plan must be an object"]
    if plan.get("schemaVersion") != 1:
        errors.append("schemaVersion must be 1")
    if plan.get("kind") != "swiftui-video-edit-plan":
        errors.append("kind must be swiftui-video-edit-plan")
    source, output = plan.get("source"), plan.get("output")
    if not isinstance(source, str) or not source:
        errors.append("source is required")
    elif check_source and not Path(source).expanduser().is_file():
        errors.append("source file is missing")
    if not isinstance(output, str) or not output:
        errors.append("output is required")
    elif Path(output).expanduser().suffix.lower() != ".mp4":
        errors.append("output must be an .mp4 file")
    if isinstance(source, str) and isinstance(output, str) and source and output:
        if Path(source).expanduser().resolve() == Path(output).expanduser().resolve():
            errors.append("output must not overwrite the raw source")
    segments = plan.get("segments")
    if not isinstance(segments, list) or not segments:
        errors.append("segments must retain at least one range")
    previous = -1.0
    for index, segment in enumerate(segments or []):
        if not isinstance(segment, dict):
            errors.append("segments[%d] must be an object" % index)
            continue
        start, end = segment.get("start"), segment.get("end")
        if not finite_number(start) or not finite_number(end) or start < 0 or end <= start:
            errors.append("segments[%d] needs a valid start/end range" % index)
        elif start < previous:
            errors.append("segments must be ordered and non-overlapping")
        else:
            previous = end
        reason = segment.get("reason")
        if not isinstance(reason, str) or len(reason.strip()) < 12:
            errors.append("segments[%d].reason must explain why the interval is retained" % index)
        if (segment.get("intentionalPause") is True and isinstance(reason, str) and
                "slow" not in reason.lower() and "pause" not in reason.lower() and
                "wait" not in reason.lower()):
            errors.append("segments[%d] intentional pause needs a slowness/wait reason" % index)
    retained_duration = sum(segment["end"] - segment["start"]
                            for segment in segments or []
                            if isinstance(segment, dict) and
                            finite_number(segment.get("start")) and
                            finite_number(segment.get("end")) and
                            segment["end"] > segment["start"])
    annotations = plan.get("annotations")
    if not isinstance(annotations, list) or not annotations:
        errors.append("annotations must identify what the viewer should watch")
    for index, note in enumerate(annotations or []):
        if not isinstance(note, dict) or not isinstance(note.get("text"), str) or not note.get("text").strip():
            errors.append("annotations[%d].text is required" % index)
            continue
        if "\n" in note["text"] or "\r" in note["text"]:
            errors.append("annotations[%d].text must be one line" % index)
        if note["text"].startswith("@"):
            errors.append("annotations[%d].text must not start with @" % index)
        font_size = note.get("fontSize", 29)
        if not finite_number(font_size) or font_size < 8 or font_size > 96:
            errors.append("annotations[%d].fontSize must be between 8 and 96" % index)
        if (not finite_number(note.get("start")) or
                not finite_number(note.get("end")) or
                note["end"] <= note["start"]):
            errors.append("annotations[%d] needs a valid output-timeline range" % index)
        elif note["start"] < 0 or note["end"] > retained_duration:
            errors.append("annotations[%d] falls outside the edited timeline" % index)
        for coordinate in ("x", "y"):
            if coordinate in note and not (isinstance(note[coordinate], str) or
                                           finite_number(note[coordinate])):
                errors.append("annotations[%d].%s must be an FFmpeg expression or number" %
                              (index, coordinate))
        highlight = note.get("highlight")
        if highlight is not None:
            if not isinstance(highlight, dict) or not all(
                    finite_number(highlight.get(field))
                    for field in ("x", "y", "width", "height")):
                errors.append("annotations[%d].highlight needs numeric x, y, width, and height" % index)
        gesture = note.get("gesture")
        if gesture is not None:
            if not isinstance(gesture, dict):
                errors.append("annotations[%d].gesture must be an object" % index)
                continue
            gesture_type = gesture.get("type")
            if gesture_type not in ("tap", "longPress", "swipe", "pinch", "rotate"):
                errors.append("annotations[%d].gesture has an unsupported type" % index)
            required = ("x", "y")
            if gesture_type in ("swipe", "pinch", "rotate"):
                required += ("endX", "endY")
            if not all(finite_number(gesture.get(field)) for field in required):
                errors.append("annotations[%d].gesture needs numeric %s" %
                              (index, ", ".join(required)))
            accent = gesture.get("accent", "#61D7FF")
            if not isinstance(accent, str) or not HEX_COLOR_RE.fullmatch(accent):
                errors.append("annotations[%d].gesture.accent must be a hex color" % index)
    return errors


def has_audio(ffprobe, source):
    command = [ffprobe, "-v", "error", "-select_streams", "a:0", "-show_entries",
               "stream=index", "-of", "csv=p=0", source]
    return bool(subprocess.run(command, check=True, capture_output=True, text=True).stdout.strip())


def duration(ffprobe, path):
    command = [ffprobe, "-v", "error", "-show_entries", "format=duration",
               "-of", "default=noprint_wrappers=1:nokey=1", str(path)]
    return float(subprocess.run(command, check=True, capture_output=True, text=True).stdout.strip())


def video_size(ffprobe, source):
    command = [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries",
               "stream=width,height", "-of", "csv=p=0:s=x", str(source)]
    width, height = subprocess.run(
        command, check=True, capture_output=True, text=True
    ).stdout.strip().split("x")
    return int(width), int(height)


def _render_card(note, magick, font, destination, directory, index, frame_size):
    label = Path(directory) / ("annotation-label-%d.png" % index)
    point_size = str(note.get("fontSize", 29))
    frame_width, frame_height = frame_size
    if frame_width < 112 or frame_height < 112:
        raise ValueError("video frame is too small for readable annotations")
    subprocess.run([
        magick, "-background", "none", "-fill", "white", "-font", font,
        "-pointsize", point_size, "label:" + note["text"],
        str(label),
    ], check=True, capture_output=True, text=True)
    dimensions = subprocess.run(
        [magick, "identify", "-format", "%w %h", str(label)], check=True,
        capture_output=True, text=True).stdout.split()
    maximum_card_width = frame_width - 32
    maximum_text_width = maximum_card_width - 40
    if int(dimensions[0]) > maximum_text_width:
        token_label = Path(directory) / ("annotation-token-%d.png" % index)
        token_lines = "\n".join(note["text"].split())
        subprocess.run([
            magick, "-background", "none", "-fill", "white", "-font", font,
            "-pointsize", point_size, "label:" + token_lines, str(token_label),
        ], check=True, capture_output=True, text=True)
        token_width = int(subprocess.run(
            [magick, "identify", "-format", "%w", str(token_label)], check=True,
            capture_output=True, text=True).stdout)
        if token_width > maximum_text_width:
            raise ValueError(
                "annotation %d has a word too wide for the video; shorten its text or reduce fontSize" %
                index)
        subprocess.run([
            magick, "-background", "none", "-fill", "white", "-font", font,
            "-pointsize", point_size, "-gravity", "center",
            "-size", "%dx" % maximum_text_width, "caption:" + note["text"],
            str(label),
        ], check=True, capture_output=True, text=True)
        dimensions = subprocess.run(
            [magick, "identify", "-format", "%w %h", str(label)], check=True,
            capture_output=True, text=True).stdout.split()
    width = min(maximum_card_width, int(dimensions[0]) + 40)
    height = int(dimensions[1]) + 24
    if height > frame_height - 48:
        raise ValueError(
            "annotation %d is too tall for the video; shorten its text or reduce fontSize" %
            index)
    subprocess.run([
        magick, "-size", "%dx%d" % (width, height), "xc:none",
        "-fill", "#111318E8", "-stroke", "#FFFFFF20", "-strokewidth", "1",
        "-draw", "roundrectangle 0,0,%d,%d,18,18" % (width - 1, height - 1),
        str(label), "-geometry", "+20+12", "-composite", str(destination),
    ], check=True, capture_output=True, text=True)


def _render_gesture(gesture, size, magick, destination):
    width, height = size
    accent = gesture.get("accent", "#61D7FF")
    x, y = float(gesture["x"]), float(gesture["y"])
    drawing = ["fill none", "stroke '%s'" % accent, "stroke-width 5"]
    gesture_type = gesture["type"]
    if gesture_type in ("tap", "longPress"):
        outer = 34 if gesture_type == "tap" else 42
        drawing += [
            "circle %.1f,%.1f %.1f,%.1f" % (x, y, x + outer, y),
            "fill '%sAA'" % accent,
            "circle %.1f,%.1f %.1f,%.1f" % (x, y, x + 13, y),
        ]
    else:
        end_x, end_y = float(gesture["endX"]), float(gesture["endY"])
        angle = math.atan2(end_y - y, end_x - x)
        arrow = 18
        left = (end_x - arrow * math.cos(angle - 0.65),
                end_y - arrow * math.sin(angle - 0.65))
        right = (end_x - arrow * math.cos(angle + 0.65),
                 end_y - arrow * math.sin(angle + 0.65))
        drawing += [
            "line %.1f,%.1f %.1f,%.1f" % (x, y, end_x, end_y),
            "fill '%s'" % accent,
            "polygon %.1f,%.1f %.1f,%.1f %.1f,%.1f" %
            (end_x, end_y, left[0], left[1], right[0], right[1]),
            "circle %.1f,%.1f %.1f,%.1f" % (x, y, x + 11, y),
        ]
        if gesture_type in ("pinch", "rotate"):
            drawing += [
                "fill none", "stroke '#FFFFFFCC'", "stroke-width 3",
                "circle %.1f,%.1f %.1f,%.1f" %
                (end_x, end_y, end_x + 14, end_y),
            ]
    command = [magick, "-size", "%dx%d" % (width, height), "xc:none",
               "-draw", " ".join(drawing), str(destination)]
    subprocess.run(command, check=True, capture_output=True, text=True)


def validate_frame_geometry(plan, size):
    width, height = size
    for index, note in enumerate(plan["annotations"]):
        highlight = note.get("highlight")
        if highlight and (highlight["x"] < 0 or highlight["y"] < 0 or
                          highlight["width"] <= 0 or highlight["height"] <= 0 or
                          highlight["x"] + highlight["width"] > width or
                          highlight["y"] + highlight["height"] > height):
            raise ValueError("annotation %d highlight falls outside the video frame" % index)
        gesture = note.get("gesture")
        if gesture:
            points = [(gesture["x"], gesture["y"])]
            if gesture["type"] in ("swipe", "pinch", "rotate"):
                points.append((gesture["endX"], gesture["endY"]))
            if any(x < 0 or y < 0 or x >= width or y >= height for x, y in points):
                raise ValueError("annotation %d gesture falls outside the video frame" % index)


def render_annotation_assets(plan, magick, font, directory, size):
    if not Path(font).is_file():
        raise ValueError("annotation font is missing: %s" % font)
    validate_frame_geometry(plan, size)
    assets = []
    for index, note in enumerate(plan["annotations"]):
        card = Path(directory) / ("annotation-card-%d.png" % index)
        _render_card(note, magick, font, card, directory, index, size)
        gesture_image = None
        if note.get("gesture"):
            gesture_image = Path(directory) / ("gesture-%d.png" % index)
            _render_gesture(note["gesture"], size, magick, gesture_image)
        assets.append({"card": card, "gesture": gesture_image})
    return assets


def build_command(plan, ffmpeg, ffprobe, annotation_assets):
    source = str(Path(plan["source"]).expanduser())
    audio = has_audio(ffprobe, source)
    command = [ffmpeg, "-hide_banner", "-y", "-i", source]
    input_indexes = []
    for asset in annotation_assets:
        card_index = len(input_indexes) + 1
        command += ["-loop", "1", "-i", str(asset["card"])]
        input_indexes.append(card_index)
        gesture_index = None
        if asset.get("gesture"):
            gesture_index = len(input_indexes) + 1
            command += ["-loop", "1", "-i", str(asset["gesture"])]
            input_indexes.append(gesture_index)
        asset["cardInput"] = card_index
        asset["gestureInput"] = gesture_index
    filters, concat_labels = [], []
    for index, segment in enumerate(plan["segments"]):
        filters.append("[0:v]trim=start=%s:end=%s,setpts=PTS-STARTPTS[v%d]" %
                       (segment["start"], segment["end"], index))
        concat_labels.append("[v%d]" % index)
        if audio:
            filters.append("[0:a]atrim=start=%s:end=%s,asetpts=PTS-STARTPTS[a%d]" %
                           (segment["start"], segment["end"], index))
            concat_labels.append("[a%d]" % index)
    if audio:
        filters.append("%sconcat=n=%d:v=1:a=1[vcat][acat]" %
                       ("".join(concat_labels), len(plan["segments"])))
    else:
        filters.append("%sconcat=n=%d:v=1:a=0[vcat]" %
                       ("".join(concat_labels), len(plan["segments"])))
    current = "vcat"
    for index, note in enumerate(plan["annotations"]):
        asset = annotation_assets[index]
        prepared = "note%d" % index
        output = "vnote%d" % index
        enable = "between(t,%s,%s)" % (note["start"], note["end"])
        filters.append("[%d:v]format=rgba[%s]" % (asset["cardInput"], prepared))
        if isinstance(note.get("highlight"), dict):
            highlight = note["highlight"]
            boxed = "vbox%d" % index
            filters.append(
                "[%s]drawbox=x=%s:y=%s:w=%s:h=%s:color=yellow@0.85:t=4:enable='%s'[%s]" %
                (current, highlight["x"], highlight["y"], highlight["width"],
                 highlight["height"], enable, boxed))
            current = boxed
        x = "max(0\\,min(W-w\\,%s))" % note.get("x", "(W-w)/2")
        y = "max(0\\,min(H-h\\,%s))" % note.get("y", "H-h-48")
        filters.append("[%s][%s]overlay=x=%s:y=%s:enable='%s':shortest=1[%s]" % (
            current, prepared, x, y, enable, output))
        current = output
        if asset.get("gestureInput") is not None:
            prepared_gesture = "gesture%d" % index
            gesture_output = "vgesture%d" % index
            filters.append("[%d:v]format=rgba[%s]" %
                           (asset["gestureInput"], prepared_gesture))
            filters.append("[%s][%s]overlay=x=0:y=0:enable='%s':shortest=1[%s]" %
                           (current, prepared_gesture, enable, gesture_output))
            current = gesture_output
    command += ["-filter_complex", ";".join(filters), "-map", "[%s]" % current]
    if audio:
        command += ["-map", "[acat]"]
    command += ["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-movflags", "+faststart"]
    if audio:
        command += ["-c:a", "aac", "-b:a", "160k"]
    retained_duration = sum(segment["end"] - segment["start"] for segment in plan["segments"])
    command += ["-t", str(retained_duration)]
    command.append(str(Path(plan["output"]).expanduser()))
    return command


def execute(plan_path, ffmpeg, ffprobe, magick, font, dry_run=False):
    plan_path = Path(plan_path).expanduser().resolve()
    plan = json.loads(plan_path.read_text())
    errors = validate_plan(plan)
    if errors:
        raise ValueError("; ".join(errors))
    with tempfile.TemporaryDirectory(prefix="swiftui-video-annotations-") as directory:
        size = video_size(ffprobe, Path(plan["source"]).expanduser())
        assets = render_annotation_assets(plan, magick, font, directory, size)
        command = build_command(plan, ffmpeg, ffprobe, assets)
        if dry_run:
            return {"ok": True, "dryRun": True, "command": command}
        output = Path(plan["output"]).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(command, check=True)
    source = Path(plan["source"]).expanduser().resolve()
    source_duration, output_duration = duration(ffprobe, source), duration(ffprobe, output)
    receipt = {
        "schemaVersion": 1,
        "kind": "swiftui-video-edit-receipt",
        "renderer": "repo-ffmpeg",
        "source": str(source),
        "sourceSha256": sha256(source),
        "output": str(output),
        "outputSha256": sha256(output),
        "sourceDurationSeconds": source_duration,
        "outputDurationSeconds": output_duration,
        "removedDurationSeconds": max(0, source_duration - output_duration),
        "segments": plan["segments"],
        "annotations": plan["annotations"],
        "planSha256": sha256(plan_path),
        "ffmpegCommand": command,
        "ffmpegVersion": subprocess.run(
            [ffmpeg, "-version"], check=True, capture_output=True, text=True
        ).stdout.splitlines()[0],
        "imageMagickVersion": subprocess.run(
            [magick, "-version"], check=True, capture_output=True, text=True
        ).stdout.splitlines()[0],
        "annotationFont": font,
        "completedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    receipt_path = output.with_suffix(output.suffix + ".edit-receipt.json")
    receipt_path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    return {"ok": True, "output": str(output), "receipt": str(receipt_path),
            "outputSha256": receipt["outputSha256"]}


def adopt_output(plan_path, ffprobe, editor):
    plan_path = Path(plan_path).expanduser().resolve()
    plan = json.loads(plan_path.read_text())
    errors = validate_plan(plan)
    if errors:
        raise ValueError("; ".join(errors))
    if not isinstance(editor, str) or len(editor.strip()) < 3:
        raise ValueError("--editor must name the editor and version")
    source = Path(plan["source"]).expanduser().resolve()
    output = Path(plan["output"]).expanduser().resolve()
    if not output.is_file():
        raise ValueError("edited output is missing: %s" % output)
    receipt = {
        "schemaVersion": 1,
        "kind": "swiftui-video-edit-receipt",
        "renderer": "external-editor",
        "editor": editor.strip(),
        "source": str(source),
        "sourceSha256": sha256(source),
        "output": str(output),
        "outputSha256": sha256(output),
        "sourceDurationSeconds": duration(ffprobe, source),
        "outputDurationSeconds": duration(ffprobe, output),
        "segments": plan["segments"],
        "annotations": plan["annotations"],
        "planSha256": sha256(plan_path),
        "completedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    receipt["removedDurationSeconds"] = max(
        0, receipt["sourceDurationSeconds"] - receipt["outputDurationSeconds"])
    receipt_path = output.with_suffix(output.suffix + ".edit-receipt.json")
    receipt_path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    return {"ok": True, "output": str(output), "receipt": str(receipt_path),
            "outputSha256": receipt["outputSha256"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan")
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe")
    parser.add_argument("--magick", default="magick")
    parser.add_argument("--font", default="/System/Library/Fonts/SFNSRounded.ttf")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--adopt-output", action="store_true",
                        help="write a receipt for an output exported by another editor")
    parser.add_argument("--editor", help="external editor name and version")
    args = parser.parse_args(argv)
    try:
        if args.adopt_output:
            if args.dry_run:
                raise ValueError("--dry-run cannot be combined with --adopt-output")
            result = adopt_output(args.plan, args.ffprobe, args.editor)
        else:
            if args.editor:
                raise ValueError("--editor requires --adopt-output")
            result = execute(args.plan, args.ffmpeg, args.ffprobe, args.magick,
                             args.font, args.dry_run)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (OSError, ValueError, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "errors": [str(exc)]}, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
