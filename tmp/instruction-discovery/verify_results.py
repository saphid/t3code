#!/usr/bin/env python3
"""Compare exact filename sets, not just counts, against the Lunar inventories."""
import json
from pathlib import Path

folder = Path(__file__).resolve().parent
load = lambda name: json.loads((folder / name).read_text())
seed_baseline = load('instruction-baseline.json')
reference_baseline = load('reference-baseline.json')
fast = load('fast-discovery.json')
root = seed_baseline['root'].rstrip('/') + '/'
relative = lambda value: value.removeprefix(root)
expected_seeds = {entry['path'] for key in ('instruction_candidates', 'skill_candidates') for entry in seed_baseline[key]}
actual_seeds = {relative(value) for value in fast['seeds']}
expected_files = set(reference_baseline['seed_paths']) | {
    edge['resolved'] for edge in reference_baseline['edges']
    if edge.get('status') in ('document', 'leaf') and edge.get('resolved')
}
actual_files = {relative(value) for value in fast['files']}

def compare(expected, actual):
    return {'baselineCount': len(expected), 'fastCount': len(actual),
            'missing': sorted(expected - actual), 'extra': sorted(actual - expected)}

result = {'seeds': compare(expected_seeds, actual_seeds),
          'references': compare(expected_files, actual_files)}
(folder / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({kind: {key: len(value) if isinstance(value, list) else value
                        for key, value in comparison.items()}
                  for kind, comparison in result.items()}, indent=2))
raise SystemExit(any(part['missing'] or part['extra'] for part in result.values()))
