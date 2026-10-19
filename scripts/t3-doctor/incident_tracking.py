"""Fingerprint incidents and track handling independently of observed recovery."""
import argparse
import hashlib
import json
from pathlib import Path
import re

from storage import locked, redact, stamp, write_json

STATES = {'needs_attention', 'assigned', 'in_progress', 'dismissed'}
REPORT_NAME = r'[0-9]{8}T[0-9]{6}-[a-f0-9]{16}\.json'


def normalized(value):
    text = str(redact(value or '')).strip().lower()
    text = re.sub(r'\b\d{4}-\d\d-\d\d[t ][\d:.]+(?:z|[+-]\d\d:\d\d)?', '<time>', text)
    text = re.sub(r'\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b', '<id>', text)
    return re.sub(r'\s+', ' ', text)


def fingerprint(item, database=''):
    """Conservative matching: omit observation times, retain scope and failure identity."""
    e = item.get('evidence', {})
    kind = item['kind']
    scope = str(Path(item.get('database') or database).expanduser().resolve()) if item.get('database') or database else 'local'
    if kind.startswith('provider-'):
        identity = [e.get('id') or item['key'], e.get('driver'), e.get('state'), e.get('auth'),
                    e.get('binary_found'), normalized(e.get('message') or item.get('reason'))]
    elif kind == 'app-update':
        identity = [e.get(k) for k in ['id', 'repository', 'channel', 'installed_version', 'latest_version']]
    elif kind in {'quiet-run', 'orphaned-run'}:
        run = e.get('run', e)
        identity = [item.get('thread_id') or run.get('thread_id'), run.get('run_id') or run.get('active_turn_id') or item['key'],
                    run.get('provider') or run.get('provider_name'), 'startup' if run.get('status') in {'queued', 'starting', 'preparing'} else 'active']
    elif kind == 'overdue-worker':
        identity = [item.get('thread_id') or e.get('thread_id'), e.get('effect_type'),
                    normalized(e.get('last_error')) or e.get('effect_id') or item['key']]
    else:
        identity = [item['key'], normalized(e.get('error') or item.get('reason'))]
    value = json.dumps([1, scope, kind, identity], sort_keys=True, separators=(',', ':'))
    return 'v1:' + hashlib.sha256(value.encode()).hexdigest()


def new_triage():
    return {'status': 'needs_attention', 'updated_at': stamp()}


class Tracking:
    """Call under storage.locked; never holds a lock during a T3 network request."""
    def __init__(self, output):
        self.output = output
        path = output / 'triage.json'
        self.issues = json.loads(path.read_text()).get('issues', {}) if path.exists() else {}
        self.reports = {}
        for path in (output / 'incidents').glob('*.json'):
            if not re.fullmatch(REPORT_NAME, path.name):
                continue
            try:
                report = json.loads(path.read_text())
                if report.get('kind') == 'app-update' or report.get('key', '').startswith('update:'):
                    archive = output / 'update-history'
                    archive.mkdir(exist_ok=True, mode=0o700)
                    destination = archive / path.name
                    if destination.exists() and destination.read_bytes() != path.read_bytes():
                        raise OSError('A different update report already occupies the archive path.')
                    path.replace(destination)
                    continue
                self.annotate(report)
                self.reports[path] = report
            except (ValueError, KeyError):
                continue
        self.import_investigations()

    def annotate(self, item, database=''):
        fp = fingerprint(item, database)
        item['fingerprint'] = fp
        item['fingerprint_version'] = 1
        issue = self.issues.setdefault(fp, {'triage': new_triage()})
        item['triage'] = dict(issue['triage'])
        for field in ['investigation', 'related', 'duplicate_of']:
            if field in issue:
                item[field] = issue[field]
            else:
                item.pop(field, None)
        return fp

    def import_investigations(self):
        # Upgrade 0.4 receipts without creating or changing any T3 thread.
        for receipt in (self.output / 'investigations').glob('*/thread.json'):
            entry = json.loads(receipt.read_text())
            evidence_path = receipt.parent / 'evidence.json'
            if not evidence_path.exists():
                continue
            bundle = json.loads(evidence_path.read_text())
            database = bundle.get('observation', {}).get('database', '')
            fingerprints = entry.get('fingerprints') or [fingerprint(i, database) for i in bundle.get('findings', [])]
            prompt = receipt.parent / 'prompt.md'
            entry.setdefault('prompt_sha256', hashlib.sha256(prompt.read_bytes()).hexdigest() if prompt.exists() else None)
            entry.setdefault('investigation_id', receipt.parent.name)
            for fp in fingerprints:
                issue = self.issues.setdefault(fp, {'triage': new_triage()})
                prior = issue.get('investigation')
                if prior is None or (prior.get('investigation_id') == receipt.parent.name and prior.get('stage') != entry['stage']):
                    self.link([fp], entry)

    def link(self, fingerprints, entry):
        fields = ['thread_id', 'title', 'project_id', 'project_title', 'environment_id', 'investigation_id',
                  'prompt_sha256', 'stage', 'created_at', 'verified_at']
        for fp in fingerprints:
            issue = self.issues.setdefault(fp, {'triage': new_triage()})
            prior = issue.get('investigation', {})
            issue['investigation'] = {k: entry.get(k) for k in fields}
            if entry['stage'] == 'verified' and prior.get('stage') != 'verified':
                issue['triage'] = dict(issue['triage'], status='in_progress', updated_at=stamp(),
                                       assignee=issue['triage'].get('assignee') or 'T3 investigation')

    def register_report(self, path, report):
        fp = self.annotate(report)
        earlier = [r for p, r in self.reports.items() if p != path and r['fingerprint'] == fp]
        if earlier and all(r.get('resolved_at') for r in earlier):
            self.issues[fp]['triage'] = dict(self.issues[fp]['triage'], status='needs_attention', updated_at=stamp(),
                                           note='The condition returned after it cleared. Review the previous investigation.')
        self.reports[path] = report
        self.annotate(report)

    def should_notify(self, report):
        if report['triage']['status'] != 'needs_attention':
            report['notification'] = {'submitted': False, 'suppressed': 'Already assigned, in progress, or dismissed.'}
            return False
        if any(r is not report and r['fingerprint'] == report['fingerprint'] and not r.get('resolved_at')
               and 'notification' in r for r in self.reports.values()):
            report['notification'] = {'submitted': False, 'suppressed': 'Duplicate of an active incident.'}
            return False
        return True

    def sync(self, snapshot):
        snapshot['findings'] = [item for item in snapshot.get('findings', [])
                                if item.get('kind') != 'app-update' and not item.get('key', '').startswith('update:')]
        snapshot['incidents'] = {key: entry for key, entry in snapshot.get('incidents', {}).items()
                                 if not key.startswith('update:')}
        for item in snapshot.get('findings', []):
            self.annotate(item, snapshot.get('database', ''))
        for entry in snapshot.get('incidents', {}).values():
            path = self.output / 'incidents' / Path(entry.get('report', '')).name
            report = self.reports.get(path)
            if report:
                self.annotate(report)
                for field in ['fingerprint', 'triage', 'investigation', 'related', 'duplicate_of']:
                    if field in report:
                        entry[field] = report[field]
                    else:
                        entry.pop(field, None)

    def save(self, snapshot=None):
        write_json(self.output / 'triage.json', {'version': 1, 'issues': self.issues})
        for path, report in self.reports.items():
            # Merge only owned metadata. Preserve fresh capture, recovery, and notification fields.
            original = path.read_text()
            current = json.loads(original)
            self.annotate(current)
            if current != json.loads(original):
                write_json(path, current)
        if snapshot is not None:
            self.sync(snapshot)
            write_json(self.output / 'status.json', snapshot)


def refresh_tracking(output):
    with locked(output):
        snapshot = json.loads((output / 'status.json').read_text())
        tracking = Tracking(output)
        tracking.sync(snapshot)
        tracking.save(snapshot)
        return snapshot


def set_handling(output, fp, status, assignee='', note=''):
    if status not in STATES:
        raise ValueError('Unknown handling status.')
    if status == 'assigned' and not assignee.strip():
        raise ValueError('Enter an owner before assigning this incident.')
    with locked(output):
        tracking = Tracking(output)
        snapshot = json.loads((output / 'status.json').read_text())
        tracking.sync(snapshot)
        if fp not in tracking.issues:
            raise ValueError('This incident is no longer available. Refresh the observations.')
        tracking.issues[fp]['triage'] = dict(status=status, assignee=assignee.strip()[:200], note=note.strip()[:2000], updated_at=stamp())
        tracking.save(snapshot)
    return {'status': status}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--fingerprint')
    parser.add_argument('--status', choices=sorted(STATES))
    parser.add_argument('--assignee', default='')
    parser.add_argument('--note', default='')
    parser.add_argument('--migrate', action='store_true')
    args = parser.parse_args()
    try:
        if args.migrate:
            refresh_tracking(args.output)
            result = {'migrated': True}
        elif args.fingerprint and args.status:
            result = set_handling(args.output, args.fingerprint, args.status, args.assignee, args.note)
        else:
            raise ValueError('Choose a fingerprint and status.')
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({'error': redact(str(error))}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
