#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT_DIR = Path(__file__).resolve().parent
AGENT = SCRIPT_DIR / "app-flow-agent.py"
APP_FLOW = SCRIPT_DIR / "app-flow.py"
PROOF_MEDIA = (
    SCRIPT_DIR.parents[2]
    / ".agents/skills/prepare-proof-media/scripts/prepare_proof_media.py"
)
CATALOG = SCRIPT_DIR / "app-flow-catalog.json"
PROOF_CATALOG = SCRIPT_DIR / "app-flow-proof-catalog.json"


class AppFlowEvidenceAssemblyTests(unittest.TestCase):
    def run_agent(self, *arguments: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(AGENT), *arguments],
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )

    def test_recording_emits_proof_media_action_map(self) -> None:
        with tempfile.TemporaryDirectory(prefix="app-flow-proof-") as temporary:
            root = Path(temporary)
            session = root / "session.json"
            raw_video = root / "raw.mov"
            action_map = root / "action-map.json"
            timeline = root / "timeline.json"
            fake_xcrun = root / "fake-xcrun.sh"
            driver = root / "driver.sh"
            fake_xcrun.write_text(
                """#!/bin/sh
set -eu
if [ "$1" = simctl ] && [ "$2" = ui ]; then
  exit 0
fi
if [ "$1" = simctl ] && [ "$2" = io ]; then
  for output do :; done
  printf 'synthetic-recorder-contract' >"$output"
  exit 0
fi
exit 1
""",
                encoding="utf-8",
            )
            fake_xcrun.chmod(0o755)
            driver.write_text(
                f"""#!/bin/sh
set -eu
tap_id=$(python3 {AGENT} act --session {session} --selector composer-command-menu --action tap --postcondition menu-visible --point 0.5,0.8)
python3 {AGENT} assert --session {session} --action-id "$tap_id" --result passed --observation menu-visible >/dev/null
swipe_id=$(python3 {AGENT} act --session {session} --selector composer-command-menu --action swipe-up --postcondition final-skill-visible --from-point 0.5,0.8 --to-point 0.5,0.3 --duration 0.6)
python3 {AGENT} assert --session {session} --action-id "$swipe_id" --result passed --observation final-skill-visible >/dev/null
""",
                encoding="utf-8",
            )
            driver.chmod(0o755)
            self.run_agent(
                "prepare",
                "--session",
                str(session),
                "--simulator-id",
                "00000000-0000-0000-0000-000000000001",
                "--plan",
                "regression",
            )
            environment = dict(os.environ)
            environment["T3_SWIFT_XCRUN_COMMAND"] = str(fake_xcrun)
            self.run_agent(
                "record",
                "--session",
                str(session),
                "--journey-id",
                "skills-popup-keyboard-readability",
                "--video",
                str(raw_video),
                "--",
                str(driver),
                env=environment,
            )
            self.run_agent(
                "proof-map",
                "--session",
                str(session),
                "--output",
                str(action_map),
                "--title",
                "Skills popup proof",
            )
            subprocess.run(
                [
                    sys.executable,
                    str(PROOF_MEDIA),
                    "timeline-from-app-flow",
                    str(session),
                    "--action-map",
                    str(action_map),
                    "--output",
                    str(timeline),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
            )

            session_value = json.loads(session.read_text(encoding="utf-8"))
            map_value = json.loads(action_map.read_text(encoding="utf-8"))
            timeline_value = json.loads(timeline.read_text(encoding="utf-8"))
            self.assertEqual(session_value["recording"]["status"], "complete")
            self.assertEqual(session_value["recording"]["appearance"], "dark")
            self.assertEqual(map_value["appearance"], "dark")
            self.assertEqual(map_value["journey_id"], "skills-popup-keyboard-readability")
            self.assertEqual(len(map_value["actions"]), 2)
            self.assertGreaterEqual(map_value["actions"][0]["at"], 0)
            self.assertIn("point", map_value["actions"][0])
            self.assertIn("from", map_value["actions"][1])
            self.assertEqual(
                map_value["raw_video"]["sha256"],
                hashlib.sha256(raw_video.read_bytes()).hexdigest(),
            )
            self.assertEqual(
                [event["kind"] for event in timeline_value["events"]],
                ["tap", "swipe"],
            )

    def test_proof_catalog_maps_green_journeys_and_checkpoints(self) -> None:
        catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
        proof_catalog = json.loads(PROOF_CATALOG.read_text(encoding="utf-8"))
        journeys = {journey["id"]: journey for journey in catalog["journeys"]}
        features = proof_catalog["features"]
        self.assertEqual(
            {feature["featureId"] for feature in features},
            {
                "skills-popup-keyboard-clearance",
                "home-thread-list-scrolling",
                "command-palette-top-drawer",
            },
        )
        video_names: set[str] = set()
        for feature in features:
            journey = journeys[feature["journeyId"]]
            self.assertEqual(feature["testMethod"], journey["test"])
            self.assertEqual(feature["appearance"], "dark")
            checkpoint_names = {
                image["checkpoint"] for image in feature["imageProofInputs"]
            }
            self.assertTrue(checkpoint_names)
            self.assertTrue(checkpoint_names.issubset(set(journey["checkpoints"])))
            action_keys = {action["key"] for action in feature["captureActions"]}
            for image in feature["imageProofInputs"]:
                self.assertIn(image["annotateWithAction"], action_keys)
            self.assertTrue(feature["captureActions"])
            for name in feature["videoProofInput"].values():
                self.assertNotIn(name, video_names)
                video_names.add(name)


if __name__ == "__main__":
    unittest.main()
