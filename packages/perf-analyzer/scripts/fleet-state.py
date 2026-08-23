#!/usr/bin/env python3
"""Print scheduler state without placing its bearer token in argv."""

import argparse
import json
import pathlib
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--scheduler", required=True)
parser.add_argument("--token-file", required=True)
args = parser.parse_args()
token = pathlib.Path(args.token_file).read_bytes().hex()
request = urllib.request.Request(
    args.scheduler.rstrip("/") + "/v1/state",
    headers={"authorization": f"Bearer {token}"},
)
with urllib.request.urlopen(request, timeout=30) as response:
    print(json.dumps(json.load(response), indent=2))
