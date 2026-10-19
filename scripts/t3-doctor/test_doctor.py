import json
import os
import plistlib
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import doctor


class DoctorTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.path = self.home / 'statev2.sqlite'
        self.now = 1_800_000_000
        self.db = sqlite3.connect(self.path)
        self.addCleanup(self.db.close)
        self.db.executescript('''
            CREATE TABLE orchestration_v2_projection_threads
              (thread_id TEXT PRIMARY KEY,title,deleted_at,archived_at);
            CREATE TABLE orchestration_v2_projection_runs
              (run_id TEXT PRIMARY KEY,thread_id,status,requested_at,provider,payload_json);
            CREATE TABLE orchestration_v2_projection_provider_turns
              (provider_turn_id,thread_id,run_attempt_id,status);
            CREATE TABLE orchestration_v2_projection_runtime_requests
              (runtime_request_id,thread_id,kind,status,created_at);
            CREATE TABLE orchestration_v2_projection_messages (run_id,updated_at);
            CREATE TABLE orchestration_v2_projection_turn_items
              (run_id,thread_id,turn_item_id,type,status,updated_at,payload_json,ordinal);
            CREATE TABLE orchestration_v2_projection_provider_sessions
              (thread_id,provider_session_id,provider,status,updated_at);
            CREATE TABLE orchestration_v2_projection_nodes
              (thread_id,run_id,node_id,kind,status,started_at,completed_at);
            CREATE TABLE orchestration_v2_effect_outbox
              (effect_id,thread_id,effect_type,status,attempt_count,available_at,
               lease_expires_at,updated_at,last_error,payload_json);
        ''')
        self.db.execute("INSERT INTO orchestration_v2_projection_threads VALUES ('t','Test',NULL,NULL)")
        self.db.execute("INSERT INTO orchestration_v2_projection_runs VALUES ('r','t','running',?,'codex','{}')",
                        (doctor.stamp(self.now - 1000),))
        self.db.commit()

    def scan(self):
        self.db.commit()
        return doctor.scan(self.home, self.path, self.now, 900, 180)

    def test_quiet_run_captures_state_without_writing_source(self):
        before = self.path.read_bytes()
        result = self.scan()
        self.assertEqual([f['kind'] for f in result['findings']], ['quiet-run'])
        self.assertEqual(result['findings'][0]['evidence']['run']['quiet_seconds'], 1000)
        self.assertEqual(before, self.path.read_bytes())
        db = doctor.connect(self.path)
        try:
            with self.assertRaises(sqlite3.OperationalError):
                db.execute('DELETE FROM orchestration_v2_projection_runs')
        finally:
            db.close()

    def test_streaming_message_is_progress(self):
        self.db.execute('INSERT INTO orchestration_v2_projection_messages VALUES (?,?)', ('r', doctor.stamp(self.now - 5)))
        self.assertEqual(self.scan()['findings'], [])

    def test_tool_update_is_progress(self):
        self.db.execute('INSERT INTO orchestration_v2_projection_turn_items VALUES (?,?,?,?,?,?,?,?)',
                        ('r', 't', 'i', 'command_execution', 'running', doctor.stamp(self.now - 5), '{}', 1))
        self.assertEqual(self.scan()['findings'], [])

    def test_provider_log_is_progress(self):
        path = doctor.provider_log(self.home, 't')
        path.parent.mkdir(parents=True)
        path.write_text('provider progress\n')
        os.utime(path, (self.now - 5, self.now - 5))
        self.assertEqual(self.scan()['findings'], [])

    def configure_orphaned_start(self, failed=True):
        self.db.execute("UPDATE orchestration_v2_projection_runs SET payload_json=?",
                        (json.dumps({'activeAttemptId': 'a', 'startedAt': doctor.stamp(self.now - 240)}),))
        if failed:
            self.db.execute("INSERT INTO orchestration_v2_effect_outbox VALUES (?,?,?,?,?,?,?,?,?,?)",
                            ('e', 't', 'provider-turn.start', 'failed', 5, doctor.stamp(self.now - 240),
                             None, doctor.stamp(self.now - 30), 'CheckpointBaselineCaptureError: git timed out after 30000ms',
                             json.dumps({'type': 'provider-turn.start', 'runId': 'r'})))
        path = doctor.provider_log(self.home, 't')
        path.parent.mkdir(parents=True)
        path.write_text('unrelated provider activity\n')
        os.utime(path, (self.now, self.now))

    def test_failed_start_is_detected_despite_fresh_provider_logs(self):
        self.configure_orphaned_start()
        findings = self.scan()['findings']
        self.assertEqual([f['kind'] for f in findings], ['orphaned-run'])
        self.assertIn('git timed out', findings[0]['evidence']['failed_start']['last_error'])
        self.assertEqual(findings[0]['evidence']['run']['active_attempt_id'], 'a')

    def test_missing_provider_turn_uses_startup_grace_not_log_mtime(self):
        self.configure_orphaned_start(failed=False)
        self.assertEqual([f['kind'] for f in self.scan()['findings']], ['orphaned-run'])
        self.db.execute("UPDATE orchestration_v2_projection_runs SET payload_json=?",
                        (json.dumps({'activeAttemptId': 'a', 'startedAt': doctor.stamp(self.now - 5)}),))
        self.assertEqual(self.scan()['findings'], [])

    def test_provider_turn_for_previous_attempt_does_not_mask_missing_current_turn(self):
        self.configure_orphaned_start()
        self.db.execute("INSERT INTO orchestration_v2_projection_provider_turns VALUES ('p','t','old','running')")
        self.assertEqual([f['kind'] for f in self.scan()['findings']], ['orphaned-run'])

    def test_terminal_provider_turn_can_be_finalizing(self):
        self.configure_orphaned_start(failed=False)
        self.db.execute("INSERT INTO orchestration_v2_projection_provider_turns VALUES ('p','t','a','completed')")
        self.assertEqual(self.scan()['findings'], [])

    def test_recovered_run_does_not_keep_failed_start_in_attention(self):
        self.configure_orphaned_start()
        self.db.execute("UPDATE orchestration_v2_projection_runs SET status='interrupted'")
        self.assertEqual(self.scan()['findings'], [])

    def test_old_failed_start_does_not_skip_current_startup_grace(self):
        self.configure_orphaned_start()
        self.db.execute("UPDATE orchestration_v2_effect_outbox SET payload_json=?", (json.dumps({'runId': 'old'}),))
        self.db.execute("UPDATE orchestration_v2_projection_runs SET payload_json=?",
                        (json.dumps({'activeAttemptId': 'a', 'startedAt': doctor.stamp(self.now - 5)}),))
        self.assertEqual(self.scan()['findings'], [])

    def test_log_filename_matches_t3_non_uuid_normalization(self):
        self.assertEqual(doctor.provider_log(self.home, 'thread:mcp:ABC').name, 'events.thread-mcp-abc.log')
        self.assertEqual(doctor.provider_log(self.home, 'a' * 100).name, 'events.' + 'a' * 80 + '.log')

    def test_pending_approval_is_waiting_not_stuck(self):
        self.db.execute('INSERT INTO orchestration_v2_projection_runtime_requests VALUES (?,?,?,?,?)',
                        ('q', 't', 'approval', 'pending', doctor.stamp(self.now - 1000)))
        result = self.scan()
        self.assertEqual(result['findings'], [])
        self.assertEqual(len(result['waiting']), 1)

    def test_queue_behind_running_turn_is_not_startup_failure(self):
        self.db.execute("INSERT INTO orchestration_v2_projection_runs VALUES ('r2','t','queued',?,'codex','{}')",
                        (doctor.stamp(self.now - 1000),))
        result = self.scan()
        self.assertEqual(len(result['findings']), 1)
        self.assertEqual(result['waiting'][0]['waiting_for'], 'earlier run')

    def test_startup_uses_shorter_threshold(self):
        self.db.execute("UPDATE orchestration_v2_projection_runs SET status='starting',requested_at=?",
                        (doctor.stamp(self.now - 200),))
        self.assertEqual(len(self.scan()['findings']), 1)

    def test_future_worker_lease_is_not_stuck(self):
        self.db.execute('INSERT INTO orchestration_v2_effect_outbox (effect_id,thread_id,effect_type,status,attempt_count,available_at,lease_expires_at,updated_at,last_error) VALUES (?,?,?,?,?,?,?,?,?)',
                        ('e', 't', 'start', 'running', 1, doctor.stamp(self.now - 1000),
                         doctor.stamp(self.now + 100), doctor.stamp(self.now - 1000), None))
        self.assertEqual(len(self.scan()['findings']), 1)
        self.db.execute('UPDATE orchestration_v2_effect_outbox SET lease_expires_at=?', (doctor.stamp(self.now - 200),))
        self.assertEqual(len(self.scan()['findings']), 2)

    def test_confirm_deduplicate_restart_resolve_and_recur(self):
        output = self.home / 'doctor'
        monitor = doctor.Monitor(output, confirm=30, notifications=True)
        snapshot = self.scan()
        with patch.object(doctor, 'notify', return_value={'submitted': True}) as notify:
            monitor.update(snapshot, self.home, self.path, self.now)
            self.assertEqual(list((output / 'incidents').glob('*')), [])
            monitor.update(snapshot, self.home, self.path, self.now + 30)
            doctor.Monitor(output).update(snapshot, self.home, self.path, self.now + 60)
            self.assertEqual(notify.call_count, 1)
            report = next((output / 'incidents').glob('*.json'))
            # An inspection failure must not falsely resolve the run.
            monitor.update({'findings': [doctor.finding('monitor', 'monitor-unavailable', 'read failed', {})]},
                           self.home, self.path, self.now + 70)
            self.assertNotIn('resolved_at', json.loads(report.read_text()))
            monitor.update({'findings': []}, self.home, self.path, self.now + 80)
            self.assertIn('resolved_at', json.loads(report.read_text()))
            monitor.update(snapshot, self.home, self.path, self.now + 90)
            monitor.update(snapshot, self.home, self.path, self.now + 120)
            self.assertEqual(notify.call_count, 2)

    def test_redacts_structured_and_log_credentials(self):
        result = doctor.redact({'apiKey': 'private', 'logs': [
            'Authorization: Bearer abcdef', 'https://host/pair?token=abc&x=1',
            '{"password":"private"}', 'sk-abcdefghijklmnop']})
        text = json.dumps(result)
        for secret in ['private', 'abcdef', 'token=abc', 'sk-abcdefghijklmnop']:
            self.assertNotIn(secret, text)

    def test_unverified_provider_does_not_resolve_an_open_incident(self):
        for category, key, unknown, healthy in [
            ('providers', 'provider:work', {'id': 'work', 'state': 'stale'}, {'id': 'work', 'state': 'ready'}),
        ]:
            with self.subTest(category=category):
                monitor = doctor.Monitor(self.home / category, confirm=0, notifications=False)
                item = doctor.finding(key, 'warning', 'Needs attention', {})
                monitor.update({'findings': [item]}, self.home, self.path, self.now)
                report = Path(monitor.state[key]['report'])
                monitor.update({'findings': [], category: [unknown]}, self.home, self.path, self.now + 30)
                self.assertNotIn('resolved_at', json.loads(report.read_text()))
                monitor.update({'findings': [], category: [healthy]}, self.home, self.path, self.now + 60)
                self.assertIn('resolved_at', json.loads(report.read_text()))

    def test_updates_are_not_findings_and_old_reports_move_to_version_history(self):
        output = self.home / 'doctor'
        monitor = doctor.Monitor(output, confirm=0, notifications=True)
        key = 'update:desktop:1.2.3'
        path = output / 'incidents/20260918T100000-1234567890abcdef.json'
        report = doctor.finding(key, 'app-update', 'New release available', {'name': 'T3 desktop'})
        report['investigation'] = {'thread_id': 'preserve-this-thread'}
        path.write_text(json.dumps(report))
        monitor.state[key] = {'report': str(path), 'first_seen': self.now}
        snapshot = {'findings': [report], 'updates': [{'id': 'desktop', 'state': 'unknown'}]}
        with patch.object(doctor, 'notify') as notify:
            monitor.update(snapshot, self.home, self.path, self.now)
        self.assertEqual(snapshot['findings'], [])
        self.assertEqual(snapshot['incidents'], {})
        self.assertEqual(monitor.state, {})
        self.assertFalse(path.exists())
        archived = json.loads((output / 'update-history' / path.name).read_text())
        self.assertEqual(archived['investigation']['thread_id'], 'preserve-this-thread')
        self.assertNotIn('resolved_at', archived)
        notify.assert_not_called()

    def test_server_discovery_uses_matching_launch_service_without_runtime_file(self):
        service = self.home / 'service.plist'
        service.write_bytes(plistlib.dumps({'ProgramArguments': [
            '/runtime/t3', 'serve', '--port', '3773', '--host', '127.0.0.1',
            '--base-dir', str(self.home.parent),
        ]}))
        connection = MagicMock()
        connection.getresponse.return_value.status = 200
        connection.getresponse.return_value.read.return_value = json.dumps({
            'environmentId': 'test-environment', 'serverVersion': '0.0.42',
        }).encode()
        with patch.object(doctor.http.client, 'HTTPConnection', return_value=connection) as http:
            health = doctor.server_health(self.home, service_path=service)
        self.assertEqual(health['state'], 'reachable')
        self.assertEqual(health['server_version'], '0.0.42')
        http.assert_called_once_with('127.0.0.1', 3773, timeout=2)
        connection.request.assert_called_once_with('GET', '/.well-known/t3/environment')
        connection.close.assert_called_once()

    def test_server_discovery_rejects_other_home_and_non_t3_response(self):
        service = self.home / 'service.plist'
        args = ['/runtime/t3', 'serve', '--port', '3773', '--base-dir', '/another-home']
        service.write_bytes(plistlib.dumps({'ProgramArguments': args}))
        with patch.object(doctor.http.client, 'HTTPConnection') as http:
            self.assertEqual(doctor.server_health(self.home, service_path=service)['state'], 'unknown')
            http.assert_not_called()
        args[-1] = str(self.home.parent)
        service.write_bytes(plistlib.dumps({'ProgramArguments': args}))
        connection = MagicMock()
        connection.getresponse.return_value.status = 200
        connection.getresponse.return_value.read.return_value = b'{}'
        with patch.object(doctor.http.client, 'HTTPConnection', return_value=connection):
            health = doctor.server_health(self.home, service_path=service)
        self.assertEqual(health['state'], 'unknown')
        connection.close.assert_called_once()

    def test_server_unreachable_is_reported(self):
        (self.home / 'server-runtime.json').write_text('{"port":3773,"pid":123}')
        with patch.object(doctor.socket, 'create_connection', side_effect=ConnectionRefusedError('refused')):
            self.assertIn('server-unreachable', [f['kind'] for f in self.scan()['findings']])

    def test_legacy_stall_and_user_input_wait(self):
        path = self.home / 'state.sqlite'
        db = sqlite3.connect(path)
        self.addCleanup(db.close)
        db.executescript('''
            CREATE TABLE projection_threads (thread_id,title,pending_approval_count,
                pending_user_input_count,deleted_at,archived_at);
            CREATE TABLE projection_thread_sessions (thread_id,status,active_turn_id,
                provider_name,updated_at,last_error);
            CREATE TABLE projection_thread_messages (thread_id,updated_at);
            CREATE TABLE projection_thread_activities (thread_id,created_at);
            INSERT INTO projection_threads VALUES ('t','Test',0,0,NULL,NULL);
        ''')
        db.execute("INSERT INTO projection_thread_sessions VALUES ('t','running','turn','codex',?,NULL)",
                   (doctor.stamp(self.now - 1000),))
        db.commit()
        self.assertEqual(len(doctor.scan(self.home, path, self.now, 900, 180)['findings']), 1)
        db.execute('UPDATE projection_threads SET pending_user_input_count=1')
        db.commit()
        result = doctor.scan(self.home, path, self.now, 900, 180)
        self.assertEqual(result['findings'], [])
        self.assertEqual(len(result['waiting']), 1)


if __name__ == '__main__':
    unittest.main()
