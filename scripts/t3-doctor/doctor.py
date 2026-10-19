#!/usr/bin/env python3
"""A read-only T3 watchdog. Python standard library only."""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import time

from health_checks import ReleaseChecker, read_providers
from storage import epoch, locked, redact, stamp, write_json
from incident_tracking import Tracking

ACTIVE = "('queued','preparing','starting','running','waiting')"
LABEL = 'local.t3-doctor'
LEGACY_UI_LABEL = 'local.t3-doctor-ui'
DEFAULT_OUTPUT = Path.home() / '.local/state/t3-doctor'



def rows(db, query, params=()):
    return [dict(row) for row in db.execute(query, params)]


def connect(path):
    db = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=2)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA query_only=ON')
    deadline = time.monotonic() + 5
    db.set_progress_handler(lambda: int(time.monotonic() > deadline), 10000)
    db.execute('BEGIN')
    return db


def provider_log(home, thread_id):
    # Match attachmentStore.toSafeThreadAttachmentSegment used by EventNdjsonLogger.
    segment = re.sub(r'[^a-z0-9_-]+', '-', thread_id.strip().lower())
    segment = re.sub(r'-+', '-', segment).strip('-_')[:80].rstrip('-_')
    return home / 'logs/provider' / ('events.' + segment + '.log') if segment else None


def log_time(home, thread_id):
    path = provider_log(home, thread_id)
    try:
        return path.stat().st_mtime if path else 0
    except FileNotFoundError:
        return 0


def finding(key, kind, reason, evidence, thread_id=None):
    return dict(key=key, kind=kind, reason=reason, thread_id=thread_id, evidence=evidence)


def scan_v2(db, home, now, quiet, startup):
    findings, active, waiting = [], [], []
    runs = rows(db, f"""SELECT r.run_id,r.thread_id,r.status,r.requested_at,r.provider,
        t.title,json_extract(r.payload_json,'$.activeAttemptId') AS active_attempt_id,
        json_extract(r.payload_json,'$.startedAt') AS started_at FROM orchestration_v2_projection_runs r
        JOIN orchestration_v2_projection_threads t USING(thread_id)
        WHERE r.status IN {ACTIVE} AND t.deleted_at IS NULL AND t.archived_at IS NULL""")
    for run in runs:
        tid, rid = run['thread_id'], run['run_id']
        # Provider log activity belongs to the whole session. It cannot prove
        # that this run acquired a provider turn, especially after a failed start.
        if run['status'] == 'running' and run['active_attempt_id']:
            turn = db.execute("""SELECT 1 FROM orchestration_v2_projection_provider_turns
                WHERE thread_id=? AND run_attempt_id=? LIMIT 1""", (tid, run['active_attempt_id'])).fetchone()
            if turn is None:
                starts = rows(db, """SELECT effect_id,effect_type,status,attempt_count,updated_at,last_error
                    FROM orchestration_v2_effect_outbox WHERE thread_id=? AND effect_type='provider-turn.start'
                    AND status='failed' AND json_extract(payload_json,'$.runId')=?
                    AND updated_at>=? ORDER BY updated_at DESC LIMIT 1""",
                    (tid, rid, run['started_at'] or run['requested_at']))
                age = max(0, now - epoch(run['started_at'] or run['requested_at']))
                if starts or age >= startup:
                    active.append(dict(run, startup_seconds=round(age)))
                    reason = ('The provider startup worker failed, but T3 still marks this run as running. '
                              'No provider turn was recorded for its current attempt.' if starts else
                              f'T3 marks this run as running, but no provider turn has been recorded after {round(age)} seconds.')
                    evidence = dict(run=run, startup_seconds=round(age))
                    if starts:
                        evidence['failed_start'] = starts[0]
                    findings.append(finding('run:' + rid, 'orphaned-run', reason, evidence, tid))
                    continue
        pending = rows(db, """SELECT runtime_request_id,kind,created_at FROM
            orchestration_v2_projection_runtime_requests WHERE thread_id=? AND status='pending'""", (tid,))
        if pending:
            waiting.append(dict(run, requests=pending))
            continue
        # A queued follow-up is allowed to wait behind a running turn.
        if run['status'] == 'queued' and any(r['thread_id'] == tid and r['status'] != 'queued' for r in runs):
            waiting.append(dict(run, waiting_for='earlier run'))
            continue
        last = max(epoch(run['requested_at']), log_time(home, tid))
        for table in ['messages', 'turn_items']:
            value = db.execute(f'SELECT MAX(updated_at) FROM orchestration_v2_projection_{table} WHERE run_id=?', (rid,)).fetchone()[0]
            last = max(last, epoch(value))
        run['last_progress_at'] = stamp(last)
        run['quiet_seconds'] = round(max(0, now - last))
        active.append(run)
        threshold = startup if run['status'] in {'queued', 'preparing', 'starting'} else quiet
        if now - last >= threshold:
            sessions = rows(db, """SELECT provider_session_id,provider,status,updated_at
                FROM orchestration_v2_projection_provider_sessions WHERE thread_id=?""", (tid,))
            nodes = rows(db, """SELECT node_id,kind,status,started_at FROM orchestration_v2_projection_nodes
                WHERE thread_id=? AND run_id=? AND completed_at IS NULL LIMIT 30""", (tid, rid))
            findings.append(finding('run:' + rid, 'quiet-run',
                f"Run is {run['status']} with no recorded progress for {run['quiet_seconds']} seconds. "
                'A long tool call or silent provider may still be working; this is a suspected stall.',
                dict(run=run, sessions=sessions, unfinished_nodes=nodes), tid))
    effects = rows(db, """SELECT effect_id,thread_id,effect_type,status,attempt_count,
        available_at,lease_expires_at,updated_at,last_error FROM orchestration_v2_effect_outbox
        WHERE status IN ('pending','running')""")
    for effect in effects:
        due = max(epoch(effect['available_at']), epoch(effect['updated_at']), epoch(effect['lease_expires_at']))
        if now - due >= startup:
            findings.append(finding('effect:' + effect['effect_id'], 'overdue-worker',
                'Worker effect has not advanced after its availability or lease deadline.', effect, effect['thread_id']))
    return findings, active, waiting


def scan_legacy(db, home, now, quiet, startup):
    findings, active, waiting = [], [], []
    sessions = rows(db, """SELECT s.thread_id,s.status,s.active_turn_id,s.provider_name,
        s.updated_at,s.last_error,t.title,t.pending_approval_count,t.pending_user_input_count
        FROM projection_thread_sessions s JOIN projection_threads t USING(thread_id)
        WHERE (s.status IN ('running','starting') OR s.active_turn_id IS NOT NULL)
        AND t.deleted_at IS NULL AND t.archived_at IS NULL""")
    for session in sessions:
        tid = session['thread_id']
        if session['pending_approval_count'] or session['pending_user_input_count']:
            waiting.append(session)
            continue
        last = max(epoch(session['updated_at']), log_time(home, tid))
        for table, column in [('projection_thread_messages', 'updated_at'), ('projection_thread_activities', 'created_at')]:
            value = db.execute(f'SELECT MAX({column}) FROM {table} WHERE thread_id=?', (tid,)).fetchone()[0]
            last = max(last, epoch(value))
        session['quiet_seconds'] = round(max(0, now - last))
        session['last_progress_at'] = stamp(last)
        active.append(session)
        if now - last >= (startup if session['status'] == 'starting' else quiet):
            findings.append(finding('session:' + tid + ':' + str(session['active_turn_id']), 'quiet-run',
                'Active session has no recent recorded progress. Suspected stall; a silent tool may still be working.', session, tid))
    return findings, active, waiting


def server_health(home, service_path=None):
    path = home / 'server-runtime.json'
    if not path.exists():
        service_path = service_path or Path.home() / 'Library/LaunchAgents/com.t3tools.t3code.service.plist'
        try:
            service = plistlib.loads(service_path.read_bytes())
            args = service['ProgramArguments']
            base = Path(args[args.index('--base-dir') + 1]).expanduser().resolve()
            port = int(args[args.index('--port') + 1])
            if base != home.parent.resolve() or 'serve' not in args or not 0 < port < 65536:
                raise ValueError('Service does not describe this T3 home.')
        except (OSError, ValueError, KeyError, IndexError, TypeError, plistlib.InvalidFileException):
            return {'state': 'unknown', 'reason': 'No runtime metadata or matching T3 launch service was found.'}
        # Verify the service is T3, using only loopback and without following redirects.
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
        try:
            connection.request('GET', '/.well-known/t3/environment')
            response = connection.getresponse()
            data = response.read(65537)
            if response.status != 200 or len(data) > 65536:
                raise ValueError('The configured port did not return a T3 environment descriptor.')
            descriptor = json.loads(data)
            if not isinstance(descriptor, dict) or not all(
                isinstance(descriptor.get(key), str) and descriptor[key]
                for key in ('environmentId', 'serverVersion')
            ):
                raise ValueError('The configured port did not identify a T3 environment.')
            return dict(state='reachable', port=port, source='launch-service',
                        environment_id=descriptor['environmentId'], server_version=descriptor['serverVersion'])
        except (OSError, http.client.HTTPException) as error:
            return dict(state='unreachable', port=port, source='launch-service', error=str(error))
        except ValueError as error:
            return dict(state='unknown', port=port, source='launch-service', reason=str(error))
        finally:
            connection.close()
    runtime = json.loads(path.read_text())
    # Never send credentials or contact a host supplied by runtime metadata.
    port = int(runtime['port'])
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=2):
            pass
        return {'state': 'reachable', 'port': port, 'pid': runtime.get('pid')}
    except OSError as error:
        return {'state': 'unreachable', 'port': port, 'pid': runtime.get('pid'), 'error': str(error)}


def scan(home, database, now, quiet, startup):
    db = connect(database)
    try:
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        version = 'OV2' if 'orchestration_v2_projection_runs' in tables else 'legacy'
        detector = scan_v2 if version == 'OV2' else scan_legacy
        findings, active, waiting = detector(db, home, now, quiet, startup)
    finally:
        db.close()
    health = server_health(home)
    if health['state'] == 'unreachable':
        findings.append(finding('server', 'server-unreachable', 'T3 is not accepting connections on its recorded local port.', health))
    return dict(checked_at=stamp(now), database=str(database), schema=version,
                server=health, active=active, waiting=waiting, findings=findings)


def tail(path, limit=32768):
    try:
        with path.open('rb') as stream:
            size = stream.seek(0, 2)
            stream.seek(max(0, size - limit))
            text = stream.read(limit).decode('utf-8', errors='replace')
        if size > limit:
            text = text.partition('\n')[2]
        return text.splitlines()[-60:]
    except OSError as error:
        return [f'Log unavailable: {error}']


def capture(home, database, item):
    tid = item.get('thread_id')
    logs = {}
    for name in ['server.log', 'boot-service.log', 'server.trace.ndjson', 'desktop.trace.ndjson']:
        path = home / 'logs' / name
        if path.exists():
            logs[name] = tail(path)
    path = provider_log(home, tid) if tid else None
    if path and path.exists():
        logs[path.name] = tail(path)
    details = {}
    if tid:
        db = connect(database)
        try:
            tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if 'orchestration_v2_projection_runs' in tables:
                details['recent_items'] = rows(db, """SELECT turn_item_id,type,status,updated_at,
                    substr(payload_json,1,4000) AS detail FROM orchestration_v2_projection_turn_items
                    WHERE thread_id=? ORDER BY ordinal DESC LIMIT 12""", (tid,))
                details['worker_errors'] = rows(db, """SELECT effect_type,status,updated_at,last_error
                    FROM orchestration_v2_effect_outbox WHERE thread_id=? AND status='failed'
                    ORDER BY updated_at DESC LIMIT 5""", (tid,))
            else:
                details['recent_activities'] = rows(db, """SELECT kind,summary,created_at FROM
                    projection_thread_activities WHERE thread_id=? ORDER BY created_at DESC LIMIT 12""", (tid,))
        finally:
            db.close()
    return dict(details=details, logs=logs,
                interpretation='Evidence records the last observed state. It does not prove a root cause. '
                'Shared server log excerpts may include unrelated threads. Common credential patterns are redacted.')


def notify(message):
    script = 'on run argv\ndisplay notification (item 1 of argv) with title "T3 Doctor"\nend run'
    try:
        result = subprocess.run(['/usr/bin/osascript', '-e', script, message], capture_output=True, text=True, timeout=10)
        return {'submitted': result.returncode == 0, 'error': redact(result.stderr.strip())}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {'submitted': False, 'error': str(error)}


class Monitor:
    def __init__(self, output, confirm=30, notifications=True):
        self.output, self.confirm, self.notifications = output, confirm, notifications
        output.mkdir(parents=True, exist_ok=True, mode=0o700)
        output.chmod(0o700)
        (output / 'incidents').mkdir(exist_ok=True, mode=0o700)
        state = output / 'monitor.json'
        self.state = json.loads(state.read_text()) if state.exists() else {}

    def update(self, snapshot, home, database, now):
        with locked(self.output):
            self._update(snapshot, home, database, now)

    def _update(self, snapshot, home, database, now):
        snapshot.setdefault('database', str(database))
        tracking = Tracking(self.output)
        tracking.sync(snapshot)
        current = {item['key']: item for item in snapshot['findings']}
        for key in list(self.state):
            if key.startswith('update:'):
                self.state.pop(key)
                continue
            if 'monitor' in current and key != 'monitor':
                # A failed read cannot establish that an existing incident recovered.
                continue
            if key.startswith('provider:') and (snapshot.get('provider_errors') or any(
                key == 'provider:' + p['id'] and p['state'] in {'stale', 'unknown'} for p in snapshot.get('providers', []))):
                continue
            previous_report = tracking.reports.get(Path(self.state[key].get('report', '')))
            changed = key in current and previous_report and previous_report['fingerprint'] != current[key]['fingerprint']
            if key not in current or changed:
                previous = self.state.pop(key)
                if previous.get('report'):
                    path = Path(previous['report'])
                    report = json.loads(path.read_text())
                    report['resolved_at'] = stamp(now)
                    report['resolution'] = 'The symptom changed; the new condition is tracked separately.' if changed else 'Condition is no longer observed; this can mean progress, completion, cancellation, or removal.'
                    write_json(path, report)
                    tracking.reports[path] = report
        for key, item in current.items():
            entry = self.state.setdefault(key, {'first_seen': now})
            if 'report' in entry or now - entry['first_seen'] < self.confirm:
                continue
            digest = hashlib.sha256((key + str(now)).encode()).hexdigest()[:16]
            path = self.output / 'incidents' / (dt.datetime.fromtimestamp(now, dt.timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + digest + '.json')
            report = dict(item, detected_at=stamp(now), database=str(database))
            try:
                report.update(capture(home, database, item))
            except (OSError, sqlite3.Error, ValueError) as error:
                report['capture_error'] = str(error)
            write_json(path, report)
            entry['report'] = str(path)
            tracking.register_report(path, report)
            if self.notifications and tracking.should_notify(report):
                evidence = item['evidence']
                title = evidence.get('run', evidence).get('title', item['kind'])
                report['notification'] = notify(f"{title}: {item['reason'][:160]}\nReport: {path.name}")
            write_json(path, report)
            print(json.dumps({'incident': str(path), 'kind': item['kind']}), flush=True)
        snapshot['incidents'] = self.state
        tracking.sync(snapshot)
        tracking.save(snapshot)
        write_json(self.output / 'monitor.json', self.state)
        # Bound disk use while preserving reports for unresolved conditions.
        protected = {v.get('report') for v in self.state.values()}
        reports = sorted((self.output / 'incidents').glob('*.json'), reverse=True)
        for path in reports[100:]:
            if str(path) not in protected:
                path.unlink()


def install(args):
    if sys.platform != 'darwin':
        raise RuntimeError('Background installation currently supports macOS only.')
    target = Path.home() / 'Library/Application Support/T3 Doctor'
    target.mkdir(parents=True, exist_ok=True)
    installed = target / 'doctor.py'
    if Path(__file__).resolve() != installed.resolve():
        shutil.copy2(__file__, installed)
        for name in ['health_checks.py', 'storage.py', 'incident_tracking.py']:
            shutil.copy2(Path(__file__).parent / name, target / name)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    agent = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
    agent.parent.mkdir(parents=True, exist_ok=True)
    command = [sys.executable, str(installed), 'watch', '--home', str(args.home.resolve()),
               '--output', str(output), '--interval', str(args.interval), '--quiet', str(args.quiet),
               '--startup', str(args.startup)]
    if args.db:
        command += ['--db', str(args.db.resolve())]
    if args.no_notify:
        command += ['--no-notify']
    config = dict(Label=LABEL, ProgramArguments=command, RunAtLoad=True, KeepAlive=True,
                  ThrottleInterval=30, ProcessType='Background',
                  StandardOutPath='/dev/null', StandardErrorPath=str(output / 'watcher-error.log'))
    agent.write_bytes(plistlib.dumps(config))
    domain = f'gui/{os.getuid()}'
    subprocess.run(['launchctl', 'bootout', domain + '/' + LABEL], capture_output=True)
    subprocess.run(['launchctl', 'bootstrap', domain, str(agent)], check=True)
    # Remove the superseded web UI service when upgrading to the native app.
    subprocess.run(['launchctl', 'bootout', domain + '/' + LEGACY_UI_LABEL], capture_output=True)
    agent.with_name(LEGACY_UI_LABEL + '.plist').unlink(missing_ok=True)
    (target / 'dashboard.py').unlink(missing_ok=True)
    if (target / 'web').is_dir():
        shutil.rmtree(target / 'web')
    print(f'Installed {LABEL}. Reports and status: {output}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['once', 'watch', 'status', 'install', 'uninstall'])
    parser.add_argument('--home', type=Path, default=Path.home() / '.t3/userdata', help='T3 userdata directory')
    parser.add_argument('--db', type=Path, help='Explicit database; defaults to statev2.sqlite when present')
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--interval', type=int, default=30)
    parser.add_argument('--quiet', type=int, default=900, help='Running-turn silence threshold in seconds')
    parser.add_argument('--startup', type=int, default=180, help='Startup/worker delay threshold in seconds')
    parser.add_argument('--no-notify', action='store_true')
    args = parser.parse_args()
    if min(args.interval, args.quiet, args.startup) < 1:
        parser.error('Time thresholds must be positive.')
    args.home, args.output = args.home.expanduser(), args.output.expanduser()
    if args.db:
        args.db = args.db.expanduser()
    if args.command == 'install':
        install(args)
        return
    if args.command == 'uninstall':
        for label in [LABEL, LEGACY_UI_LABEL]:
            subprocess.run(['launchctl', 'bootout', f'gui/{os.getuid()}/{label}'], capture_output=True)
            (Path.home() / 'Library/LaunchAgents' / (label + '.plist')).unlink(missing_ok=True)
        print('Watcher stopped; login startup removed. Reports and native app retained.')
        return
    if args.command == 'status':
        path = args.output / 'status.json'
        if not path.exists():
            parser.error('No status yet. Run once or install first.')
        print(path.read_text())
        return
    monitor = Monitor(args.output, confirm=args.interval, notifications=not args.no_notify)
    releases = ReleaseChecker(args.home, args.output)
    with (args.output / 'watcher.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error('A doctor already uses this output directory. Use status to inspect it.')
        while True:
            now = time.time()
            database = args.db or args.home / ('statev2.sqlite' if (args.home / 'statev2.sqlite').exists() else 'state.sqlite')
            try:
                snapshot = scan(args.home, database, now, args.quiet, args.startup)
            except (OSError, sqlite3.Error, ValueError, KeyError) as error:
                snapshot = dict(checked_at=stamp(now), database=str(database), active=[], waiting=[],
                                findings=[finding('monitor', 'monitor-unavailable', 'Doctor cannot inspect T3 state.', {'error': str(error)})])
            snapshot['monitoring'] = dict(interval=args.interval, quiet=args.quiet, startup=args.startup)
            try:
                snapshot['providers'], snapshot['provider_errors'] = read_providers(args.home, now)
                for provider in snapshot['providers']:
                    provider['active_runs'] = sum(1 for run in snapshot['active'] + snapshot['waiting']
                                                  if (run.get('provider') or run.get('provider_name')) == provider['id'])
                    if provider['state'] in {'error', 'warning'}:
                        snapshot['findings'].append(finding('provider:' + provider['id'], 'provider-' + provider['state'],
                                                           provider['message'], dict(provider, title=provider['name'])))
            except (OSError, ValueError, TypeError) as error:
                snapshot['provider_errors'] = [str(error)]
            try:
                request = args.output / 'check-updates.request'
                force = request.exists()
                if force:
                    request.unlink()
                snapshot['updates'] = releases.check(now, force=force)
            except (OSError, ValueError, KeyError) as error:
                snapshot['update_errors'] = [str(error)]
            if args.command == 'once':
                print(json.dumps(redact(snapshot), indent=2))
                return
            monitor.update(snapshot, args.home, database, now)
            time.sleep(args.interval)


if __name__ == '__main__':
    main()
