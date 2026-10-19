import json
from pathlib import Path
import tempfile
import subprocess
import urllib.error
import unittest
from unittest.mock import patch

from health_checks import ReleaseChecker, age, compare_versions, read_providers, select_release, timestamp, release_distance, fetch_comparison


class HealthChecksTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / 'userdata'
        self.home.mkdir()
        self.caches = self.root / 'caches'
        self.caches.mkdir()
        self.output = self.root / 'doctor'
        self.output.mkdir()
        self.now = 1800000000
        self.settings = {'providerInstances': {'work': {'driver': 'codex', 'enabled': True, 'displayName': 'Work'}}}
        self.cache = dict(instanceId='work', driver='codex', enabled=True, installed=True, status='ready',
                          version='1.2.3', auth={'status': 'authenticated', 'email': 'private@example.com'}, checkedAt=timestamp(self.now))

    def providers(self):
        (self.home / 'settings.json').write_text(json.dumps(self.settings))
        (self.caches / 'work.json').write_text(json.dumps(self.cache))
        return read_providers(self.home, self.now)[0]

    def test_configured_account_is_distinct_and_credentials_are_not_copied(self):
        result = self.providers()
        self.assertEqual(result[0]['id'], 'work')
        self.assertEqual(result[0]['state'], 'ready')
        self.assertNotIn('private@example.com', json.dumps(result))

    def test_stale_diagnostic_does_not_claim_ready_or_failed(self):
        self.cache.update(status='error', checkedAt=timestamp(self.now - 1800))
        self.assertEqual(self.providers()[0]['state'], 'stale')

    def test_disabled_provider_cannot_trigger_error(self):
        self.settings['providerInstances']['work']['enabled'] = False
        self.cache['status'] = 'error'
        self.assertEqual(self.providers()[0]['state'], 'disabled')

    def test_missing_configured_executable_is_detected(self):
        self.settings['providerInstances']['work']['config'] = {'binaryPath': str(self.root / 'missing')}
        result = self.providers()[0]
        self.assertEqual(result['state'], 'error')
        self.assertFalse(result['binary_found'])

    def test_unknown_auth_is_not_an_authentication_failure(self):
        self.cache['auth']['status'] = 'unknown'
        self.assertEqual(self.providers()[0]['state'], 'ready')
        self.cache['auth']['status'] = 'unauthenticated'
        self.assertEqual(self.providers()[0]['state'], 'error')

    def test_removed_custom_account_is_not_monitored(self):
        self.settings['providerInstances'] = {}
        self.assertEqual(self.providers(), [])

    def test_version_ordering_numeric_prereleases_and_stable(self):
        self.assertGreater(compare_versions('0.0.42-nightly-v2.20260918.10', '0.0.42-nightly-v2.20260918.2'), 0)
        self.assertGreater(compare_versions('0.0.42', '0.0.42-nightly-v2.20260918.10'), 0)
        self.assertEqual(compare_versions('v1.2.3+local', '1.2.3'), 0)
        with self.assertRaises(ValueError): compare_versions('custom', '1.2.3')

    def release(self, version='0.0.42-nightly-v2.20260918.10', **extras):
        return dict(tag_name='v' + version, published_at='2026-09-18T00:00:00Z', draft=False,
                    html_url='https://github.com/example/t3/releases/tag/v' + version,
                    assets=[{'name': 'T3-Code-' + version + '-arm64.dmg'}, {'name': 't3-' + version + '-darwin-arm64.tar.gz'}], **extras)

    def test_release_selection_ignores_drafts_other_channels_and_missing_assets(self):
        expected = self.release()
        draft = dict(self.release('0.0.43-nightly-v2.20260918.1'), draft=True)
        incomplete = dict(self.release('0.0.44-nightly-v2.20260918.1'), assets=[{'name': 'nightly-v2-mac.yml'}])
        releases = [draft, incomplete, self.release('0.0.99-nightly.20260918.1'), expected]
        self.assertEqual(select_release(releases, 'nightly-v2', 'server'), expected)
        self.assertEqual(select_release(releases, 'nightly-v2', 'desktop'), expected)

    def test_release_cache_persists_and_explicit_refresh_bypasses_it(self):
        (self.output / 'checks.json').write_text(json.dumps({'release_repository': 'example/t3', 'release_channel': 'nightly-v2'}))
        components = [{'id': 'server', 'name': 'T3 server', 'installed_version': '0.0.41-nightly-v2.20260917.2'}]
        with patch('health_checks.installed_components', return_value=components), patch('health_checks.fetch_releases', return_value=[self.release()]) as fetch:
            checker = ReleaseChecker(self.home, self.output)
            self.assertEqual(checker.check(self.now)[0]['state'], 'update_available')
            ReleaseChecker(self.home, self.output).check(self.now + 60)
            self.assertEqual(fetch.call_count, 1)
            checker.check(self.now + 60, force=True)
            self.assertEqual(fetch.call_count, 2)

    def test_release_distance_counts_only_newer_releases_on_the_same_channel(self):
        releases = [self.release('1.0.3'), self.release('1.0.2'), self.release('1.0.1')]
        result = release_distance('1.0.1', releases, 'latest')
        self.assertEqual(result['releases_behind'], 2)
        self.assertTrue(result['releases_behind_exact'])
        missing = release_distance('1.0.0', releases, 'latest')
        self.assertEqual(missing['releases_behind'], 3)
        self.assertFalse(missing['releases_behind_exact'])
        self.assertNotIn('releases_behind', release_distance('1.0.0-preview.1', releases, 'latest'))

    def test_commit_comparison_counts_both_sides_of_a_diverged_build(self):
        response = dict(status='diverged', ahead_by=656, behind_by=479, html_url='https://github.com/example/t3/compare/a...b')
        with patch('health_checks.github_json', return_value=response) as fetch:
            result = fetch_comparison('example/t3', 'abcd123', 'v1.2.3')
        self.assertEqual(result['commits_behind'], 656)
        self.assertEqual(result['commits_ahead'], 479)
        self.assertEqual(result['commit_status'], 'diverged')
        self.assertIn('page=2', fetch.call_args.args[1])

    def test_bad_commit_counts_are_rejected(self):
        with patch('health_checks.github_json', return_value={'status': 'ahead', 'ahead_by': -1, 'behind_by': 0}):
            with self.assertRaises(ValueError): fetch_comparison('example/t3', 'abcd123', 'v1.2.3')

    def test_preview_uses_source_commit_without_guessing_releases_behind(self):
        (self.output / 'checks.json').write_text(json.dumps({'release_repository': 'example/t3', 'release_channel': 'nightly-v2'}))
        component = dict(id='desktop', name='T3 desktop', installed_version='0.0.41-preview.1', source_commit='abcd123')
        comparison = dict(commit_status='diverged', commits_behind=7, commits_ahead=3)
        with patch('health_checks.installed_components', return_value=[component]), patch('health_checks.fetch_releases', return_value=[self.release()]), patch('health_checks.fetch_comparison', return_value=comparison) as compare:
            checker = ReleaseChecker(self.home, self.output)
            first = checker.check(self.now)[0]
            self.assertEqual(first['commits_behind'], 7)
            self.assertNotIn('releases_behind', first)
            self.assertEqual(first['state'], 'release_available')
            checker.check(self.now + 60)
            self.assertEqual(compare.call_count, 1)
            component['source_commit'] = 'abcdef4'
            checker.check(self.now + 90)
            self.assertEqual(compare.call_count, 2)
            with patch('health_checks.fetch_comparison', side_effect=OSError('offline')):
                failed = checker.check(self.now + 120, force=True)[0]
            self.assertNotIn('commits_behind', failed)
            self.assertIn('offline', failed['commit_distance_note'])

    def test_public_rate_limit_uses_existing_github_cli_authentication(self):
        error = urllib.error.HTTPError('https://api.github.com', 403, 'rate limit', {}, None)
        result = subprocess.CompletedProcess([], 0, json.dumps([self.release()]).encode(), b'')
        with patch('health_checks.urllib.request.urlopen', side_effect=error), patch('health_checks.shutil.which', return_value='/tools/gh'), patch('health_checks.subprocess.run', return_value=result) as run:
            from health_checks import fetch_releases
            self.assertEqual(len(fetch_releases('example/t3')), 1)
        self.assertEqual(run.call_args.args[0][-1], 'repos/example/t3/releases?per_page=100')
        self.assertEqual(run.call_args.kwargs['env']['GH_PROMPT_DISABLED'], '1')

    def test_network_failure_is_unknown_not_up_to_date(self):
        (self.output / 'checks.json').write_text(json.dumps({'release_repository': 'example/t3', 'release_channel': 'nightly-v2'}))
        components = [{'id': 'desktop', 'name': 'T3 desktop', 'installed_version': '0.0.41'}]
        with patch('health_checks.installed_components', return_value=components), patch('health_checks.fetch_releases', side_effect=OSError('offline')):
            result = ReleaseChecker(self.home, self.output).check(self.now)
            self.assertEqual(result[0]['state'], 'unknown')
            self.assertIn('offline', result[0]['message'])


if __name__ == '__main__':
    unittest.main()
