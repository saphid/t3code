#!/usr/bin/env python3
"""Lease one nightly at a time and run it in the pinned perf container."""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request


def request(base: str, token: str, path: str, payload: dict) -> dict:
    encoded = json.dumps(payload).encode()
    req = urllib.request.Request(
        base.rstrip("/") + path,
        data=encoded,
        headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scheduler", required=True)
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--contract", required=True)
    parser.add_argument("--otlp", required=True)
    parser.add_argument("--suite", default="smoke")
    parser.add_argument("--poll-seconds", type=int, default=60)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    worker_id = socket.gethostname()
    token = pathlib.Path(args.token_file).read_bytes().hex()
    data_dir = pathlib.Path(args.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    # Fail before claiming if the installer did not make storage writable.
    (data_dir / "runs").mkdir(parents=True, exist_ok=True)
    common = {"workerId": worker_id, "contract": args.contract}

    while True:
        try:
            claimed = request(args.scheduler, token, "/v1/claim", common)
        except Exception as error:
            print(f"claim failed: {error}", flush=True)
            if args.once:
                return 2
            time.sleep(args.poll_seconds)
            continue
        lease = claimed.get("lease")
        if lease is None:
            print("no work", flush=True)
            if args.once:
                return 0
            time.sleep(args.poll_seconds)
            continue

        version = lease["version"]
        published_at = lease["publishedAt"]
        lease_id = lease["leaseId"]
        run_id = lease["runId"]
        run_dir = data_dir / "runs" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        stop_renewing = threading.Event()

        def renew() -> None:
            while not stop_renewing.wait(60):
                try:
                    request(
                        args.scheduler,
                        token,
                        "/v1/renew",
                        {**common, "version": version, "leaseId": lease_id},
                    )
                except Exception as error:
                    print(f"lease renewal failed: {error}", flush=True)

        renewer = threading.Thread(target=renew, daemon=True)
        renewer.start()
        print(f"claimed version={version} lease={lease_id} run={run_id}", flush=True)
        command = [
            "docker",
            "run",
            "--rm",
            "--hostname",
            worker_id,
            "--shm-size=2g",
            "--cpus=1.0",
            "--memory=4g",
            "-e",
            f"T3_VERSION={version}",
            "-e",
            f"LABEL={version}",
            "-e",
            f"BUILD={version}",
            "-e",
            f"RUN_ID={run_id}",
            "-e",
            f"T3_PERF_OTLP_URL={args.otlp}",
            "-e",
            f"T3_PERF_RELEASED_AT={published_at}",
            "-v",
            f"{run_dir}:/results",
            args.image,
            "--suite",
            args.suite,
        ]
        completed = subprocess.run(command, check=False)
        stop_renewing.set()
        renewer.join(timeout=5)
        result_files = sorted(run_dir.glob("perf-*.json"))
        try:
            if not result_files:
                raise RuntimeError(f"container exited {completed.returncode} without a result file")
            result = json.loads(result_files[-1].read_text())
            result["fleet"] = {
                "worker": worker_id,
                "nightly": version,
                "publishedAt": published_at,
                "run": run_id,
                "contract": args.contract,
                "containerImage": args.image,
                "containerExit": completed.returncode,
            }
            request(
                args.scheduler,
                token,
                "/v1/complete",
                {
                    **common,
                    "version": version,
                    "leaseId": lease_id,
                    "runId": run_id,
                    "result": result,
                },
            )
            print(f"completed version={version} run={run_id}", flush=True)
            for path in run_dir.iterdir():
                path.unlink()
            run_dir.rmdir()
        except Exception as error:
            print(f"job failed version={version}: {error}", flush=True)
            try:
                request(
                    args.scheduler,
                    token,
                    "/v1/fail",
                    {**common, "version": version, "leaseId": lease_id, "error": str(error)},
                )
            except Exception as report_error:
                print(f"failure report failed: {report_error}", flush=True)
        if args.once:
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
