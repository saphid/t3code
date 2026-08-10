# T3 Code Typed SwiftUI project boundary

This private repository is a standalone, full-history downstream of
[`pingdotgg/t3code`](https://github.com/pingdotgg/t3code). It owns the isolated
typed SwiftUI vertical-slice proof approved in
[`saphid/t3code-personal#28`](https://github.com/saphid/t3code-personal/issues/28).
Repository creation is tracked by
[`saphid/t3code-personal#36`](https://github.com/saphid/t3code-personal/issues/36).

The prototype is not implemented by the repository-creation change. The
official SwiftUI branch is imported as a source baseline, but this repository
has no started product runtime, installed app, release, Apple registration,
credential, deployment, or integration with the existing fleet and release
gates.

## Identity

- GitHub: `saphid/t3code-typed-swiftui`, private and standalone.
- Canonical clone: `/Users/saphid/Projects/T3 Code/t3code-typed-swiftui`.
- Initial upstream revision: `1a003e383ac6b10258b8100c2617d938c4f06c69`.
- Product branches: `typed-swiftui/<ticket-or-topic>`.
- Upstream import branches: `sync/upstream-YYYYMMDD-<short-sha>`.

The machine-readable namespace is
[`config/t3code-typed-swiftui/project-isolation.json`](../../config/t3code-typed-swiftui/project-isolation.json).
The identifiers there are reserved collision boundaries. They are wired into
the source build configuration but are not external registrations or shipping
configuration.

## App sandbox

The Electron and SwiftUI sources use identities owned only by this repository:

- Electron bundle IDs: `com.alxs.t3code.typed-swiftui.desktop` and its `.dev`
  variant.
- Electron URL schemes: `t3code-typed-swiftui-desktop` and its `-dev` variant.
- Electron backend state: `T3CodeTypedSwiftUI` below the platform application
  data directory; Electron user data uses `T3CodeTypedSwiftUIElectron` or
  `T3CodeTypedSwiftUIElectronDev`.
- SwiftUI bundle IDs: `com.alxs.t3code.typed-swiftui` and its `.dev` variant,
  with matching app-group, extension, URL-scheme, keychain, and on-disk cache
  namespaces.
- Desktop artifacts use the `T3-Code-Typed-SwiftUI-*` name and carry no GitHub
  update feed. Mock-update configuration remains available only for tests.

These source-level boundaries do not prescribe a persistent installation or
runtime for either app. Evidence-only launches must use disposable isolated
state and be cleaned up afterward. The existing T3 Code Electron and approved
SwiftUI apps keep their current identities, storage, runtime, checkout, and
automation. The sandbox clients use visibly distinct `T3 Typed Desktop` and
`T3 Typed SwiftUI` app names; product copy, layouts, and interactions are
otherwise the imported upstream baseline.

Inherited T3 operational and release documents are reference material only in
this experimental repository. Commands that register, sign, publish, install,
or launch upstream identities are not approved here. This project boundary and
the isolation manifest take precedence until a later ticket explicitly creates
the corresponding runtime and release lane.

Run the static guardrail and its focused tests with:

```sh
node scripts/verify-project-isolation.mjs --receipts
node --test scripts/verify-project-isolation.test.mjs
```

In the canonical clone, also verify the Git common directory and remote roles:

```sh
node scripts/verify-project-isolation.mjs --live --receipts
```

The canonical clone uses `.githooks/pre-push` to fail closed on direct pushes
to `main`. The desired GitHub-hosted ruleset is checked in at
`config/t3code-typed-swiftui/protected-main-ruleset.json`: it requires one
approval and resolved review threads, and rejects deletion and non-fast-forward
updates. GitHub returned HTTP 403 when repository creation attempted to apply
both native branch protection and this ruleset because the current account plan
does not include either feature for private repositories. Until that plan
boundary changes and the checked-in ruleset is applied, hosted enforcement is
an explicit open verification anomaly; the local hook is not represented as an
equivalent server-side control.

## Remote roles

`origin` is the only pushable product remote. `upstream` fetches
`pingdotgg/t3code`; `contrib` fetches the public `saphid/t3code` contribution
fork. The latter two remotes use the literal push URL `DISABLED`. Do not test
that policy by attempting a push.

No worktree for this project may share a Git common directory with
`t3code-personal`. New project worktrees belong below
`/Users/saphid/.t3/worktrees/t3code-typed-swiftui/`.

## Upstream sync

1. Fetch `upstream` without changing product refs.
2. Record the full target `upstream/main` SHA.
3. Create `sync/upstream-YYYYMMDD-<short-sha>` from current product `main`.
4. Merge the exact upstream SHA with an explicit merge commit. Never rebase or
   force-push published product history.
5. Add one JSON receipt under `docs/upstream-sync/receipts/`. A baseline receipt
   may use `mode: "baseline"` and `mergeCommit: null`; later imports use
   `mode: "merge"` and name the exact merge commit.
6. Open a draft pull request, run focused checks for the affected paths, obtain
   review, and merge manually only after the protected-main requirements pass.

Automation may fetch, test, and open a draft sync pull request. It may not
auto-merge, deploy, install, mutate Portfolio identity, or touch the existing
T3 Code Personal project, public contribution branches, SwiftUI work, fleet
configuration, release gates, apps, or runtimes.
