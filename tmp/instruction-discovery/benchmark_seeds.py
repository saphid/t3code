#!/usr/bin/env python3
"""Measure complete filename discovery; store filenames without terminal truncation."""
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = Path(__file__).resolve().parent
GLOBS = ['AGENTS.md', 'AGENTS.*.md', 'CLAUDE.md', 'CLAUDE.*.md', 'SKILL.md']
results = []
for name, flags in [
    ('defaults', []),
    ('hidden', ['--hidden']),
    ('exhaustive', ['--hidden', '--no-ignore']),
    ('exhaustive-one-thread', ['--hidden', '--no-ignore', '--threads', '1']),
]:
    command = ['rg', '--no-config', '--files', '--null', *flags]
    for pattern in GLOBS:
        command += ['--iglob', pattern]
    command += ['--', '.']
    start = time.perf_counter()
    run = subprocess.run(command, cwd=ROOT, capture_output=True)
    elapsed = time.perf_counter() - start
    paths = sorted(os.fsdecode(p).removeprefix('./') for p in run.stdout.split(b'\0') if p)
    result = dict(name=name, command=command, elapsed_seconds=elapsed,
                  count=len(paths), paths=paths, exit_code=run.returncode,
                  stderr=os.fsdecode(run.stderr))
    results.append(result)
    print(json.dumps({k: v for k, v in result.items() if k not in ('paths', 'command')}), flush=True)
    if run.returncode not in (0, 1):
        raise SystemExit('Incomplete traversal; inspect stderr.')
(OUTPUT / 'seed-searches.json').write_text(json.dumps(results, indent=2) + '\n')
