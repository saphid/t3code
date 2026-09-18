#!/usr/bin/env python3
"""Launch OpenCode against the live Algolia AI Enablers model catalog."""

from __future__ import annotations

import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

VAULT_ADDR = "https://vault.algolia.net"
TOKEN_PATH = "identity/oidc/token/enablers"
BASE_URL = "https://inference.api.enablers.algolia.net/v1"
DEFAULT_OUTPUT_LIMIT = 32_000
CACHE_TTL_SECONDS = 300
METADATA_COMMANDS = {
    ("models",),
    ("agent", "list"),
    ("debug", "skill"),
}
CHILD_ENVIRONMENT_KEYS = {
    "COLORTERM",
    "HOME",
    "LANG",
    "LC_ALL",
    "LOGNAME",
    "NO_PROXY",
    "PATH",
    "SHELL",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "TERM",
    "TMPDIR",
    "USER",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
}


class LauncherError(RuntimeError):
    pass


def find_command(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise LauncherError(f"Required command is not installed or not on PATH: {name}")
    return path


def read_token(vault: str) -> str:
    env = os.environ.copy()
    env["VAULT_ADDR"] = VAULT_ADDR
    try:
        result = subprocess.run(
            [vault, "read", "--field=token", TOKEN_PATH],
            check=False,
            capture_output=True,
            text=True,
            env=env,
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise LauncherError(
            "Could not run Vault to obtain an AI Enablers token."
        ) from error
    token = result.stdout.strip()
    if result.returncode != 0 or not token:
        raise LauncherError(
            "Could not obtain an AI Enablers token. Authenticate to Vault and try again."
        )
    return token


def fetch_catalog(token: str, base_url: str = BASE_URL) -> list[dict[str, Any]]:
    request = urllib.request.Request(
        f"{base_url}/models",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "ai-enablers-t3-setup/0.1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        raise LauncherError(
            f"The AI Enablers model catalog returned HTTP {error.code}."
        ) from error
    except (OSError, ValueError) as error:
        raise LauncherError("Could not read the AI Enablers model catalog.") from error

    entries = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        raise LauncherError(
            "The AI Enablers model catalog returned an unexpected response."
        )
    return [entry for entry in entries if isinstance(entry, dict)]


def stable_aliases(entries: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    aliases: dict[str, dict[str, Any]] = {}
    for entry in entries:
        alias = entry.get("id")
        served_model = entry.get("served_model")
        if not isinstance(alias, str) or not isinstance(served_model, str):
            continue
        context = entry.get("context_length", entry.get("max_model_len"))
        model: dict[str, Any] = {
            "name": f"{alias} ({served_model})",
        }
        if isinstance(context, int) and context > 0:
            model["limit"] = {
                "context": context,
                "output": min(DEFAULT_OUTPUT_LIMIT, context),
            }
        aliases[alias] = model
    if not aliases:
        raise LauncherError("The AI Enablers catalog contains no stable model aliases.")
    return aliases


def cache_path() -> Path:
    root = Path(
        os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))
    ).expanduser()
    return root / "ai-enablers-t3" / "catalog.json"


def read_cached_catalog(
    path: Path, now: float | None = None
) -> list[dict[str, Any]] | None:
    try:
        age = (time.time() if now is None else now) - path.stat().st_mtime
        if age < 0 or age > CACHE_TTL_SECONDS:
            return None
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(payload, list) or not all(
        isinstance(item, dict) for item in payload
    ):
        return None
    return payload


def write_json_cache(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            json.dump(payload, temporary, separators=(",", ":"))
        temporary_path.chmod(stat.S_IRUSR | stat.S_IWUSR)
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def probe_version(opencode: str, path: Path) -> int:
    """Avoid cold CLI startup during T3 discovery; invalidate on binary replacement."""
    binary = Path(opencode).resolve()
    metadata = binary.stat()
    identity = [
        str(binary),
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    ]
    try:
        cached = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cached = None
    if isinstance(cached, dict) and cached.get("binary") == identity:
        version = cached.get("version")
        if isinstance(version, str) and re.fullmatch(
            r"(?:opencode )?v?\d+\.\d+\.\d+(?:[-+][^\s]+)?\s*", version
        ):
            print(version, end="")
            return 0
    try:
        result = subprocess.run(
            [opencode, "--version"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise LauncherError("Could not read the OpenCode version.") from error
    if result.returncode == 0 and re.fullmatch(
        r"(?:opencode )?v?\d+\.\d+\.\d+(?:[-+][^\s]+)?\s*", result.stdout
    ):
        try:
            write_json_cache(path, {"binary": identity, "version": result.stdout})
        except OSError:
            pass
    print(result.stdout, end="")
    print(result.stderr, end="", file=sys.stderr)
    return result.returncode


def is_metadata_command(argv: list[str]) -> bool:
    words = tuple(argument for argument in argv if not argument.startswith("-"))
    return any(words[: len(command)] == command for command in METADATA_COMMANDS)


def build_config(entries: list[dict[str, Any]]) -> dict[str, Any]:
    models = stable_aliases(entries)
    default_alias = "xlarge" if "xlarge" in models else min(models)
    return {
        "$schema": "https://opencode.ai/config.json",
        "enabled_providers": ["enablers"],
        "model": f"enablers/{default_alias}",
        "mcp": {},
        "provider": {
            "enablers": {
                "npm": "@ai-sdk/openai-compatible",
                "name": "AI Enablers",
                "options": {
                    "baseURL": BASE_URL,
                    "apiKey": "{env:ENABLERS_JWT}",
                },
                "models": models,
            }
        },
    }


def child_environment(token: str, catalog: list[dict[str, Any]]) -> dict[str, str]:
    env = {
        key: value for key, value in os.environ.items() if key in CHILD_ENVIRONMENT_KEYS
    }
    env["ENABLERS_JWT"] = token
    env["OPENCODE_CONFIG_CONTENT"] = json.dumps(build_config(catalog))
    return env


def main(argv: list[str]) -> int:
    try:
        opencode = find_command("opencode")
        if argv == ["--version"]:
            return probe_version(opencode, cache_path().with_name("version.json"))

        catalog_cache = cache_path()
        catalog = read_cached_catalog(catalog_cache)
        force_refresh = os.environ.get("AI_ENABLERS_FORCE_REFRESH") == "1"
        token = ""
        if force_refresh or catalog is None or not is_metadata_command(argv):
            vault = find_command("vault")
            token = read_token(vault)
        if force_refresh or catalog is None or not is_metadata_command(argv):
            catalog = fetch_catalog(token)
            stable_aliases(catalog)
            write_json_cache(catalog_cache, catalog)
        env = child_environment(token or "metadata-only", catalog)
        try:
            os.execve(opencode, [opencode, "--pure", *argv], env)
        except OSError as error:
            raise LauncherError("Could not start OpenCode.") from error
    except LauncherError as error:
        print(f"AI Enablers launcher: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
