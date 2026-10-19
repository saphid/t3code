## Problem

When a client asks the background service to update, the launcher stops the server and only then copies the whole database with `fs.copyFile`. If the copy does not fit, the update fails with `db-backup-failed`, rolls back, and restarts the old server cold. On a machine with less free space than the database, every update attempt is an outage. Fixes #14515.

## Change

- Before the server is stopped, `databaseBackupBlocker` checks that the backup fits. If it does not, the update is rejected through the existing `update-rejected` path with a reason the client already shows: "Not enough free disk space to back up the database before updating: X GB needed, Y GB free. Free up disk space and try again. The server was not stopped."
- Backups and rollback restores copy with `cp -c` on macOS (APFS clone) and `cp --reflink=auto` on Linux (reflink on btrfs/XFS, normal copy elsewhere). They fall back to `fs.copyFile` if `cp` fails, and on Windows. Node's own clone flag is not used. On macOS, `COPYFILE_FICLONE` silently does a full copy (1 GiB took 805 ms and used 1 GiB of free space), and `COPYFILE_FICLONE_FORCE` fails with ENOSYS.
- How much space the check requires:
  - If a full copy (1.05x the database plus WAL) fits, the update goes ahead.
  - Otherwise, if the backup will be a clone, it needs max(1 GiB, 10% of the database). That is headroom for the trial server's writes, migrations included, which diverge from the shared blocks.
  - Otherwise the full copy is required.
- Whether the backup will be a clone is decided without writing test data or measuring free space:
  - On macOS, `cp -c` clones within one APFS volume and silently copies anywhere else. So the database and backup directories must share a device whose filesystem type matches the system volume's, which is always APFS. (`statfs().type` on macOS is a per-boot index, so it is compared with `/` rather than a constant.)
  - On Linux, each existing database file is cloned with `cp --reflink=always`, then the clones are deleted. That command fails instead of copying when a file cannot be reflinked, which also covers btrfs databases marked No_COW (`chattr +C`).
  - On other platforms, never.
- If the check cannot run, the update is rejected too, with "Could not check that the database backup fits before updating: ... The server was not stopped." That covers an unreadable database file and a failing `statfs`. The alternative is stopping the server without knowing whether the backup fits.

The launcher stays on Node built-ins (no Effect), as its header requires. The running launcher picks this up after its next restart or successful update.

## Scope and approval

Fixes triaged bug #14515. This changes only the launcher's backup copy and adds a preflight before the existing stop step. No contract, client or server changes.

## Verification

- New launcher integration tests drive a real `Launcher` with a fake runtime that requests an update. They inject the free-space and clone checks, so the result does not depend on the test machine:
  - With 0 bytes free, the update is rejected with the free-space reason. The trial runtime is never started and the service state is unchanged.
  - With a free-space reader that throws, the update is rejected with the check-failure reason, again with no trial and no state change. This test fails against a fail-open version.
- New `databaseBackupBlocker` tests (10 GiB sparse database):
  - A full copy that fits passes.
  - A clone with 1.5 GiB free passes; with 0.5 GiB free it is rejected ("1.0 GB needed").
  - A non-cloning filesystem with 8 GiB free is rejected ("10.5 GB needed").
  - A missing database throws ENOENT, which the launcher turns into a rejection.
- A filesystem test runs the real clone check. On macOS it detects the APFS temp directory as cloneable. On Linux it runs the `--reflink=always` probe and leaves nothing in the backup directory.
- `vp test run src/serviceLauncher.test.ts src/cloud/selfUpdate.test.ts` in apps/server: 25 passed. `apps/server` typecheck clean; lint and format clean on both files.
- Measured on macOS: `cp -c` of a 32 MiB file on APFS changed free space by 176 KiB. `cp -c` onto an existing 256 MiB file replaced it with a clone (new inode, its old blocks were freed), so rollback restores are near-free too. `cp -c` from APFS to a FAT volume exited 0 after a full copy, which is why macOS cloning is decided from the filesystem rather than from `cp`'s exit code.
- Not run: a full update through a real launcher and runtime download. The Linux clone path runs only in CI (ext4, not cloneable); btrfs and XFS were not exercised. Windows was not exercised.

Implemented and tested by Claude Sonnet 5.5 and Claude Opus 5.5 in Claude Code, running inside T3 Code. Reviewed by GPT-6 Astra over two rounds (findings fixed); the clone check was then reworked after Macroscope and CodeRabbit review.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
