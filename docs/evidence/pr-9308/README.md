# PR 9308 usage snapshot evidence

Captured with isolated synthetic provider homes. The final-head proof ran against commit `73b07277c05c19d19727e3c2955b89927125a973`.

- `usage-background-snapshot.png` shows the final-head persisted 1.75K-token snapshot and the explicit Sep 2 availability boundary.
- `usage-final-head.webm` records final-head startup rendering that snapshot without loading copy.
- `usage-refresh.webm` records opening Usage from its persisted snapshot and manually refreshing after a new transcript record was appended.
- `usage-retained-after-failure.webm` records Usage after the provider home was replaced with an unreadable source and the server was restarted. The last-good snapshot remained visible with the same availability boundary.

The original refresh/failure run retained SHA-256 `925670e4a758bd507096b4676de18375212da0d1c17501396b18b159670827f3`. The final-head startup/failure rerun retained SHA-256 `035629105d091f3da64f6cd2d8be59352b302ad62f24a522ad5f687760006ae1` and mtime `2026-09-03T17:43:06+1000`.
