from pathlib import Path
import importlib.util,tempfile,json,unittest
from unittest.mock import patch
p=Path(__file__).with_name('ov2-open-update.py')
spec=importlib.util.spec_from_file_location('handoff',p); module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Tests(unittest.TestCase):
 def test_check_never_installs(self):
  with tempfile.TemporaryDirectory() as d:
   Path(d,'handoff.json').write_text(json.dumps({'build':'/tmp/ready'}))
   with patch('sys.argv',[str(p),d,'--check']),patch.object(module,'run') as call:
    module.main()
    self.assertNotIn('--install',call.call_args.args[0])
 def test_success_launches_new_app_and_keeps_original_backup(self):
  with tempfile.TemporaryDirectory() as d:
   Path(d,'handoff.json').write_text(json.dumps({'build':'/tmp/ready','originalShortcut':'/tmp/original.app','newApp':'/tmp/new.app','desktopHome':'/tmp/home'}))
   with patch('sys.argv',[str(p),d]),patch.object(module,'notify'),patch.object(module,'run') as call,patch.object(module.subprocess,'run') as install:
    install.return_value.returncode=0
    self.assertEqual(module.main(),0)
    self.assertIn('/tmp/original.app',install.call_args.args[0])
    self.assertEqual(call.call_args.args[0][0:3],['/usr/bin/open','-a','/tmp/new.app'])
    self.assertTrue(Path(d,'completed.json').exists())
unittest.main()
