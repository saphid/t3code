# Native SwiftUI delivery: clean cutover

Date: 2026-08-22
Branch: `t3code/simplify-swiftui-skills`

## Decision

The native SwiftUI delivery system is project-owned. Its source lives only in
this T3 Code checkout:

- `.agents/skills`: capture, orchestrate, feature work, deliver, Xcode hygiene,
  and private video handoff;
- `scripts/swiftui-delivery`: contract, validators, retained-build store,
  evidence editor/receipt tool, tests, and reference documents;
- `docs/operations`: this cutover record and the interactive explainer.

There is no runtime or discovery dependency on Personal Workspace, Portfolio
Control Plane, OpenCode, Gemini, or global copies of these role skills.

## What the Agent Operating Standard is

Alex's Agent Operating Standard is host-level session policy. It selects model
routing, review expectations, safety defaults, and evidence language across
many unrelated repositories. The harness may load it before this repository is
opened. That does not make it part of SwiftUI delivery.

This package does not import it, link to it, audit it, or wait for its health.
Repository `AGENTS.md` remains normal project governance. A failure or change
in the host-level policy cannot block a valid SwiftUI work item.

## Explicit exclusions

- OpenCode and Gemini are not workers, dispatch targets, install roots, or
  health checks for this process.
- Personal Workspace and Portfolio do not own, register, mirror, or gate it.
- No background dispatcher, label auditor, deployment daemon, or second state
  database is introduced.
- Protected upstream skills are invoked by capability name when applicable;
  their source is not copied or changed.

## The six project skills

| Responsibility | Skill | Boundary |
|---|---|---|
| Capture | `file-swiftui-lane-issue` | One issue and one lane membership |
| Coordinate | `swiftui-orchestrate` | Select, bind, babysit, and gate work |
| Build and prove | `swiftui-feature-work` | One isolated issue worktree |
| Deliver | `swiftui-deliver` | One prevalidated, authorized generation |
| Xcode hygiene | `ios-build-hygiene` | Isolated DerivedData and safe cleanup |
| Evidence handoff | `share-video-evidence` | Playable private video delivery |

The first four are the process roles. The final two are small project-local
helpers. They do not introduce additional workflow state.

## Evidence and phone gate

Every user-visible issue has exact-base before and exact-head after proof. Each
phase contains an image and an edited video, plus the raw video and edit
receipt. An agent visually reviews every capture and records expected behavior,
observed behavior, side effects checked, and a verdict.

No Test queue, phone build, publication lease, install, or deployment can begin
until the generation-plan validator reopens and passes the work item, proof,
edit receipts, inspection, dependency closure, and prior installed carry.

Retained `.app` bundles are content-addressed and kept in
`~/.local/share/t3/swiftui-delivery/builds`. This permits exact historical
reproduction without rebuilding when the stored tree and executable hashes
still match.

## Video tool decision

RocketSim is the preferred recorder/editor. Its free tier provides simulator
and physical-device capture, timeline trimming, touch trails, tap indicators,
pinch/rotate gestures, device bezels, and styled backgrounds. The project tool
can adopt a RocketSim export and create a hash-bound receipt without
re-encoding it.

The repository renderer remains the automation fallback. It now uses SF
Rounded, translucent dark cards, cyan gesture marks, rounded highlights, and
supports tap, long-press, swipe, pinch, and rotate overlays. It preserves the
raw file and records its exact FFmpeg/ImageMagick command.

RocketSim is not installed yet. The App Store package is ID `1504940162`; the
noninteractive `mas install` attempt stopped at the macOS administrator-password
boundary. No password was requested or captured and no purchase was made. The
repo renderer remains usable now, and RocketSim installation is a human step.

## Model and reviewer fallback

Implementation stays in the current capable session. A fresh independent
review uses this explicit order:

1. Claude Fable 5 high when its live lane has usable headroom;
2. Kimi 256k when callable directly;
3. Ox Alpha Free when callable directly;
4. a fresh GPT-5.6 Sol high session.

Alex explicitly supplied this fallback order for this cutover on 2026-08-22;
that user instruction overrides the older host-level reviewer default for this
work. This is reviewer routing only. It does not make any provider a SwiftUI
runtime dependency. Every review receipt records the launcher, actual model,
exit status, and findings. It never claims a model that did not run.

## Local archive policy

Legacy SwiftUI checkouts are preserved in a dated archive outside active
project discovery. Each ZIP excludes reproducible bulk (`node_modules`,
DerivedData, vendored `.repos`, build artifacts, and sandbox runtime data) but
includes source, configuration, Git metadata/state, and untracked work. The
archive manifest records original path, branch, dirty state, exclusions, ZIP
path, byte size, and SHA-256. Originals remain untouched in this pass.

The large set is intentionally archived in small batches because the machine
has limited free disk space. An archive is not considered valid until
`unzip -t` and SHA-256 both pass.

## Temporary explainer hosting

- Owner: this SwiftUI cutover review.
- LaunchAgent label: `com.saphid.swiftui-delivery-explainer-local`.
- Source: this checkout, served on loopback `127.0.0.1:8770`.
- Tailnet-only URL:
  `https://alexs-macbook-pro-1.tail4e5636.ts.net:8771/docs/operations/swiftui-delivery-system.html`.
- Tailscale mapping: HTTPS `8771` to `http://127.0.0.1:8770`.
- Cleanup after review: boot out that exact LaunchAgent label, then remove only
  the exact `8771` Tailscale Serve mapping.

## Remaining gaps

1. Run one disposable issue from capture through simulator proof and stop
   before phone installation. This validates ergonomics, not just schemas.
2. Decide how the tool should attest that the prior Test receipt is the build
   currently installed on the physical phone. Today it validates the receipt,
   not independent device state.
3. Decide retention limits for old content-addressed builds based on measured
   disk growth. Do not invent automatic deletion before real usage data.
4. Validate RocketSim styling on a representative tap, swipe, and pinch video;
   keep the repo renderer only if the exported result and receipt are clean.
5. After the archive review window, separately approve removal of superseded
   source directories. The present cutover does not delete them.
6. Human review of the phone-accessible explainer is still required before
   merge or PR work.

## Focused checks

```sh
python3 -m unittest discover -s scripts/swiftui-delivery/tests -p 'test_*.py'
python3 -m unittest discover -s .agents/skills/ios-build-hygiene/tests -p 'test_*.py'
scripts/swiftui-delivery/scripts/audit-package
python3 scripts/swiftui-delivery/audit_environment.py
```

Use the system `skill-creator` validator against each project skill before the
cutover is accepted. No repo-wide T3 test suite is required for these isolated
process files.
