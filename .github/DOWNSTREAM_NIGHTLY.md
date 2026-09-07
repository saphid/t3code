# Fork Nightly releases

`downstream-nightly.yml` checks for a new `pingdotgg/t3code` Nightly release every five minutes. It starts from that exact release tag, applies the ordered entries in `downstream-nightly.json`, builds desktop installers, and publishes a prerelease in `saphid/t3code`.

The generated version keeps the upstream Nightly date and serial, then adds a deterministic numeric suffix derived from the resolved patch stack. This makes the fork build newer than the matching upstream build while preserving the Nightly version format expected by the desktop updater.

## Change the patch stack

Edit `.github/downstream-nightly.json`. Entries run in file order.

- `pull_request` requires the base repository, PR number, and exact reviewed `headSha`.
- `commit` requires its repository and full SHA.
- `ref` requires its repository, ref name, and exact `expectedSha`.

PR heads and refs are pinned on purpose. If one moves, the workflow stops before running patch code with release credentials. Review the new head, update the manifest, and merge that manifest change to build it.

If a selected commit is already part of the upstream Nightly, the assembler skips it. A real cherry-pick conflict stops the release and leaves the previous fork Nightly available.

Normal scheduled and dispatch-triggered runs are idempotent. To repair artifacts without changing the upstream tag or patch stack, run the workflow manually with `force_rebuild` enabled. The workflow rebuilds every gate and replaces the matching release assets.

Fork Nightly currently publishes macOS arm64 and macOS x64 artifacts only. The Linux, Windows, and WSL platform-specific steps remain available for later restoration, but they are not on the current release path. A release is complete when its merged macOS updater manifest is present.

## Point the app at the fork

Select the Nightly update track and set Custom release source to `saphid/t3code`. Fork-built installers also embed `saphid/t3code` as their default update repository, so later updates stay on the fork even when the custom field is empty.

## Fork setup

The workflow uses GitHub-hosted runners and the repository `GITHUB_TOKEN`. It publishes desktop assets only. It does not publish the `t3` CLI package to npm, deploy the web app, or update AUR.

When Apple signing settings are absent, macOS artifacts receive a valid ad hoc signature with a stable designated requirement based on the fork bundle identifier. That lets Squirrel.Mac validate one credential-free fork build against the next. Windows artifacts remain unsigned. For normal Developer ID-signed macOS and signed Windows auto-updates, configure the same signing secret and variable names used by the upstream release workflow. A custom build signed by a different identity cannot replace an installed upstream-signed app through the normal updater. Install the first fork build manually, then keep the fork bundle identifier and signing identity stable.

The generated source is pushed to `automation/downstream-nightly`. The GitHub release points at that exact commit and its body records the upstream tag, resolved patch SHAs, and stack fingerprint.

Fork artifacts set `T3CODE_DESKTOP_DISTRIBUTION=Fork`. This gives them the product name
`T3 Code (Fork Nightly)`, bundle ID `com.t3tools.t3code.fork-466f726b`, and updater cache package
name `t3code-fork-466f726b`. The encoded suffix prevents distinct distribution labels from sharing
an update identity. The macOS build job extracts every update archive and verifies those values plus
the code signature before uploading it. Keep this distribution name stable and never rename the
installed `.app` bundle.

## Orchestrator v2 stream

`downstream-nightly-v2.yml` checks the upstream `t3code/codex-turn-mapping` branch
hourly and calls the shared desktop build workflow. It resolves the branch to one
exact commit before checkout. It builds only when that commit or its own selected
patches change; manual `force_rebuild` repairs an existing release.

Edit `.github/downstream-nightly-v2.json` to change **only the v2** PR/commit list.
The existing `.github/downstream-nightly.json` continues to own Fork Nightly's list.
Both support pinned PR heads, individual commits, and pinned refs. V2 initially
includes only the fork updater patches. Do not copy the normal stack into v2
without checking compatibility.

V2 publishes `v<version>-nightly-v2.<date>.<serial>` releases with
`nightly-v2-mac.yml`, and pushes source to `automation/downstream-nightly-v2`.
The source commit and separate patch fingerprint appear in each release's notes.
The desktop build keeps the `Fork` distribution identity used by regular Fork
Nightly so the updater can switch between channels. The release names and version
suffixes distinguish them; neither stream overwrites the other's tags or manifests.

In Settings → About, choose Custom, enter `saphid/t3code`, then select
**Fork Nightly** or **Fork Nightly Orchestrator v2** under **Fork release**.
The selected channel is persisted with the repository. The updater filters by the
channel's prerelease identifier and rejects an offered version from the other
stream. Remote servers and phone apps are separate installations.
