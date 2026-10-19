### Before submitting

- [x] I searched existing issues and did not find a duplicate.
- [x] I included enough detail to reproduce or investigate the problem.

### Area

apps/server

### Steps to reproduce

1. Run T3 Code as the background service (`t3 service install`) on a machine whose free disk space is smaller than the server database. In my case: `statev2.sqlite` was 32.8 GB and the volume had 24 GB free.
2. From a client, accept the prompt to update the server (`server.updateServerWithProgress`, `serverSelfUpdate: "boot-service"`).

### Expected behavior

The update is refused up front with a reason the client can show ("not enough free disk space to back up the database"), and the running server is left alone. Or the backup takes no extra space where the filesystem supports clones (APFS, btrfs, XFS).

### Actual behavior

The launcher stops the server first and only then runs `backupDatabaseOnce`, which copies the whole database with `fs.copyFile`. The copy fails for lack of space, the update is recorded as failed and rolled back, and the old server restarts cold. Every attempt is an outage plus a cold restart. With a large database the cold server then took long enough to answer that clients reconnect-looped for about 10 minutes.

Even with enough space, the full copy of a tens-of-GB database is slow and briefly needs double the space. On macOS, `fs.copyFile` with `COPYFILE_FICLONE` does not clone: it falls back to a full copy (1 GiB took 805 ms and consumed 1 GiB), and `COPYFILE_FICLONE_FORCE` fails with ENOSYS. `cp -c` clones on APFS (a 32 MiB copy changed free space by 176 KiB).

### Impact

Major degradation or frequent failure

### Version or commit

Seen on a 0.0.42 nightly build; the launcher code is unchanged on upstream/main @ 0cf482b08bc (`apps/server/src/serviceLauncher.ts`, `backupDatabaseOnce`, `#handleUpdateRequest`).

### Environment

macOS 26 (Darwin 25.5), APFS, background service via launchd, desktop client connected to the service.

### Logs or stack traces

`~/.t3/runtime/service-state.json` after the attempt:

```json
"status": "failed", "reason": "db-backup-failed"
```

### Workaround

Free disk space larger than the database before updating, or update with `t3 update <version>` from the CLI, which does not take the launcher's backup step.
