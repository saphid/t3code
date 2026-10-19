import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import investigate
from incident_tracking import Tracking, refresh_tracking
from related_incidents import detach_related, find_related, reuse_related
from storage import locked
from test_investigate import FakeControl


class FakeJev:
    def __init__(self, score=0.92):
        self.score = score
        self.calls = []
        self.missing_answer = False

    def ask_with_retry(self, state, questions):
        self.calls.append((state, questions))
        return {'model': 'jev-test', 'answers': {} if self.missing_answer else
                {key: {'type': 'noul', 'noul': self.score} for key in questions}}


class RelatedTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name)
        self.config = {'workspace': str(self.output), 'project_id': 'project', 'home': str(self.output / 'home'),
                       'model': {'instanceId': 'opencode', 'model': 'enablers/xlarge'}}
        self.source = {'key': 'provider:new', 'kind': 'provider-warning', 'reason': 'Could not renew login',
                       'evidence': {'id': 'new', 'auth': 'unknown'}, 'logs': {'provider.log': ['PRIVATE RAW LOG']}}
        self.target = dict(self.source, key='provider:old', reason='Refresh authentication failed', evidence={'id': 'old', 'auth': 'unknown'})
        (self.output / 'status.json').write_text(json.dumps({'findings': [self.source, self.target], 'incidents': {}}))
        (self.output / 'incidents').mkdir()
        self.report = self.output / 'incidents/20260918T100000-1234567890abcdef.json'
        self.report.write_text(json.dumps(self.source))
        self.control = FakeControl(self.output)
        self.client = FakeJev()
        with patch('investigate.repository_context', return_value={'workspace': str(self.output)}):
            self.entry = investigate.investigate(self.output, self.config, finding_key=self.target['key'],
                                                control=self.control, budget=lambda: None)
        self.snapshot = refresh_tracking(self.output)
        self.fp = self.snapshot['findings'][0]['fingerprint']
        self.target_fp = self.snapshot['findings'][1]['fingerprint']

    def find(self):
        return find_related(self.output, self.fp, self.config, client=self.client)

    def test_suggestions_are_saved_without_changing_handling_or_sending_logs(self):
        result = self.find()
        self.assertEqual(result['matches'][0]['thread_id'], self.entry['thread_id'])
        report = json.loads(self.report.read_text())
        self.assertEqual(report['triage']['status'], 'needs_attention')
        self.assertEqual(report['related'], result)
        self.assertNotIn('PRIVATE RAW LOG', json.dumps(self.client.calls))
        self.assertNotIn('logs', json.dumps(self.client.calls))
        self.assertEqual(len(self.control.commands), 2)

    def test_unchanged_comparison_uses_saved_assessment(self):
        first = self.find()
        self.assertEqual(self.find(), first)
        self.assertEqual(len(self.client.calls), 1)

    def test_low_score_is_not_a_suggestion(self):
        self.client.score = 0.2
        self.assertEqual(self.find()['matches'], [])

    def test_invalid_or_missing_answer_cannot_clear_attention(self):
        self.client.missing_answer = True
        with self.assertRaisesRegex(RuntimeError, 'incomplete'): self.find()
        self.assertEqual(refresh_tracking(self.output)['findings'][0]['triage']['status'], 'needs_attention')
        self.client.missing_answer = False
        self.client.score = float('nan')
        with self.assertRaisesRegex(RuntimeError, 'invalid'): self.find()

    def test_link_and_unlink_preserve_the_existing_thread_and_other_incident(self):
        self.find()
        reuse_related(self.output, self.fp, self.target_fp, self.config, control=self.control)
        report = json.loads(self.report.read_text())
        self.assertEqual(report['investigation']['thread_id'], self.entry['thread_id'])
        self.assertEqual(report['duplicate_of'], self.target_fp)
        self.assertEqual(report['triage']['status'], 'in_progress')
        detach_related(self.output, self.fp)
        snapshot = refresh_tracking(self.output)
        self.assertNotIn('investigation', snapshot['findings'][0])
        self.assertNotIn('duplicate_of', json.loads(self.report.read_text()))
        self.assertEqual(snapshot['findings'][0]['triage']['status'], 'needs_attention')
        self.assertEqual(snapshot['findings'][1]['investigation']['thread_id'], self.entry['thread_id'])
        self.assertEqual(len(self.control.commands), 2)

    def test_different_live_environment_cannot_receive_a_stale_link(self):
        self.find()
        self.control.environment_id = 'different'
        with self.assertRaisesRegex(ValueError, 'changed'):
            reuse_related(self.output, self.fp, self.target_fp, self.config, control=self.control)
        self.assertNotIn('investigation', refresh_tracking(self.output)['findings'][0])

    def test_existing_source_investigation_is_never_overwritten(self):
        self.find()
        with locked(self.output):
            tracking = Tracking(self.output)
            tracking.link([self.fp], dict(self.entry, thread_id='preserve-me'))
            tracking.save(json.loads((self.output / 'status.json').read_text()))
        with self.assertRaisesRegex(ValueError, 'already has'):
            reuse_related(self.output, self.fp, self.target_fp, self.config, control=self.control)
        self.assertEqual(refresh_tracking(self.output)['findings'][0]['investigation']['thread_id'], 'preserve-me')

    def test_no_candidates_skips_the_api(self):
        self.target['kind'] = 'server-unreachable'
        (self.output / 'status.json').write_text(json.dumps({'findings': [self.source, self.target]}))
        result = self.find()
        self.assertEqual(result['compared'], 0)
        self.assertEqual(self.client.calls, [])


if __name__ == '__main__':
    unittest.main()
