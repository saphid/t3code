# SwiftUI Test catalog proof audit

## Audit target

This catalog uplift is based directly on `origin/personal/swiftui-test` at full
commit `9d7b61c8e8085ff27c71459954c8c4ca4d763814`.

The catalog contains 15 records in the `in-test` state. All 15 records name
Test build 59. Product facts come from the named issues, source threads, source
commits, integration manifests, immutable feature receipts, and the app-flow
coverage catalog. The uplift does not create proof.

## Result

The catalog is not review-ready. The deterministic validator reports 15
blocking errors. Each error is a missing proof object for one item.

| Required field or evidence | Complete | Missing or invalid |
| --- | ---: | ---: |
| Test build 59 binding | 15 | 0 |
| Full 40-character source commit | 15 | 0 |
| Explicit integrated-commit chain | 15 | 0 |
| Unique positive review order | 15 | 0 |
| Behavior statement | 15 | 0 |
| Delivery classification | 15 | 0 |
| Explicit dependency list | 15 | 0 |
| User acceptance points | 15 | 0 |
| Commit- and build-bound proof packets | 0 | 15 |

Zero items can appear in the approval list. Zero items can reserve the next
Test build number.

## Item findings

`P` means that the proof object and proof packets are missing.

| Item | Blocking codes |
| --- | --- |
| `in-app-stream-approval-control` | P |
| `skill-popup-readability-and-height` | P |
| `skills-popup-keyboard-clearance` | P |
| `home-thread-list-scrolling` | P |
| `command-palette-top-drawer` | P |
| `development-build-source-thread` | P |
| `widget-build-channel-links` | P |
| `initial-thread-live-updates` | P |
| `pull-request-workspace-protocol` | P |
| `pull-request-inbox-summary-timeline` | P |
| `safe-tool-content-recovery` | P |
| `swiftui-test-personal-connect` | P |
| `cold-boot-home-list-scrolling` | P |
| `shared-electron-vscode-themes` | P |
| `app-flow-regression-tests` | P |

## Factual dependency and delivery decisions

- `pull-request-inbox-summary-timeline` depends on
  `pull-request-workspace-protocol`. Issue 94 and its immutable receipt define
  that sequence.
- `cold-boot-home-list-scrolling` depends on
  `home-thread-list-scrolling`. Issue 55 states this dependency.
- Shared acceptance surfaces do not create a dependency. The two Skills items
  and the three Home gesture items can be reviewed together but remain separate
  changes.
- `in-app-stream-approval-control`, `swiftui-test-personal-connect`, and
  `app-flow-regression-tests` are local-only. Their source material limits them
  to the personal workflow, private Tailnet, or personal regression harness.
- The other items are bounded direct changes. Existing source receipts, commit
  ranges, and upstream delivery records identify no feature dependency for
  those changes.

The catalog delivery value describes the current feature package. It does not
claim that an upstream pull request is ready or mergeable. The upstream handoff
must revalidate its exact base, dependencies, and PR delivery block.

The GitHub connector returned 404 for every private issue. The authenticated
read-only GitHub CLI returned the known issues. This access anomaly did not
become evidence that an issue was absent.

## Review-ready contract

Each pending item must identify the exact product claim and the exact evidence
for that claim. The catalog must contain:

1. A full source commit that resolves in Git.
2. A behavior statement.
3. A stable review order.
4. A delivery class and explicit feature dependencies.
5. One or more acceptance points with unique IDs and clear text.
6. A successful private-CI proof-build receipt for the exact final application
   revision. This build revision is separate from the feature's provenance
   commit.
7. A proof-media receipt for each proof packet.
8. A clean and annotated image pair, or a clean and annotated video pair.
9. A caption in each annotated proof. An annotated video must also show a tap
   or swipe.
10. Explicit acceptance-point IDs on each proof packet. Every acceptance point
    must have coverage.

The catalog stores the absolute receipt paths and their SHA-256 hashes. The
validator recalculates each receipt and artifact hash. It rejects a symbolic
link, missing file, changed file, wrong source commit, wrong build ID, failed
pipeline run, incomplete media pair, or uncovered acceptance point.

## Deterministic sequence for the next proof-complete Test build

1. Keep the audit source pinned to the full commit above.
2. At the exact source commit, run `candidate-verification` and
   `candidate-simulator`. For the combined train, also run `test-train`.
3. Keep the successful private-CI receipt. Record its absolute path, SHA-256
   hash, run ID, and source commit.
4. Capture each acceptance flow without overlays. Record a semantic event
   timeline for the taps, swipes, and expected results.
5. Use `prepare-proof-media` to create paired clean and annotated outputs.
   Inspect all outputs. Keep the proof-media receipt and its SHA-256 hash.
6. Run `prepare_proof_media.py validate-packet` with `--feature-id` and the
   successful final-head `--build-receipt`. This creates a sealed packet
   validation that binds the media to the Review Item, source revision, and
   private-CI run without hand-entering those values.
7. Use `assemble_review_proof.py assemble` to create a candidate catalog file.
   Bind each packet to its acceptance-point IDs. The assembler never edits the
   live catalog and never allocates a build number.
8. Run:

    ```sh
    scripts/swiftui-stream/stream.py review-readiness \
      --verify-files \
      --verify-commits
    ```

9. Continue only if the command exits with status 0.
10. Replace `stream.json` with the inspected assembler output. On a clean
    `personal/swiftui-test`, run `stream.py stage-test-build`. This
    is the first step that can reserve a new Test build number.
11. Review the catalog attribution diff. Commit only `stream.json` in the
    catalog commit.
12. Set `T3_SWIFT_BUILD_NUMBER` to the reserved number. Run the private
    pipeline through `test-catalog` and `test-phone-build`.
13. The Test build guard must pass before signing and before the ready pointer
    changes.
14. Let the deterministic phone watcher install and launch the exact ready
    build. Keep its installed-device receipt.
15. Run `approval-list`. It rechecks the proof hashes, source commits, Test
    build binding, ready pointer, and installed-device receipt.
16. Review each acceptance point on the phone. Record the human verdict for the
    exact item and Test build.

The current catalog fails step 8. Therefore this audit does not allocate,
sign, install, or approve a build.

## Reproduce the audit

```sh
scripts/swiftui-stream/stream.py review-readiness
```

The expected result is exit status 1, `reviewItemCount` 15, `errorCount` 15,
and `reviewReady` false.
