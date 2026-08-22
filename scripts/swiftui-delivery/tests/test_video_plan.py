import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("swiftui_video", ROOT / "annotate_video.py")
video = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(video)


class VideoPlanTests(unittest.TestCase):
    def plan(self, source, output):
        return {
            "schemaVersion": 1, "kind": "swiftui-video-edit-plan",
            "source": str(source), "output": str(output),
            "segments": [
                {"start": 0, "end": 2, "reason": "Shows setup and the control"},
                {"start": 5, "end": 9, "reason": "Retains the slow wait that reproduces the bug",
                 "intentionalPause": True},
            ],
            "annotations": [{"start": 0.2, "end": 1.8,
                             "text": "Watch the connection status",
                             "gesture": {"type": "tap", "x": 190, "y": 510}}],
        }

    def test_plan_requires_annotation_and_reasoned_segments(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "raw.mp4"
            source.write_bytes(b"video")
            plan = self.plan(source, root / "edited.mp4")
            self.assertEqual(video.validate_plan(plan), [])
            plan["annotations"] = []
            self.assertTrue(any("annotations" in error for error in video.validate_plan(plan)))

    def test_ffmpeg_command_trims_concats_and_draws_text(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "raw.mp4"
            source.write_bytes(b"video")
            with mock.patch.object(video, "has_audio", return_value=False):
                command = video.build_command(self.plan(source, root / "edited.mp4"),
                                              "ffmpeg", "ffprobe",
                                              [{"card": root / "note.png",
                                                "gesture": root / "gesture.png"}])
            filters = command[command.index("-filter_complex") + 1]
            self.assertIn("trim=start=0:end=2", filters)
            self.assertIn("concat=n=2", filters)
            self.assertIn("overlay", filters)
            self.assertIn("gesture0", filters)

    def test_audio_and_video_inputs_are_interleaved_for_concat(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "raw.mp4"
            source.write_bytes(b"video")
            with mock.patch.object(video, "has_audio", return_value=True):
                command = video.build_command(self.plan(source, root / "edited.mp4"),
                                              "ffmpeg", "ffprobe",
                                              [{"card": root / "note.png",
                                                "gesture": root / "gesture.png"}])
            filters = command[command.index("-filter_complex") + 1]
            self.assertIn("[v0][a0][v1][a1]concat=n=2:v=1:a=1", filters)

    def test_swipe_requires_end_coordinates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "raw.mp4"
            source.write_bytes(b"video")
            plan = self.plan(source, root / "edited.mp4")
            plan["annotations"][0]["gesture"] = {"type": "swipe", "x": 20, "y": 40}
            self.assertTrue(any("endX" in error for error in video.validate_plan(plan)))

    def test_intentional_pause_without_reason_returns_errors_not_a_traceback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "raw.mp4"
            source.write_bytes(b"video")
            plan = self.plan(source, root / "edited.mp4")
            plan["segments"][1].pop("reason")
            errors = video.validate_plan(plan)
            self.assertTrue(any("reason" in error for error in errors))

    def test_external_editor_output_gets_a_hash_bound_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output = root / "raw.mp4", root / "edited.mp4"
            source.write_bytes(b"raw-video")
            output.write_bytes(b"edited-video")
            plan_path = root / "plan.json"
            plan_path.write_text(json.dumps(self.plan(source, output)))
            with mock.patch.object(video, "duration", side_effect=[8.0, 6.0]):
                result = video.adopt_output(plan_path, "ffprobe", "RocketSim 16.4.3")
            receipt = json.loads(Path(result["receipt"]).read_text())
            self.assertEqual(receipt["renderer"], "external-editor")
            self.assertEqual(receipt["editor"], "RocketSim 16.4.3")
            self.assertEqual(receipt["sourceSha256"], video.sha256(source))
            self.assertEqual(receipt["outputSha256"], video.sha256(output))

    def test_annotation_card_wraps_to_the_video_width(self):
        with tempfile.TemporaryDirectory() as directory:
            responses = [
                mock.Mock(stdout=""), mock.Mock(stdout="425 37"),
                mock.Mock(stdout=""), mock.Mock(stdout="140"),
                mock.Mock(stdout=""), mock.Mock(stdout="318 74"),
                mock.Mock(stdout=""),
            ]
            with mock.patch.object(video.subprocess, "run", side_effect=responses) as run:
                video._render_card(
                    {"text": "Tap: watch the selected control"}, "magick", "font",
                    Path(directory) / "card.png", directory, 0, (390, 844))
            commands = [call.args[0] for call in run.call_args_list]
            self.assertIn("318x", commands[4])
            self.assertIn("358x98", commands[6])

    def test_annotation_card_rejects_vertical_clipping(self):
        with tempfile.TemporaryDirectory() as directory:
            responses = [
                mock.Mock(stdout=""), mock.Mock(stdout="425 37"),
                mock.Mock(stdout=""), mock.Mock(stdout="140"),
                mock.Mock(stdout=""), mock.Mock(stdout="318 900"),
            ]
            with mock.patch.object(video.subprocess, "run", side_effect=responses):
                with self.assertRaisesRegex(ValueError, "too tall"):
                    video._render_card(
                        {"text": "An excessively long annotation"}, "magick", "font",
                        Path(directory) / "card.png", directory, 0, (390, 844))

    def test_annotation_card_rejects_unbreakable_text(self):
        with tempfile.TemporaryDirectory() as directory:
            responses = [
                mock.Mock(stdout=""), mock.Mock(stdout="425 37"),
                mock.Mock(stdout=""), mock.Mock(stdout="340"),
            ]
            with mock.patch.object(video.subprocess, "run", side_effect=responses):
                with self.assertRaisesRegex(ValueError, "word too wide"):
                    video._render_card(
                        {"text": "an-unbreakable-identifier"}, "magick", "font",
                        Path(directory) / "card.png", directory, 0, (390, 844))

    def test_annotation_card_rejects_unreadably_narrow_video(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "too small"):
                video._render_card(
                    {"text": "Watch this"}, "magick", "font",
                    Path(directory) / "card.png", directory, 0, (100, 844))

    def test_annotation_font_size_is_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "raw.mp4"
            source.write_bytes(b"video")
            plan = self.plan(source, root / "edited.mp4")
            plan["annotations"][0]["fontSize"] = "large"
            self.assertTrue(any("fontSize" in error for error in video.validate_plan(plan)))
            for invalid in (4, 200, True, float("nan")):
                plan["annotations"][0]["fontSize"] = invalid
                self.assertTrue(any("fontSize" in error for error in video.validate_plan(plan)))

    def test_imagemagick_control_inputs_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "raw.mp4"
            source.write_bytes(b"video")
            plan = self.plan(source, root / "edited.mp4")
            plan["annotations"][0]["text"] = "@/private/file"
            self.assertTrue(any("start with @" in error for error in video.validate_plan(plan)))
            plan["annotations"][0]["text"] = "Watch this"
            plan["annotations"][0]["gesture"]["accent"] = "#fff' fill 'red"
            self.assertTrue(any("hex color" in error for error in video.validate_plan(plan)))
            plan["annotations"][0]["gesture"]["accent"] = "#61D7FFCC"
            self.assertTrue(any("hex color" in error for error in video.validate_plan(plan)))

    def test_non_finite_timing_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "raw.mp4"
            source.write_bytes(b"video")
            plan = self.plan(source, root / "edited.mp4")
            plan["annotations"][0]["start"] = float("nan")
            self.assertTrue(any("timeline" in error for error in video.validate_plan(plan)))

    def test_off_frame_highlight_and_gesture_are_rejected(self):
        plan = {"annotations": [{
            "highlight": {"x": 300, "y": 10, "width": 100, "height": 30},
            "gesture": {"type": "tap", "x": 390, "y": 20},
        }]}
        with self.assertRaisesRegex(ValueError, "highlight"):
            video.validate_frame_geometry(plan, (390, 844))
        plan["annotations"][0].pop("highlight")
        with self.assertRaisesRegex(ValueError, "gesture"):
            video.validate_frame_geometry(plan, (390, 844))


if __name__ == "__main__":
    unittest.main()
