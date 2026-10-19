import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import doctor
from incident_tracking import fingerprint, refresh_tracking, set_handling


class TrackingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name)
        self.database = self.output / 'source.sqlite'
        self.monitor = doctor.Monitor(self.output, confirm=0, notifications=True)
        self.now = 1_800_000_000
        self.item = dict(key='provider:work', kind='provider-warning', reason='Authentication not verified',
                         evidence=dict(id='work', driver='claude', auth='unknown', state='warning', message='Authentication not verified'))
        self.notifier = patch.object(doctor, 'notify', return_value={'submitted': True})
        self.notify = self.notifier.start()
        self.addCleanup(self.notifier.stop)

    def scan(self, items=None):
        self.now += 30
        snapshot = {'findings': copy.deepcopy([self.item] if items is None else items), 'active': [], 'waiting': [],
                    'checked_at': doctor.stamp(self.now), 'database': str(self.database)}
        self.monitor.update(snapshot, self.output, self.database, self.now)
        return json.loads((self.output / 'status.json').read_text())

    def reports(self):
        return [json.loads(p.read_text()) for p in sorted((self.output / 'incidents').glob('*.json'))]

    def test_fingerprint_ignores_observation_churn_but_keeps_failure_and_environment(self):
        old = fingerprint(self.item, '/one.sqlite')
        changed = copy.deepcopy(self.item)
        changed['evidence'].update(checked_at='tomorrow', active_runs=23, title='New display name')
        self.assertEqual(old, fingerprint(changed, '/one.sqlite'))
        self.assertNotEqual(old, fingerprint(changed, '/two.sqlite'))
        changed['evidence']['auth'] = 'unauthenticated'
        self.assertNotEqual(old, fingerprint(changed, '/one.sqlite'))

    def test_distinct_runs_and_release_versions_are_not_merged(self):
        item = dict(key='run:r', kind='quiet-run', evidence={'run': {'thread_id': 't', 'run_id': 'r', 'quiet_seconds': 1000}})
        old = fingerprint(item)
        item['evidence']['run']['quiet_seconds'] = 2000
        self.assertEqual(old, fingerprint(item))
        item['evidence']['run']['run_id'] = 'other'
        self.assertNotEqual(old, fingerprint(item))
        release = dict(key='update:desktop', kind='app-update', evidence={'id': 'desktop', 'latest_version': '1'})
        old = fingerprint(release)
        release['evidence']['latest_version'] = '2'
        self.assertNotEqual(old, fingerprint(release))

    def test_assignment_survives_scans_and_restart_without_claiming_recovery(self):
        snapshot = self.scan()
        fp = snapshot['findings'][0]['fingerprint']
        set_handling(self.output, fp, 'assigned', 'Alex', 'Checking upstream')
        self.monitor = doctor.Monitor(self.output, confirm=0, notifications=True)
        snapshot = self.scan()
        self.assertEqual(snapshot['findings'][0]['triage']['assignee'], 'Alex')
        self.assertEqual(snapshot['incidents'][self.item['key']]['triage']['status'], 'assigned')
        self.assertNotIn('resolved_at', self.reports()[0])
        set_handling(self.output, fp, 'needs_attention')
        self.assertEqual(self.scan()['findings'][0]['triage']['status'], 'needs_attention')
        self.assertEqual(self.notify.call_count, 1)

    def test_recurrence_returns_to_attention_and_keeps_history(self):
        fp = self.scan()['findings'][0]['fingerprint']
        set_handling(self.output, fp, 'dismissed')
        self.scan([])
        self.assertIn('resolved_at', self.reports()[0])
        returned = self.scan()
        self.assertEqual(returned['findings'][0]['triage']['status'], 'needs_attention')
        self.assertEqual(len(self.reports()), 2)
        self.assertEqual(self.notify.call_count, 2)

    def test_changed_failure_under_same_key_gets_a_new_report(self):
        fp = self.scan()['findings'][0]['fingerprint']
        set_handling(self.output, fp, 'in_progress')
        self.item['evidence']['message'] = 'Provider executable missing'
        current = self.scan()
        self.assertNotEqual(current['findings'][0]['fingerprint'], fp)
        self.assertEqual(current['findings'][0]['triage']['status'], 'needs_attention')
        self.assertEqual(len(self.reports()), 2)
        self.assertIn('resolved_at', self.reports()[0])

    def test_same_worker_failure_groups_reports_and_suppresses_duplicate_alerts(self):
        a = dict(key='effect:a', kind='overdue-worker', reason='Checkpoint overdue', thread_id='t', evidence={'effect_id': 'a', 'effect_type': 'checkpoint', 'last_error': 'write failed'})
        b = dict(a, key='effect:b', evidence=dict(a['evidence'], effect_id='b'))
        with patch.object(doctor, 'capture', return_value={}):
            first = self.scan([a])
            fp = first['findings'][0]['fingerprint']
            set_handling(self.output, fp, 'in_progress')
            current = self.scan([a, b])
        self.assertEqual(len(self.reports()), 2)
        self.assertEqual({i['fingerprint'] for i in current['findings']}, {fp})
        self.assertEqual(self.notify.call_count, 1)
        self.assertIn('suppressed', self.reports()[-1]['notification'])

    def test_status_validation_does_not_hide_a_finding(self):
        fp = self.scan()['findings'][0]['fingerprint']
        with self.assertRaises(ValueError): set_handling(self.output, fp, 'assigned', '')
        with self.assertRaises(ValueError): set_handling(self.output, fp, 'resolved')
        self.assertEqual(refresh_tracking(self.output)['findings'][0]['triage']['status'], 'needs_attention')


if __name__ == '__main__':
    unittest.main()
