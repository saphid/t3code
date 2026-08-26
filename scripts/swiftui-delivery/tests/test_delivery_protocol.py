import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


delivery = module("swiftui_delivery_protocol", "swiftui_delivery.py")


def write(path, value):
    path = Path(path)
    if isinstance(value, (dict, list)):
        path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    else:
        path.write_bytes(value)
    return {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def describe(path):
    path = Path(path)
    return {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


class DeliveryProtocolTests(unittest.TestCase):
    def work_item(self, issue="saphid/t3code-personal#1", lane="native-ui"):
        return {
            "schemaVersion": 2, "kind": "swiftui-work-item", "issue": issue,
            "laneId": lane, "rank": 10, "stage": "queued",
            "acceptance": ["The visible result is observable"], "dependencies": [],
            "binding": {"baseCommit": None, "headCommit": None,
                        "launchReceiptSha256": None, "proofSha256": None,
                        "inspectionSha256": None, "phoneGenerationReceiptSha256": None,
                        "acceptanceReceiptSha256": None, "prGenerationReceiptSha256": None,
                        "landedReceiptSha256": None},
        }

    def active_work_item(self, issue="saphid/t3code-personal#1", lane="native-ui"):
        item = self.work_item(issue, lane)
        item["stage"] = "active"
        item["binding"]["baseCommit"] = "a" * 40
        item["binding"]["launchReceiptSha256"] = "b" * 64
        return item

    def external_landing_receipt(self, directory, item):
        directory = Path(directory)
        source_path = directory / "Sources" / "Feature.swift"
        source_path.parent.mkdir(exist_ok=True)
        source_path.write_text("struct ExternallyLandedFeature {}\n")
        source_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
        relative_source = "Sources/Feature.swift"
        receipt = {
            "schemaVersion": 1,
            "kind": "swiftui-external-landing-receipt",
            "provenanceMode": "external-upstream-landing",
            "issue": item["issue"],
            "laneId": item["laneId"],
            "baseCommit": item["binding"]["baseCommit"],
            "launchReceiptSha256": item["binding"]["launchReceiptSha256"],
            "pullRequestUrl": "https://github.com/pingdotgg/t3code/pull/7895",
            "pullRequestState": "MERGED",
            "mergedAt": "2026-08-22T12:05:28Z",
            "mergeCommit": "c" * 40,
            "ancestorAttestation": {
                "mergeCommit": "c" * 40,
                "liveBaseCommit": "d" * 40,
                "method": "git-merge-base-is-ancestor",
                "exitStatus": 0,
                "isAncestor": True,
                "attestedAt": "2026-08-23T13:42:36Z",
            },
            "acceptanceMapping": [{
                "acceptance": acceptance,
                "source": relative_source + ":1",
                "observation": "The current source contains the accepted behavior.",
            } for acceptance in item["acceptance"]],
            "currentSourceCommit": "d" * 40,
            "currentSourceHashes": {relative_source: source_hash},
            "sideEffects": {
                name: False
                for name in delivery.CONTRACT["externalLanding"]["prohibitedSideEffects"]
            },
            "reconciledAt": "2026-08-23T13:45:00Z",
        }
        receipt_path = directory / "external-landing.json"
        write(receipt_path, receipt)
        return receipt, receipt_path

    def make_evidence(self, directory, user_visible=True):
        directory = Path(directory)
        base, head = "a" * 40, "b" * 40
        receipts = {}
        for phase, commit in (("before", base), ("after", head)):
            app = directory / (phase.title() + ".app")
            app.mkdir()
            (app / phase.title()).write_bytes((phase + " executable").encode())
            receipt_path, receipt, _ = delivery.BUILD_STORE.preserve(
                app, directory / "build-store", commit, "Debug", "iphonesimulator")
            receipts[phase] = (describe(receipt_path), receipt)
        base_build, head_build = receipts["before"][0], receipts["after"][0]
        captures = []
        for phase, commit in (("before", base), ("after", head)):
            image = write(directory / (phase + ".png"), (phase + " image").encode())
            captures.append({
                "id": phase + "-image", "phase": phase, "kind": "image",
                "commit": commit, "installedBinarySha256": receipts[phase][1]["binarySha256"],
                "booted": True, "device": "proof-simulator", "appearance": "light",
                "capturedAt": "2026-08-22T01:02:03Z", "expected": "Expected state",
                "observed": "Observed state", "artifact": image,
            })
            raw = write(directory / (phase + "-raw.mp4"), (phase + " raw").encode())
            edited = write(directory / (phase + ".mp4"), (phase + " edited").encode())
            edit_plan = write(directory / (phase + "-edit-plan.json"), {
                "schemaVersion": 1, "kind": "swiftui-video-edit-plan",
                "source": raw["path"], "output": edited["path"],
                "segments": [{"start": 0, "end": 1, "reason": "Shows the interaction"}],
                "annotations": [{"start": 0, "end": 1, "text": "Watch this control"}],
            })
            receipt_value = {
                "schemaVersion": 1, "kind": "swiftui-video-edit-receipt",
                "sourceSha256": raw["sha256"], "outputSha256": edited["sha256"],
                "planSha256": edit_plan["sha256"],
                "sourceDurationSeconds": 2.0, "outputDurationSeconds": 1.0,
                "removedDurationSeconds": 1.0, "ffmpegVersion": "ffmpeg test",
                "imageMagickVersion": "ImageMagick test", "annotationFont": "test-font",
                "ffmpegCommand": ["ffmpeg", "-i", raw["path"]],
                "segments": [{"start": 0, "end": 1, "reason": "Shows the interaction"}],
                "annotations": [{"start": 0, "end": 1, "text": "Watch this control"}],
            }
            receipt = write(directory / (phase + ".mp4.edit-receipt.json"), receipt_value)
            captures.append({
                "id": phase + "-video", "phase": phase, "kind": "video",
                "commit": commit, "installedBinarySha256": receipts[phase][1]["binarySha256"],
                "booted": True, "device": "proof-simulator", "appearance": "not-applicable",
                "capturedAt": "2026-08-22T01:02:03Z", "expected": "Expected interaction",
                "observed": "Observed interaction", "artifact": edited,
                "rawArtifact": raw, "editPlan": edit_plan, "editReceipt": receipt,
            })
        proof = {
            "schemaVersion": 2, "kind": "swiftui-proof",
            "issue": "saphid/t3code-personal#1", "baseCommit": base,
            "headCommit": head, "userVisible": user_visible, "visualChange": False,
            "evidenceException": None, "baseBuildReceipt": base_build,
            "headBuildReceipt": head_build, "captures": captures,
            "verificationCommands": [{"command": "focused tests", "exitStatus": 0,
                                      "testsMatched": 3}],
        }
        proof_path = directory / "proof.json"
        proof_descriptor = write(proof_path, proof)
        reviews = [{
            "captureId": item["id"], "artifactSha256": item["artifact"]["sha256"],
            "phase": item["phase"], "kind": item["kind"], "expected": item["expected"],
            "observed": item["observed"],
            "sideEffectsChecked": "Adjacent navigation and layout remained correct",
            "verdict": "pass",
        } for item in captures]
        inspection = {
            "schemaVersion": 2, "kind": "swiftui-evidence-inspection",
            "issue": proof["issue"], "proofSha256": proof_descriptor["sha256"],
            "reviewer": {"agent": "reviewer-1", "model": "review-model", "harness": "T3"},
            "reviewedAt": "2026-08-22T02:03:04Z", "verdict": "pass",
            "intentComparison": "Before reproduces the defect and after matches acceptance.",
            "sideEffectAssessment": "Checked adjacent navigation, layout, appearance, and input.",
            "captureReviews": reviews,
        }
        inspection_path = directory / "inspection.json"
        inspection_descriptor = write(inspection_path, inspection)
        return proof, proof_path, proof_descriptor, inspection, inspection_path, inspection_descriptor

    def upgrade_proof_to_schema3(self, proof):
        proof["schemaVersion"] = 3
        proof["laneId"] = "native-ui"
        for capture in proof["captures"]:
            lease_hash = "c" * 64
            binding_path = Path(capture["artifact"]["path"]).with_suffix(".lease.json")
            binding = {
                "schemaVersion": 1,
                "kind": "swiftui-simulator-lease-binding",
                "laneId": "native-ui",
                "simulator": {"udid": "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"},
                "leaseSha256": lease_hash,
            }
            binding_descriptor = write(binding_path, binding)
            capture["simulator"] = {
                "udid": "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
                "runtime": "iOS 26.0",
                "deviceType": "iPhone 17 Pro",
                "laneId": "native-ui",
                "leaseSha256": lease_hash,
                "leaseBinding": binding_descriptor,
            }
            capture["driver"] = {
                "name": "XcodeBuildMCP",
                "version": "2.7.0",
                "axeVersion": "1.8.0",
                "routing": "explicit-udid-per-command",
            }
            capture["coordinateSpace"] = {
                "interactionWidth": 402,
                "interactionHeight": 874,
                "capturePixelWidth": 1206,
                "capturePixelHeight": 2622,
            }
            capture["input"] = {
                "method": "touch",
                "softwareKeyboardVisible": False,
                "notes": "Visible touch interaction; no keyboard was needed.",
            }
        return proof

    def test_many_issues_can_share_one_lane(self):
        first = self.work_item()
        second = self.work_item("saphid/t3code-personal#2", "native-ui")
        self.assertEqual(delivery.validate_catalog([first, second]), [])

    def test_issue_cannot_appear_in_two_work_items(self):
        errors = delivery.validate_catalog([self.work_item(), self.work_item()])
        self.assertTrue(any("more than one work item" in error for error in errors))

    def test_work_item_must_name_exactly_one_lane(self):
        item = self.work_item()
        item["laneId"] = ["one", "two"]
        self.assertTrue(any("laneId" in error for error in delivery.validate_work_item(item)))

    def test_malformed_dependency_returns_validation_errors_without_crashing(self):
        item = self.work_item()
        item["dependencies"] = [{
            "issue": ["not", "an", "issue"],
            "kind": "ordered-after", "satisfiedAt": "accepted",
        }]
        errors = delivery.validate_catalog([item])
        self.assertTrue(any("dependencies[0].issue is invalid" in error for error in errors))

    def test_user_visible_proof_requires_before_and_after_video(self):
        with tempfile.TemporaryDirectory() as directory:
            proof, _, _, _, _, _ = self.make_evidence(directory)
            proof["captures"] = [item for item in proof["captures"]
                                 if not (item["phase"] == "before" and item["kind"] == "video")]
            errors = delivery.validate_proof(proof, True)
            self.assertIn("before evidence requires at least one video", errors)

    def test_capture_binary_must_match_retained_build(self):
        with tempfile.TemporaryDirectory() as directory:
            proof, _, _, _, _, _ = self.make_evidence(directory)
            proof["captures"][0]["installedBinarySha256"] = "0" * 64
            errors = delivery.validate_proof(proof, True)
            self.assertTrue(any("installed binary must match" in error for error in errors))

    def test_schema3_proof_binds_parallel_runtime_context(self):
        with tempfile.TemporaryDirectory() as directory:
            proof, _, _, _, _, _ = self.make_evidence(directory)
            self.upgrade_proof_to_schema3(proof)
            self.assertEqual(delivery.validate_proof(proof, True), [])

    def test_schema3_rejects_missing_coordinate_and_input_context(self):
        with tempfile.TemporaryDirectory() as directory:
            proof, _, _, _, _, _ = self.make_evidence(directory)
            self.upgrade_proof_to_schema3(proof)
            proof["captures"][0].pop("coordinateSpace")
            proof["captures"][0].pop("input")
            errors = delivery.validate_proof(proof, True)
            self.assertTrue(any("coordinateSpace" in error for error in errors))
            self.assertTrue(any("input" in error for error in errors))

    def test_schema2_evidence_remains_valid(self):
        with tempfile.TemporaryDirectory() as directory:
            proof, _, _, _, _, _ = self.make_evidence(directory)
            self.assertEqual(delivery.validate_proof(proof, True), [])

    def test_video_requires_raw_file_edit_receipt_and_annotation(self):
        with tempfile.TemporaryDirectory() as directory:
            proof, _, _, _, _, _ = self.make_evidence(directory)
            video = next(item for item in proof["captures"] if item["kind"] == "video")
            receipt = json.loads(Path(video["editReceipt"]["path"]).read_text())
            receipt["annotations"] = []
            video["editReceipt"] = write(video["editReceipt"]["path"], receipt)
            errors = delivery.validate_proof(proof, True)
            self.assertTrue(any("annotation" in error for error in errors))

    def test_inspection_reviews_every_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            proof, proof_path, _, inspection, _, _ = self.make_evidence(directory)
            inspection["captureReviews"].pop()
            errors = delivery.validate_inspection(inspection, proof, proof_path, True)
            self.assertIn("captureReviews must review every proof capture exactly once", errors)

    def test_inspection_requires_side_effect_details(self):
        with tempfile.TemporaryDirectory() as directory:
            proof, proof_path, _, inspection, _, _ = self.make_evidence(directory)
            inspection["captureReviews"][0]["sideEffectsChecked"] = ""
            errors = delivery.validate_inspection(inspection, proof, proof_path, True)
            self.assertTrue(any("sideEffectsChecked" in error for error in errors))

    def test_generation_plan_reopens_proof_and_inspection(self):
        with tempfile.TemporaryDirectory() as directory:
            proof, _, proof_d, _, _, inspection_d = self.make_evidence(directory)
            item = self.work_item()
            item["stage"] = "proof-ready"
            item["binding"] = {"baseCommit": proof["baseCommit"], "headCommit": proof["headCommit"],
                               "launchReceiptSha256": "e" * 64,
                               "proofSha256": proof_d["sha256"],
                               "inspectionSha256": inspection_d["sha256"],
                               "phoneGenerationReceiptSha256": None,
                               "acceptanceReceiptSha256": None,
                               "prGenerationReceiptSha256": None,
                               "landedReceiptSha256": None}
            item_d = write(Path(directory) / "work-item.json", item)
            catalog_d = write(Path(directory) / "catalog.json", [item])
            plan = {
                "schemaVersion": 2, "kind": "swiftui-generation-plan", "mode": "publish-test",
                "authority": {"actor": "Alex", "source": "T3 thread message",
                              "scopeSha256": "d" * 64, "grantedAt": "2026-08-22T03:04:05Z"},
                "emptyCarryReason":
                    "This isolated protocol fixture has no prior installed Test generation.",
                "catalog": catalog_d,
                "entries": [{"issue": item["issue"], "headCommit": proof["headCommit"],
                             "role": "candidate", "workItem": item_d,
                             "proof": proof_d, "inspection": inspection_d}],
            }
            self.assertEqual(delivery.validate_generation_plan(plan), [])
            inspection = json.loads(Path(inspection_d["path"]).read_text())
            inspection["captureReviews"].pop()
            write(inspection_d["path"], inspection)
            self.assertTrue(delivery.validate_generation_plan(plan))

    def test_publish_test_without_prior_generation_requires_specific_reason(self):
        with tempfile.TemporaryDirectory() as directory:
            proof, _, proof_d, _, _, inspection_d = self.make_evidence(directory)
            item = self.work_item()
            item["stage"] = "proof-ready"
            item["binding"].update({
                "baseCommit": proof["baseCommit"], "headCommit": proof["headCommit"],
                "launchReceiptSha256": "e" * 64, "proofSha256": proof_d["sha256"],
                "inspectionSha256": inspection_d["sha256"],
            })
            item_d = write(Path(directory) / "work-item.json", item)
            catalog_d = write(Path(directory) / "catalog.json", [item])
            plan = {
                "schemaVersion": 2, "kind": "swiftui-generation-plan", "mode": "publish-test",
                "authority": {"actor": "Alex", "source": "T3 thread message",
                              "scopeSha256": "d" * 64, "grantedAt": "2026-08-22T03:04:05Z"},
                "catalog": catalog_d,
                "entries": [{"issue": item["issue"], "headCommit": proof["headCommit"],
                             "role": "candidate", "workItem": item_d,
                             "proof": proof_d, "inspection": inspection_d}],
            }
            errors = delivery.validate_generation_plan(plan)
            self.assertIn(
                "publish-test without carryReceipt requires a specific emptyCarryReason", errors)

    def test_generation_plan_rejects_unsatisfied_dependency_stage(self):
        with tempfile.TemporaryDirectory() as directory:
            proof, _, proof_d, _, _, inspection_d = self.make_evidence(directory)
            dependency = self.work_item("saphid/t3code-personal#2")
            item = self.work_item()
            item["stage"] = "proof-ready"
            item["dependencies"] = [{
                "issue": dependency["issue"], "kind": "ordered-after",
                "satisfiedAt": "accepted",
            }]
            item["binding"].update({
                "baseCommit": proof["baseCommit"], "headCommit": proof["headCommit"],
                "launchReceiptSha256": "e" * 64, "proofSha256": proof_d["sha256"],
                "inspectionSha256": inspection_d["sha256"],
            })
            item_d = write(Path(directory) / "work-item.json", item)
            catalog_d = write(Path(directory) / "catalog.json", [item, dependency])
            plan = {
                "schemaVersion": 2, "kind": "swiftui-generation-plan", "mode": "publish-test",
                "authority": {"actor": "Alex", "source": "T3 thread message",
                              "scopeSha256": "d" * 64, "grantedAt": "2026-08-22T03:04:05Z"},
                "catalog": catalog_d,
                "emptyCarryReason":
                    "This isolated protocol fixture has no prior installed Test generation.",
                "entries": [{"issue": item["issue"], "headCommit": proof["headCommit"],
                             "role": "candidate", "workItem": item_d,
                             "proof": proof_d, "inspection": inspection_d}],
            }
            errors = delivery.validate_generation_plan(plan)
            self.assertTrue(any("requires accepted" in error for error in errors))

    def test_publish_test_carry_must_exactly_match_prior_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            proof, _, proof_d, _, _, inspection_d = self.make_evidence(directory)
            candidate = self.work_item()
            candidate["stage"] = "proof-ready"
            candidate["binding"].update({
                "baseCommit": proof["baseCommit"], "headCommit": proof["headCommit"],
                "launchReceiptSha256": "e" * 64, "proofSha256": proof_d["sha256"],
                "inspectionSha256": inspection_d["sha256"],
            })
            candidate_d = write(Path(directory) / "candidate.json", candidate)

            carried = self.work_item("saphid/t3code-personal#2")
            carried["stage"] = "accepted"
            carried["binding"].update({
                "baseCommit": proof["baseCommit"], "headCommit": proof["headCommit"],
                "launchReceiptSha256": "1" * 64, "proofSha256": proof_d["sha256"],
                "inspectionSha256": inspection_d["sha256"],
                "phoneGenerationReceiptSha256": "2" * 64,
                "acceptanceReceiptSha256": "3" * 64,
            })
            carried_d = write(Path(directory) / "carried.json", carried)
            carried_proof = dict(proof)
            carried_proof["issue"] = carried["issue"]
            carried_proof_d = write(Path(directory) / "carried-proof.json", carried_proof)
            carried["binding"]["proofSha256"] = carried_proof_d["sha256"]
            carried_inspection = json.loads(Path(inspection_d["path"]).read_text())
            carried_inspection["issue"] = carried["issue"]
            carried_inspection["proofSha256"] = carried_proof_d["sha256"]
            carried_inspection_d = write(
                Path(directory) / "carried-inspection.json", carried_inspection)
            carried["binding"]["inspectionSha256"] = carried_inspection_d["sha256"]
            carried_d = write(Path(directory) / "carried.json", carried)
            catalog_d = write(Path(directory) / "catalog.json", [candidate, carried])

            prior = write(Path(directory) / "prior-generation-receipt.json", {
                "schemaVersion": 2, "kind": "swiftui-generation-receipt",
                "mode": "publish-test", "planSha256": "4" * 64,
                "completedAt": "2026-08-22T03:00:00Z",
                "resolvedDestination": "Alex iPhone", "installedArtifactSha256": "5" * 64,
                "entries": [{"issue": carried["issue"],
                             "headCommit": carried["binding"]["headCommit"]}],
            })
            plan = {
                "schemaVersion": 2, "kind": "swiftui-generation-plan", "mode": "publish-test",
                "authority": {"actor": "Alex", "source": "T3 thread message",
                              "scopeSha256": "d" * 64, "grantedAt": "2026-08-22T03:04:05Z"},
                "catalog": catalog_d,
                "carryReceipt": prior,
                "entries": [
                    {"issue": candidate["issue"], "headCommit": proof["headCommit"],
                     "role": "candidate", "workItem": candidate_d,
                     "proof": proof_d, "inspection": inspection_d},
                    {"issue": carried["issue"], "headCommit": carried["binding"]["headCommit"],
                     "role": "installed-carry", "workItem": carried_d,
                     "proof": carried_proof_d, "inspection": carried_inspection_d},
                ],
            }
            self.assertEqual(delivery.validate_generation_plan(plan), [])
            plan["entries"][1]["headCommit"] = "c" * 40
            self.assertTrue(any("exactly preserve" in error
                                for error in delivery.validate_generation_plan(plan)))

    def test_generation_receipt_repeats_plan_issue_head_order(self):
        with tempfile.TemporaryDirectory() as directory:
            plan_path = Path(directory) / "generation-plan.json"
            plan = {
                "schemaVersion": 2, "kind": "swiftui-generation-plan",
                "mode": "publish-test",
                "entries": [
                    {"issue": "saphid/t3code-personal#1", "headCommit": "a" * 40},
                    {"issue": "saphid/t3code-personal#2", "headCommit": "b" * 40},
                ],
            }
            write(plan_path, plan)
            receipt = {
                "schemaVersion": 2, "kind": "swiftui-generation-receipt",
                "mode": "publish-test", "planSha256": delivery.sha256(plan_path),
                "completedAt": "2026-08-22T05:06:07Z",
                "resolvedDestination": "Alex iPhone",
                "installedArtifactSha256": "c" * 64,
                "entries": [
                    {"issue": "saphid/t3code-personal#2", "headCommit": "b" * 40},
                    {"issue": "saphid/t3code-personal#1", "headCommit": "a" * 40},
                ],
            }
            errors = delivery.validate_generation_receipt(receipt, plan, plan_path)
            self.assertIn("generation receipt entries must match plan issue/head order", errors)

    def test_open_pr_receipt_requires_vouched_handoff_checklist(self):
        with tempfile.TemporaryDirectory() as directory:
            plan_path = Path(directory) / "generation-plan.json"
            plan = {
                "schemaVersion": 2, "kind": "swiftui-generation-plan",
                "mode": "open-pr",
                "entries": [
                    {"issue": "saphid/t3code-personal#1", "headCommit": "a" * 40},
                ],
            }
            write(plan_path, plan)
            receipt = {
                "schemaVersion": 2, "kind": "swiftui-generation-receipt",
                "mode": "open-pr", "planSha256": delivery.sha256(plan_path),
                "completedAt": "2026-08-26T05:06:07Z",
                "resolvedDestination": "upstream",
                "installedArtifactSha256": "c" * 64,
                "pullRequestUrl": "https://github.com/pingdotgg/t3code/pull/1",
                "resultingHeadCommit": "a" * 40,
                "entries": [
                    {"issue": "saphid/t3code-personal#1", "headCommit": "a" * 40},
                ],
            }
            errors = delivery.validate_generation_receipt(receipt, plan, plan_path)
            self.assertTrue(any("vouchedHandoffChecklist" in e for e in errors))
            receipt["vouchedHandoffChecklist"] = "pass"
            receipt["vouchedHandoffGaps"] = ["watchOS surface not exercised"]
            errors = delivery.validate_generation_receipt(receipt, plan, plan_path)
            self.assertFalse(any("vouchedHandoff" in e for e in errors))
            receipt["vouchedHandoffGaps"] = [""]
            errors = delivery.validate_generation_receipt(receipt, plan, plan_path)
            self.assertTrue(any("vouchedHandoffGaps" in e for e in errors))

    def test_active_transition_requires_launch_receipt(self):
        _, errors = delivery.transition(self.work_item(), "active")
        self.assertIn("active requires a launch receipt", errors)

    def test_active_transition_binds_exact_launch_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            item = self.work_item()
            receipt_path = Path(directory) / "launch.json"
            receipt = {
                "schemaVersion": 2, "kind": "swiftui-launch-receipt",
                "issue": item["issue"], "laneId": item["laneId"],
                "baseCommit": "a" * 40, "branch": "swiftui/issue-1",
                "worktree": "/temporary/worktree", "environmentId": "environment-1",
                "projectId": "project-1", "threadId": "thread-1",
                "launchedAt": "2026-08-22T04:05:06Z",
            }
            write(receipt_path, receipt)
            transitioned, errors = delivery.transition(
                item, "active", launch_receipt_path=str(receipt_path))
            self.assertEqual(errors, [])
            self.assertEqual(transitioned["stage"], "active")
            self.assertEqual(transitioned["binding"]["baseCommit"], "a" * 40)
            self.assertEqual(transitioned["binding"]["launchReceiptSha256"],
                             hashlib.sha256(receipt_path.read_bytes()).hexdigest())

    def test_proof_ready_transition_rejects_schema3_from_another_lane(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            proof, proof_path, _, inspection, inspection_path, _ = self.make_evidence(root)
            self.upgrade_proof_to_schema3(proof)
            proof["laneId"] = "another-lane"
            write(proof_path, proof)
            inspection["proofSha256"] = delivery.sha256(proof_path)
            write(inspection_path, inspection)
            item = self.work_item()
            item["stage"] = "active"
            item["binding"]["launchReceiptSha256"] = "a" * 64
            _, errors = delivery.transition(
                item, "proof-ready", proof_path=proof_path,
                inspection_path=inspection_path
            )
            self.assertIn("proof laneId must match work item", errors)

    def test_phone_acceptance_requires_bound_receipt(self):
        item = self.work_item()
        item["stage"] = "phone-test"
        item["binding"] = {
            "baseCommit": "a" * 40, "headCommit": "b" * 40,
            "launchReceiptSha256": "c" * 64, "proofSha256": "d" * 64,
            "inspectionSha256": "e" * 64, "phoneGenerationReceiptSha256": "f" * 64,
            "acceptanceReceiptSha256": None, "prGenerationReceiptSha256": None,
            "landedReceiptSha256": None,
        }
        _, errors = delivery.transition(item, "accepted", verdict="accept")
        self.assertIn("phone-test -> accepted requires explicit accept verdict and receipt", errors)

    def test_phone_acceptance_actor_policy(self):
        item = self.work_item()
        item["binding"] = {"phoneGenerationReceiptSha256": "f" * 64}
        receipt = {
            "schemaVersion": 2, "kind": "swiftui-acceptance-receipt",
            "issue": item["issue"], "actor": "Alex", "verdict": "accept",
            "phoneGenerationReceiptSha256": "f" * 64,
            "acceptedAt": "2026-08-26T05:06:07Z",
        }
        base = delivery.validate_acceptance_receipt(dict(receipt), item)
        self.assertFalse(any("acceptance receipt actor" in e for e in base))
        receipt["actor"] = "Saphid"
        errors = delivery.validate_acceptance_receipt(receipt, item)
        self.assertTrue(any("acceptance receipt actor" in e for e in errors))

    def test_pr_open_transition_requires_open_pr_plan(self):
        item = self.work_item()
        item["stage"] = "accepted"
        item["binding"] = {
            "baseCommit": "a" * 40, "headCommit": "b" * 40,
            "launchReceiptSha256": "c" * 64, "proofSha256": "d" * 64,
            "inspectionSha256": "e" * 64, "phoneGenerationReceiptSha256": "f" * 64,
            "acceptanceReceiptSha256": "1" * 64, "prGenerationReceiptSha256": None,
            "landedReceiptSha256": None,
        }
        _, errors = delivery.transition(item, "pr-open")
        self.assertIn("pr-open requires generation plan and receipt", errors)

    def test_phone_transition_rejects_another_issues_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            item = self.work_item()
            item["stage"] = "proof-ready"
            item["binding"].update({
                "baseCommit": "a" * 40, "headCommit": "b" * 40,
                "launchReceiptSha256": "c" * 64, "proofSha256": "d" * 64,
                "inspectionSha256": "e" * 64,
            })
            other = self.work_item("saphid/t3code-personal#2")
            other["stage"] = "proof-ready"
            other["binding"].update(item["binding"])
            other_path = Path(directory) / "other.json"
            other_descriptor = write(other_path, other)
            plan_path = Path(directory) / "plan.json"
            plan = {"mode": "publish-test", "entries": [{
                "issue": other["issue"], "headCommit": other["binding"]["headCommit"],
                "role": "candidate", "workItem": other_descriptor,
            }]}
            write(plan_path, plan)
            receipt_path = Path(directory) / "receipt.json"
            write(receipt_path, {})
            with mock.patch.object(delivery, "validate_generation_plan", return_value=[]), \
                    mock.patch.object(delivery, "validate_generation_receipt", return_value=[]):
                _, errors = delivery.transition(
                    item, "phone-test", plan_path=plan_path, receipt_path=receipt_path)
            self.assertIn(
                "generation must contain the transitioning issue exactly once", errors)

    def test_phone_transition_requires_exact_work_item_and_head(self):
        with tempfile.TemporaryDirectory() as directory:
            item = self.work_item()
            item["stage"] = "proof-ready"
            item["binding"].update({
                "baseCommit": "a" * 40, "headCommit": "b" * 40,
                "launchReceiptSha256": "c" * 64, "proofSha256": "d" * 64,
                "inspectionSha256": "e" * 64,
            })
            item_path = Path(directory) / "item.json"
            item_descriptor = write(item_path, item)
            plan_path = Path(directory) / "plan.json"
            plan = {"mode": "publish-test", "entries": [{
                "issue": item["issue"], "headCommit": item["binding"]["headCommit"],
                "role": "candidate", "workItem": item_descriptor,
            }]}
            write(plan_path, plan)
            receipt_path = Path(directory) / "receipt.json"
            write(receipt_path, {})
            with mock.patch.object(delivery, "validate_generation_plan", return_value=[]), \
                    mock.patch.object(delivery, "validate_generation_receipt", return_value=[]):
                transitioned, errors = delivery.transition(
                    item, "phone-test", plan_path=plan_path, receipt_path=receipt_path)
            self.assertEqual(errors, [])
            self.assertEqual(transitioned["stage"], "phone-test")

    def test_active_item_can_reconcile_an_exact_external_landing(self):
        with tempfile.TemporaryDirectory() as directory:
            item = self.active_work_item()
            _, missing_errors = delivery.transition(item, "landed", source_root=directory)
            self.assertIn(
                "active -> landed requires an external landing receipt", missing_errors)
            _, receipt_path = self.external_landing_receipt(directory, item)
            transitioned, errors = delivery.transition(
                item, "landed", external_landing_receipt_path=receipt_path,
                source_root=directory)
            self.assertEqual(errors, [])
            self.assertEqual(transitioned["stage"], "landed")
            self.assertEqual(
                transitioned["binding"]["landingProvenance"], "external-upstream")
            self.assertEqual(
                transitioned["binding"]["landedReceiptSha256"],
                delivery.sha256(receipt_path))
            self.assertIsNone(transitioned["binding"]["phoneGenerationReceiptSha256"])
            self.assertIsNone(transitioned["binding"]["acceptanceReceiptSha256"])
            self.assertIsNone(transitioned["binding"]["prGenerationReceiptSha256"])
            self.assertEqual(delivery.validate_work_item(transitioned), [])

    def test_external_landing_receipt_rejects_incomplete_or_false_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            item = self.active_work_item()
            receipt, _ = self.external_landing_receipt(directory, item)
            mutations = {
                "issue": lambda value: value.update(issue="saphid/t3code-personal#2"),
                "lane": lambda value: value.update(laneId="another-lane"),
                "base": lambda value: value.update(baseCommit="e" * 40),
                "launch": lambda value: value.update(launchReceiptSha256="e" * 64),
                "mode": lambda value: value.update(provenanceMode="work-item-pr"),
                "pull request": lambda value: value.update(
                    pullRequestUrl="https://github.com/other/repository/pull/7895"),
                "merged state": lambda value: value.update(pullRequestState="OPEN"),
                "merge commit": lambda value: value.update(mergeCommit="not-a-commit"),
                "ancestry": lambda value: value["ancestorAttestation"].update(
                    isAncestor=False),
                "acceptance coverage": lambda value: value.update(acceptanceMapping=[]),
                "source commit": lambda value: value.update(currentSourceCommit="e" * 40),
                "source hash": lambda value: value["currentSourceHashes"].update(
                    {"Sources/Feature.swift": "0" * 64}),
                "side effect": lambda value: value["sideEffects"].update(
                    productSourceChanged=True),
            }
            for name, mutate in mutations.items():
                with self.subTest(name=name):
                    changed = json.loads(json.dumps(receipt))
                    mutate(changed)
                    self.assertTrue(delivery.validate_external_landing_receipt(
                        changed, item, directory))

    def test_external_landed_catalog_binding_cannot_impersonate_ordinary_receipts(self):
        with tempfile.TemporaryDirectory() as directory:
            item = self.active_work_item()
            _, receipt_path = self.external_landing_receipt(directory, item)
            transitioned, errors = delivery.transition(
                item, "landed", external_landing_receipt_path=receipt_path,
                source_root=directory)
            self.assertEqual(errors, [])
            transitioned["binding"]["acceptanceReceiptSha256"] = "e" * 64
            errors = delivery.validate_catalog([transitioned])
            self.assertTrue(any("must be absent at externally landed" in error
                                for error in errors))
            item["binding"]["proofSha256"] = "f" * 64
            _, errors = delivery.transition(
                item, "landed", external_landing_receipt_path=receipt_path,
                source_root=directory)
            self.assertTrue(any("requires binding.proofSha256 to be absent" in error
                                for error in errors))

    def test_externally_landed_item_satisfies_landed_dependency_normally(self):
        with tempfile.TemporaryDirectory() as directory:
            proof, _, proof_d, _, _, inspection_d = self.make_evidence(directory)
            dependency = self.active_work_item(
                "saphid/t3code-personal#2", "external-feature")
            _, receipt_path = self.external_landing_receipt(directory, dependency)
            dependency, errors = delivery.transition(
                dependency, "landed", external_landing_receipt_path=receipt_path,
                source_root=directory)
            self.assertEqual(errors, [])

            candidate = self.work_item()
            candidate["stage"] = "proof-ready"
            candidate["dependencies"] = [{
                "issue": dependency["issue"], "kind": "ordered-after",
                "satisfiedAt": "landed",
            }]
            candidate["binding"].update({
                "baseCommit": proof["baseCommit"], "headCommit": proof["headCommit"],
                "launchReceiptSha256": "e" * 64,
                "proofSha256": proof_d["sha256"],
                "inspectionSha256": inspection_d["sha256"],
            })
            candidate_d = write(Path(directory) / "candidate.json", candidate)
            catalog_d = write(Path(directory) / "catalog.json", [candidate, dependency])
            plan = {
                "schemaVersion": 2, "kind": "swiftui-generation-plan",
                "mode": "publish-test",
                "authority": {"actor": "Alex", "source": "T3 thread message",
                              "scopeSha256": "f" * 64,
                              "grantedAt": "2026-08-23T14:00:00Z"},
                "catalog": catalog_d,
                "emptyCarryReason":
                    "This isolated protocol fixture has no prior installed Test generation.",
                "entries": [{
                    "issue": candidate["issue"],
                    "headCommit": candidate["binding"]["headCommit"],
                    "role": "candidate", "workItem": candidate_d,
                    "proof": proof_d, "inspection": inspection_d,
                }],
            }
            self.assertEqual(delivery.validate_generation_plan(plan), [])

    def test_ordinary_landed_transition_remains_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            item = self.work_item()
            item["stage"] = "pr-open"
            item["binding"] = {
                "baseCommit": "a" * 40, "headCommit": "b" * 40,
                "launchReceiptSha256": "c" * 64, "proofSha256": "d" * 64,
                "inspectionSha256": "e" * 64,
                "phoneGenerationReceiptSha256": "f" * 64,
                "acceptanceReceiptSha256": "1" * 64,
                "prGenerationReceiptSha256": None,
                "landedReceiptSha256": None,
            }
            pr_receipt_path = Path(directory) / "pr-generation.json"
            write(pr_receipt_path, {
                "schemaVersion": 2, "kind": "swiftui-generation-receipt",
                "mode": "open-pr", "pullRequestUrl": "https://example.test/pr/1",
            })
            item["binding"]["prGenerationReceiptSha256"] = delivery.sha256(pr_receipt_path)
            landed_path = Path(directory) / "landed.json"
            write(landed_path, {
                "schemaVersion": 2, "kind": "swiftui-landed-receipt",
                "issue": item["issue"], "pullRequestUrl": "https://example.test/pr/1",
                "mergeCommit": "9" * 40, "landedAt": "2026-08-22T06:07:08Z",
            })
            transitioned, errors = delivery.transition(
                item, "landed", receipt_path=pr_receipt_path,
                landed_receipt_path=landed_path)
            self.assertEqual(errors, [])
            self.assertEqual(transitioned["stage"], "landed")
            self.assertNotIn("landingProvenance", transitioned["binding"])

    def test_landed_transition_must_close_the_generated_pull_request(self):
        with tempfile.TemporaryDirectory() as directory:
            item = self.work_item()
            item["stage"] = "pr-open"
            item["binding"] = {
                "baseCommit": "a" * 40, "headCommit": "b" * 40,
                "launchReceiptSha256": "c" * 64, "proofSha256": "d" * 64,
                "inspectionSha256": "e" * 64,
                "phoneGenerationReceiptSha256": "f" * 64,
                "acceptanceReceiptSha256": "1" * 64,
                "prGenerationReceiptSha256": None,
                "landedReceiptSha256": None,
            }
            pr_receipt_path = Path(directory) / "pr-generation.json"
            write(pr_receipt_path, {
                "schemaVersion": 2, "kind": "swiftui-generation-receipt",
                "mode": "open-pr", "pullRequestUrl": "https://example.test/pr/1",
            })
            item["binding"]["prGenerationReceiptSha256"] = delivery.sha256(pr_receipt_path)
            landed_path = Path(directory) / "landed.json"
            write(landed_path, {
                "schemaVersion": 2, "kind": "swiftui-landed-receipt",
                "issue": item["issue"], "pullRequestUrl": "https://example.test/pr/2",
                "mergeCommit": "9" * 40, "landedAt": "2026-08-22T06:07:08Z",
            })
            _, errors = delivery.transition(
                item, "landed", receipt_path=pr_receipt_path,
                landed_receipt_path=landed_path)
            self.assertIn(
                "landed receipt pull request must match the open-pr generation", errors)


if __name__ == "__main__":
    unittest.main()
