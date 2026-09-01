# SwiftUI delivery environment inventory

Captured 2026-08-22. This classification controls cleanup.

## Canonical source

The current T3 Code checkout owns the entire delivery package:

- `scripts/swiftui-delivery` contains the contract, validators, retained-build
  store, evidence renderer, tests, and reference documents.
- `.agents/skills` contains the four role skills plus the helper skills they
  use for Xcode hygiene, private video handoff, upstream contribution policy,
  and PR monitoring.
- `docs/operations` contains the human review plan and interactive explainer.

These are normal project files. They are not installed, copied, or symlinked
into user-level harness roots. A fresh checkout therefore gets one coherent
version, and deleting or switching the checkout cannot leave a different live
process behind.

## Protected external specialists

The delivery skills may invoke `swiftui-pro`, `swift-testing-pro`, and
`swift-concurrency-pro` by capability name when relevant. They are upstream
specialists. This package does not edit, vendor, pin, audit, or require a
particular filesystem copy of them. The T3-specific
`t3code-land-contribution` and `babysit-pr` skills are repository-owned so a
fresh checkout resolves every T3 workflow caller without a global bridge.

## Retired personal artifacts

Old personal orchestrators, dispatch daemons, deployment wrappers, label-board
auditors, and copied role skills are historical inputs only. They are not
runtime dependencies. Dated archives preserve source and Git state while
excluding reproducible caches. Global links for the four replacement role
skills are removed so discovery resolves only the project-local copy.

## Review hosting

The interactive explainer may be served from this checkout on loopback and
proxied over a Tailnet-only Tailscale Serve mapping. That temporary service is
review infrastructure, not a delivery dependency. Its owner, port, URL, and
cleanup command are recorded in the cutover document.
