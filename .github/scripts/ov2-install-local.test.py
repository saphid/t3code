import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('installer', Path(__file__).with_name('ov2-install-local.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def test_catalog_migration_uses_the_packaged_fork_catalog_path(self):
        self.assertEqual(installer.fork_connection_catalog(Path('/test-home')),
            Path('/test-home/userdata/connection-catalog.0054003300200043006f00640065002000280046006f0072006b0020004e0069006700680074006c00790029.json'))

    def test_migration_selects_fork_ov2_and_preserves_desktop_preferences(self):
        previous = {'mainWindowBounds': {'x': 20, 'y': 30, 'width': 1000, 'height': 800},
                    'localEnvironmentEnabled': False, 'updateChannel': 'nightly'}
        updated = installer.fork_update_settings(previous)
        self.assertEqual(updated['updateRepository'], 'saphid/t3code')
        self.assertEqual(updated['updateChannel'], 'nightly-v2')
        self.assertTrue(updated['updateChannelConfiguredByUser'])
        self.assertFalse(updated['localEnvironmentEnabled'])
        self.assertEqual(updated['mainWindowBounds'], previous['mainWindowBounds'])
        self.assertEqual(previous['updateChannel'], 'nightly')

    def test_backup_captures_wal_and_active_turn_preflight(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.sqlite'
            dest = Path(directory) / 'backup.sqlite'
            with sqlite3.connect(source) as writer:
                writer.execute('pragma journal_mode=wal')
                writer.execute('create table orchestration_v2_projection_runs (status text)')
                writer.executemany('insert into orchestration_v2_projection_runs values (?)', [('running',), ('completed',), ('waiting',)])
                writer.commit()
                self.assertEqual(installer.active_runs(source), 2)
                installer.backup_database(source, dest)
                with sqlite3.connect(dest) as backup:
                    self.assertEqual(backup.execute('select count(*) from orchestration_v2_projection_runs').fetchone()[0], 3)
                    self.assertEqual(backup.execute('pragma integrity_check').fetchone()[0], 'ok')

    def test_launcher_preserves_separate_desktop_home_and_does_not_reinstall_old_service(self):
        text = installer.launcher_text(Path('/Applications/T3 Fork.app'), Path('/tmp/desktop home'), Path('/tmp/service.plist'))
        self.assertIn("'T3CODE_HOME=/tmp/desktop home'", text)
        self.assertNotIn('service install', text)
        self.assertNotIn('preview.', text)
        self.assertIn('launchctl bootstrap', text)


if __name__ == '__main__':
    unittest.main()
