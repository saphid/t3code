# Local AI Enablers launcher

`opencode-launcher.py` is the source for Alex's `~/.local/bin/opencode-ai-enablers`.
It uses the existing Vault user-token flow and the live Enablers model catalog.
Credentials remain in process memory and environment variables.

T3 probes `--version` with a four-second deadline. Starting OpenCode under load can
exceed that deadline even when its server is healthy. The launcher caches a
successful version response against the resolved executable path, inode, size,
and modification timestamps. Replacing or upgrading the executable invalidates
the cache. The cache contains only binary metadata and the version string.

Install and warm the version cache:

```sh
install -m 700 scripts/ai-enablers/opencode-launcher.py ~/.local/bin/opencode-ai-enablers
~/.local/bin/opencode-ai-enablers --version
```

Then refresh the AI Enablers provider in T3. No T3 server restart is required for
launcher changes. T3 remembers a successful version probe and retries a failed
one on the next refresh, so only the first cold start after an upgrade can still
miss the deadline.

Focused launcher checks:

```sh
python3 -m unittest discover -s scripts/ai-enablers -p 'test_*.py'
```
