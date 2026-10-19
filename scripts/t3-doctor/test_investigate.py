from contextlib import contextmanager
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import investigate


class FakeControl:
    def __init__(self, workspace):
        self.workspace = str(workspace)
        self.commands = []
        self.accepted = {}
        self.lose_reply = None
        self.message_visible = True
        self.sessions_closed = 0
        self.environment_id = 'test-environment'

    def runtime_origin(self, home, explicit):
        return 'http://127.0.0.1:3773'

    @contextmanager
    def orchestration_session(self, home, origin):
        try:
            yield 'temporary-test-session'
        finally:
            self.sessions_closed += 1

    def dispatch(self, origin, bearer, command):
        self.commands.append(command)
        self.accepted[command['commandId']] = command
        if self.lose_reply == command['type']:
            self.lose_reply = None
            raise OSError('connection closed after acceptance')

    def http_json(self, url, bearer=None):
        if url.endswith('/.well-known/t3/environment'):
            return {'environmentId': self.environment_id, 'serverVersion': '0.0.42'}
        if url.endswith('/snapshot'):
            return {'projects': [{'id': 'project', 'workspaceRoot': self.workspace}]}
        start = next(command for command in self.accepted.values() if command['type'] == 'thread.turn.start' and url.endswith(command['threadId']))
        return {'thread': {'id': start['threadId'], 'messages':
                          [{'id': start['message']['messageId']}] if self.message_visible else []}}


class InvestigationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name)
        self.item = {'key': 'provider:work', 'kind': 'provider-warning', 'reason': 'Auth check unverified',
                     'evidence': {'title': 'Work', 'auth': 'unknown'}}
        (self.output / 'status.json').write_text(json.dumps({'findings': [self.item], 'incidents': {}, 'providers': []}))
        self.config = {'project_id': 'project', 'workspace': str(self.output), 'home': str(self.output / 't3'),
                       'model': {'instanceId': 'opencode', 'model': 'enablers/xlarge'}}
        self.control = FakeControl(self.output)
        patcher = patch('investigate.repository_context', return_value={'workspace': str(self.output), 'head': 'local-head'})
        patcher.start()
        self.addCleanup(patcher.stop)

    def launch(self, **kwargs):
        return investigate.investigate(self.output, self.config, control=self.control, budget=lambda: None, **kwargs)

    def test_launch_creates_turn_and_verifies_message_then_reuses_it(self):
        first = self.launch(finding_key='provider:work')
        self.assertEqual(first['stage'], 'verified')
        self.assertEqual(len(self.control.accepted), 2)
        self.assertEqual(self.control.sessions_closed, 1)
        second = self.launch(finding_key='provider:work')
        self.assertTrue(second['reused'])
        self.assertEqual(second['thread_id'], first['thread_id'])
        self.assertEqual(len(self.control.commands), 2)
        start = self.control.commands[1]
        self.assertEqual(start['modelSelection'], {'instanceId': 'opencode', 'model': 'enablers/xlarge'})

    def test_lost_create_reply_reuses_the_same_command_and_thread_ids(self):
        self.control.lose_reply = 'thread.create'
        with self.assertRaises(OSError): self.launch()
        first = self.control.commands[0]
        result = self.launch()
        self.assertEqual(result['thread_id'], first['threadId'])
        self.assertEqual(self.control.commands[1]['commandId'], first['commandId'])
        self.assertEqual(len(self.control.accepted), 2)

    def test_lost_start_reply_cannot_submit_a_second_turn(self):
        self.control.lose_reply = 'thread.turn.start'
        with self.assertRaises(OSError): self.launch()
        start = self.control.commands[-1]
        self.launch()
        self.assertEqual(self.control.commands[-1], start)
        self.assertEqual(len(self.control.accepted), 2)

    def test_readback_retry_does_not_redispatch(self):
        self.control.message_visible = False
        with self.assertRaisesRegex(RuntimeError, 'not yet visible'): self.launch()
        self.control.message_visible = True
        self.assertEqual(self.launch()['stage'], 'verified')
        self.assertEqual(len(self.control.commands), 2)

    def test_wrong_project_workspace_blocks_creation(self):
        self.control.workspace = '/unexpected'
        with self.assertRaisesRegex(RuntimeError, 'expected T3 Code Contrib'): self.launch()
        self.assertEqual(self.control.commands, [])

    def test_verified_investigation_cannot_be_reused_in_another_environment(self):
        self.launch()
        self.control.environment_id = 'different-environment'
        with self.assertRaisesRegex(RuntimeError, 'different environment'): self.launch()
        self.assertEqual(len(self.control.commands), 2)

    def test_readback_does_not_require_budget_for_a_new_launch(self):
        self.control.message_visible = False
        with self.assertRaisesRegex(RuntimeError, 'not yet visible'): self.launch()
        self.control.message_visible = True
        def blocked(): raise RuntimeError('Usage approval required')
        result = investigate.investigate(self.output, self.config, control=self.control, budget=blocked)
        self.assertEqual(result['stage'], 'verified')
        self.assertEqual(len(self.control.commands), 2)

    def test_usage_budget_blocks_before_any_dispatch(self):
        def blocked(): raise RuntimeError('Usage approval required')
        with self.assertRaisesRegex(RuntimeError, 'Usage approval'):
            investigate.investigate(self.output, self.config, control=self.control, budget=blocked)
        self.assertEqual(self.control.commands, [])

    def test_prompt_requires_upstream_our_prs_local_changes_and_build_comparison(self):
        self.launch()
        prompt = self.control.commands[1]['message']['text']
        for text in ['current upstream code', 'our existing PRs', 'draft', 'uncommitted changes',
                     'running build', 'patch equivalence', 'No child agents', 'read-only interfaces',
                     'scripts/ov2-nightly-status.mjs']:
            self.assertIn(text, prompt)
        self.assertIn('Auth check unverified', prompt)
        bundle = next((self.output / 'investigations').glob('*/evidence.json'))
        self.assertEqual(json.loads(bundle.read_text())['context']['environment']['serverVersion'], '0.0.42')

    def test_cleared_finding_and_path_traversal_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'cleared'): self.launch(finding_key='missing')
        with self.assertRaisesRegex(ValueError, 'Invalid incident'): self.launch(report_name='../status.json')
        self.assertEqual(self.control.commands, [])

    def test_combined_investigation_is_reused_from_each_incident(self):
        other = dict(self.item, key='provider:other', evidence={'id': 'other', 'auth': 'unknown'})
        (self.output / 'status.json').write_text(json.dumps({'findings': [self.item, other]}))
        first = self.launch()
        single = self.launch(finding_key=other['key'])
        self.assertEqual(first['thread_id'], single['thread_id'])
        self.assertEqual(len(self.control.commands), 2)
        self.assertEqual(len(json.loads((self.output / 'triage.json').read_text())['issues']), 2)

    def test_new_finding_does_not_duplicate_an_existing_investigation(self):
        first = self.launch()
        other = dict(self.item, key='provider:other', evidence={'id': 'other', 'auth': 'unknown'})
        (self.output / 'status.json').write_text(json.dumps({'findings': [self.item, other]}))
        combined = self.launch()
        self.assertEqual(len(self.control.commands), 4)
        self.assertEqual(len(combined['threads']), 2)
        self.assertIn(first['thread_id'], [r['thread_id'] for r in combined['threads']])
        self.assertNotIn('provider:work', self.control.commands[-1]['message']['text'])

    def test_legacy_receipt_links_saved_incident_and_preserves_manual_reopen(self):
        (self.output / 'incidents').mkdir()
        name = '20260918T100000-1234567890abcdef.json'
        path = self.output / 'incidents' / name
        path.write_text(json.dumps(self.item))
        first = self.launch(report_name=name)
        receipt = next((self.output / 'investigations').glob('*/thread.json'))
        entry = json.loads(receipt.read_text())
        for key in ['fingerprints', 'investigation_id', 'prompt_sha256']: entry.pop(key, None)
        receipt.write_text(json.dumps(entry))
        (self.output / 'triage.json').unlink()
        from incident_tracking import refresh_tracking, set_handling
        refresh_tracking(self.output)
        report = json.loads(path.read_text())
        self.assertEqual(report['investigation']['thread_id'], first['thread_id'])
        self.assertEqual(len(report['investigation']['prompt_sha256']), 64)
        self.assertEqual(report['triage']['status'], 'in_progress')
        set_handling(self.output, report['fingerprint'], 'needs_attention')
        refresh_tracking(self.output)
        self.assertEqual(json.loads(path.read_text())['triage']['status'], 'needs_attention')
        self.assertEqual(len(self.control.commands), 2)

    def test_saved_report_and_current_finding_share_investigation(self):
        (self.output / 'incidents').mkdir()
        name = '20260918T100000-1234567890abcdef.json'
        (self.output / 'incidents' / name).write_text(json.dumps(self.item))
        first = self.launch(report_name=name)
        second = self.launch(finding_key=self.item['key'])
        self.assertEqual(first['thread_id'], second['thread_id'])
        self.assertTrue(second['reused'])


if __name__ == '__main__':
    unittest.main()
