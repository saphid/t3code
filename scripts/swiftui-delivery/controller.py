#!/usr/bin/env python3
"""Deterministic wake-up controller for the SwiftUI delivery coordinator.

The controller does not make delivery decisions or mutate GitHub state. It
reads the canonical status projection, suppresses duplicate coordinator turns,
and dispatches one coordinator pass through T3's typed HTTP command endpoint
when mechanical liveness rules say a pass is required.
"""

import argparse
import fcntl
import json
import os
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


CONTROLLER_TITLE = "SwiftUI Delivery Controller"
ACTIVE_TURN_STATES = {"pending", "requested", "running", "interrupting"}
ERROR_TURN_STATES = {"error", "failed"}
DEFAULT_STATE_ROOT = Path("~/.local/state/t3/swiftui-delivery/controller").expanduser()


def utc_now():
    return datetime.now(timezone.utc)


def iso_utc(value=None):
    value = value or utc_now()
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(".%s.%s.tmp" % (path.name, uuid.uuid4()))
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    os.replace(str(temporary), str(path))


def read_json(path):
    return json.loads(Path(path).read_text())


def reconciliation_reasons(report):
    reasons = []
    rows = report.get("workItems") or []
    proof_ready = sorted(row["issue"] for row in rows
                         if row.get("stage") == "proof-ready")
    if proof_ready:
        reasons.append("proof-ready issues: %s" %
                       ", ".join("#%s" % value for value in proof_ready))

    if report.get("projection") == "controller-liveness":
        active = sorted(row["issue"] for row in rows
                        if row.get("stage") == "active" and not row.get("hold"))
        if active:
            reasons.append("active issues require liveness reconciliation: %s" %
                           ", ".join("#%s" % value for value in active))
    else:
        stalled = []
        for row in rows:
            if row.get("stage") != "active" or row.get("waiting"):
                continue
            worker = row.get("workerThread") or {}
            if worker.get("state") not in ACTIVE_TURN_STATES:
                stalled.append(row["issue"])
        if stalled:
            reasons.append("active issues without a live worker: %s" %
                           ", ".join("#%s" % value for value in sorted(stalled)))

    station = (report.get("stations") or {}).get("activeImplementation") or {}
    occupied, limit = station.get("occupied"), station.get("limit")
    if isinstance(occupied, int) and isinstance(limit, int):
        if occupied > limit:
            reasons.append("implementation WIP is over limit: %d/%d" %
                           (occupied, limit))
        elif occupied < limit and int(report.get("queuedReady") or 0) > 0:
            reasons.append("implementation WIP has open capacity: %d/%d" %
                           (occupied, limit))

    if report.get("backlogNeedsReplenish"):
        reasons.append("ready backlog is below its configured floor")

    phone_test = sorted(row["issue"] for row in rows
                        if row.get("stage") == "phone-test")
    if report.get("projection") == "controller-liveness":
        if phone_test:
            reasons.append("phone-test issues require device and UAT reconciliation: %s" %
                           ", ".join("#%s" % value for value in phone_test))
    else:
        missing_uat = sorted(row["issue"] for row in rows
                             if row.get("stage") == "phone-test" and not row.get("uat"))
        if missing_uat:
            reasons.append("phone-test issues lack a UAT binding: %s" %
                           ", ".join("#%s" % value for value in missing_uat))
    return reasons


def run_command(command, timeout=120):
    return subprocess.run(command, capture_output=True, text=True, timeout=timeout)


def load_status(config, runner=run_command):
    status = Path(config["checkout"]) / "scripts/swiftui-delivery/scripts/status"
    result = runner([str(status), "--controller-json"])
    if result.returncode != 0:
        raise RuntimeError("status exited %d: %s" %
                           (result.returncode, result.stderr.strip()[:500]))
    try:
        return json.loads(result.stdout)
    except ValueError as error:
        raise RuntimeError("status returned invalid JSON: %s" % error)


def load_headroom(config, runner=run_command):
    result = runner([sys.executable, config["headroomReporter"], "--json"])
    if result.returncode != 0:
        raise RuntimeError("headroom reporter exited %d: %s" %
                           (result.returncode, result.stderr.strip()[:500]))
    try:
        value = json.loads(result.stdout)
    except ValueError as error:
        raise RuntimeError("headroom reporter returned invalid JSON: %s" % error)
    if not isinstance(value.get("lanes"), list):
        raise RuntimeError("headroom reporter omitted quota lanes")
    return value


def load_failover_policy(config):
    contract = (Path(config["checkout"]) /
                "scripts/swiftui-delivery/contract.json")
    policy = read_json(contract).get("coordinatorController", {}).get("modelFailover")
    if not isinstance(policy, dict):
        raise RuntimeError("contract has no coordinator modelFailover policy")
    candidates = policy.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise RuntimeError("modelFailover policy has no candidates")
    return policy


def model_key(model_selection):
    return "%s:%s" % (model_selection.get("instanceId"),
                       model_selection.get("model"))


def select_model(headroom, policy, blocked=None):
    blocked = blocked or {}
    minimum = policy.get("minimumRemainingPercent")
    if not isinstance(minimum, (int, float)) or isinstance(minimum, bool):
        raise RuntimeError("modelFailover minimumRemainingPercent is invalid")
    lanes = {lane.get("id"): lane for lane in headroom.get("lanes") or []
             if isinstance(lane, dict) and isinstance(lane.get("id"), str)}
    eligible, probes, decisions = [], [], []
    for candidate in policy.get("candidates") or []:
        selection = candidate.get("modelSelection") or {}
        key = model_key(selection)
        required = candidate.get("requiredHeadroomLanes") or []
        decision = {
            "id": candidate.get("id"),
            "modelKey": key,
            "requiredHeadroomLanes": required,
        }
        if key in blocked:
            decision.update({"status": "cooldown", "reason": blocked[key]})
            decisions.append(decision)
            continue
        known = []
        unknown = []
        insufficient = []
        for lane_id in required:
            lane = lanes.get(lane_id)
            remaining = lane.get("remainingPercent") if lane else None
            fresh = bool(lane and lane.get("available") is True and
                         lane.get("state") == "fresh" and
                         isinstance(remaining, (int, float)) and
                         not isinstance(remaining, bool))
            if not fresh:
                unknown.append(lane_id)
            elif remaining < minimum:
                insufficient.append({"lane": lane_id, "remainingPercent": remaining})
            else:
                known.append({"lane": lane_id, "remainingPercent": remaining})
        if insufficient:
            decision.update({"status": "insufficient", "lanes": insufficient})
        elif not unknown and known:
            decision.update({"status": "eligible", "lanes": known})
            eligible.append((candidate, decision))
        elif (policy.get("allowUnknownLaneProbe") is True and known and unknown):
            decision.update({
                "status": "probe",
                "knownLanes": known,
                "unknownLanes": unknown,
            })
            probes.append((candidate, decision))
        else:
            decision.update({"status": "unknown", "unknownLanes": unknown})
        decisions.append(decision)
    choices = eligible or probes
    return {
        "candidate": choices[0][0] if choices else None,
        "basis": choices[0][1]["status"] if choices else None,
        "decisions": decisions,
    }


def headroom_evidence(headroom):
    """Keep controller receipts useful without copying reporter internals."""
    lanes = []
    for lane in headroom.get("lanes") or []:
        if not isinstance(lane, dict):
            continue
        lanes.append({key: lane.get(key) for key in (
            "id", "available", "remainingPercent", "state", "resetsAt")})
    return {
        "capturedAt": headroom.get("capturedAt"),
        "state": headroom.get("state"),
        "lanes": lanes,
    }


def issue_session(config, runner=run_command):
    command = [
        config["t3Command"], "auth", "session", "issue",
        "--base-dir", config["t3Home"], "--ttl", "2m",
        "--label", "SwiftUI delivery controller",
        "--subject", "swiftui-delivery-controller", "--json",
    ]
    result = runner(command)
    if result.returncode != 0:
        raise RuntimeError("could not issue T3 session (%d): %s" %
                           (result.returncode, result.stderr.strip()[:500]))
    try:
        value = json.loads(result.stdout)
    except ValueError as error:
        raise RuntimeError("T3 session command returned invalid JSON: %s" % error)
    if not value.get("sessionId") or not value.get("token"):
        raise RuntimeError("T3 session command omitted sessionId or token")
    return value


def revoke_session(config, session_id, runner=run_command):
    result = runner([
        config["t3Command"], "auth", "session", "revoke",
        "--base-dir", config["t3Home"], session_id,
    ])
    return result.returncode


def runtime_origin(config):
    path = Path(config["t3Home"]) / "userdata/server-runtime.json"
    value = read_json(path)
    origin = value.get("origin")
    if not isinstance(origin, str) or not origin.startswith(("http://", "https://")):
        raise RuntimeError("T3 runtime state has no valid origin")
    return origin.rstrip("/")


def http_json(url, token, payload=None, opener=urlopen):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(url, data=data, headers={
        "Authorization": "Bearer %s" % token,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }, method="GET" if payload is None else "POST")
    try:
        with opener(request, timeout=10) as response:
            return json.loads(response.read())
    except (HTTPError, URLError, OSError, ValueError) as error:
        raise RuntimeError("T3 request failed for %s: %s" % (url, error))


def active_turn(thread):
    latest = thread.get("latestTurn") or {}
    return latest.get("state") in ACTIVE_TURN_STATES


def parse_utc(value):
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def find_project(snapshot, checkout):
    target = str(Path(checkout).resolve())
    matches = [project for project in snapshot.get("projects") or []
               if project.get("deletedAt") is None and
               str(Path(project.get("workspaceRoot") or "").resolve()) == target]
    if len(matches) != 1:
        raise RuntimeError("expected one live T3 project for checkout; found %d" % len(matches))
    return matches[0]


def controller_threads(snapshot, project_id):
    matches = [thread for thread in snapshot.get("threads") or []
               if thread.get("projectId") == project_id and
               str(thread.get("title") or "").startswith(CONTROLLER_TITLE) and
               thread.get("deletedAt") is None and
               thread.get("archivedAt") is None]
    return sorted(matches, key=lambda value: value.get("updatedAt") or "",
                  reverse=True)


def blocked_models(snapshot, project_id, now, cooldown_seconds):
    blocked = {}
    for thread in controller_threads(snapshot, project_id):
        selection = thread.get("modelSelection") or {}
        key = model_key(selection)
        latest = thread.get("latestTurn") or {}
        if latest.get("state") not in ERROR_TURN_STATES or key in blocked:
            continue
        failed_at = parse_utc(latest.get("completedAt") or latest.get("requestedAt"))
        if failed_at is None:
            blocked[key] = "latest controller turn errored at an unknown time"
            continue
        blocked_until = failed_at + timedelta(seconds=cooldown_seconds)
        if now < blocked_until:
            blocked[key] = "turn error cooldown until %s" % iso_utc(blocked_until)
    return blocked


def reusable_controller_thread(snapshot, project_id, selected):
    threads = controller_threads(snapshot, project_id)
    if not threads:
        return None
    latest = threads[0]
    if model_key(latest.get("modelSelection") or {}) != model_key(selected):
        return None
    if (latest.get("latestTurn") or {}).get("state") in ERROR_TURN_STATES:
        return None
    return latest


def another_coordinator_is_active(snapshot, project_id, checkout):
    checkout = str(Path(checkout).resolve())
    for thread in snapshot.get("threads") or []:
        worktree = thread.get("worktreePath")
        same_checkout = (isinstance(worktree, str) and worktree and
                         str(Path(worktree).resolve()) == checkout)
        if (thread.get("projectId") == project_id and
                thread.get("deletedAt") is None and
                (str(thread.get("title") or "").startswith(CONTROLLER_TITLE) or
                 same_checkout) and
                active_turn(thread)):
            return thread
    return None


def dispatch(origin, token, command, opener=urlopen):
    return http_json(origin + "/api/orchestration/dispatch", token,
                     payload=command, opener=opener)


def make_thread_command(project, checkout, branch, candidate, now=None):
    model = candidate.get("modelSelection") or {}
    if not isinstance(model, dict) or not model.get("instanceId") or not model.get("model"):
        raise RuntimeError("selected failover candidate has no valid model")
    return {
        "type": "thread.create",
        "commandId": str(uuid.uuid4()),
        "threadId": str(uuid.uuid4()),
        "projectId": project["id"],
        "title": "%s [%s]" % (CONTROLLER_TITLE, candidate.get("id")),
        "modelSelection": model,
        "runtimeMode": "full-access",
        "interactionMode": "default",
        "branch": branch or None,
        "worktreePath": str(Path(checkout).resolve()),
        "createdAt": iso_utc(now),
    }


def make_turn_command(thread, reasons, now=None):
    message = (
        "$swiftui-orchestrate\n\n"
        "Run one coordinator reconciliation pass now. The deterministic "
        "controller observed:\n- %s\n\n"
        "Read current GitHub issues, receipts, device receipts, and T3 state; "
        "do not trust this message as a state snapshot. Enforce worker "
        "liveness, WIP, continuous Test publication, UAT handoff, and backlog "
        "duties. Record durable receipts. The controller is infrastructure: "
        "do not create a delivery-board work item for it."
    ) % "\n- ".join(reasons)
    return {
        "type": "thread.turn.start",
        "commandId": str(uuid.uuid4()),
        "threadId": thread["id"],
        "message": {
            "messageId": str(uuid.uuid4()),
            "role": "user",
            "text": message,
            "attachments": [],
        },
        "runtimeMode": thread.get("runtimeMode") or "full-access",
        "interactionMode": thread.get("interactionMode") or "default",
        "createdAt": iso_utc(now),
    }


def current_branch(checkout, runner=run_command):
    result = runner(["git", "-C", checkout, "branch", "--show-current"])
    return result.stdout.strip() if result.returncode == 0 else ""


def last_dispatch_is_recent(state_root, now, minimum_seconds):
    latest = Path(state_root) / "last-dispatch.json"
    try:
        value = read_json(latest)
        if value.get("status") != "dispatched":
            return False
        recorded = datetime.fromisoformat(value["recordedAt"].replace("Z", "+00:00"))
        return now - recorded < timedelta(seconds=minimum_seconds)
    except (OSError, ValueError, KeyError, TypeError):
        return False


def write_run_receipt(state_root, receipt):
    state_root = Path(state_root)
    name = "%s-%s.json" % (
        receipt["recordedAt"].replace(":", "").replace("-", ""), uuid.uuid4())
    atomic_json(state_root / "runs" / name, receipt)
    atomic_json(state_root / "latest.json", receipt)
    if receipt.get("status") == "dispatched":
        atomic_json(state_root / "last-dispatch.json", receipt)


def run_once(config, runner=run_command, opener=urlopen, now=None):
    now = now or utc_now()
    if config.get("path"):
        os.environ["PATH"] = config["path"]
    state_root = Path(config.get("stateRoot") or DEFAULT_STATE_ROOT).expanduser()
    state_root.mkdir(parents=True, exist_ok=True)
    lock_path = state_root / "controller.lock"
    with lock_path.open("a+") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"status": "already-running", "recordedAt": iso_utc(now)}

        base = {
            "schemaVersion": 2,
            "kind": "swiftui-delivery-controller-receipt",
            "recordedAt": iso_utc(now),
        }
        try:
            report = load_status(config, runner=runner)
            reasons = reconciliation_reasons(report)
            if not reasons:
                receipt = dict(base, status="idle", reasons=[])
                write_run_receipt(state_root, receipt)
                return receipt
            minimum = int(config.get("minimumDispatchIntervalSeconds") or 300)
            if last_dispatch_is_recent(state_root, now, minimum):
                receipt = dict(base, status="cooldown", reasons=reasons)
                write_run_receipt(state_root, receipt)
                return receipt

            session = issue_session(config, runner=runner)
            revoke_rc = None
            try:
                origin = runtime_origin(config)
                snapshot = http_json(origin + "/api/orchestration/snapshot",
                                     session["token"], opener=opener)
                project = find_project(snapshot, config["checkout"])
                running = another_coordinator_is_active(
                    snapshot, project["id"], config["checkout"])
                if running:
                    receipt = dict(base, status="coordinator-running", reasons=reasons,
                                   threadId=running["id"])
                else:
                    policy = load_failover_policy(config)
                    headroom = load_headroom(config, runner=runner)
                    cooldown = int(policy.get("errorCooldownSeconds") or 900)
                    blocked = blocked_models(
                        snapshot, project["id"], now, cooldown)
                    choice = select_model(headroom, policy, blocked=blocked)
                    candidate = choice["candidate"]
                    evidence = headroom_evidence(headroom)
                    if candidate is None:
                        receipt = dict(
                            base, status="no-model-capacity", reasons=reasons,
                            projectId=project["id"], headroom=evidence,
                            modelDecisions=choice["decisions"])
                    else:
                        selected = candidate["modelSelection"]
                        thread = reusable_controller_thread(
                            snapshot, project["id"], selected)
                        created = False
                        if thread is None:
                            command = make_thread_command(
                                project, config["checkout"],
                                current_branch(config["checkout"], runner=runner),
                                candidate, now=now)
                            dispatch(origin, session["token"], command, opener=opener)
                            thread = {
                                "id": command["threadId"],
                                "runtimeMode": command["runtimeMode"],
                                "interactionMode": command["interactionMode"],
                            }
                            created = True
                        turn = make_turn_command(thread, reasons, now=now)
                        result = dispatch(
                            origin, session["token"], turn, opener=opener)
                        receipt = dict(
                            base, status="dispatched", reasons=reasons,
                            projectId=project["id"], threadId=thread["id"],
                            threadCreated=created, commandId=turn["commandId"],
                            sequence=result.get("sequence"), headroom=evidence,
                            modelDecisions=choice["decisions"],
                            selectionBasis=choice["basis"],
                            selectedModel={
                                "id": candidate.get("id"),
                                "modelSelection": selected,
                                "modelKey": model_key(selected),
                            })
            finally:
                revoke_rc = revoke_session(config, session["sessionId"], runner=runner)
            receipt["sessionRevocationExitStatus"] = revoke_rc
        except Exception as error:
            receipt = dict(base, status="waiting", reason=str(error))
        write_run_receipt(state_root, receipt)
        return receipt


def configure(args):
    t3_command = args.t3_command or shutil.which("t3")
    if not t3_command:
        raise RuntimeError("t3 command not found")
    reporter = Path(args.headroom_reporter).expanduser().absolute()
    if not reporter.is_file():
        raise RuntimeError("headroom reporter not found at %s" % reporter)
    value = {
        "schemaVersion": 1,
        "checkout": str(Path(args.checkout).resolve()),
        "t3Command": str(Path(t3_command).resolve()),
        "t3Home": str(Path(args.t3_home).expanduser().resolve()),
        "headroomReporter": str(reporter),
        "stateRoot": str(Path(args.state_root).expanduser().resolve()),
        "minimumDispatchIntervalSeconds": args.minimum_dispatch_interval,
        "path": os.environ.get("PATH", ""),
        "configuredAt": iso_utc(),
    }
    atomic_json(args.config, value)
    return value


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=str(DEFAULT_STATE_ROOT / "config.json"))
    parser.add_argument("--configure", action="store_true")
    parser.add_argument("--checkout")
    parser.add_argument("--t3-command")
    parser.add_argument("--t3-home", default="~/.t3")
    parser.add_argument(
        "--headroom-reporter",
        default=("~/.local/share/agent-operating-standard/current/skills/"
                 "report-headroom/scripts/report_headroom.py"))
    parser.add_argument("--state-root", default=str(DEFAULT_STATE_ROOT))
    parser.add_argument("--minimum-dispatch-interval", type=int, default=300)
    args = parser.parse_args(argv)
    try:
        if args.configure:
            if not args.checkout:
                parser.error("--configure requires --checkout")
            result = configure(args)
        else:
            result = run_once(read_json(args.config))
        print(json.dumps(result, indent=2, sort_keys=True))
        return 1 if result.get("status") == "waiting" else 0
    except Exception as error:
        print("controller: %s" % error, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
