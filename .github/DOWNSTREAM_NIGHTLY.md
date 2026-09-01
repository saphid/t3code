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

## Point the app at the fork

Select the Nightly update track and set Custom release source to `saphid/t3code`. Fork-built installers also embed `saphid/t3code` as their default update repository, so later updates stay on the fork even when the custom field is empty.

## Fork setup

The workflow uses GitHub-hosted runners and the repository `GITHUB_TOKEN`. It publishes desktop assets only. It does not publish the `t3` CLI package to npm, deploy the web app, or update AUR.

When Apple signing settings are absent, macOS artifacts receive a valid ad hoc signature and Windows artifacts remain unsigned. For normal signed macOS and Windows auto-updates, configure the same signing secret and variable names used by the upstream release workflow. A custom build signed by a different identity cannot replace an installed upstream-signed app through the normal updater. Install the first fork build manually, then keep the fork signing identity stable.

The generated source is pushed to `automation/downstream-nightly`. The GitHub release points at that exact commit and its body records the upstream tag, resolved patch SHAs, and stack fingerprint.

Fork artifacts set `T3CODE_DESKTOP_DISTRIBUTION=Fork`. This gives them the product name
`T3 Code (Fork Nightly)`, bundle ID `com.t3tools.t3code.fork-466f726b`, and updater cache package
name `t3code-fork-466f726b`. The encoded suffix prevents distinct distribution labels from sharing
an update identity. The macOS build job extracts every update archive and verifies those values plus
the code signature before uploading it. Keep this distribution name stable and never rename the
installed `.app` bundle.
