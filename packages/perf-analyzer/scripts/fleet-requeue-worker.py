#!/usr/bin/env python3
"""Return every active lease for one stopped worker to the scheduler."""

import argparse
import json
import pathlib
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--scheduler", required=True)
parser.add_argument("--token-file", required=True)
parser.add_argument("--worker", required=True)
parser.add_argument("--reason", required=True)
args = parser.parse_args()
token = pathlib.Path(args.token_file).read_bytes().hex()
base = args.scheduler.rstrip("/")
headers = {"authorization": f"Bearer {token}", "content-type": "application/json"}
state_request = urllib.request.Request(base + "/v1/state", headers=headers)
with urllib.request.urlopen(state_request, timeout=30) as response:
    state = json.load(response)
leases = [
    job
    for job in state["jobs"]
    if job["state"] == "leased" and job["worker_id"] == args.worker
]
for lease in leases:
    payload = json.dumps(
        {
            "workerId": args.worker,
            "contract": "t3perf-v1-node24-playwright1.60",
            "version": lease["version"],
            "leaseId": lease["lease_id"],
            "error": args.reason,
        }
    ).encode()
    request = urllib.request.Request(base + "/v1/fail", data=payload, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    print(json.dumps({"version": lease["version"], "lease": lease["lease_id"], "result": result}))
print(json.dumps({"requeued": len(leases), "worker": args.worker}))
