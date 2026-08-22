# Local SwiftUI archive manifest

Created 2026-08-22. Archive root:
`/Users/saphid/Archives/t3code-swiftui/2026-08-22`.

This pass is non-destructive for legacy project checkouts. Their originals
remain in place. The obsolete untracked delivery-package source was moved out
of Personal Workspace only after it was copied into this repository, tested,
zipped, and retained in the archive's `detached-personal-workspace-source`
recovery directory.

## Archive rules

Every project ZIP preserves source, project configuration, untracked files,
and lightweight Git control state. It excludes reproducible bulk:
`node_modules`, `.repos`, `.t3`, `artifacts`, `DerivedData`, `.derivedData`,
`.build`, `dist`, `out`, Git object/module stores, `xcuserdata`, and
`*.xcresult`. Each archive passed `unzip -t` and SHA-256 verification.

## Verified archives

| Original | Branch / state | ZIP bytes | SHA-256 |
|---|---|---:|---|
| `~/projects/T3 Code/t3code-swiftui` | `saphid-swiftui` @ `825710919`, clean | 116,697,089 | `e7efecb6ec8e45675d8efa03bc8a7a6889dbfad848c67d95f6063c6a86afeee5` |
| `~/projects/T3 Code/t3code-typed-swiftui` | `typed-swiftui/issue-36-app-sandbox` @ `95ff37132`, clean | 774,403,578 | `4f359ccc3b7414ab018dfaff4c2a934f4d619232c8a14660ea33020f4a5b74cc` |
| `~/projects/t3code-swift-approved` | `personal/swiftui-approved` @ `b3f003f51`, 2 tracked changes | 52,052,618 | `c0b541644f61e293b109c0ef37474de063490bde9467c2a88fdf57877b602173` |
| `~/projects/t3code-swift-dev` | `personal/swift-ios-dev-signing` @ `ce23ed2fe`, 4 tracked + 1 untracked | 51,742,614 | `da9683e175a40646919b136e1eb62fd8d45bc91f75b5633c4c62f88588769d8e` |
| `~/projects/t3code-swiftui-composer-polish` | `agent/swiftui-composer-polish` @ `4a562721c`, clean | 51,857,435 | `f2c15485b938d652896f1c8e5911cb4977006f79f0d0262b1308081a1f1b88b1` |
| `~/projects/t3code-swiftui-header-spacing` | `agent/swiftui-header-spacing` @ `fca9ced31`, clean | 51,843,599 | `6ac258bf80a098e82e872d6f1352d6385ae4742589e58ab2caca6003427078ed` |
| `~/projects/t3code-swiftui-project-picker-scroll` | `agent/swiftui-project-picker-scroll` @ `65e66ee51`, clean | 51,886,439 | `5940201b189d29d0ffc03304f29d9964d3e049fda1ccc8762b885ba0ae4e0315` |
| `~/.t3/worktrees/t3code-swiftui` | legacy multi-worktree root, 15 children | 780,859,255 | `8f3be055787cd25f0307c0a5189abc0c7aa93b4e4dede248f30e2e1dc7eadc2b` |
| `~/.t3/worktrees/swiftui-feature-fix` | legacy multi-worktree root, 5 children | 248,614,086 | `d43c2e56828f9af2457efde0a52201bf5054dbff60427eb4c2cefe11492ca6eb` |
| detached delivery package | superseded untracked source | 76,318 | `250dc3bbe92c823991e1ca23f12c1ed2996faa253bbc674345c4755d18ba5b93` |
| legacy Claude SwiftUI memory | historical instruction/reference docs | 51,383 | `7d6df8afaac2199225a3fe82401aecc3e0982f833e050fdf083cbbd4e13544c4` |

The ZIP filenames mirror the original paths and are under `projects/`, except
the final two small historical archives at the dated archive root.

## Intentionally not touched

- The current worktree and its parent repository.
- Shared/upstream `swiftui-pro`, `swift-testing-pro`,
  `swift-concurrency-pro`, `t3code`, `start-t3-issue`, and
  `t3code-land-contribution` skills.
- Other T3 Code projects that did not identify themselves as native SwiftUI
  delivery checkouts in the scoped inventory.

## Later cleanup

Review the dirty-source archives first. Removing an original checkout needs a
separate explicit approval, followed by another existence and Git-worktree
ownership check. Do not infer deletion authority from this manifest.
