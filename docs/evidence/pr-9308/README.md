# PR 9308 usage snapshot evidence

Captured from commit `5a35b6ba001c97365cfcf1f1985b77d4e53f8304` with an isolated synthetic provider home.

- `usage-background-snapshot.png` shows the persisted 1.75K-token snapshot and the explicit Sep 2 availability boundary.
- `usage-refresh.webm` records opening Usage from its persisted snapshot and manually refreshing after a new transcript record was appended.
- `usage-retained-after-failure.webm` records Usage after the provider home was replaced with an unreadable source and the server was restarted. The last-good snapshot remained visible with the same availability boundary.

Before and after the failed startup refresh, `usage-snapshot.json` retained SHA-256 `925670e4a758bd507096b4676de18375212da0d1c17501396b18b159670827f3` and mtime `2026-09-03T16:30:26+1000`.
