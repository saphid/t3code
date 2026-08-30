#!/usr/bin/env python3
"""Serve the visual delivery board over localhost, read-only.

The board itself is rendered by status_report.py --html; this server only
runs that renderer on a cache-and-refresh loop so the board is always one
stable URL away. GitHub issue state stays canonical; nothing here mutates.
"""

import argparse
import ipaddress
import json
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

PACKAGE = Path(__file__).resolve().parent
DEFAULT_PORT = 4012
DEFAULT_TTL_SECONDS = 120.0
RENDER_TIMEOUT_SECONDS = 180.0
BROWSER_REFRESH_SECONDS = 300


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def inject_browser_refresh(html, seconds=BROWSER_REFRESH_SECONDS):
    """Add a meta refresh so an open board tab tracks the pipeline."""
    marker = "<head>"
    index = html.find(marker)
    if index < 0:
        return html
    cut = index + len(marker)
    tag = '\n<meta http-equiv="refresh" content="%d">' % seconds
    return html[:cut] + tag + html[cut:]


def render_board(timeout=RENDER_TIMEOUT_SECONDS):
    """One status_report --html run; drift findings (exit 1) still render."""
    with tempfile.TemporaryDirectory(prefix="swiftui-board-") as scratch:
        target = Path(scratch) / "board.html"
        result = subprocess.run(
            [sys.executable, str(PACKAGE / "status_report.py"),
             "--html", str(target)],
            capture_output=True, text=True, timeout=timeout)
        if result.returncode not in (0, 1) or not target.is_file():
            detail = (result.stderr or result.stdout).strip()[:500]
            raise RuntimeError(detail or "renderer exit %d" % result.returncode)
        return inject_browser_refresh(target.read_text(encoding="utf-8"))


class BoardCache:
    """Last-good board HTML; refreshes never evict a served page."""

    def __init__(self, renderer=render_board, ttl=DEFAULT_TTL_SECONDS):
        self.renderer = renderer
        self.ttl = ttl
        self.lock = threading.Lock()
        self.html = None
        self.rendered_at = None
        self.rendered_monotonic = 0.0
        self.last_error = None
        self.refreshing = False

    def refresh(self):
        try:
            html = self.renderer()
        except Exception as error:  # keep serving the last-good board
            with self.lock:
                self.last_error = "%s: %s" % (type(error).__name__, error)
                self.refreshing = False
            return
        with self.lock:
            self.html = html
            self.rendered_at = utc_now()
            self.rendered_monotonic = time.monotonic()
            self.last_error = None
            self.refreshing = False

    def start_refresh(self):
        with self.lock:
            if self.refreshing:
                return
            self.refreshing = True
        threading.Thread(target=self.refresh, daemon=True).start()

    def get(self):
        spawn = False
        with self.lock:
            stale = (self.html is None or
                     time.monotonic() - self.rendered_monotonic >= self.ttl)
            if stale and not self.refreshing:
                self.refreshing = True
                spawn = True
            snapshot = (self.html, self.rendered_at, self.last_error)
        if spawn:
            threading.Thread(target=self.refresh, daemon=True).start()
        return snapshot


class BoardHandler(BaseHTTPRequestHandler):
    server_version = "SwiftUIDeliveryBoard"

    def do_GET(self):  # noqa: N802 - http.server API name
        path = urlsplit(self.path).path
        html, rendered_at, error = self.server.cache.get()
        if path == "/healthz":
            body = json.dumps({
                "ok": html is not None,
                "renderedAt": rendered_at,
                "lastError": error,
            }, separators=(",", ":")).encode()
            self.send_body(200, body, "application/json; charset=utf-8")
            return
        if path not in ("/", "/index.html"):
            self.send_body(404, b"not found\n", "text/plain; charset=utf-8")
            return
        if html is None:
            self.send_body(503, b"board is generating or failed; see /healthz\n",
                           "text/plain; charset=utf-8", retry_after="15")
            return
        self.send_body(200, html.encode(), "text/html; charset=utf-8",
                       rendered_at=rendered_at)

    def send_body(self, status, body, content_type,
                  rendered_at=None, retry_after=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if rendered_at:
            self.send_header("X-Board-Rendered-At", rendered_at)
        if retry_after:
            self.send_header("Retry-After", retry_after)
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def log_message(self, format, *args):  # noqa: A002 - http.server API name
        return


class BoardServer(ThreadingHTTPServer):
    daemon_threads = True


def loopback_address(value):
    """The board carries private pipeline detail; never leave this host.

    IPv4 only: the server binds AF_INET, so ::1 could not be served anyway.
    """
    if value == "localhost":
        return value
    try:
        if ipaddress.ip_address(value).version == 4 and \
                ipaddress.ip_address(value).is_loopback:
            return value
    except ValueError:
        pass
    raise argparse.ArgumentTypeError(
        "%r is not an IPv4 loopback address; the board serves localhost only"
        % value)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1", type=loopback_address)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--ttl", type=float, default=DEFAULT_TTL_SECONDS,
                        help="seconds a rendered board stays fresh")
    args = parser.parse_args(argv)
    server = BoardServer((args.bind, args.port), BoardHandler)
    server.cache = BoardCache(ttl=args.ttl)
    server.cache.start_refresh()
    print("http://%s:%d" % (args.bind, args.port), flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
