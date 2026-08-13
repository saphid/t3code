#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -n "${T3_FAKE_XCRUN_ARGUMENT_LOG:-}" ]]; then
  printf '%s\n' "$*" >>"${T3_FAKE_XCRUN_ARGUMENT_LOG}"
fi

if [[ "${1:-}" == "simctl" && "${2:-}" == "create" ]]; then
  printf '%s\n' '00000000-0000-0000-0000-000000000001'
  exit 0
fi

if [[ "${1:-}" == "simctl" && "${2:-}" == "install" && -n "${4:-}" ]]; then
  exit 0
fi

if [[ "${1:-}" == "simctl" && "${2:-}" == "bootstatus" && -n "${3:-}" ]]; then
  exit 0
fi

if [[ "${1:-}" == "simctl" && "${2:-}" == "boot" && -n "${3:-}" ]]; then
  exit "${T3_FAKE_BOOT_STATUS:-0}"
fi

if [[ "${1:-}" == "simctl" && "${2:-}" == "uninstall" && -n "${4:-}" ]]; then
  exit "${T3_FAKE_UNINSTALL_STATUS:-0}"
fi

if [[ "${1:-}" == "simctl" && "${2:-}" == "shutdown" && -n "${3:-}" ]]; then
  exit "${T3_FAKE_SHUTDOWN_STATUS:-0}"
fi

if [[ "${1:-}" == "simctl" && "${2:-}" == "delete" && -n "${3:-}" ]]; then
  exit "${T3_FAKE_DELETE_STATUS:-0}"
fi

if [[ "${1:-}" == "simctl" && "${2:-}" == "get_app_container" && -n "${4:-}" ]]; then
  printf '%s\n' "${T3_FAKE_APP_CONTAINER}"
  exit 0
fi

if [[ "${1:-}" == "xcresulttool" && "${2:-}" == "get" && "${4:-}" == "summary" ]]; then
  passed="${T3_FAKE_PASSED_TESTS:-11}"
  failed="${T3_FAKE_FAILED_TESTS:-0}"
  skipped="${T3_FAKE_SKIPPED_TESTS:-0}"
  total=$((passed + failed + skipped))
  configuration_passed="${passed}"
  if [[ "${T3_APP_FLOW_PLAN:-}" == "stability" \
    && "${passed}" -eq 6 \
    && "${failed}" -eq 0 \
    && "${skipped}" -eq 0 ]]; then
    passed=2
    total=2
  fi
  result="Passed"
  if [[ "${failed}" -ne 0 ]]; then
    result="Failed"
  fi
  printf '{"result":"%s","totalTestCount":%s,"passedTests":%s,"failedTests":%s,"skippedTests":%s,"expectedFailures":0,"devicesAndConfigurations":[{"device":{"deviceId":"00000000-0000-0000-0000-000000000001","deviceName":"Fake iPhone","osVersion":"1.0"},"passedTests":%s,"failedTests":%s,"skippedTests":%s,"expectedFailures":0}]}\n' \
    "${result}" "${total}" "${passed}" "${failed}" "${skipped}" \
    "${configuration_passed}" "${failed}" "${skipped}"
  exit "${T3_FAKE_SUMMARY_STATUS:-0}"
fi

if [[ "${1:-}" == "xcresulttool" && "${2:-}" == "get" && "${4:-}" == "tests" ]]; then
  if [[ "${T3_FAKE_UNIT_TESTS:-0}" == "1" ]]; then
    printf '%s\n' '{"testNodes":[{"children":[{"nodeType":"Test Case","nodeIdentifier":"AppFlowVisualSnapshotTests/testOnboardingWelcomeAtStandardType()","result":"Passed","durationInSeconds":1.0},{"nodeType":"Test Case","nodeIdentifier":"AppFlowVisualSnapshotTests/testOnboardingWelcomeAtAccessibilityTypeInDarkMode()","result":"Passed","durationInSeconds":1.0},{"nodeType":"Test Case","nodeIdentifier":"AppFlowVisualSnapshotTests/testOnboardingWelcomeRightToLeft()","result":"Passed","durationInSeconds":1.0},{"nodeType":"Test Case","nodeIdentifier":"AppFlowVisualSnapshotTests/testOnboardingWelcomeOnIPad()","result":"Passed","durationInSeconds":1.0},{"nodeType":"Test Case","nodeIdentifier":"TransportReliabilityTests/testLivePerMessageDeflateRoundTripWhenConfigured()","result":"Skipped","durationInSeconds":0.0}]}]}'
    exit "${T3_FAKE_TESTS_STATUS:-0}"
  fi
  python3 - "${SCRIPT_DIR}/../app-flow-catalog.json" "${T3_APP_FLOW_PLAN:-regression}" <<'PY'
import json
from pathlib import Path
import sys

catalog = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
plan = catalog["plans"][sys.argv[2]]
journeys = {journey["id"]: journey for journey in catalog["journeys"]}
children = []
repetitions = plan.get("repetitions", 1)
for journey_id in plan["journeys"]:
    test = journeys[journey_id]["test"]
    test_case = {
        "nodeType": "Test Case",
        "nodeIdentifier": f"AppFlowUITests/{test}()",
        "result": "Passed",
        "durationInSeconds": float(repetitions),
    }
    if repetitions > 1:
        test_case["children"] = [
            {
                "nodeType": "Repetition",
                "name": f"Repetition {index}",
                "result": "Passed",
                "durationInSeconds": 1.0,
            }
            for index in range(1, repetitions + 1)
        ]
    children.append(test_case)
print(json.dumps({"testNodes": [{"children": children}]}))
PY
  exit "${T3_FAKE_TESTS_STATUS:-0}"
fi

if [[ "${1:-}" == "xcresulttool" && "${2:-}" == "export" ]]; then
  output=""
  while [[ "$#" -gt 0 ]]; do
    if [[ "$1" == "--output-path" ]]; then
      output="$2"
      shift 2
    else
      shift
    fi
  done
  [[ -n "${output}" ]]
  python3 - "${SCRIPT_DIR}/../app-flow-catalog.json" "${T3_APP_FLOW_PLAN:-regression}" "${output}" <<'PY'
import json
from pathlib import Path
import sys

catalog = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
plan = catalog["plans"][sys.argv[2]]
journeys = {journey["id"]: journey for journey in catalog["journeys"]}
output = Path(sys.argv[3])
output.mkdir(parents=True)
attachments = []
index = 0
for journey_id in plan["journeys"]:
    for checkpoint in journeys[journey_id]["checkpoints"]:
        for extension, suffix in (("png", ""), ("txt", "-accessibility")):
            filename = f"attachment-{index}.{extension}"
            (output / filename).write_text("fixture evidence\n", encoding="utf-8")
            attachments.append(
                {
                    "exportedFileName": filename,
                    "suggestedHumanReadableName": (
                        f"{checkpoint}{suffix}_0_00000000-0000-0000-0000-000000000000.{extension}"
                    ),
                }
            )
            index += 1
(output / "manifest.json").write_text(
    json.dumps([{"testIdentifier": "fake", "attachments": attachments}]),
    encoding="utf-8",
)
PY
  exit "${T3_FAKE_ATTACHMENTS_STATUS:-0}"
fi

exit 1
