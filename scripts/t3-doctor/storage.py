"""Private, atomic storage shared by the watcher and native app commands."""
import datetime as dt
import json
import re
import time
from contextlib import contextmanager
import fcntl


def stamp(value=None):
    return dt.datetime.fromtimestamp(time.time() if value is None else value, dt.timezone.utc).isoformat()


def epoch(value):
    if not value:
        return 0.0
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def redact(value):
    if isinstance(value, dict):
        return {k: '<REDACTED>' if re.search(r'token|secret|password|authorization|api.?key|cookie', k, re.I)
                else redact(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    if isinstance(value, str):
        value = re.sub(r'(?i)\bBearer\s+[^\s"\',;]+', 'Bearer <REDACTED>', value)
        value = re.sub(r'(?i)((?:[\w-]*(?:token|secret|password|api[_-]?key)|authorization|cookie)["\']?\s*[:=]\s*["\']?)[^\s"\',;&}]+', r'\1<REDACTED>', value)
        value = re.sub(r'\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b', '<REDACTED>', value)
    return value


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(redact(value), indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(path)



@contextmanager
def locked(output):
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (output / "incidents.lock").open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield
