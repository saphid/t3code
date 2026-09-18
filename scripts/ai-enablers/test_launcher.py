import contextlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "launcher", Path(__file__).with_name("opencode-launcher.py")
)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class VersionProbeTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.binary = self.root / "opencode"
        self.binary.write_text("binary version one")
        self.cache = self.root / "version.json"

    def probe(self):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            code = launcher.probe_version(str(self.binary), self.cache)
        return code, output.getvalue()

    def test_warm_probe_does_not_start_opencode_or_contact_vault(self):
        with patch.object(
            launcher.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 0, "1.18.20\n", ""),
        ) as run:
            self.assertEqual(self.probe(), (0, "1.18.20\n"))
            run.assert_called_once()
        with patch.object(
            launcher.subprocess, "run", side_effect=AssertionError("cold start")
        ):
            self.assertEqual(self.probe(), (0, "1.18.20\n"))

    def test_binary_upgrade_invalidates_cached_version(self):
        with patch.object(
            launcher.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 0, "1.18.20\n", ""),
        ):
            self.probe()
        self.binary.write_text("binary version two, different executable")
        with patch.object(
            launcher.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 0, "1.18.21\n", ""),
        ) as run:
            self.assertEqual(self.probe(), (0, "1.18.21\n"))
            run.assert_called_once()

    def test_failed_probe_does_not_poison_cache(self):
        with (
            patch.object(
                launcher.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 1, "", "probe failed\n"),
            ),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            self.assertEqual(self.probe(), (1, ""))
        self.assertFalse(self.cache.exists())

    def test_corrupt_cache_is_replaced(self):
        self.cache.write_text("{broken")
        with patch.object(
            launcher.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 0, "1.18.20\n", ""),
        ):
            self.assertEqual(self.probe(), (0, "1.18.20\n"))
        json.loads(self.cache.read_text())

    def test_unwritable_cache_does_not_break_version_probe(self):
        with (
            patch.object(
                launcher.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 0, "1.18.20\n", ""),
            ),
            patch.object(launcher, "write_json_cache", side_effect=PermissionError),
        ):
            self.assertEqual(self.probe(), (0, "1.18.20\n"))

    def test_version_entrypoint_needs_no_credentials(self):
        self.binary.write_text(
            '#!/bin/sh\n[ "$PROBE_MUST_USE_CACHE" = "1" ] && exit 1\necho "1.18.20"\n'
        )
        self.binary.chmod(0o700)
        env = {
            **os.environ,
            "PATH": str(self.root),
            "XDG_CACHE_HOME": str(self.root / "cache"),
        }
        for must_use_cache in ("0", "1"):
            result = subprocess.run(
                [sys.executable, str(Path(launcher.__file__)), "--version"],
                env={**env, "PROBE_MUST_USE_CACHE": must_use_cache},
                capture_output=True,
                text=True,
                check=False,
                timeout=4,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, "1.18.20\n")


if __name__ == "__main__":
    unittest.main()
