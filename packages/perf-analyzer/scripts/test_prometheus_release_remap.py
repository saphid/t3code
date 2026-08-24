#!/usr/bin/env python3

from __future__ import annotations

import gzip
import json
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


SCRIPT = Path(__file__).with_name("prometheus-release-remap.py")


class CaptureHandler(BaseHTTPRequestHandler):
    requests: list[dict] = []

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        length = int(self.headers["content-length"])
        self.requests.append(json.loads(self.rfile.read(length)))
        self.send_response(200)
        self.end_headers()

    def log_message(self, _format: str, *_args: object) -> None:
        pass


class PrometheusReleaseRemapTest(unittest.TestCase):
    def test_cli_exports_each_series_once_at_release_time(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dump = root / "prometheus.txt.gz"
            registry = root / "registry.json"
            state = root / "state.json"
            version = "0.0.34-nightly.20260823.1171"
            source = (
                '{__name__="t3perf_wall_ms", build="%s", host="AUS-M5P-AS", '
                'label="%s", network="good", scenario="startup", size="small", '
                'stat="median", surface="web"} 123 1787520000000\n'
            ) % (version, version)
            with gzip.open(dump, "wt") as output:
                output.write(source)
            registry.write_text(json.dumps({"time": {version: "2026-08-23T21:14:53.840Z"}}))

            CaptureHandler.requests = []
            server = ThreadingHTTPServer(("127.0.0.1", 0), CaptureHandler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            endpoint = f"http://127.0.0.1:{server.server_port}"
            command = [
                "python3",
                str(SCRIPT),
                "--dump-gzip",
                str(dump),
                "--registry-json",
                str(registry),
                "--host",
                "AUS-M5P-AS",
                "--otlp",
                endpoint,
                "--state-file",
                str(state),
            ]
            try:
                first = subprocess.run(command, check=True, text=True, capture_output=True)
                second = subprocess.run(command, check=True, text=True, capture_output=True)
            finally:
                server.shutdown()
                thread.join(timeout=5)
                server.server_close()

            self.assertEqual(json.loads(first.stdout)["points"], 1)
            self.assertEqual(json.loads(second.stdout)["points"], 0)
            self.assertEqual(len(CaptureHandler.requests), 1)
            point = CaptureHandler.requests[0]["resourceMetrics"][0]["scopeMetrics"][0][
                "metrics"
            ][0]["gauge"]["dataPoints"][0]
            attributes = {
                item["key"]: item["value"]["stringValue"] for item in point["attributes"]
            }
            self.assertEqual(point["timeUnixNano"], "1787519693840000000")
            self.assertEqual(attributes["host"], "AUS-M5P-AS")
            self.assertEqual(attributes["time_basis"], "release")
            self.assertEqual(attributes["label"], version)
            self.assertNotIn("AUS-M5P-AS", attributes["label"])
            self.assertTrue(state.exists())


if __name__ == "__main__":
    unittest.main()
