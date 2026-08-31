# Where everything lives

Canonical checkout: ~/projects/swiftui-delivery-canonical
Branch: t3code/swiftui-delivery-canonical, pushed to fork saphid/t3code.
Everything the pipeline needs travels with this repo; a new Mac needs only
a clone plus `scripts/swiftui-delivery/scripts/setup`.

## The four delivery skills (.agents/skills/)

- file-swiftui-lane-issue/ intake: idea/bug -> lane issue with work-item block
- swiftui-orchestrate/ coordinator: board, WIP/backlog, UAT threads, dispatch
- swiftui-feature-work/ one worker, one issue: implement + prove
- swiftui-deliver/ publication: Test/Dev generations, upstream PRs
  Supporting vendored skills: ios-build-hygiene/ (build isolation + simulator
  session cleanup), share-video-evidence/; product-owned: ios-debugger-agent,
  ios-simulator-browser, test-t3-app, test-t3-mobile.

## The runtime (scripts/swiftui-delivery/)

- contract.json ALL policy: stages, flowPolicy (WIP/backlog),
  testPublication (continuous, standing auth),
  uatThreads, phoneAcceptanceActors, repos, paths
- swiftui_delivery.py validator CLI: work items, catalogs, proofs,
  receipts, transitions, signing preflight,
  vouched handoff gate
- compose_generation.py deterministic build-source composer: a new detached
  Theo-base tree plus exact issue overlays and receipt
- status_report.py text/JSON board plus self-contained HTML kanban
  (scripts/status --html <path>)
- board_server.py serves that HTML kanban live on 127.0.0.1:4012
  (scripts/board; LaunchAgent
  com.saphid.t3-swiftui-delivery-dashboard, which
  resolves the checkout via the canonical pointer)
- controller.py quota-independent liveness trigger; reads status and
  sanitized headroom, selects an eligible model, and
  creates/wakes one model-bound coordinator thread
  through typed T3 commands (never a board item, never
  direct GitHub)
- issue_evidence.py validates proof, publishes media through GitHub's bearer
  attachment endpoint, preserves the work-item fence, and writes a receipt
- simulator_lane.py per-UDID leases; phone_lease.py; artifact_store.py;
  annotate_video.py; audit_package.py (+ audit_environment.py)
- package-manifest.json required-file list audit-package enforces
- tests/ the suite doctor runs (zero-test guard armed)

## Operator tools (scripts/swiftui-delivery/scripts/)

- setup environment readiness + canonical-checkout pointer (any Mac)
- doctor self-check: integrity, tests, skills, tools, watcher, board;
  exit 2 stops dispatch
- status every work item by stage, WIP occupancy, backlog, drift
- board serve the visual kanban board read-only (default port 4012)
- controller run/configure one deterministic coordinator liveness pass
- publish-issue-evidence upload validated proof and verify its issue embed
- swiftui-delivery / compose-generation / simulator-lane / phone-lease / audit-package /
  annotate-video / preserve-build

## Process references (scripts/swiftui-delivery/references/)

- process.md THE process: stages, checkpoints, flow control,
  continuous publication, UAT threads
- CONTRIBUTING_VOUCHED.md vendored authoritative contributor guide
- upstream-handoff.md the guide mapped to pipeline stages + 12-item gate
- conflict-resolution.md our-branches-freely / others-inviolable protocol
- evidence.md risk-tiered proof policy
- simulator-lanes.md lease discipline + session cleanup
- environment-inventory.md, video-edit-plan.example.json

## Phone push (scripts/swiftui-delivery/watcher/ = source of truth)

- phone-watch.py + com.saphid.t3-swiftui-phone-watch.plist
  Deployed at ~/.local/libexec/t3-swiftui-stream/phone-watch.py +
  ~/Library/LaunchAgents/ (doctor verifies byte parity + loaded state).
  Config: ~/.t3/swiftui-stream/watcher-config.json (deviceId, teamIdentifier).
  Pointer: ~/.t3/swiftui-stream/ready/test.json (atomic, flipped post-build).
  Device receipts: ~/.t3/swiftui-stream/device-receipts/.

## Front doors (front-doors/ = source; installed copies:)

~/.codex/skills/{swiftui-orchestrate,file-swiftui-lane-issue,swiftui-status}
with ~/.claude/skills symlinks. Resolution: pointer file -> fallback path ->
clone fork branch + setup.

## Mutable state (NOT in the repo)

- Board truth: GitHub issues saphid/t3code-personal (work-item blocks +
  lane labels); ledger/checkpoints: issue #104; UAT threads in T3 project
  c75be3a7-138b-4602-bcfb-d3c3c7955c05
- Builds: ~/.local/share/t3/swiftui-delivery/builds/<generation>/ (immutable)
- Runtime state/leases: ~/.local/state/t3/swiftui-delivery/
- Canonical-checkout pointer: ~/.local/state/t3/swiftui-delivery/canonical-checkout

## Adjacent but separate

- ios-build-hygiene source of record: personal-workspace repo
  (~/projects/Personal Workspace/personal-workspace/skills/ios-build-hygiene;
  vendored copy here is synced manually)
- t3-swiftui-signing global stopgap skill: ~/.codex/skills/t3-swiftui-signing
  (fold into references when convenient)
- Session-era audit archive: ~/.claude/memory-backups/20260825-full-export/
  (reviews, retro, handoff notes - history, not process)
