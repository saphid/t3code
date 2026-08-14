# SwiftUI Test catalog proof audit

## Audit target

This audit uses `origin/personal/swiftui-test` at full commit
`56ca5318a1d50c364dce6f22d8f908130b8009d2`.

The catalog contains 15 records in the `in-test` state. All 15 records name
Test build 59. The audit did not infer or create missing product details. The
feature owner or source thread must supply them.

## Result

The catalog is not review-ready. The deterministic validator reports 75
blocking errors.

| Required field or evidence | Complete | Missing or invalid |
| --- | ---: | ---: |
| Test build 59 binding | 15 | 0 |
| Full 40-character source commit | 8 | 7 |
| Unique positive review order | 14 | 1 |
| Behavior statement | 1 | 14 |
| Delivery classification | 6 | 9 |
| Explicit dependency list | 1 | 14 |
| User acceptance points | 0 | 15 |
| Commit- and build-bound proof packets | 0 | 15 |

Zero items can appear in the approval list. Zero items can reserve the next
Test build number.

## Item findings

The codes in this table have these meanings:

- `C`: source commit is abbreviated;
- `O`: review order is missing;
- `B`: behavior statement is missing;
- `D`: delivery classification is missing;
- `N`: explicit dependency list is missing;
- `A`: user acceptance points are missing;
- `P`: proof object and proof packets are missing.

| Item | Blocking codes |
| --- | --- |
| `in-app-stream-approval-control` | B, D, N, A, P |
| `skill-popup-readability-and-height` | N, A, P |
| `skills-popup-keyboard-clearance` | C, B, N, A, P |
| `home-thread-list-scrolling` | C, B, D, N, A, P |
| `command-palette-top-drawer` | C, B, D, N, A, P |
| `development-build-source-thread` | C, B, D, N, A, P |
| `widget-build-channel-links` | B, D, N, A, P |
| `initial-thread-live-updates` | C, B, D, N, A, P |
| `pull-request-workspace-protocol` | C, B, D, N, A, P |
| `pull-request-inbox-summary-timeline` | B, A, P |
| `safe-tool-content-recovery` | C, B, D, N, A, P |
| `swiftui-test-personal-connect` | B, N, A, P |
| `cold-boot-home-list-scrolling` | B, N, A, P |
| `shared-electron-vscode-themes` | B, N, A, P |
| `app-flow-regression-tests` | O, B, N, A, P |

## Review-ready contract

Each pending item must identify the exact product claim and the exact evidence
for that claim. The catalog must contain:

1. A full source commit that resolves in Git.
2. A behavior statement.
3. A stable review order.
4. A delivery class and explicit feature dependencies.
5. One or more acceptance points with unique IDs and clear text.
6. A successful private-CI proof-build receipt for the same source commit.
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
2. Resolve each abbreviated source commit to the exact full commit.
3. Add the missing behavior, order, delivery class, and explicit dependency
   list. Use an empty dependency list when the item has no dependency.
4. Add clear user acceptance points. Do not use a general feature title as the
   only acceptance point.
5. At the exact source commit, run `candidate-verification` and
   `candidate-simulator`. For the combined train, also run `test-train`.
6. Keep the successful private-CI receipt. Record its absolute path, SHA-256
   hash, run ID, and source commit.
7. Capture each acceptance flow without overlays. Record a semantic event
   timeline for the taps, swipes, and expected results.
8. Use `prepare-proof-media` to create paired clean and annotated outputs.
   Inspect all outputs. Keep the proof-media receipt and its SHA-256 hash.
9. Add the proof object to each item. Bind each packet to its acceptance-point
   IDs. Bind the proof to the exact private-CI run ID and source commit.
10. Run:

    ```sh
    scripts/swiftui-stream/stream.py review-readiness \
      --verify-files \
      --verify-commits
    ```

11. Continue only if the command exits with status 0.
12. On a clean `personal/swiftui-test`, run `stream.py stage-test-build`. This
    is the first step that can reserve a new Test build number.
13. Review the catalog attribution diff. Commit only `stream.json` in the
    catalog commit.
14. Set `T3_SWIFT_BUILD_NUMBER` to the reserved number. Run the private
    pipeline through `test-catalog` and `test-phone-build`.
15. The Test build guard must pass before signing and before the ready pointer
    changes.
16. Let the deterministic phone watcher install and launch the exact ready
    build. Keep its installed-device receipt.
17. Run `approval-list`. It rechecks the proof hashes, source commits, Test
    build binding, ready pointer, and installed-device receipt.
18. Review each acceptance point on the phone. Record the human verdict for the
    exact item and Test build.

The current catalog fails step 10. Therefore this audit does not allocate,
sign, install, or approve a build.

## Reproduce the audit

Extract `scripts/swiftui-stream/stream.json` from the pinned commit. Then run:

```sh
scripts/swiftui-stream/stream.py review-readiness \
  --manifest <path-to-extracted-stream.json>
```

The expected result is exit status 1, `reviewItemCount` 15, `errorCount` 75,
and `reviewReady` false.
