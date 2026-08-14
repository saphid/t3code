# Private SwiftUI CI

This pipeline controls private work before an upstream branch or pull request
exists. It does not use GitHub Actions. GitHub Actions start only after the
upstream handoff.

## Authority

Buildkite schedules deterministic work on the private Mac agent. The scripts
own the policy. Fastlane is only a pinned command wrapper. An agent can start a
stage, read its receipt, and repair a failure. An agent does not poll a phone or
replace a human decision.

The Buildkite queue is `swiftui-private-mac`. Its first step installs the exact
Fastlane dependency graph from `Gemfile.lock`. The cache stays below
`~/.t3/cache/swiftui-private-ci`. It does not make the source tree dirty.
The wrapper disables Fastlane update checks, usage reports, and GitHub issue
lookups. It stores generated Fastlane reports outside the source tree.

The human acceptance block is an approval boundary. It does not create an
approval by itself. The existing SwiftUI approval workflow must record an exact
approval receipt for the installed Test build and its Candidate set.
Buildkite passes the block field `approval-receipt-reference` into the Dev
promotion command. The command rejects a blank reference. The stage receipt
retains that exact authority reference.

## Stage order

1. `candidate-verification` validates the stream and branch graph.
2. `candidate-simulator` runs the native test entry point.
3. `test-train` repeats the stream, branch, and native regression gates on the
   combined Test train.
4. `test-phone-build` creates the signed, immutable Test artifact and ready
   pointer.
5. `test-phone-install` runs the deterministic phone reconciler.
6. `human-acceptance` blocks until the exact installed Test receipt has a human
   verdict.
7. `dev-promotion` verifies the installed Test receipt, promotion queue, stream,
   and branch graph after the approved integration workflow updates Dev.
8. `dev-phone-build` creates the signed, immutable Dev artifact and ready
   pointer.
9. `dev-phone-install` runs the deterministic Dev phone reconciler.
10. `upstream-handoff` validates the stream, branch graph, and prepared pull
    request body. It does not push code or start GitHub Actions.

The Candidate-to-Dev integration remains in the existing approval workflow.
This CI layer does not implement a second merge policy. The `dev-promotion`
stage fails when the exact Test receipt, queue, stream, or branch graph is not
valid.

## Resource control

Buildkite sets one named concurrency group on each job. Each group has a limit
of one:

- `swiftui/native-build`;
- `swiftui/simulator`;
- `swiftui/signing`;
- `swiftui/test-phone`;
- `swiftui/dev-phone`.

Some stages use more than one resource. The command runner also takes local
file leases for every declared resource. It takes leases in sorted order. This
rule prevents a deadlock and protects local runs outside Buildkite.

## Local commands

Run a real stage with the Python command. The command returns the real exit
status from the first failed child command.

```sh
python3 scripts/swiftui-pipeline/pipeline.py run candidate-verification
```

Plan a stage without a build, signature, Simulator, or phone:

```sh
python3 scripts/swiftui-pipeline/pipeline.py run test-phone-build --dry-run
```

Use one fake command for a deterministic harness test:

```sh
python3 scripts/swiftui-pipeline/pipeline.py run test-train \
  --fake-command-json '["/usr/bin/true"]'
```

Validate a saved receipt:

```sh
python3 scripts/swiftui-pipeline/pipeline.py validate-receipt \
  .t3/swiftui-private-ci-artifacts/receipts/<run>/<stage>.json
```

The pinned Fastlane wrapper is also available:

```sh
scripts/swiftui-pipeline/fastlane.sh swiftui_candidate_verification
```

Set these variables for signed phone builds:

- `T3_SWIFT_DEVICE_ID`;
- `T3_SWIFT_DEVELOPMENT_TEAM`.

Set `T3_SWIFT_UPSTREAM_PR_BODY` and `T3_SWIFT_UPSTREAM_PR_NUMBER` for the
upstream handoff. The body must satisfy the existing delivery classification
contract.

## Receipts

Each stage writes one JSON receipt below
`.t3/swiftui-private-ci-artifacts/receipts/`. This directory is ignored by Git.
The receipt uses
`receipt.schema.json`. It records:

- the stage and run identity;
- the repository branch, commit, and dirty state;
- the declared resources;
- every command and its real exit status;
- separate stdout and stderr log paths;
- a SHA-256 hash and size for each retained artifact;
- whether the stage can cross the GitHub boundary.

A non-dry-run Dev promotion receipt also records the exact human approval
receipt reference from the Buildkite block.

The runner writes a failed receipt and preserves both logs when a child command
fails. It stops before later commands. A dry run writes a `planned` receipt and
does not run the planned command.

Buildkite uploads the receipt tree after each command step. Retention policy and
agent registration remain Buildkite administration tasks. Do not put signing
credentials in the pipeline file.
