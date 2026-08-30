"""Board server: cache semantics, refresh injection, HTTP surface."""

import json
import sys
import threading
import time
import unittest
from http.client import HTTPConnection
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import board_server  # noqa: E402


class InjectBrowserRefreshTest(unittest.TestCase):
    def test_meta_tag_lands_inside_head(self):
        html = "<html><head><title>x</title></head><body></body></html>"
        result = board_server.inject_browser_refresh(html, seconds=300)
        self.assertIn('<head>\n<meta http-equiv="refresh" content="300">',
                      result)
        self.assertEqual(result.count("http-equiv"), 1)

    def test_document_without_head_is_untouched(self):
        self.assertEqual(board_server.inject_browser_refresh("<body></body>"),
                         "<body></body>")


class RenderBoardTest(unittest.TestCase):
    def run_with(self, returncode, write_file=True, stderr=""):
        def fake_run(command, **kwargs):
            target = Path(command[command.index("--html") + 1])
            if write_file:
                target.write_text("<html><head></head>ok</html>")
            return mock.Mock(returncode=returncode, stdout="", stderr=stderr)

        with mock.patch.object(board_server.subprocess, "run", fake_run):
            return board_server.render_board()

    def test_clean_and_drift_exits_both_render(self):
        for returncode in (0, 1):
            self.assertIn("ok", self.run_with(returncode))

    def test_renderer_failure_raises(self):
        with self.assertRaises(RuntimeError):
            self.run_with(2, write_file=False, stderr="boom")


class BoardCacheTest(unittest.TestCase):
    def test_failed_refresh_keeps_last_good_board(self):
        outcomes = iter(["<html><head></head>v1</html>", RuntimeError("gh down")])

        def renderer():
            outcome = next(outcomes)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        cache = board_server.BoardCache(renderer=renderer, ttl=999)
        cache.refresh()
        self.assertIn("v1", cache.get()[0])
        cache.refresh()
        html, rendered_at, error = cache.get()
        self.assertIn("v1", html)
        self.assertIsNotNone(rendered_at)
        self.assertIn("gh down", error)

    def test_concurrent_stale_gets_claim_one_refresh(self):
        release = threading.Event()
        calls = []

        def renderer():
            calls.append(1)
            release.wait(timeout=5)
            return "<html><head></head>fresh</html>"

        cache = board_server.BoardCache(renderer=renderer, ttl=0)
        barrier = threading.Barrier(2)

        def racing_get():
            barrier.wait(timeout=5)
            cache.get()

        threads = [threading.Thread(target=racing_get) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=5)
        time.sleep(0.2)
        self.assertEqual(len(calls), 1)
        release.set()

    def test_stale_get_kicks_background_refresh_once(self):
        started = threading.Event()
        calls = []

        def renderer():
            calls.append(1)
            started.set()
            return "<html><head></head>fresh</html>"

        cache = board_server.BoardCache(renderer=renderer, ttl=0)
        self.assertEqual(cache.get()[0], None)
        self.assertTrue(started.wait(timeout=5))
        for _ in range(50):
            if cache.get()[0]:
                break
            time.sleep(0.05)
        self.assertIn("fresh", cache.get()[0])
        self.assertGreaterEqual(len(calls), 1)


class HttpSurfaceTest(unittest.TestCase):
    def serve(self, cache):
        server = board_server.BoardServer(("127.0.0.1", 0),
                                          board_server.BoardHandler)
        server.cache = cache
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        return server.server_address[1]

    def request(self, port, path):
        connection = HTTPConnection("127.0.0.1", port, timeout=5)
        connection.request("GET", path)
        response = connection.getresponse()
        body = response.read().decode()
        headers = dict(response.getheaders())
        connection.close()
        return response.status, body, headers

    def test_board_healthz_and_unknown_paths(self):
        cache = board_server.BoardCache(
            renderer=lambda: "<html><head></head>board</html>", ttl=999)
        cache.refresh()
        port = self.serve(cache)
        status, body, headers = self.request(port, "/")
        self.assertEqual(status, 200)
        self.assertIn("board", body)
        self.assertIn("X-Board-Rendered-At", headers)
        status, body, _ = self.request(port, "/healthz")
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["ok"])
        status, _, _ = self.request(port, "/nope")
        self.assertEqual(status, 404)

    def test_unrendered_board_returns_503(self):
        def failing():
            raise RuntimeError("offline")

        cache = board_server.BoardCache(renderer=failing, ttl=999)
        port = self.serve(cache)
        cache.refresh()
        status, body, headers = self.request(port, "/")
        self.assertEqual(status, 503)
        self.assertEqual(headers.get("Retry-After"), "15")
        self.assertIn("healthz", body)
        self.assertNotIn("X-Board-Refresh-Error", headers)
        status, body, _ = self.request(port, "/healthz")
        self.assertEqual(status, 200)
        health = json.loads(body)
        self.assertFalse(health["ok"])
        self.assertIn("offline", health["lastError"])


class LoopbackAddressTest(unittest.TestCase):
    def test_loopback_forms_accepted(self):
        for value in ("127.0.0.1", "127.0.0.2", "localhost"):
            self.assertEqual(board_server.loopback_address(value), value)

    def test_non_loopback_rejected(self):
        import argparse
        for value in ("0.0.0.0", "192.168.1.10", "example.com", "::1", ""):
            with self.assertRaises(argparse.ArgumentTypeError):
                board_server.loopback_address(value)


if __name__ == "__main__":
    unittest.main()
