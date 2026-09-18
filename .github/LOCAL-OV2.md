# Local Fork OV2 builds

`node .github/scripts/ov2-local-build.mjs build` fetches the current
`pingdotgg/t3code` branch `t3code/codex-turn-mapping`, then replays our ordered
`.github/downstream-nightly-v2.json` manifest in a fresh isolated clone. It supports
unpublished local commit pins and uses the hosted assembler's fingerprint and
version calculation. It never resets your checkout or silently drops a patch.

It produces an Apple Silicon desktop ZIP and matching server archive, using the
published **Fork** identity, repository `saphid/t3code`, and `nightly-v2` stream.
The selected patches include the accepted Nightly batch, OV2 voice, provider-start
recovery, OpenCode health recovery, and the release-test repairs. The manifest is
the list to change when selecting features. Ordinary Nightly features outside
that list still need a deliberate OV2 port.

Requirements: macOS Apple Silicon, Git, authenticated `gh`, Node 26, Vite+ `vp`,
and Rust if no matching resource-monitor cache is supplied. Allow about 8 GB for
build files, plus space for the installation's database backup. The installer uses
Python 3.11 or newer. Current local pins live in this machine's repository; they
must be pushed before another machine or GitHub can resolve them.

## Build or check

From this release-config checkout:

```sh
node .github/scripts/ov2-local-build.mjs build
```

The command prints the build directory. To reuse a resource-monitor binary from
a previous source checkout, add `--resource-monitor-from /path/to/source`. The
builder checks that its tracked native source matches before copying the binary.
Without the flag it builds the native helper.

```sh
node .github/scripts/ov2-local-build.mjs status --output /path/to/build
```

`current` compares the exact upstream commit with GitHub. `selectedPatchesCurrent`
compares the build's pins with our current manifest. A force-rebased upstream can
change commit IDs without adding features; inspect the tree diff when reviewing
changes. `plan.json` records every included patch; `build.json` records the final
source commit, version, and whether packaging finished. `SHA256SUMS` verifies the
artifacts. Names are descriptive; pins and fingerprints identify the actual code.

`assemble` performs only fetch and replay. `package --output /path/to/build`
continues an assembled directory. Packaging refuses changed source or an existing
artifacts directory. If cherry-picking conflicts, the clone and conflict remain
for inspection. Prepare a compatible patch, update its manifest pin, and run a
fresh build. Do not force the package step past a failed replay.

The build runs focused voice, recovery, update, Git, deep-link, and recent
upstream regression tests; web, server, desktop and contracts typechecks; desktop
packaging and signature checks; server packaging and an isolated server smoke
test. It does not run the whole repository suite or automatically drive the UI.

## Install on Alex's current Mac

The generated `install.command` is the recovery/manual route for the existing V2 setup on this Mac. Normal use is the graphical handoff prepared under `~/.t3-v2-desktop/setup/ov2-fork-handoff-20260918`, followed by in-app updates.
Its default preview is read-only:

```sh
python3 /path/to/build/install.py /path/to/build
```

1. Finish or stop every active T3 turn, including the thread preparing this build.
2. Quit T3 with Command-Q. Open the macOS Terminal application separately.
3. Run `/path/to/build/install.command`. Do not run it inside a T3 agent or terminal.
4. Wait for `Installed and verified`. The script prints its backup directory.
5. Open **Applications > T3 Code (V2 Preview)**. The shortcut keeps its old name,
   but now opens **T3 Code (Fork Nightly)** using the existing desktop settings.
6. Select the existing local environment on `127.0.0.1:3773`. If the new app asks
   to pair, run `~/.local/bin/t3 pair --base-dir ~/.t3` in Terminal and paste the
   displayed pairing URL into the app's connection flow.
7. In Settings, confirm the custom release source is `saphid/t3code` and the fork
   release is **Fork Nightly Orchestrator v2**. The desktop and server should show
   the version in `build.json`. Open a thread and send a small test prompt.
8. For voice, open Settings > Integrations, enter your OpenAI API key, save, and
   allow microphone access when asked. A real microphone session still needs this
   user check.

The installer refuses active turns and a running desktop. It verifies checksums,
backs up the live SQLite databases through SQLite's backup API, retains the old
runtime and Alpha app, installs the new runtime through T3's service installer,
updates `~/.local/bin/t3`, and repairs the existing Applications shortcut. The
shortcut no longer reinstalls a hard-coded old preview on every launch. The
server check verifies both its version and its original environment identity.
No live data is replaced by the test fixture.

If the installer refuses active turns, end those turns in T3 and retry. It does
not wait for its own thread to finish and does not silently interrupt work. If an
installation fails after staging, keep the printed backup and error. Do not
rerun over the staged files or erase them blindly.

## Roll back an installed build

Quit the desktop and end active turns first. Set `OV2_BACKUP` to the exact backup
folder printed by the installer, then run these commands in macOS Terminal:

```sh
OV2_BACKUP="$HOME/.local/share/t3-ov2-backups/REPLACE_WITH_PRINTED_TIMESTAMP"
launchctl bootout --wait "gui/$(id -u)/com.t3tools.t3code.service"
cp "$OV2_BACKUP/service.plist" "$HOME/Library/LaunchAgents/com.t3tools.t3code.service.plist"
cp "$OV2_BACKUP/service-state.json" "$HOME/.t3/runtime/service-state.json"
if test -f "$OV2_BACKUP/connection-catalog.json"; then
  cp "$OV2_BACKUP/connection-catalog.json" "$HOME/.t3-v2-desktop/userdata/connection-catalog.json"
fi
ln -sfn "$(cat "$OV2_BACKUP/cli-link.txt")" "$HOME/.local/bin/t3"
ditto "$OV2_BACKUP/T3 Code (V2 Preview).app" "/Applications/T3 Code (V2 Preview).app"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.t3tools.t3code.service.plist"
```

This restores the previous executables and launch configuration. It does not
rewind conversations. If a database migration prevents the old server starting,
stop it and restore the saved database only after deciding whether to discard
work created since the backup. Retain the newer database separately first.

## Hosted updates

A local build does not publish anything. The hourly workflow still needs the
selected patch commits available on GitHub and this manifest merged into
`saphid/t3code` main. Run `downstream-nightly-v2.yml` and wait for its full CI and
published assets. Until that happens, rebuild locally with this tool. Updating
the upstream project itself is separate, with one focused PR per suitable fix.

## Automatic builds and in-app updates

The OV2 workflow checks the upstream branch every five minutes through GitHub's
scheduler. GitHub may delay scheduled runs. An already published source and patch
fingerprint is skipped. Merging a selected-patch manifest change into fork `main`
starts the workflow immediately. PRs are selected by adding their pinned commit
series to the manifest; unrelated PRs are not included automatically.

The workflow runs the complete quality gate, builds both Mac architectures and the
Apple Silicon server archive, and publishes their updater manifests only after
success. The Fork OV2 desktop checks its feed at startup and every four minutes,
then offers the normal download and restart controls. Connected-server updates
use the matching archive through the existing Update server flow. Users do not
build releases or run terminal commands.

The earlier Alpha preview was intentionally packaged without an updater. It
needs a one-time migration into the Fork app identity. Once migrated, keep the
release source `saphid/t3code` and Fork Nightly Orchestrator v2 selected.

The graphical Alpha migration also converts the saved connection catalog into
the Fork app encryption identity. It verifies the source file has not changed,
keeps the original encrypted file in the installation backup, and replaces it
only after the old desktop is quit. Rollback must restore that catalog together
with the Alpha shortcut. Credentials are never written as plaintext.
