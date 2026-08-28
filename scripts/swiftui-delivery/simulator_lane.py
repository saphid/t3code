#!/usr/bin/env python3
"""Own explicit Simulator UDIDs and route UI commands without shared defaults."""

import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path


SCHEMA_VERSION = 1
KIND = "swiftui-simulator-lane-lease"
UDID_PATTERN = re.compile(r"^[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$")
LANE_PATTERN = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
XCODEBUILDMCP_VERSION = "2.7.0"
AXE_VERSION = "1.8.0"
POOL_SCHEMA_VERSION = 1
POOL_KIND = "swiftui-simulator-pool"
DEFAULT_POOL_SIZE = 3
DEFAULT_POOL_NAME_PREFIX = "T3 SwiftUI iPhone 16 Pro Lane"


class LeaseHeldError(RuntimeError):
    """The exact simulator already has a lane owner."""


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def lease_root():
    configured = os.environ.get("T3_SWIFTUI_SIMULATOR_LEASE_ROOT")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path.home() / ".local/state/t3/swiftui-delivery/simulator-leases"


def pool_path():
    configured = os.environ.get("T3_SWIFTUI_SIMULATOR_POOL")
    if configured:
        return Path(configured).expanduser().resolve()
    return lease_root().parent / "simulator-pool.json"


def atomic_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp-" + secrets.token_hex(6))
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)


def simulator_catalog():
    completed = subprocess.run(
        ["xcrun", "simctl", "list", "devices", "-j"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError("simctl device inventory failed: " + completed.stderr.strip())
    raw = json.loads(completed.stdout)
    catalog = {}
    for runtime, devices in raw.get("devices", {}).items():
        for device in devices:
            item = dict(device)
            item["runtime"] = runtime
            catalog[item["udid"].upper()] = item
    return catalog


def validate_pool_identifier(value, kind):
    prefix = "com.apple.CoreSimulator.%s." % kind
    if not isinstance(value, str) or not value.startswith(prefix):
        raise ValueError("invalid CoreSimulator %s identifier" % kind.lower())
    return value


def load_pool(path=None):
    source = Path(path or pool_path())
    if not source.is_file():
        raise ValueError("simulator pool manifest is missing; run ensure-pool")
    payload = json.loads(source.read_text(encoding="utf-8"))
    if (payload.get("schemaVersion") != POOL_SCHEMA_VERSION or
            payload.get("kind") != POOL_KIND):
        raise ValueError("not a supported simulator pool manifest")
    validate_pool_identifier(payload.get("deviceTypeIdentifier"), "SimDeviceType")
    validate_pool_identifier(payload.get("runtimeIdentifier"), "SimRuntime")
    members = payload.get("members")
    if not isinstance(members, list) or not members:
        raise ValueError("simulator pool manifest has no members")
    slots = set()
    udids = set()
    for member in members:
        if not isinstance(member, dict):
            raise ValueError("simulator pool manifest has invalid members")
        slot = member.get("slot")
        udid = validate_udid(member.get("udid", ""))
        if not isinstance(slot, int) or slot < 1 or slot in slots or udid in udids:
            raise ValueError("simulator pool manifest has invalid members")
        if not isinstance(member.get("name"), str) or not member["name"]:
            raise ValueError("simulator pool member has no name")
        slots.add(slot)
        udids.add(udid)
        member["udid"] = udid
    return payload


@contextmanager
def pool_mutation_lock(path):
    lock_path = Path(path).with_name(Path(path).name + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+") as handle:
        lock_path.chmod(0o600)
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield


def create_simulator(name, device_type_identifier, runtime_identifier, runner=None):
    execute = runner or subprocess.run
    completed = execute(
        ["xcrun", "simctl", "create", name, device_type_identifier, runtime_identifier],
        check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError("simctl could not create %s: %s" % (
            name, (completed.stderr or "unknown error").strip()
        ))
    output = (completed.stdout or "").strip()
    try:
        return validate_udid(output)
    except ValueError:
        raise RuntimeError("simctl returned an invalid UDID while creating " + name)


def ensure_pool(device_type_identifier, runtime_identifier,
                count=DEFAULT_POOL_SIZE, name_prefix=DEFAULT_POOL_NAME_PREFIX,
                path=None, catalog=None, runner=None, root=None):
    device_type_identifier = validate_pool_identifier(
        device_type_identifier, "SimDeviceType"
    )
    runtime_identifier = validate_pool_identifier(runtime_identifier, "SimRuntime")
    if not isinstance(count, int) or count < 1 or count > 8:
        raise ValueError("simulator pool count must be from 1 through 8")
    if (not isinstance(name_prefix, str) or not name_prefix.strip() or
            "\n" in name_prefix or "\r" in name_prefix):
        raise ValueError("simulator pool name prefix is invalid")
    destination = Path(path or pool_path())
    with pool_mutation_lock(destination):
        devices = dict(catalog if catalog is not None else simulator_catalog())
        previous = None
        if destination.is_file():
            previous = load_pool(destination)
            same_configuration = (
                previous["deviceTypeIdentifier"] == device_type_identifier and
                previous["runtimeIdentifier"] == runtime_identifier and
                previous.get("namePrefix") == name_prefix.strip()
            )
            if not same_configuration:
                raise RuntimeError(
                    "existing simulator pool configuration differs; use a new manifest path"
                )
            if count < len(previous["members"]):
                raise RuntimeError("existing simulator pool cannot be shrunk")
        previous_by_slot = {
            member["slot"]: member for member in (previous or {}).get("members", [])
        }
        members = []
        for slot in range(1, count + 1):
            name = "%s %d" % (name_prefix.strip(), slot)
            candidates = [
                device for device in devices.values()
                if device.get("name") == name and
                device.get("runtime") == runtime_identifier and
                device.get("deviceTypeIdentifier") == device_type_identifier and
                device.get("isAvailable") is not False
            ]
            previous_member = previous_by_slot.get(slot)
            selected = None
            if previous_member:
                selected = next(
                    (device for device in candidates
                     if device.get("udid", "").upper() == previous_member["udid"]),
                    None,
                )
                previous_lease = (
                    lease_directory(previous_member["udid"], root) / "lease.json"
                )
                if selected is None and previous_lease.is_file():
                    owner = "unknown"
                    try:
                        owner = load_receipt(previous_lease)["laneId"]
                    except (OSError, ValueError, KeyError, json.JSONDecodeError):
                        pass
                    raise RuntimeError(
                        "cannot replace simulator pool slot %d while leased by lane %s"
                        % (slot, owner)
                    )
            if selected is None and len(candidates) == 1:
                selected = candidates[0]
            elif selected is None and len(candidates) > 1:
                raise RuntimeError("multiple matching simulators exist for " + name)
            if selected is None:
                udid = create_simulator(
                    name, device_type_identifier, runtime_identifier, runner
                )
                selected = {
                    "udid": udid,
                    "name": name,
                    "runtime": runtime_identifier,
                    "deviceTypeIdentifier": device_type_identifier,
                    "isAvailable": True,
                    "state": "Shutdown",
                }
                devices[udid] = selected
            members.append({
                "slot": slot,
                "name": name,
                "udid": validate_udid(selected["udid"]),
            })
        payload = {
            "schemaVersion": POOL_SCHEMA_VERSION,
            "kind": POOL_KIND,
            "deviceTypeIdentifier": device_type_identifier,
            "runtimeIdentifier": runtime_identifier,
            "desiredCount": count,
            "namePrefix": name_prefix.strip(),
            "members": members,
            "updatedAt": utc_now(),
        }
        atomic_json(destination, payload)
    return payload


def acquire_pool_lease(lane_id, receipt_path, path=None, catalog=None, root=None):
    pool = load_pool(path)
    devices = catalog if catalog is not None else simulator_catalog()
    stale = []
    occupied = []
    for member in sorted(pool["members"], key=lambda item: item["slot"]):
        udid = member["udid"]
        device = devices.get(udid)
        if (not device or device.get("isAvailable") is False or
                device.get("name") != member["name"] or
                device.get("runtime") != pool["runtimeIdentifier"] or
                device.get("deviceTypeIdentifier") != pool["deviceTypeIdentifier"]):
            stale.append(str(member["slot"]))
            continue
        try:
            return acquire_lease(lane_id, udid, receipt_path, devices, root)
        except LeaseHeldError:
            occupied.append(str(member["slot"]))
    details = []
    if occupied:
        details.append("leased slots " + ", ".join(occupied))
    if stale:
        details.append("stale slots " + ", ".join(stale) + " (run ensure-pool)")
    suffix = ": " + "; ".join(details) if details else ""
    raise RuntimeError("simulator pool has no free member" + suffix)


def inspect_pool(path=None, catalog=None, root=None):
    pool = load_pool(path)
    devices = catalog if catalog is not None else simulator_catalog()
    members = []
    for member in sorted(pool["members"], key=lambda item: item["slot"]):
        device = devices.get(member["udid"])
        state_path = lease_directory(member["udid"], root) / "lease.json"
        row = dict(member)
        row.update({
            "available": bool(device and device.get("isAvailable") is not False),
            "state": device.get("state", "unknown") if device else "missing",
            "leased": state_path.is_file(),
        })
        if state_path.is_file():
            try:
                row["laneId"] = load_receipt(state_path)["laneId"]
            except (OSError, ValueError, json.JSONDecodeError):
                row["laneId"] = "unknown"
        members.append(row)
    return {
        "schemaVersion": POOL_SCHEMA_VERSION,
        "kind": "swiftui-simulator-pool-inspection",
        "deviceTypeIdentifier": pool["deviceTypeIdentifier"],
        "runtimeIdentifier": pool["runtimeIdentifier"],
        "members": members,
    }


def validate_udid(value):
    if not UDID_PATTERN.fullmatch(value):
        raise ValueError("simulator must be an exact UDID")
    return value.upper()


def validate_lane_id(value):
    if not isinstance(value, str) or not LANE_PATTERN.fullmatch(value):
        raise ValueError("lane ID must use canonical lowercase segments")
    return value


def lease_directory(udid, root=None):
    return (root or lease_root()) / (udid + ".lock")


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def acquire_lease(lane_id, udid, receipt_path, catalog=None, root=None):
    lane_id = validate_lane_id(lane_id)
    udid = validate_udid(udid)
    devices = catalog if catalog is not None else simulator_catalog()
    device = devices.get(udid)
    if not device or device.get("isAvailable") is False:
        raise ValueError("simulator is unavailable or unknown: " + udid)
    root = root or lease_root()
    root.mkdir(parents=True, exist_ok=True)
    directory = lease_directory(udid, root)
    try:
        directory.mkdir()
    except FileExistsError:
        existing_path = directory / "lease.json"
        owner = "unknown"
        if existing_path.is_file():
            try:
                owner = json.loads(existing_path.read_text(encoding="utf-8")).get("laneId", owner)
            except (OSError, ValueError):
                pass
        raise LeaseHeldError("simulator is already leased by lane " + owner)
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": KIND,
        "laneId": lane_id,
        "token": secrets.token_hex(24),
        "acquiredAt": utc_now(),
        "simulator": {
            "udid": udid,
            "name": device.get("name"),
            "runtime": device.get("runtime"),
            "stateAtAcquire": device.get("state"),
        },
        "driver": {
            "xcodebuildmcpVersion": XCODEBUILDMCP_VERSION,
            "routing": "explicit-udid-per-command",
        },
        "allocator": {"pid": os.getpid(), "cwd": str(Path.cwd())},
    }
    try:
        atomic_json(directory / "lease.json", payload)
        for name in ("action.lock", "recording.lock"):
            lock_path = directory / name
            lock_path.touch(mode=0o600)
            lock_path.chmod(0o600)
        atomic_json(receipt_path, payload)
    except Exception:
        for path in (directory / "lease.json", directory / "action.lock",
                     directory / "recording.lock"):
            if path.exists():
                path.unlink()
        directory.rmdir()
        raise
    return payload


def load_receipt(path):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if payload.get("schemaVersion") != SCHEMA_VERSION or payload.get("kind") != KIND:
        raise ValueError("not a supported simulator lane receipt")
    validate_udid(payload.get("simulator", {}).get("udid", ""))
    validate_lane_id(payload.get("laneId"))
    if not payload.get("token"):
        raise ValueError("simulator lane receipt is incomplete")
    return payload


def verify_lease(receipt_path, root=None):
    receipt = load_receipt(receipt_path)
    udid = receipt["simulator"]["udid"]
    state_path = lease_directory(udid, root) / "lease.json"
    if not state_path.is_file():
        raise RuntimeError("simulator lane lease is not active")
    state = load_receipt(state_path)
    for field in ("laneId", "token"):
        if state[field] != receipt[field]:
            raise RuntimeError("simulator lane lease does not match its active owner")
    return receipt


def release_lease(receipt_path, root=None):
    receipt = verify_lease(receipt_path, root)
    directory = lease_directory(receipt["simulator"]["udid"], root)
    state_path = directory / "lease.json"
    action_path = directory / "action.lock"
    recording_path = directory / "recording.lock"
    expected_paths = {state_path, action_path, recording_path}
    unexpected = [path.name for path in directory.iterdir() if path not in expected_paths]
    if unexpected:
        raise RuntimeError("simulator lease contains unexpected files: " + ", ".join(unexpected))
    with action_path.open("a+") as action_handle, recording_path.open("a+") as recording_handle:
        fcntl.flock(action_handle.fileno(), fcntl.LOCK_EX)
        fcntl.flock(recording_handle.fileno(), fcntl.LOCK_EX)
        verify_lease(receipt_path, root)
        state_path.unlink()
        action_path.unlink()
        recording_path.unlink()
        directory.rmdir()
    return receipt


@contextmanager
def lane_operation(receipt_path, lock_name, root=None):
    receipt = verify_lease(receipt_path, root)
    directory = lease_directory(receipt["simulator"]["udid"], root)
    lock_path = directory / lock_name
    with lock_path.open("a+") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        receipt = verify_lease(receipt_path, root)
        yield receipt


def inspect_lease(udid, root=None, catalog=None):
    udid = validate_udid(udid)
    state_path = lease_directory(udid, root) / "lease.json"
    devices = catalog if catalog is not None else simulator_catalog()
    device = devices.get(udid, {})
    result = {
        "schemaVersion": 1,
        "kind": "swiftui-simulator-lane-inspection",
        "simulatorUdid": udid,
        "simulatorState": device.get("state", "unknown"),
        "active": state_path.is_file(),
    }
    if state_path.is_file():
        raw = state_path.read_bytes()
        state = load_receipt(state_path)
        result.update({
            "laneId": state["laneId"],
            "acquiredAt": state.get("acquiredAt"),
            "leaseSha256": sha256_bytes(raw),
            "allocator": state.get("allocator"),
        })
    return result


def processes_referencing_udid(udid):
    completed = subprocess.run(
        ["ps", "-axo", "pid=,ppid=,command="], check=False,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError("cannot inspect simulator processes")
    rows = []
    parents = {}
    for line in completed.stdout.splitlines():
        fields = line.strip().split(None, 2)
        if len(fields) == 3:
            pid, parent, command = int(fields[0]), int(fields[1]), fields[2]
            parents[pid] = parent
            rows.append((pid, command))
    ancestors = {os.getpid()}
    current = os.getpid()
    while current in parents and parents[current] not in ancestors:
        current = parents[current]
        ancestors.add(current)
    return ["%d %s" % (pid, command) for pid, command in rows
            if pid not in ancestors and udid in command]


def recover_lease(udid, expected_sha256, reason, recovery_receipt,
                  root=None, catalog=None, process_matches=None):
    inspection = inspect_lease(udid, root, catalog)
    if not inspection["active"]:
        raise RuntimeError("simulator lane lease is not active")
    if inspection["leaseSha256"] != expected_sha256:
        raise RuntimeError("active simulator lease hash changed; inspect again")
    if inspection["simulatorState"] != "Shutdown":
        raise RuntimeError("recovery requires the exact simulator to be Shutdown")
    matches = (process_matches if process_matches is not None
               else processes_referencing_udid(inspection["simulatorUdid"]))
    if matches:
        raise RuntimeError("recovery found a process referencing the simulator")
    if len(reason.strip()) < 40:
        raise ValueError("recovery reason must contain at least 40 characters")
    directory = lease_directory(inspection["simulatorUdid"], root)
    state_path = directory / "lease.json"
    action_path = directory / "action.lock"
    recording_path = directory / "recording.lock"
    expected_paths = {state_path, action_path, recording_path}
    if [path for path in directory.iterdir() if path not in expected_paths]:
        raise RuntimeError("simulator lease contains unexpected files")
    recovery = dict(inspection)
    recovery.update({
        "kind": "swiftui-simulator-lane-recovery",
        "recoveredAt": utc_now(),
        "reason": reason.strip(),
    })
    atomic_json(recovery_receipt, recovery)
    with action_path.open("a+") as action_handle, recording_path.open("a+") as recording_handle:
        fcntl.flock(action_handle.fileno(), fcntl.LOCK_EX)
        fcntl.flock(recording_handle.fileno(), fcntl.LOCK_EX)
        state_path.unlink()
        action_path.unlink()
        recording_path.unlink()
        directory.rmdir()
    return recovery


def write_lease_binding(receipt_path, output_path, root=None):
    receipt = verify_lease(receipt_path, root)
    state_path = lease_directory(receipt["simulator"]["udid"], root) / "lease.json"
    payload = {
        "schemaVersion": 1,
        "kind": "swiftui-simulator-lease-binding",
        "laneId": receipt["laneId"],
        "simulator": receipt["simulator"],
        "leaseSha256": sha256_bytes(state_path.read_bytes()),
        "boundAt": utc_now(),
    }
    atomic_json(output_path, payload)
    return payload


def snapshot_binding(snapshot_path, receipt):
    payload = json.loads(Path(snapshot_path).read_text(encoding="utf-8"))
    expected = receipt["simulator"]["udid"]
    artifact_udid = payload.get("data", {}).get("artifacts", {}).get("simulatorId")
    capture = payload.get("data", {}).get("capture", {})
    capture_udid = capture.get("udid") or capture.get("simulatorId")
    if payload.get("didError") is not False:
        raise ValueError("snapshot reports an error")
    if artifact_udid != expected or capture_udid != expected:
        raise ValueError(
            "snapshot simulator mismatch: expected %s, artifact %s, capture %s"
            % (expected, artifact_udid, capture_udid)
        )
    screen_hash = capture.get("screenHash")
    if not screen_hash:
        raise ValueError("snapshot has no screen hash")
    return {
        "schemaVersion": 1,
        "kind": "swiftui-simulator-snapshot-binding",
        "laneId": receipt["laneId"],
        "simulatorUdid": expected,
        "screenHash": screen_hash,
        "snapshotPath": str(Path(snapshot_path).resolve()),
    }


def run_xcodebuildmcp(receipt_path, arguments, root=None):
    receipt = verify_lease(receipt_path, root)
    udid = receipt["simulator"]["udid"]
    if any(value == "--simulator-name" or value.startswith("--simulator-name=")
           for value in arguments):
        raise ValueError("simulator names are ambiguous; the lane supplies its UDID")
    equals_ids = [value.split("=", 1)[1] for value in arguments
                  if value.startswith("--simulator-id=")]
    if equals_ids:
        if len(equals_ids) != 1 or equals_ids[0].upper() != udid:
            raise ValueError("command simulator ID does not match the lane")
        command_arguments = list(arguments)
    elif "--simulator-id" in arguments:
        index = arguments.index("--simulator-id")
        if index + 1 >= len(arguments) or arguments[index + 1].upper() != udid:
            raise ValueError("command simulator ID does not match the lane")
        command_arguments = list(arguments)
    else:
        command_arguments = list(arguments) + ["--simulator-id", udid]
    if (len(command_arguments) >= 2 and command_arguments[0] == "ui-automation" and
            command_arguments[1] not in ("snapshot-ui", "screenshot")):
        raise ValueError(
            "stateful UI actions must use the atomic AXe runner; element refs cannot cross processes"
        )
    command = ["npx", "--yes", "xcodebuildmcp@" + XCODEBUILDMCP_VERSION] + command_arguments
    with lane_operation(receipt_path, "action.lock", root):
        return subprocess.run(command, check=False).returncode


def locate_axe():
    completed = subprocess.run(
        ["npm", "exec", "--yes", "--package=xcodebuildmcp@" + XCODEBUILDMCP_VERSION,
         "--", "sh", "-c", "command -v xcodebuildmcp"],
        check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    if completed.returncode != 0 or not completed.stdout.strip():
        raise RuntimeError("cannot locate pinned XcodeBuildMCP package")
    binary = Path(completed.stdout.strip()).resolve()
    axe = binary.parent.parent / "bundled" / "axe"
    if not axe.is_file() or not os.access(axe, os.X_OK):
        raise RuntimeError("pinned XcodeBuildMCP has no executable bundled AXe")
    version = subprocess.run(
        [str(axe), "--version"], check=False, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True,
    )
    if version.returncode != 0 or AXE_VERSION not in (version.stdout + version.stderr):
        raise RuntimeError("bundled AXe version is not " + AXE_VERSION)
    return axe


def run_axe(receipt_path, arguments, root=None, axe_path=None):
    receipt = verify_lease(receipt_path, root)
    udid = receipt["simulator"]["udid"]
    if not arguments:
        raise ValueError("axe requires a subcommand after --")
    if any(value == "--udid" or value.startswith("--udid=") for value in arguments):
        raise ValueError("the lane supplies the exact AXe UDID")
    axe = Path(axe_path) if axe_path else locate_axe()
    lock_name = "recording.lock" if arguments[0] in ("record-video", "stream-video") \
        else "action.lock"
    with lane_operation(receipt_path, lock_name, root):
        return subprocess.run(
            [str(axe)] + list(arguments) + ["--udid", udid], check=False
        ).returncode


def parser():
    root = argparse.ArgumentParser(description=__doc__)
    subparsers = root.add_subparsers(dest="command", required=True)
    acquire = subparsers.add_parser("acquire")
    acquire.add_argument("--lane-id", required=True)
    acquire.add_argument("--simulator", required=True)
    acquire.add_argument("--receipt", required=True, type=Path)
    acquire_pool = subparsers.add_parser("acquire-next")
    acquire_pool.add_argument("--lane-id", required=True)
    acquire_pool.add_argument("--receipt", required=True, type=Path)
    ensure = subparsers.add_parser("ensure-pool")
    ensure.add_argument("--device-type", required=True)
    ensure.add_argument("--runtime", required=True)
    ensure.add_argument("--count", type=int, default=DEFAULT_POOL_SIZE)
    ensure.add_argument("--name-prefix", default=DEFAULT_POOL_NAME_PREFIX)
    subparsers.add_parser("pool-status")
    verify = subparsers.add_parser("verify")
    verify.add_argument("--receipt", required=True, type=Path)
    release = subparsers.add_parser("release")
    release.add_argument("--receipt", required=True, type=Path)
    inspect = subparsers.add_parser("inspect")
    inspect.add_argument("--simulator", required=True)
    recover = subparsers.add_parser("recover")
    recover.add_argument("--simulator", required=True)
    recover.add_argument("--expected-lease-sha256", required=True)
    recover.add_argument("--reason", required=True)
    recover.add_argument("--receipt", required=True, type=Path)
    binding = subparsers.add_parser("write-binding")
    binding.add_argument("--receipt", required=True, type=Path)
    binding.add_argument("--output", required=True, type=Path)
    snapshot = subparsers.add_parser("validate-snapshot")
    snapshot.add_argument("--receipt", required=True, type=Path)
    snapshot.add_argument("--snapshot", required=True, type=Path)
    xcb = subparsers.add_parser("xcb")
    xcb.add_argument("--receipt", required=True, type=Path)
    xcb.add_argument("arguments", nargs=argparse.REMAINDER)
    axe = subparsers.add_parser("axe")
    axe.add_argument("--receipt", required=True, type=Path)
    axe.add_argument("arguments", nargs=argparse.REMAINDER)
    return root


def main(argv=None):
    arguments = parser().parse_args(argv)
    try:
        if arguments.command == "acquire":
            payload = acquire_lease(
                arguments.lane_id, arguments.simulator, arguments.receipt
            )
        elif arguments.command == "acquire-next":
            payload = acquire_pool_lease(arguments.lane_id, arguments.receipt)
        elif arguments.command == "ensure-pool":
            payload = ensure_pool(
                arguments.device_type, arguments.runtime,
                arguments.count, arguments.name_prefix
            )
        elif arguments.command == "pool-status":
            payload = inspect_pool()
        elif arguments.command == "verify":
            payload = verify_lease(arguments.receipt)
        elif arguments.command == "release":
            payload = release_lease(arguments.receipt)
        elif arguments.command == "inspect":
            payload = inspect_lease(arguments.simulator)
        elif arguments.command == "recover":
            payload = recover_lease(
                arguments.simulator, arguments.expected_lease_sha256,
                arguments.reason, arguments.receipt
            )
        elif arguments.command == "write-binding":
            payload = write_lease_binding(arguments.receipt, arguments.output)
        elif arguments.command == "validate-snapshot":
            payload = snapshot_binding(
                arguments.snapshot, verify_lease(arguments.receipt)
            )
        else:
            command_arguments = arguments.arguments
            if command_arguments and command_arguments[0] == "--":
                command_arguments = command_arguments[1:]
            if arguments.command == "xcb":
                if len(command_arguments) < 2:
                    raise ValueError("xcb requires a workflow and tool after --")
                return run_xcodebuildmcp(arguments.receipt, command_arguments)
            return run_axe(arguments.receipt, command_arguments)
        visible = dict(payload)
        visible.pop("token", None)
        print(json.dumps(visible, indent=2, sort_keys=True))
        return 0
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        print("simulator-lane: " + str(error), file=sys.stderr)
        return 75 if isinstance(error, RuntimeError) else 64


if __name__ == "__main__":
    sys.exit(main())
