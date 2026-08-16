#!/usr/bin/env bash

t3_select_available_iphone_simulator() {
  xcrun simctl list devices available \
    | awk '
        /^[[:space:]]+iPhone/ {
          line = $0
          while (match(line, /\([[:xdigit:]-]+\)/)) {
            value = substr(line, RSTART + 1, RLENGTH - 2)
            if (value ~ /^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$/) {
              candidate = value
            }
            line = substr(line, RSTART + RLENGTH)
          }
        }
        END { print candidate }
      '
}

t3_reboot_simulator() {
  local xcrun_command="$1"
  local timeout_tool="$2"
  local simulator_id="$3"
  local timeout_seconds="$4"

  # Xcode may leave the destination either Booted or Shutdown after a suite.
  # A failed shutdown is acceptable only when the following boot succeeds;
  # busy, missing, and otherwise unhealthy devices still fail at that step.
  "${xcrun_command}" simctl shutdown "${simulator_id}" >/dev/null 2>&1 || true
  "${xcrun_command}" simctl boot "${simulator_id}" || return $?
  python3 "${timeout_tool}" --seconds "${timeout_seconds}" -- \
    "${xcrun_command}" simctl bootstatus "${simulator_id}" -b || return $?
}

t3_replace_simulator() {
  local xcrun_command="$1"
  local simulator_id="$2"
  local simulator_name="$3"
  local device_type="$4"
  local runtime="$5"
  local create_arguments=(simctl create "${simulator_name}" "${device_type}")

  "${xcrun_command}" simctl shutdown "${simulator_id}" >/dev/null 2>&1 || true
  "${xcrun_command}" simctl delete "${simulator_id}" || return $?
  if [[ -n "${runtime}" ]]; then
    create_arguments+=("${runtime}")
  fi
  "${xcrun_command}" "${create_arguments[@]}"
}
