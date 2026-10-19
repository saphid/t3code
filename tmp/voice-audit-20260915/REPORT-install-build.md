# Fork Nightly install build: mac arm64 DMG from verified HEAD

Built by opencode (enablers/xlarge, glm-5.3-flash) from
`/Users/aus-m5p-as/projects/t3code-voice-repairs` at exactly the verified
integration HEAD. No source edits, no launch, no install; the artifact is
for the parent to stage-replace the existing install.

## Commit packaged

`2eed523ea6` fix(voice): record the real flat clickControl outcome in
session history (worktree clean at build time; the 10-commit integrated
series on `agent/voice-repairs-integrated`, base `194db89fe5`).

## Command

```sh
export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:/opt/homebrew/bin:$PATH"
T3CODE_DESKTOP_DISTRIBUTION="Fork" \
T3CODE_DESKTOP_STABLE_MAC_ADHOC_SIGNATURE=true \
T3CODE_MACOS_STABLE_ADHOC_BUNDLE_ID=com.t3tools.t3code.fork-466f726b \
T3CODE_DESKTOP_UPDATE_REPOSITORY=saphid/t3code \
node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64
```

Rust/Cargo were present but off PATH (rustup-managed toolchain under
`~/.rustup/toolchains/stable-aarch64-apple-darwin`, target
`aarch64-apple-darwin` already installed); exporting the toolchain bin dir
cleared the preflight. Build completed in about 2 minutes.

## Exact artifact paths (gitignored `release/` in this worktree)

- `/Users/aus-m5p-as/projects/t3code-voice-repairs/release/T3-Code-0.0.41-nightly.20260914.1722956577-arm64.dmg`
- `/Users/aus-m5p-as/projects/t3code-voice-repairs/release/T3-Code-0.0.41-nightly.20260914.1722956577-arm64.zip`
  (updater payload) plus `.blockmap` files, `nightly-mac.yml`, `builder-debug.yml`

SHA-256:

```
7edee2da679d84b3ac967cb8bea78c7135d70638561be565418ad523017fe1b3  ...arm64.dmg
a3256a675f485ead3076d2d75f755d60bfa06b4711b707dbafb78bb9132789db  ...arm64.zip
```

## Identity and signature validation (mounted read-only, then ejected)

- App bundle: `T3 Code (Fork Nightly).app`
- `CFBundleIdentifier`: `com.t3tools.t3code.fork-466f726b` (exact Fork
  distribution identity; "Fork" hex slug `466f726b`)
- `CFBundleShortVersionString`: `0.0.41-nightly.20260914.1722956577`
  (existing nightly version preserved; series and update channel unchanged)
- `codesign -dv`: `Signature=adhoc`, `TeamIdentifier=not set`,
  designated requirement `identifier "com.t3tools.t3code.fork-466f726b"` -
  identical to the installed app's preflight, so the staged replacement
  keeps the same code-signing identity
- `codesign --verify --deep --strict`: PASS (hardened runtime disabled, as
  the tooling does for ad hoc identities)
- `Contents/Resources/app-update.yml` matches the installed bundle's feed
  exactly: owner `saphid`, repo `t3code`, provider `github`, releaseType
  `prerelease`, channel `nightly`, updaterCacheDirName
  `t3code-fork-466f726b-updater`
- `nightly-mac.yml` lists version `0.0.41-nightly.20260914.1722956577` with
  sha512 entries for the zip and dmg (update-manifest shape intact)

## Content verification

The packaged renderer bundle (`Contents/Resources/app.asar`) contains the
integrated change markers (`"now reads"`, `"surrounding context changed"`
from the controls context/revalidation fix), and does NOT contain
test-only or fixture-only strings (`"Phase 3.2"`, `"fixture-session"`), so
the DMG carries the product code of HEAD without test/fixture material.

## Notes and boundaries

- Same version string as the currently installed Fork Nightly by design:
  the parent installs by staged replacement, not by update feed, so no
  version bump was needed; the updater feed and channel remain untouched.
- Signing is ad hoc (no Developer ID secrets present in this environment);
  the custom `scripts/sign-macos.ts` hook pinned the designated requirement
  to the Fork bundle identifier via `T3CODE_MACOS_STABLE_ADHOC_BUNDLE_ID`.
- Nothing was launched, installed, or replaced; live userdata untouched;
  the build output lives entirely under the worktree's gitignored
  `release/`.

## Installation by primary

User authorized updating Fork Nightly and asking them to restart. Extracted the verified ZIP under `/Applications/.t3-voice-update-2eed523ea6`, checked identity and identical updater configuration against the installed bundle, and verified its deep strict code signature. Renamed the previous bundle into `/Applications/.t3-backup-before-voice-2eed523ea6/T3 Code (Fork Nightly).app`, then moved the staged app to `/Applications/T3 Code (Fork Nightly).app`. Installed signature verification passed. No app quit or launch, and no live userdata writes. User restart required to load this build.

Installed app.asar SHA-256: `e65b8baacc5d0e5446af364565e7c133fb298a0169a47e163bfe2b07aba11245`. Previous app.asar SHA-256: `bf54fa9eb52541c67a9ce9af11c0497ac87205066256df9558293b6f6bb28509`. This is a local installation; no remote release or nightly manifest activation was performed.
