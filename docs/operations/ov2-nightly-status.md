# Nightly features in OV2

Run from the repository:

```sh
node scripts/ov2-nightly-status.mjs
```

The script reads the installed V2 Preview's packaged version and source commit
from `~/.local/share/t3-v2-desktop/T3 Code (Alpha).app`. It compares that exact
commit with `.github/downstream-nightly.json` at `origin/main`. It does not use
the current checkout or the latest V2 branch as a substitute for the installed
build.

The report lists each Nightly patch under **Detected in build history** or
**Not detected, port or review needed**. It compares both original commits and
stable patch IDs, so unchanged cherry-picks and rebases count even when their
commit hashes differ. Names come from the manifest or original commit subject.
Counts include feature fixes, tests, and historical build compatibility patches.

This detects replay history. A port that rewrites or combines patches needs
manual review. A detected patch might have been changed or reverted later.
The report does not prove runtime behavior or include uncommitted changes.

The default command works offline using local Git objects. Refresh the Nightly
manifest before comparing with the current configured stack:

```sh
node scripts/ov2-nightly-status.mjs --refresh
```

That fetches fork `origin/main`; it does not switch branches, change application
files, or replay patches. Missing source objects cause an error rather than a
false absence report. Fetch missing pins from their reported repository.

To inspect a port in progress, a different installed app, or save JSON:

```sh
node scripts/ov2-nightly-status.mjs --target sandbox/orchestrator-v2
node scripts/ov2-nightly-status.mjs --app '/path/to/T3 Code.app'
node scripts/ov2-nightly-status.mjs --json > /tmp/ov2-nightly-status.json
```

`--target` compares committed source; it does not imply that source is installed.
Use `--nightly-ref <ref>` to select a historical manifest and `--repo <path>`
to use another checkout. Node and Git are required. App inspection also requires
the repository's existing `@electron/asar` dependency, installed by `vp i`.
Commit and ref manifest entries are supported. A future pull-request entry
requires resolving its full commit series, so the script rejects it explicitly.
