#!/bin/bash
# Clean up simulator sessions safely, from any project.
#
#   clean-simulator-sessions.sh [status|clean] [--dry-run] [--keep-app]
#
# status (default): list booted simulators, marking LEASED / PROTECTED /
#   UNLEASED, and whether Simulator.app is running.
# clean: shut down UNLEASED booted simulators, delete unavailable device
#   records, and quit Simulator.app when nothing remains booted.
#
# Safety model: a simulator is never touched when
#   - an active delivery lease directory exists for its UDID under
#     ~/.local/state/t3/swiftui-delivery/simulator-leases/<UDID>.lock, or
#   - its UDID is listed in $SIMULATOR_CLEAN_PROTECT (comma-separated).
# Exit 0 on success (including nothing to do), 1 on any failed action.
set -u
LEASE_ROOT="${T3_SWIFTUI_SIMULATOR_LEASE_ROOT:-$HOME/.local/state/t3/swiftui-delivery/simulator-leases}"
MODE="status"
DRY=0
KEEP_APP=0
for a in "$@"; do
  case "$a" in
    status|clean) MODE="$a" ;;
    --dry-run) DRY=1 ;;
    --keep-app) KEEP_APP=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown argument: $a" >&2; exit 1 ;;
  esac
done

is_protected() { # udid -> 0 if leased/protected
  [ -d "$LEASE_ROOT/$1.lock" ] && return 0
  case ",${SIMULATOR_CLEAN_PROTECT:-}," in
    *",$1,"*) return 0 ;;
  esac
  return 1
}

BOOTED_JSON=$(xcrun simctl list devices booted -j 2>/dev/null)
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "simctl unavailable (rc=$rc)" >&2; exit 1
fi
# "udid<TAB>name" per booted device, via python for stable JSON parsing.
BOOTED=$(printf '%s' "$BOOTED_JSON" | python3 -c '
import json, sys
data = json.load(sys.stdin)
for devices in data.get("devices", {}).values():
    for d in devices:
        if d.get("state") == "Booted":
            print("%s\t%s" % (d["udid"], d["name"]))
')

FAILS=0
ACTED=0
KEPT=0
if [ -n "$BOOTED" ]; then
  while IFS=$(printf '\t') read -r udid name; do
    [ -z "$udid" ] && continue
    if is_protected "$udid"; then
      echo "LEASED    $udid  $name"
      KEPT=$((KEPT+1))
      continue
    fi
    if [ "$MODE" = "status" ]; then
      echo "UNLEASED  $udid  $name"
    elif [ "$DRY" -eq 1 ]; then
      echo "WOULD SHUTDOWN  $udid  $name"
    else
      if is_protected "$udid"; then
        echo "LEASED    $udid  $name (lease appeared; skipped)"
        KEPT=$((KEPT+1))
        continue
      fi
      xcrun simctl shutdown "$udid" > /dev/null 2>&1
      rc=$?
      if [ "$rc" -eq 0 ]; then
        echo "SHUTDOWN  $udid  $name"
        ACTED=$((ACTED+1))
      else
        echo "FAILED shutdown ($rc)  $udid  $name" >&2
        FAILS=$((FAILS+1))
      fi
    fi
  done << BOOTED_EOF
$BOOTED
BOOTED_EOF
else
  echo "no booted simulators"
fi

if [ "$MODE" = "clean" ] && [ "$DRY" -eq 0 ]; then
  ALL_JSON=$(xcrun simctl list devices -j 2>/dev/null)
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "device inventory failed ($rc); skipping unavailable cleanup" >&2
    FAILS=$((FAILS+1))
  else
    UNAVAILABLE=$(printf '%s' "$ALL_JSON" | python3 -c '
import json, sys
data = json.load(sys.stdin)
for devices in data.get("devices", {}).values():
    for d in devices:
        if d.get("isAvailable") is False:
            print(d["udid"])
')
    DELETED=0
    for udid in $UNAVAILABLE; do
      if is_protected "$udid"; then
        echo "LEASED    $udid  (unavailable but protected; kept)"
        continue
      fi
      xcrun simctl delete "$udid" > /dev/null 2>&1
      rc=$?
      if [ "$rc" -eq 0 ]; then DELETED=$((DELETED+1));
      else echo "FAILED delete ($rc)  $udid" >&2; FAILS=$((FAILS+1)); fi
    done
    [ "$DELETED" -gt 0 ] && echo "deleted $DELETED unavailable device record(s)"
  fi
fi

SIM_RUNNING=0
pgrep -x Simulator > /dev/null 2>&1 && SIM_RUNNING=1
RECOUNT_JSON=$(xcrun simctl list devices booted -j 2>/dev/null)
rc=$?
if [ "$rc" -eq 0 ]; then
  STILL_BOOTED=$(printf '%s' "$RECOUNT_JSON" | python3 -c '
import json, sys
data = json.load(sys.stdin)
print(sum(1 for ds in data.get("devices", {}).values()
          for d in ds if d.get("state") == "Booted"))')
else
  # Fail closed: unknown inventory must never look like "nothing booted".
  STILL_BOOTED="unknown"
fi
if [ "$MODE" = "clean" ] && [ "$KEEP_APP" -eq 0 ] && [ "$SIM_RUNNING" -eq 1 ] \
   && [ "$STILL_BOOTED" = "0" ]; then
  if [ "$DRY" -eq 1 ]; then
    echo "WOULD QUIT Simulator.app (nothing booted)"
  else
    osascript -e 'tell application "Simulator" to quit' > /dev/null 2>&1
    rc=$?
    if [ "$rc" -eq 0 ]; then
      echo "quit Simulator.app"
    else
      echo "FAILED to quit Simulator.app ($rc)" >&2
      FAILS=$((FAILS+1))
    fi
  fi
elif [ "$SIM_RUNNING" -eq 1 ]; then
  echo "Simulator.app running ($STILL_BOOTED still booted)"
fi

echo "----"
echo "kept(leased)=$KEPT acted=$ACTED failed=$FAILS"
[ "$FAILS" -eq 0 ] && exit 0 || exit 1
