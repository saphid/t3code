#!/usr/bin/env python3

"""Print a fail-closed, read-only inventory of local iOS native resources."""

import argparse
import datetime as dt
import glob
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
from pathlib import Path


SCHEMA_VERSION = 1
UUID_RE = re.compile(
    r"\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-"
    r"[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b"
)


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def stable_id(kind, identity):
    digest = hashlib.sha256((kind + "\0" + identity).encode("utf-8")).hexdigest()
    return kind + ":" + digest[:16]


def parse_elapsed(value):
    """Parse ps etime values such as 01:02, 03:04:05, or 2-03:04:05."""
    try:
        day_split = value.split("-", 1)
        days = int(day_split[0]) if len(day_split) == 2 else 0
        clock = day_split[-1].split(":")
        if len(clock) == 2:
            hours, minutes, seconds = 0, int(clock[0]), int(clock[1])
        elif len(clock) == 3:
            hours, minutes, seconds = map(int, clock)
        else:
            return None
        return days * 86400 + hours * 3600 + minutes * 60 + seconds
    except ValueError:
        return None


def process_kind(command):
    lowered = command.lower()
    if re.search(r"(^|[/\s])xcodebuild(?:\s|$)", lowered):
        if any(
            flag in lowered
            for flag in ("-showbuildsettings", "-showdestinations", " -list")
        ):
            return "xcodebuild-inspection", "native-worker"
        return "xcodebuild", "native-worker"
    if re.search(r"(^|[/\s])xctest(?:\s|$)", lowered):
        return "xctest", "native-worker"
    if re.search(r"(^|[/\s])testmanagerd(?:\s|$)", lowered):
        return "testmanagerd", "native-worker"
    if "xcodebuildmcp" in lowered:
        return "xcodebuildmcp", "control"
    if "serve-sim" in lowered:
        return "serve-sim", "visual-feed"
    return None, None


def run_command(arguments, timeout, errors, source):
    try:
        completed = subprocess.run(
            arguments,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        errors.append({"source": source, "error": type(exc).__name__})
        return None
    if completed.returncode != 0:
        errors.append(
            {
                "source": source,
                "error": "exit-{}".format(completed.returncode),
            }
        )
        return None
    return completed.stdout


def collect_processes(errors):
    output = run_command(
        ["ps", "-axo", "pid=,ppid=,etime=,command="], 10, errors, "processes"
    )
    if output is None:
        return []
    processes = []
    for line in output.splitlines():
        fields = line.strip().split(None, 3)
        if len(fields) != 4:
            continue
        try:
            pid = int(fields[0])
            ppid = int(fields[1])
        except ValueError:
            continue
        kind, resource_class = process_kind(fields[3])
        processes.append(
            {
                "pid": pid,
                "ppid": ppid,
                "elapsedSeconds": parse_elapsed(fields[2]),
                "command": fields[3],
                "kind": kind,
                "resourceClass": resource_class,
            }
        )
    return processes


def read_integer(path):
    try:
        value = path.read_text(encoding="utf-8").strip()
        return int(value) if value else None
    except (OSError, ValueError):
        return None


def read_text(path):
    try:
        value = path.read_text(encoding="utf-8").strip()
        return value or None
    except OSError:
        return None


def collect_lock(lock_path):
    return {
        "path": str(lock_path),
        "present": lock_path.is_dir(),
        "ownerPid": read_integer(lock_path / "owner-pid"),
        "mcpDerivedDataPath": read_text(lock_path / "mcp-derived-data"),
    }


def collect_build_slots(capacity_root):
    slots = []
    for path in sorted(capacity_root.glob("slot-*.lock")):
        run_root = read_text(path / "run-root")
        slots.append({
            "path": str(path),
            "present": path.is_dir(),
            "allocatorPid": read_integer(path / "allocator-pid"),
            "kind": read_text(path / "kind"),
            "state": read_text(path / "state"),
            "runRoot": run_root,
            "runRootExists": bool(run_root and Path(run_root).is_dir()),
        })
    return slots


def collect_simulators(errors):
    output = run_command(
        ["xcrun", "simctl", "list", "devices", "-j"],
        15,
        errors,
        "simulators",
    )
    if output is None:
        return []
    try:
        payload = json.loads(output)
    except json.JSONDecodeError:
        errors.append({"source": "simulators", "error": "invalid-json"})
        return []
    result = []
    for runtime, devices in payload.get("devices", {}).items():
        for device in devices:
            result.append(
                {
                    "udid": device.get("udid"),
                    "name": device.get("name"),
                    "state": device.get("state"),
                    "runtime": runtime,
                    "available": device.get("isAvailable", True),
                }
            )
    return result


def known_derived_data_paths(lock, build_slots, additional_paths):
    patterns = [
        "/private/tmp/t3-xcodebuildmcp.*/DerivedData",
        "/private/var/folders/*/*/T/t3-xcodebuildmcp.*/DerivedData",
        "/private/tmp/t3-xcodebuild.*/DerivedData",
        "/private/var/folders/*/*/T/t3-xcodebuild.*/DerivedData",
        str(Path.home() / ".t3/worktrees/*/.derivedData"),
        str(Path.home() / "Library/Developer/XcodeBuildMCP/workspaces/*/DerivedData"),
    ]
    paths = set()
    for pattern in patterns:
        paths.update(glob.glob(pattern))
    if lock.get("mcpDerivedDataPath"):
        paths.add(lock["mcpDerivedDataPath"])
    for slot in build_slots:
        if slot.get("runRoot"):
            paths.add(str(Path(slot["runRoot"]) / "DerivedData"))
    paths.update(additional_paths)
    return sorted(paths)


def open_handle_pids(path, errors):
    try:
        completed = subprocess.run(
            ["lsof", "-nP", "-Fp", "+D", path],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=8,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        errors.append(
            {"source": "open-handles", "path": path, "error": type(exc).__name__}
        )
        return None
    if completed.returncode not in (0, 1):
        errors.append(
            {
                "source": "open-handles",
                "path": path,
                "error": "exit-{}".format(completed.returncode),
            }
        )
        return None
    if completed.returncode == 1 and completed.stderr.strip():
        errors.append(
            {
                "source": "open-handles",
                "path": path,
                "error": "inspection-incomplete",
            }
        )
        return None
    pids = set()
    for line in completed.stdout.splitlines():
        if line.startswith("p") and line[1:].isdigit():
            pids.add(int(line[1:]))
    return sorted(pids)


def product_lane(path):
    if "t3-xcodebuild" in path or "XcodeBuildMCP" in path:
        return "simulator-verification"
    return "unknown"


def collect_derived_data(lock, build_slots, additional_paths, errors):
    result = []
    for path in known_derived_data_paths(lock, build_slots, additional_paths):
        result.append(
            {
                "path": path,
                "exists": Path(path).is_dir(),
                "productLane": product_lane(path),
                "openHandlePids": open_handle_pids(path, errors)
                if Path(path).is_dir()
                else [],
            }
        )
    return result


def collect_disk(errors):
    try:
        usage = shutil.disk_usage("/")
    except OSError:
        errors.append({"source": "disk", "error": "disk-usage-failed"})
        return None
    return {
        "path": "/",
        "bytesTotal": usage.total,
        "bytesUsed": usage.used,
        "bytesFree": usage.free,
    }


def collect_live(additional_paths):
    errors = []
    lock = collect_lock(
        Path.home() / ".local/state/t3/swiftui-delivery/ios-build-hygiene.lock"
    )
    build_slots = collect_build_slots(
        Path.home() / ".local/state/t3/swiftui-delivery/ios-build-capacity"
    )
    return {
        "observedAt": utc_now(),
        "hostname": socket.gethostname(),
        "lock": lock,
        "buildSlots": build_slots,
        "processes": collect_processes(errors),
        "simulators": collect_simulators(errors),
        "derivedData": collect_derived_data(lock, build_slots, additional_paths, errors),
        "disk": collect_disk(errors),
        "errors": errors,
    }


def collect_fixture(path):
    with path.open(encoding="utf-8") as source:
        payload = json.load(source)
    payload.setdefault("observedAt", "2000-01-01T00:00:00Z")
    payload.setdefault("hostname", "fixture-host")
    payload.setdefault("lock", {"present": False, "path": "fixture-lock"})
    payload.setdefault("buildSlots", [])
    payload.setdefault("processes", [])
    payload.setdefault("simulators", [])
    payload.setdefault("derivedData", [])
    payload.setdefault("disk", None)
    payload.setdefault("errors", [])
    return payload


def has_ancestor(pid, ancestor_pid, process_map):
    visited = set()
    current = pid
    while current and current not in visited:
        if current == ancestor_pid:
            return True
        visited.add(current)
        current = process_map.get(current, {}).get("ppid")
    return False


def normalize_path(path):
    if not path:
        return None
    return os.path.normcase(os.path.abspath(os.path.expanduser(path)))


def classify_snapshot(raw, mode):
    errors = list(raw.get("errors", []))
    raw_processes = raw.get("processes", [])
    process_map = {item.get("pid"): item for item in raw_processes if item.get("pid")}
    lock = dict(raw.get("lock", {}))
    lock_present = bool(lock.get("present"))
    owner_pid = lock.get("ownerPid")
    mcp_path = lock.get("mcpDerivedDataPath")
    raw_slots = raw.get("buildSlots", [])
    active_slot_roots = [
        normalize_path(item.get("runRoot")) for item in raw_slots
        if item.get("present") and item.get("runRoot")
        and item.get("runRootExists", Path(item.get("runRoot")).is_dir())
    ]
    mcp_exists = any(
        normalize_path(item.get("path")) == normalize_path(mcp_path)
        and item.get("exists", False)
        for item in raw.get("derivedData", [])
    )

    if not lock_present:
        lock_state, lock_classification = "absent", "informational"
    elif owner_pid and mcp_path:
        lock_state, lock_classification = "ambiguous", "protected-unknown"
        errors.append({"source": "lock", "error": "multiple-owner-markers"})
    elif mcp_path and mcp_exists:
        lock_state, lock_classification = "mcp-active", "owned-active"
    elif mcp_path:
        lock_state, lock_classification = "mcp-path-missing", "protected-unknown"
        errors.append({"source": "lock", "error": "leased-path-missing"})
    elif owner_pid and owner_pid in process_map:
        lock_state, lock_classification = "direct-active", "owned-active"
    elif owner_pid:
        lock_state, lock_classification = "owner-pid-unobserved", "protected-unknown"
        errors.append({"source": "lock", "error": "owner-pid-unobserved"})
    else:
        lock_state, lock_classification = "ambiguous", "protected-unknown"
        errors.append({"source": "lock", "error": "owner-marker-missing"})

    processes = []
    serve_sim_udids = set()
    for item in raw_processes:
        command = item.get("command", "")
        kind = item.get("kind")
        resource_class = item.get("resourceClass")
        if kind is None:
            kind, resource_class = process_kind(command)
        if kind is None:
            continue
        if kind == "serve-sim":
            serve_sim_udids.update(value.upper() for value in UUID_RE.findall(command))
        if resource_class == "native-worker":
            slot_root = next((root for root in active_slot_roots if root in command), None)
            if slot_root:
                classification = "owned-active"
                owner_evidence = "build-capacity-slot"
            elif owner_pid and has_ancestor(item.get("pid"), owner_pid, process_map):
                classification = "owned-active"
                owner_evidence = "direct-hygiene-lock"
            elif mcp_path and mcp_path in command:
                classification = "owned-active"
                owner_evidence = "mcp-hygiene-lock"
            else:
                classification = "protected-unknown"
                owner_evidence = None
        elif resource_class == "visual-feed":
            classification = "owned-active"
            owner_evidence = "serve-sim"
        else:
            classification = "informational"
            owner_evidence = None
        processes.append(
            {
                "resourceId": stable_id("process", str(item.get("pid"))),
                "pid": item.get("pid"),
                "ppid": item.get("ppid"),
                "elapsedSeconds": item.get("elapsedSeconds"),
                "kind": kind,
                "resourceClass": resource_class,
                "classification": classification,
                "ownerEvidence": owner_evidence,
                "cleanupEligible": False,
            }
        )

    simulators = []
    for item in raw.get("simulators", []):
        udid = (item.get("udid") or "").upper()
        state = item.get("state")
        if udid in serve_sim_udids:
            classification = "owned-active"
            evidence = "serve-sim"
        elif state == "Booted":
            classification = "protected-unknown"
            evidence = None
        else:
            classification = "informational"
            evidence = None
        simulators.append(
            {
                "resourceId": stable_id("simulator", udid),
                "udid": item.get("udid"),
                "name": item.get("name"),
                "state": state,
                "runtime": item.get("runtime"),
                "available": item.get("available", True),
                "classification": classification,
                "ownerEvidence": evidence,
                "cleanupEligible": False,
            }
        )

    build_slots = []
    for item in raw_slots:
        run_root = item.get("runRoot")
        run_root_exists = bool(run_root and item.get(
            "runRootExists", Path(run_root).is_dir()
        ))
        if item.get("present") and run_root_exists and item.get("state") == "active":
            classification = "owned-active"
        else:
            classification = "protected-unknown"
            errors.append({"source": "build-slot", "error": "incomplete-owner-state"})
        build_slots.append({
            "resourceId": stable_id("build-slot", item.get("path") or "unknown"),
            "path": item.get("path"),
            "kind": item.get("kind"),
            "state": item.get("state"),
            "runRoot": run_root,
            "allocatorPid": item.get("allocatorPid"),
            "classification": classification,
            "cleanupEligible": False,
        })

    derived_data = []
    normalized_mcp_path = normalize_path(mcp_path)
    for item in raw.get("derivedData", []):
        path = item.get("path")
        slot_root = next((root for root in active_slot_roots
                          if normalize_path(path or "").startswith(root + os.sep)), None)
        if slot_root:
            classification = "owned-active"
            owner_evidence = "build-capacity-slot"
        elif normalize_path(path) == normalized_mcp_path and lock_classification == "owned-active":
            classification = "owned-active"
            owner_evidence = "mcp-hygiene-lock"
        else:
            classification = "protected-unknown"
            owner_evidence = None
        derived_data.append(
            {
                "resourceId": stable_id("derived-data", path or "unknown"),
                "path": path,
                "exists": item.get("exists", False),
                "productLane": item.get("productLane", product_lane(path or "")),
                "openHandlePids": item.get("openHandlePids"),
                "classification": classification,
                "ownerEvidence": owner_evidence,
                "cleanupEligible": False,
            }
        )

    native_workers = [
        item for item in processes if item.get("resourceClass") == "native-worker"
    ]
    protected_unknown = sum(
        item.get("classification") == "protected-unknown"
        for item in processes + simulators + build_slots + derived_data
    )
    snapshot = {
        "schemaVersion": SCHEMA_VERSION,
        "observedAt": raw.get("observedAt"),
        "mode": mode,
        "host": raw.get("hostname"),
        "coverage": "partial" if errors else "complete",
        "safety": {
            "readOnly": True,
            "mutationCapabilities": [],
            "ageAloneNeverPermitsCleanup": True,
            "unknownMeansProtected": True,
        },
        "lock": {
            "resourceId": stable_id("lock", lock.get("path", "ios-build-hygiene")),
            "path": lock.get("path"),
            "present": lock_present,
            "state": lock_state,
            "ownerPid": owner_pid,
            "mcpDerivedDataPath": mcp_path,
            "classification": lock_classification,
            "cleanupEligible": False,
        },
        "buildSlots": sorted(build_slots, key=lambda item: item.get("path") or ""),
        "processes": sorted(processes, key=lambda item: item.get("pid") or 0),
        "simulators": sorted(simulators, key=lambda item: item.get("udid") or ""),
        "derivedData": sorted(derived_data, key=lambda item: item.get("path") or ""),
        "disk": raw.get("disk"),
        "errors": errors,
        "summary": {
            "nativeWorkerCount": len(native_workers),
            "protectedUnknownCount": protected_unknown,
            "derivedDataCount": len(derived_data),
            "activeBuildSlotCount": sum(
                item.get("classification") == "owned-active" for item in build_slots
            ),
            "bootedSimulatorCount": sum(
                item.get("state") == "Booted" for item in simulators
            ),
            "cleanupEligibleCount": 0,
        },
    }
    return snapshot


def parse_arguments(argv):
    parser = argparse.ArgumentParser(
        description="Print a read-only JSON inventory of native iOS resources."
    )
    parser.add_argument(
        "--fixture",
        type=Path,
        help="Replay raw evidence from a JSON fixture instead of inspecting live state.",
    )
    parser.add_argument(
        "--derived-data",
        action="append",
        default=[],
        help="Include one additional exact DerivedData path (repeatable).",
    )
    parser.add_argument("--compact", action="store_true", help="Emit compact JSON.")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_arguments(argv or sys.argv[1:])
    try:
        if args.fixture:
            raw = collect_fixture(args.fixture)
            mode = "fixture"
        else:
            raw = collect_live(args.derived_data)
            mode = "live"
        snapshot = classify_snapshot(raw, mode)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print("inventory failed: {}".format(type(exc).__name__), file=sys.stderr)
        return 1
    if args.compact:
        json.dump(snapshot, sys.stdout, sort_keys=True, separators=(",", ":"))
    else:
        json.dump(snapshot, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 3 if snapshot["coverage"] == "partial" else 0


if __name__ == "__main__":
    sys.exit(main())
