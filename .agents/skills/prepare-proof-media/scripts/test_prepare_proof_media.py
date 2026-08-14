#!/usr/bin/env python3
"""Focused tests for the deterministic proof-media renderer."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from typing import Optional
import unittest
from unittest import mock


SCRIPT = Path(__file__).with_name("prepare_proof_media.py")
SPEC = importlib.util.spec_from_file_location("prepare_proof_media", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MEDIA = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MEDIA)


class IntervalTests(unittest.TestCase):
    def test_subtracts_protected_action_from_idle_removal(self) -> None:
        self.assertEqual(
            MEDIA.subtract_intervals((2.0, 8.0), [(4.0, 6.0)]),
            [(2.0, 4.0), (6.0, 8.0)],
        )

    def test_maps_source_timestamp_through_shared_cuts(self) -> None:
        cuts = [(0.0, 2.0), (5.0, 8.0)]
        self.assertAlmostEqual(MEDIA.map_time(6.5, cuts), 3.5)

    def test_rejects_event_outside_explicit_cut(self) -> None:
        timeline = {
            "cuts": [{"start": 0.0, "end": 1.0}],
            "events": [{"kind": "tap", "at": 2.0, "x": 0.5, "y": 0.5}],
        }
        with self.assertRaisesRegex(MEDIA.ProofMediaError, "not fully contained"):
            MEDIA.choose_cuts("ffmpeg", Path("unused"), timeline, 3.0, True, 2.5, 2.0)

    def test_intersects_freezes_with_verified_silence(self) -> None:
        self.assertEqual(
            MEDIA.intersect_intervals([(0.0, 5.0)], [(1.0, 2.0), (3.0, 4.0)]),
            [(1.0, 2.0), (3.0, 4.0)],
        )


class AppFlowAdapterTests(unittest.TestCase):
    def history(self) -> dict:
        return {
            "schemaVersion": 1,
            "plan": "pr",
            "events": [
                {
                    "id": "event-1",
                    "phase": "act",
                    "at": "2026-08-14T01:00:01.250000+00:00",
                    "selector": "sidebar-settings-button",
                    "action": "tap",
                    "postcondition": "settings-visible",
                },
                {
                    "id": "event-2",
                    "phase": "assert",
                    "at": "2026-08-14T01:00:01.500000+00:00",
                    "actionid": "event-1",
                    "result": "passed",
                    "observation": "settings-visible",
                },
                {
                    "id": "event-3",
                    "phase": "act",
                    "at": "2026-08-14T01:00:02.000000Z",
                    "selector": "settings-list",
                    "action": "swipe-up",
                    "postcondition": "usage-row-visible",
                },
                {
                    "id": "event-4",
                    "phase": "assert",
                    "at": "2026-08-14T01:00:02.750000+00:00",
                    "actionid": "event-3",
                    "result": "passed",
                    "observation": "usage-row-visible",
                },
            ],
        }

    def action_map(self) -> dict:
        return {
            "version": 1,
            "recording_started_at": "2026-08-14T01:00:00Z",
            "actions": [
                {"action_id": "event-1", "point": [0.9, 0.1]},
                {
                    "action_id": "event-3",
                    "from": [0.5, 0.8],
                    "to": [0.5, 0.3],
                    "duration": 0.5,
                },
            ],
        }

    def test_converts_passed_actions_to_timed_visual_events(self) -> None:
        timeline = MEDIA.convert_app_flow_timeline(self.history(), self.action_map())

        self.assertEqual(timeline["title"], "App-flow pr proof")
        self.assertEqual(
            timeline["events"],
            [
                {
                    "action_id": "event-1",
                    "kind": "tap",
                    "at": 1.25,
                    "label": "sidebar settings button",
                    "expect": "settings visible",
                    "x": 0.9,
                    "y": 0.1,
                },
                {
                    "action_id": "event-3",
                    "kind": "swipe",
                    "at": 2.0,
                    "label": "settings list",
                    "expect": "usage row visible",
                    "from": [0.5, 0.8],
                    "to": [0.5, 0.3],
                    "duration": 0.5,
                },
            ],
        )

    def test_requires_exact_action_coverage_and_passed_assertions(self) -> None:
        missing = self.action_map()
        missing["actions"].pop()
        with self.assertRaisesRegex(
            MEDIA.ProofMediaError, "Missing visual mapping.*event-3"
        ):
            MEDIA.convert_app_flow_timeline(self.history(), missing)

        unknown = self.action_map()
        unknown["actions"].append({"action_id": "event-99", "point": [0.5, 0.5]})
        with self.assertRaisesRegex(
            MEDIA.ProofMediaError, "unknown app-flow actions.*event-99"
        ):
            MEDIA.convert_app_flow_timeline(self.history(), unknown)

        unproved = self.history()
        unproved["events"][-1]["result"] = "failed"
        with self.assertRaisesRegex(
            MEDIA.ProofMediaError, "no passed assertion.*event-3"
        ):
            MEDIA.convert_app_flow_timeline(unproved, self.action_map())

        conflicting = self.action_map()
        conflicting["actions"][0]["kind"] = "swipe"
        conflicting["actions"][0]["from"] = [0.5, 0.8]
        conflicting["actions"][0]["to"] = [0.5, 0.3]
        with self.assertRaisesRegex(
            MEDIA.ProofMediaError, "conflicts with semantic action"
        ):
            MEDIA.convert_app_flow_timeline(self.history(), conflicting)

    def test_cli_binds_source_hashes_without_overwriting_by_default(self) -> None:
        with tempfile.TemporaryDirectory(prefix="proof-app-flow-") as temporary:
            root = Path(temporary)
            history_path = root / "session.json"
            map_path = root / "visual-map.json"
            output_path = root / "timeline.json"
            history_path.write_text(json.dumps(self.history()), encoding="utf-8")
            map_path.write_text(json.dumps(self.action_map()), encoding="utf-8")
            command = [
                "python3", str(SCRIPT), "timeline-from-app-flow", str(history_path),
                "--action-map", str(map_path), "--output", str(output_path),
            ]
            first = subprocess.run(
                command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
            )
            second = subprocess.run(
                command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
            )

            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertNotEqual(second.returncode, 0)
            timeline = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(
                timeline["source_history"]["sha256"], MEDIA.sha256(history_path)
            )
            self.assertEqual(timeline["action_map"]["sha256"], MEDIA.sha256(map_path))


class SafetyTests(unittest.TestCase):
    def test_rejects_pairing_credentials_non_strings_and_custom_patterns(self) -> None:
        rejected = [
            "Token: 23456789ABCD",
            "Token: 23456789ABCDEFGH",
            "Pairing code = abc_def-12345",
            "https://host/pair?token=23456789ABCD",
            "https://host/pair#token=23456789ABCD",
        ]
        for value in rejected:
            with self.subTest(value=value), self.assertRaisesRegex(
                MEDIA.ProofMediaError, "credential"
            ):
                MEDIA.reject_secrets({"caption": value}, 0)
        with self.assertRaisesRegex(MEDIA.ProofMediaError, "must be a string"):
            MEDIA.reject_secrets({"label": {"token": "hidden"}}, 0)
        with self.assertRaisesRegex(MEDIA.ProofMediaError, "credential"):
            MEDIA.reject_secrets(
                {"expect": "tenant-secret-42"}, 0, (MEDIA.re.compile("tenant-secret"),)
            )

    def test_rejects_imagemagick_indirect_caption_input(self) -> None:
        for field in ("caption", "label", "expect"):
            with self.subTest(field=field), self.assertRaisesRegex(
                MEDIA.ProofMediaError, "must not start with @"
            ):
                MEDIA.reject_secrets({field: "  @/tmp/private.txt"}, 0)
        with self.assertRaisesRegex(MEDIA.ProofMediaError, "must not start with @"):
            MEDIA.validate_caption_text("@/tmp/private.txt")

    def test_rejects_symlink_hardlink_and_timeline_output_aliases(self) -> None:
        with tempfile.TemporaryDirectory(prefix="proof-path-safety-") as temporary:
            root = Path(temporary)
            source = root / "raw.mp4"
            timeline = root / "timeline.json"
            source.write_bytes(b"raw")
            timeline.write_bytes(b"timeline")
            symlink = root / "clean.mp4"
            symlink.symlink_to(source)
            hardlink = root / "annotated.mp4"
            os.link(source, hardlink)
            with self.assertRaises(MEDIA.ProofMediaError):
                MEDIA.validate_packet_paths((source, timeline), (symlink,))
            with self.assertRaises(MEDIA.ProofMediaError):
                MEDIA.validate_packet_paths((source, timeline), (hardlink,))
            with self.assertRaises(MEDIA.ProofMediaError):
                MEDIA.validate_packet_paths((source, timeline), (timeline,))

    def test_packet_publish_rolls_back_if_receipt_install_fails(self) -> None:
        with tempfile.TemporaryDirectory(prefix="proof-publish-rollback-") as temporary:
            root = Path(temporary)
            stage = root / "stage"
            final = root / "final"
            stage.mkdir()
            final.mkdir()
            destinations = [final / "clean", final / "annotated", final / "receipt"]
            staged = [stage / path.name for path in destinations]
            for path, value in zip(destinations, (b"old-clean", b"old-annotated", b"old-receipt")):
                path.write_bytes(value)
            for path, value in zip(staged, (b"new-clean", b"new-annotated", b"new-receipt")):
                path.write_bytes(value)
            original_replace = Path.replace

            def fail_receipt(source: Path, target: Path) -> Path:
                if source == staged[-1] and target == destinations[-1]:
                    raise OSError("injected receipt failure")
                return original_replace(source, target)

            with mock.patch.object(Path, "replace", fail_receipt):
                with self.assertRaisesRegex(OSError, "injected receipt failure"):
                    MEDIA.publish_packet(tuple(zip(staged, destinations)), destinations[-1])

            self.assertEqual(
                [path.read_bytes() for path in destinations],
                [b"old-clean", b"old-annotated", b"old-receipt"],
            )
            self.assertEqual(list(final.glob(".prepare-proof-recovery-*")), [])

    def test_packet_publish_preserves_recovery_evidence_and_restores_other_files(self) -> None:
        with tempfile.TemporaryDirectory(prefix="proof-publish-recovery-") as temporary:
            root = Path(temporary)
            stage = root / "stage"
            final = root / "final"
            stage.mkdir()
            final.mkdir()
            destinations = [final / "clean", final / "annotated", final / "receipt"]
            staged = [stage / path.name for path in destinations]
            for path, value in zip(destinations, (b"old-clean", b"old-annotated", b"old-receipt")):
                path.write_bytes(value)
            for path, value in zip(staged, (b"new-clean", b"new-annotated", b"new-receipt")):
                path.write_bytes(value)
            original_replace = Path.replace

            def fail_receipt_and_one_restore(source: Path, target: Path) -> Path:
                if source == staged[-1] and target == destinations[-1]:
                    raise OSError("injected receipt failure")
                if (
                    source.name == "1-annotated"
                    and source.parent.name.startswith(".prepare-proof-recovery-")
                    and target == destinations[1]
                ):
                    raise OSError("injected restore failure")
                return original_replace(source, target)

            with mock.patch.object(Path, "replace", fail_receipt_and_one_restore):
                with self.assertRaisesRegex(MEDIA.ProofMediaError, "rollback was incomplete"):
                    MEDIA.publish_packet(tuple(zip(staged, destinations)), destinations[-1])

            self.assertEqual(destinations[0].read_bytes(), b"old-clean")
            self.assertFalse(destinations[1].exists())
            self.assertEqual(destinations[2].read_bytes(), b"old-receipt")
            recovery_roots = list(final.glob(".prepare-proof-recovery-*"))
            self.assertEqual(len(recovery_roots), 1)
            self.assertEqual((recovery_roots[0] / "1-annotated").read_bytes(), b"old-annotated")
            evidence = json.loads((recovery_roots[0] / "recovery.json").read_text(encoding="utf-8"))
            self.assertIn("injected receipt failure", evidence["publish_error"])
            self.assertTrue(any("injected restore failure" in item for item in evidence["recovery_errors"]))


@unittest.skipUnless(
    all(shutil.which(name) for name in ("ffmpeg", "ffprobe", "magick")),
    "media tools unavailable",
)
class PacketValidationTests(unittest.TestCase):
    def build_app_flow_packet(self, root: Path) -> tuple:
        source = root / "raw.mp4"
        history = root / "agent-session.json"
        action_map = root / "action-map.json"
        timeline = root / "timeline.json"
        artifacts = root / "artifacts"
        validation = root / "validation.json"
        subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", "testsrc2=s=320x480:d=4:r=30",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-shortest", str(source),
            ],
            check=True,
        )
        history.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "plan": "pr",
                    "events": [
                        {
                            "id": "event-1", "phase": "act",
                            "at": "2026-08-15T01:00:01Z",
                            "selector": "new", "action": "tap",
                            "postcondition": "open",
                        },
                        {
                            "id": "event-2", "phase": "assert",
                            "at": "2026-08-15T01:00:01.2Z",
                            "actionid": "event-1", "result": "passed",
                            "observation": "open",
                        },
                        {
                            "id": "event-3", "phase": "act",
                            "at": "2026-08-15T01:00:02Z",
                            "selector": "options", "action": "swipe-up",
                            "postcondition": "picker",
                        },
                        {
                            "id": "event-4", "phase": "assert",
                            "at": "2026-08-15T01:00:02.7Z",
                            "actionid": "event-3", "result": "passed",
                            "observation": "picker",
                        },
                    ],
                }
            ),
            encoding="utf-8",
        )
        action_map.write_text(
            json.dumps(
                {
                    "version": 1,
                    "recording_started_at": "2026-08-15T01:00:00Z",
                    "actions": [
                        {"action_id": "event-1", "point": [0.8, 0.9]},
                        {
                            "action_id": "event-3", "from": [0.5, 0.8],
                            "to": [0.5, 0.3], "duration": 0.5,
                        },
                    ],
                }
            ),
            encoding="utf-8",
        )
        subprocess.run(
            [
                "python3", str(SCRIPT), "timeline-from-app-flow", str(history),
                "--action-map", str(action_map), "--output", str(timeline),
            ],
            check=True,
        )
        subprocess.run(
            [
                "python3", str(SCRIPT), "build", str(source),
                "--timeline", str(timeline), "--output-dir", str(artifacts),
                "--stem", "flow", "--no-auto-trim",
            ],
            check=True,
        )
        return source, history, timeline, artifacts / "flow-receipt.json", validation

    def validate_command(
        self, receipt: Path, timeline: Path, history: Path, output: Path
    ) -> list:
        return [
            "python3", str(SCRIPT), "validate-packet", str(receipt),
            "--timeline", str(timeline), "--history", str(history),
            "--output", str(output),
        ]

    def test_validates_and_seals_complete_app_flow_packet_deterministically(self) -> None:
        with tempfile.TemporaryDirectory(prefix="proof-packet-validation-") as temporary:
            root = Path(temporary)
            _, history, timeline, receipt, validation = self.build_app_flow_packet(root)
            command = self.validate_command(receipt, timeline, history, validation)

            first = subprocess.run(
                command, check=True, text=True, stdout=subprocess.PIPE
            )
            first_hash = MEDIA.sha256(validation)
            second = subprocess.run(
                command + ["--overwrite"], check=True, text=True,
                stdout=subprocess.PIPE,
            )
            value = json.loads(validation.read_text(encoding="utf-8"))
            unsigned = {key: item for key, item in value.items() if key != "seal"}

            self.assertIn('"verdict": "passed"', first.stdout)
            self.assertIn('"actions": 2', second.stdout)
            self.assertEqual(first_hash, MEDIA.sha256(validation))
            self.assertEqual(value["verdict"], "passed")
            self.assertEqual(value["actionCount"], 2)
            self.assertEqual(
                value["seal"]["canonicalPayloadSha256"],
                MEDIA.validation_seal(unsigned),
            )
            self.assertGreaterEqual(value["pairing"]["videoSsim"], 0.75)
            self.assertRegex(
                value["pairing"]["decodedAudioSha256"], r"^[0-9a-f]{64}$"
            )
            self.assertEqual(
                [item["action_id"] for item in value["actions"]],
                ["event-1", "event-3"],
            )

    def test_rejects_missing_history_unmapped_actions_and_credentials(self) -> None:
        with tempfile.TemporaryDirectory(prefix="proof-packet-rejections-") as temporary:
            root = Path(temporary)
            _, history, timeline, receipt, validation = self.build_app_flow_packet(root)
            without_history = subprocess.run(
                [
                    "python3", str(SCRIPT), "validate-packet", str(receipt),
                    "--timeline", str(timeline), "--output", str(validation),
                ],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.assertNotEqual(without_history.returncode, 0)
            self.assertIn("requires its bound app-flow history", without_history.stderr)

            packet = json.loads(receipt.read_text(encoding="utf-8"))
            packet["events"][1]["action_id"] = "event-1"
            with self.assertRaisesRegex(MEDIA.ProofMediaError, "unmapped action id"):
                timeline_value = MEDIA.load_timeline(timeline, 4.0)
                MEDIA.validate_packet_action_ledger(
                    timeline_value, packet, 320, 480, 4.0
                )

            secret_history = json.loads(history.read_text(encoding="utf-8"))
            secret_history["events"][0]["postcondition"] = (
                "Token: ABCDEFGHIJKLMNOP"
            )
            with self.assertRaisesRegex(MEDIA.ProofMediaError, "credential"):
                MEDIA.validate_history_actions(
                    secret_history, ["event-1", "event-3"], []
                )

    def test_rejects_unrelated_same_shape_annotated_video(self) -> None:
        with tempfile.TemporaryDirectory(prefix="proof-packet-content-") as temporary:
            root = Path(temporary)
            _, history, timeline, receipt, validation = self.build_app_flow_packet(root)
            packet = json.loads(receipt.read_text(encoding="utf-8"))
            annotated = Path(packet["artifacts"]["annotated_video"]["path"])
            subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "color=c=red:s=320x480:d=4:r=30",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-shortest", str(annotated),
                ],
                check=True,
            )
            packet["artifacts"]["annotated_video"] = MEDIA.artifact_record(
                "ffprobe", annotated
            )
            receipt.write_text(json.dumps(packet), encoding="utf-8")

            result = subprocess.run(
                self.validate_command(receipt, timeline, history, validation),
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("not content-paired", result.stderr)
            self.assertFalse(validation.exists())


@unittest.skipUnless(
    all(shutil.which(name) for name in ("ffmpeg", "ffprobe", "magick")),
    "media tools unavailable",
)
class RenderSmokeTest(unittest.TestCase):
    def extract_video_frame(
        self, video: Path, timestamp: str, destination: Path
    ) -> Path:
        subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-ss", timestamp, "-i", str(video), "-frames:v", "1",
                str(destination),
            ],
            check=True,
        )
        return destination

    def image_absolute_error(
        self, left: Path, right: Path, *, fuzz: Optional[str] = None
    ) -> float:
        command = ["magick", "compare"]
        if fuzz is not None:
            command.extend(["-fuzz", fuzz])
        command.extend(["-metric", "AE", str(left), str(right), "null:"])
        comparison = subprocess.run(
            command,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertIn(
            comparison.returncode,
            (0, 1),
            msg="ImageMagick comparison failed for {0} and {1}: {2}".format(
                left, right, comparison.stderr.strip() or comparison.stdout.strip()
            ),
        )
        metric_lines = comparison.stderr.strip().splitlines()
        self.assertTrue(
            metric_lines,
            msg="ImageMagick returned no AE metric for {0} and {1}: {2}".format(
                left, right, comparison.stdout.strip()
            ),
        )
        match = re.match(
            r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?",
            metric_lines[-1] if metric_lines else "",
        )
        self.assertIsNotNone(
            match,
            msg="ImageMagick returned no numeric AE metric for {0} and {1}: {2}".format(
                left, right, comparison.stderr.strip() or comparison.stdout.strip()
            ),
        )
        if match is None:
            return 0.0
        return float(match.group(0))

    def test_swipe_timeline_renders_distinct_video_and_still_overlays(self) -> None:
        with tempfile.TemporaryDirectory(prefix="proof-swipe-flow-") as temporary:
            root = Path(temporary)
            source = root / "raw.mp4"
            timeline = root / "timeline.json"
            output = root / "artifacts"
            image_output = root / "image-artifacts"
            subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "color=c=0x1d4ed8:s=360x640:d=4:r=30",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
                ],
                check=True,
            )
            subprocess.run(
                ["python3", str(SCRIPT), "timeline-init", str(timeline)],
                check=True,
            )
            for at, start, end in (
                ("0.8", "0.2,0.8", "0.8,0.2"),
                ("2.2", "0.8,0.2", "0.2,0.8"),
            ):
                subprocess.run(
                    [
                        "python3", str(SCRIPT), "timeline-add", str(timeline),
                        "--kind", "swipe", "--at", at, "--duration", "0.6",
                        "--from", start, "--to", end,
                    ],
                    check=True,
                )
            timeline_payload = json.loads(timeline.read_text(encoding="utf-8"))
            self.assertEqual(
                timeline_payload["events"],
                [
                    {
                        "kind": "swipe", "at": 0.8, "action_id": "action-1",
                        "from": [0.2, 0.8],
                        "to": [0.8, 0.2], "duration": 0.6,
                    },
                    {
                        "kind": "swipe", "at": 2.2, "action_id": "action-2",
                        "from": [0.8, 0.2],
                        "to": [0.2, 0.8], "duration": 0.6,
                    },
                ],
            )

            sprite_dir = root / "sprites"
            sprite_dir.mkdir()
            first_sprites, _, _ = MEDIA.make_swipe_sprites(
                "magick", sprite_dir, (72, 511), (287, 128), 24
            )
            second_sprites, _, _ = MEDIA.make_swipe_sprites(
                "magick", sprite_dir, (287, 128), (72, 511), 24
            )
            self.assertEqual(len(first_sprites), 6)
            self.assertEqual(len(second_sprites), 6)
            self.assertTrue(set(first_sprites).isdisjoint(second_sprites))
            self.assertEqual(len(set(sprite_dir.glob("swipe-*.png"))), 12)

            subprocess.run(
                [
                    "python3", str(SCRIPT), "build", str(source), "--timeline",
                    str(timeline), "--output-dir", str(output), "--stem", "swipes",
                    "--no-auto-trim",
                ],
                check=True,
            )
            receipt = json.loads((output / "swipes-receipt.json").read_text(encoding="utf-8"))
            self.assertEqual([event["kind"] for event in receipt["events"]], ["swipe", "swipe"])
            self.assertEqual(receipt["events"][0]["from"], [72, 511])
            self.assertEqual(receipt["events"][0]["to"], [287, 128])
            self.assertEqual(receipt["events"][1]["from"], [287, 128])
            self.assertEqual(receipt["events"][1]["to"], [72, 511])

            frames = {}
            # build_image_annotations selects sprites[len(sprites)//2]. The
            # video renderer gives each phase duration/phase_count plus 20 ms
            # of overlap, so sample that same canonical phase explicitly.
            second_swipe_at = 2.2
            swipe_duration = 0.6
            swipe_phase_count = len(second_sprites)
            canonical_phase = swipe_phase_count // 2
            phase_duration = swipe_duration / swipe_phase_count
            canonical_phase_start = second_swipe_at + canonical_phase * phase_duration
            canonical_phase_end = canonical_phase_start + phase_duration + 0.02
            canonical_phase_sample = 2.55
            self.assertLess(canonical_phase_start, canonical_phase_sample)
            self.assertLess(canonical_phase_sample, canonical_phase_end)
            for label, timestamp in (
                ("first-inside", "1.15"),
                ("second-inside", str(canonical_phase_sample)),
                ("outside", "3.5"),
            ):
                for kind in ("clean", "annotated"):
                    frames[(label, kind)] = self.extract_video_frame(
                        output / "swipes-{0}.mp4".format(kind),
                        timestamp,
                        root / "{0}-{1}.png".format(label, kind),
                    )

            first_difference = self.image_absolute_error(
                frames[("first-inside", "clean")],
                frames[("first-inside", "annotated")],
            )
            second_difference = self.image_absolute_error(
                frames[("second-inside", "clean")],
                frames[("second-inside", "annotated")],
            )
            self.assertGreater(first_difference, 0)
            self.assertGreater(second_difference, 0)
            self.assertGreater(
                self.image_absolute_error(
                    frames[("first-inside", "annotated")],
                    frames[("second-inside", "annotated")],
                    fuzz="3%",
                ),
                360 * 640 * 0.01,
            )
            self.assertLess(
                self.image_absolute_error(
                    frames[("outside", "clean")],
                    frames[("outside", "annotated")],
                    fuzz="1%",
                ),
                360 * 640 * 0.001,
            )

            still_source = root / "still.png"
            self.extract_video_frame(
                output / "swipes-clean.mp4", str(canonical_phase_sample), still_source
            )
            subprocess.run(
                [
                    "python3", str(SCRIPT), "image", str(still_source), "--timeline",
                    str(timeline), "--event", "1", "--output-dir", str(image_output),
                    "--stem", "swipe-still",
                ],
                check=True,
            )
            still_annotated = image_output / "swipe-still-image-annotated.png"
            self.assertGreater(
                self.image_absolute_error(
                    image_output / "swipe-still-image-clean.png", still_annotated
                ),
                0,
            )
            self.assertLess(
                self.image_absolute_error(
                    still_annotated,
                    frames[("second-inside", "annotated")],
                    fuzz="3%",
                ),
                360 * 640 * 0.01,
                msg=(
                    "The image renderer uses swipe sprite phase len(sprites)//2; "
                    "the sampled video frame must fall inside that same canonical phase."
                ),
            )
            image_receipt = json.loads(
                (image_output / "swipe-still-image-receipt.json").read_text(encoding="utf-8")
            )
            self.assertEqual(image_receipt["event"]["index"], 1)
            self.assertEqual(image_receipt["event"]["kind"], "swipe")
            self.assertEqual(image_receipt["event"]["from"], [287, 128])
            self.assertEqual(image_receipt["event"]["to"], [72, 511])

    def test_caption_layout_wraps_long_tokens_and_rejects_more_than_three_lines(self) -> None:
        with tempfile.TemporaryDirectory(prefix="proof-caption-layout-") as temporary:
            root = Path(temporary)
            font = MEDIA.find_font()
            card, _, _ = MEDIA.make_caption_card(
                "magick", font, root, 0, "w" * 40, 360, 640
            )
            text_layer = root / "caption-text-0.png"
            self.assertEqual(MEDIA.probe_image("magick", card)[0], 324)
            self.assertEqual(MEDIA.probe_image("magick", text_layer)[0], 280)
            self.assertGreater(MEDIA.probe_image("magick", text_layer)[1], 22)
            with self.assertRaisesRegex(MEDIA.ProofMediaError, "three rendered lines"):
                MEDIA.make_caption_card(
                    "magick", font, root, 1, "w" * 200, 360, 640
                )

    def test_image_rejects_event_selection_for_an_empty_timeline(self) -> None:
        with tempfile.TemporaryDirectory(prefix="proof-empty-image-event-") as temporary:
            root = Path(temporary)
            source = root / "raw.png"
            timeline = root / "timeline.json"
            output = root / "artifacts"
            subprocess.run(["magick", "-size", "32x32", "xc:blue", str(source)], check=True)
            timeline.write_text(
                json.dumps({"version": 1, "events": []}), encoding="utf-8"
            )

            result = subprocess.run(
                [
                    "python3", str(SCRIPT), "image", str(source), "--timeline",
                    str(timeline), "--event", "0", "--output-dir", str(output),
                    "--stem", "empty",
                ],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("--event must identify an existing timeline event", result.stderr)
            self.assertEqual(list(output.glob("empty-*")), [])

    def test_failed_image_build_leaves_existing_packet_unchanged(self) -> None:
        with tempfile.TemporaryDirectory(prefix="proof-image-atomic-") as temporary:
            root = Path(temporary)
            source = root / "raw.png"
            timeline = root / "timeline.json"
            output = root / "artifacts"
            output.mkdir()
            subprocess.run(["magick", "-size", "32x32", "xc:blue", str(source)], check=True)
            timeline.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "events": [
                            {"kind": "caption", "start": 0, "end": 1, "caption": "proof"}
                        ],
                    }
                ),
                encoding="utf-8",
            )
            existing = {
                output / "proof-image-clean.png": b"old-clean",
                output / "proof-image-annotated.png": b"old-annotated",
                output / "proof-image-receipt.json": b"old-receipt",
            }
            for path, contents in existing.items():
                path.write_bytes(contents)
            result = subprocess.run(
                [
                    "python3", str(SCRIPT), "image", str(source), "--timeline",
                    str(timeline), "--event", "9", "--output-dir", str(output),
                    "--stem", "proof", "--overwrite",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.assertNotEqual(result.returncode, 0)
            for path, contents in existing.items():
                self.assertEqual(path.read_bytes(), contents)

    def test_non_silent_static_video_is_not_auto_trimmed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="proof-media-audio-") as temporary:
            root = Path(temporary)
            source = root / "raw.mp4"
            timeline = root / "timeline.json"
            output = root / "artifacts"
            subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=5:r=30",
                    "-f", "lavfi", "-i", "sine=frequency=880:duration=5",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                    "-shortest", str(source),
                ],
                check=True,
            )
            timeline.write_text(
                json.dumps({"version": 1, "events": []}), encoding="utf-8"
            )
            subprocess.run(
                [
                    "python3", str(SCRIPT), "build", str(source), "--timeline",
                    str(timeline), "--output-dir", str(output), "--stem", "audio",
                ],
                check=True,
            )
            receipt = json.loads((output / "audio-receipt.json").read_text(encoding="utf-8"))
            self.assertLess(receipt["edit"]["removed_duration"], 0.1)

    def test_uses_staged_clean_duration_for_annotation_limit_and_receipt(self) -> None:
        with tempfile.TemporaryDirectory(prefix="proof-rendered-duration-") as temporary:
            root = Path(temporary)
            source = root / "raw.mp4"
            timeline = root / "timeline.json"
            output = root / "artifacts"
            subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "testsrc2=s=320x240:d=2:r=30",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
                ],
                check=True,
            )
            timeline.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "cuts": [{"start": 0.017, "end": 1.563}],
                        "events": [
                            {
                                "kind": "tap", "at": 1.4, "x": 0.5, "y": 0.5,
                                "caption": "The final frame remains visible",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            subprocess.run(
                [
                    "python3", str(SCRIPT), "build", str(source), "--timeline",
                    str(timeline), "--output-dir", str(output), "--stem", "quantized",
                ],
                check=True,
            )
            receipt = json.loads((output / "quantized-receipt.json").read_text(encoding="utf-8"))
            rendered_duration = receipt["artifacts"]["clean_video"]["duration"]
            self.assertAlmostEqual(receipt["edit"]["requested_output_duration"], 1.546, places=3)
            self.assertNotAlmostEqual(
                receipt["edit"]["requested_output_duration"], rendered_duration, places=3
            )
            self.assertAlmostEqual(receipt["edit"]["output_duration"], rendered_duration, places=6)
            self.assertAlmostEqual(
                receipt["events"][0]["caption_output"][1], rendered_duration, places=6
            )
            self.assertEqual(
                receipt["artifacts"]["clean_video"]["frame_count"],
                receipt["artifacts"]["annotated_video"]["frame_count"],
            )
            self.assertEqual(
                (
                    receipt["artifacts"]["clean_video"]["width"],
                    receipt["artifacts"]["clean_video"]["height"],
                ),
                (320, 240),
            )

    def test_rejects_display_rotation_that_changes_rendered_dimensions(self) -> None:
        with tempfile.TemporaryDirectory(prefix="proof-rotated-dimensions-") as temporary:
            root = Path(temporary)
            base = root / "base.mp4"
            source = root / "rotated.mp4"
            timeline = root / "timeline.json"
            output = root / "artifacts"
            subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=1:r=30",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(base),
                ],
                check=True,
            )
            subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-display_rotation:v:0", "90", "-i", str(base), "-c", "copy",
                    str(source),
                ],
                check=True,
            )
            timeline.write_text(
                json.dumps({"version": 1, "events": []}), encoding="utf-8"
            )

            result = subprocess.run(
                [
                    "python3", str(SCRIPT), "build", str(source), "--timeline",
                    str(timeline), "--output-dir", str(output), "--stem", "rotated",
                    "--no-auto-trim",
                ],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Rendered dimensions differ", result.stderr)
            self.assertEqual(list(output.glob("rotated-*")), [])

    def test_repeated_builds_have_identical_packet_hashes_and_keep_full_timing(self) -> None:
        with tempfile.TemporaryDirectory(prefix="proof-deterministic-build-") as temporary:
            root = Path(temporary)
            source = root / "raw.mp4"
            timeline = root / "timeline.json"
            output = root / "artifacts"
            subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "testsrc2=s=320x240:d=1:r=30",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
                ],
                check=True,
            )
            timeline.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "events": [
                            {
                                "kind": "tap", "at": 0.4, "x": 0.5, "y": 0.5,
                                "caption": "The result remains visible",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            command = [
                "python3", str(SCRIPT), "build", str(source), "--timeline",
                str(timeline), "--output-dir", str(output), "--stem", "repeatable",
                "--no-auto-trim",
            ]
            subprocess.run(command, check=True)
            packet_names = (
                "repeatable-clean.mp4", "repeatable-annotated.mp4",
                "repeatable-clean.png", "repeatable-annotated.png",
                "repeatable-contact-sheet.png", "repeatable-receipt.json",
            )
            first_hashes = {name: MEDIA.sha256(output / name) for name in packet_names}

            subprocess.run(command + ["--overwrite"], check=True)
            second_hashes = {name: MEDIA.sha256(output / name) for name in packet_names}
            receipt = json.loads(
                (output / "repeatable-receipt.json").read_text(encoding="utf-8")
            )
            metadata = subprocess.run(
                [
                    "ffprobe", "-v", "error", "-show_entries",
                    "format_tags=creation_time:stream_tags=creation_time",
                    "-of", "json", str(output / "repeatable-clean.mp4"),
                ],
                check=True,
                text=True,
                stdout=subprocess.PIPE,
            ).stdout

            self.assertEqual(first_hashes, second_hashes)
            self.assertNotIn("creation_time", metadata)
            self.assertTrue(receipt["edit"]["no_auto_trim"])
            self.assertFalse(receipt["edit"]["auto_trim"])
            self.assertAlmostEqual(
                receipt["edit"]["source_duration"],
                receipt["edit"]["output_duration"],
                places=2,
            )

    def test_image_and_video_packets_with_same_stem_do_not_collide(self) -> None:
        with tempfile.TemporaryDirectory(prefix="proof-packet-names-") as temporary:
            root = Path(temporary)
            source_video = root / "raw.mp4"
            source_image = root / "raw.png"
            timeline = root / "timeline.json"
            output = root / "artifacts"
            subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=1:r=30",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source_video),
                ],
                check=True,
            )
            subprocess.run(
                ["magick", "-size", "320x240", "xc:green", str(source_image)],
                check=True,
            )
            timeline.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "events": [
                            {"kind": "tap", "at": 0.4, "x": 0.5, "y": 0.5, "caption": "Proof"}
                        ],
                    }
                ),
                encoding="utf-8",
            )
            subprocess.run(
                [
                    "python3", str(SCRIPT), "build", str(source_video), "--timeline",
                    str(timeline), "--output-dir", str(output), "--stem", "shared",
                    "--no-auto-trim",
                ],
                check=True,
            )
            video_packet = {
                name: MEDIA.sha256(output / name)
                for name in (
                    "shared-clean.mp4", "shared-annotated.mp4", "shared-clean.png",
                    "shared-annotated.png", "shared-contact-sheet.png", "shared-receipt.json",
                )
            }
            subprocess.run(
                [
                    "python3", str(SCRIPT), "image", str(source_image), "--timeline",
                    str(timeline), "--output-dir", str(output), "--stem", "shared",
                    "--overwrite",
                ],
                check=True,
            )
            self.assertEqual(
                video_packet,
                {name: MEDIA.sha256(output / name) for name in video_packet},
            )
            for name in (
                "shared-image-clean.png", "shared-image-annotated.png",
                "shared-image-receipt.json",
            ):
                self.assertGreater((output / name).stat().st_size, 0)

    def test_builds_pacing_identical_clean_and_annotated_outputs(self) -> None:
        with tempfile.TemporaryDirectory(prefix="proof-media-test-") as temporary:
            root = Path(temporary)
            source = root / "raw.mp4"
            timeline = root / "timeline.json"
            output = root / "artifacts"
            subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=0x1d4ed8:s=360x640:d=1:r=30",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=0x111827:s=360x640:d=5:r=30",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=0x15803d:s=360x640:d=1:r=30",
                    "-f",
                    "lavfi",
                    "-i",
                    "anullsrc=r=48000:cl=stereo:d=7",
                    "-filter_complex",
                    "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
                    "-map",
                    "[v]",
                    "-map",
                    "3:a",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-shortest",
                    str(source),
                ],
                check=True,
            )
            timeline.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "title": "Synthetic proof",
                        "events": [
                            {
                                "kind": "tap",
                                "at": 0.5,
                                "x": 0.5,
                                "y": 0.5,
                                "label": "Continue",
                                "expect": "The screen changes",
                            },
                            {
                                "kind": "caption",
                                "start": 6.0,
                                "end": 6.8,
                                "caption": "Proof: the final state is visible",
                            },
                        ],
                    }
                ),
                encoding="utf-8",
            )
            subprocess.run(
                [
                    "python3",
                    str(SCRIPT),
                    "build",
                    str(source),
                    "--timeline",
                    str(timeline),
                    "--output-dir",
                    str(output),
                    "--stem",
                    "smoke",
                    "--poster-at",
                    "6.2",
                    "--deny-secret-pattern",
                    "never-render-this",
                ],
                check=True,
            )
            receipt = json.loads((output / "smoke-receipt.json").read_text(encoding="utf-8"))
            clean_duration = receipt["artifacts"]["clean_video"]["duration"]
            annotated_duration = receipt["artifacts"]["annotated_video"]["duration"]
            self.assertAlmostEqual(clean_duration, annotated_duration, places=2)
            self.assertEqual(
                receipt["artifacts"]["clean_video"]["frame_count"],
                receipt["artifacts"]["annotated_video"]["frame_count"],
            )
            self.assertGreater(receipt["edit"]["removed_duration"], 1.0)
            self.assertEqual(receipt["edit"]["poster_at"], 6.2)
            self.assertEqual(receipt["edit"]["freeze_minimum"], 2.5)
            self.assertEqual(receipt["edit"]["max_freeze"], 2.0)
            self.assertEqual(receipt["edit"]["freeze_noise"], 0.002)
            self.assertEqual(receipt["edit"]["silence_noise"], "-45dB")
            self.assertEqual(receipt["edit"]["deny_secret_patterns"], ["never-render-this"])
            for name in (
                "smoke-clean.mp4",
                "smoke-annotated.mp4",
                "smoke-clean.png",
                "smoke-annotated.png",
                "smoke-contact-sheet.png",
            ):
                self.assertGreater((output / name).stat().st_size, 0)
            clean_frame = root / "clean-frame.png"
            annotated_frame = root / "annotated-frame.png"
            for video, frame in (
                (output / "smoke-clean.mp4", clean_frame),
                (output / "smoke-annotated.mp4", annotated_frame),
            ):
                subprocess.run(
                    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", "0.5", "-i", str(video), "-frames:v", "1", str(frame)],
                    check=True,
                )
            comparison = subprocess.run(
                ["magick", "compare", "-metric", "AE", str(clean_frame), str(annotated_frame), "null:"],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.assertGreater(float(comparison.stderr.split()[0]), 0)
            clean_outside = root / "clean-outside.png"
            annotated_outside = root / "annotated-outside.png"
            for video, frame in (
                (output / "smoke-clean.mp4", clean_outside),
                (output / "smoke-annotated.mp4", annotated_outside),
            ):
                subprocess.run(
                    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", "2.5", "-i", str(video), "-frames:v", "1", str(frame)],
                    check=True,
                )
            outside_comparison = subprocess.run(
                ["magick", "compare", "-metric", "AE", str(clean_outside), str(annotated_outside), "null:"],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.assertLessEqual(float(outside_comparison.stderr.split()[0]), 1)
            image_output = root / "image-artifacts"
            subprocess.run(
                [
                    "python3",
                    str(SCRIPT),
                    "image",
                    str(clean_frame),
                    "--timeline",
                    str(timeline),
                    "--event",
                    "0",
                    "--output-dir",
                    str(image_output),
                    "--stem",
                    "still",
                    "--deny-secret-pattern",
                    "never-render-this",
                ],
                check=True,
            )
            still_clean = image_output / "still-image-clean.png"
            still_annotated = image_output / "still-image-annotated.png"
            self.assertEqual(MEDIA.probe_image("magick", still_clean), MEDIA.probe_image("magick", still_annotated))
            still_comparison = subprocess.run(
                ["magick", "compare", "-metric", "AE", str(still_clean), str(still_annotated), "null:"],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.assertGreater(float(still_comparison.stderr.split()[0]), 0)
            image_receipt = json.loads(
                (image_output / "still-image-receipt.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                image_receipt["parameters"]["deny_secret_patterns"],
                ["never-render-this"],
            )


if __name__ == "__main__":
    unittest.main()
