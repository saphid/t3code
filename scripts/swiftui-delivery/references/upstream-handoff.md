# Upstream handoff: vouched contributor requirements

The authoritative source is `CONTRIBUTING_VOUCHED.md`, vendored beside this
file (references/CONTRIBUTING_VOUCHED.md, captured from branch
`t3code/create-vouched-contributing-guide`; prefer the product repository
root copy once it lands upstream). This file
maps its requirements onto pipeline stages; where the guide and this summary
disagree, the guide wins.

## At intake (`file-swiftui-lane-issue`)

- State the problem in user terms: the triggering action, what happens now,
  what should happen instead. Acceptance points derive from this.
- Record an affected-surface map: entry points (chat, Settings, command
  palette, keybindings), clients (web, desktop, mobile), providers (Codex,
  Claude, Cursor, Grok, OpenCode), contracts/server/projections/runtime,
  connection modes (local, remote, relay, tunnel), and the reverse action
  plus success/failure/stale/partial states. Most items touch only a few —
  name which, and name unsupported paths.

## During implementation (`swiftui-feature-work`)

- For a bug, find the cause before choosing the patch. Fix the source of
  incorrect state, never a downstream display patch, when the server,
  decider, projector, or contract owns the truth.
- Reuse the service, contract, schema, helper, component, token, or platform
  convention that already owns the behavior. Keep provider and platform
  differences at adapter boundaries.
- Represent meaningful states in types or schemas, not strings or timing.
  Bound subprocesses, requests, retries, buffers, rendering, and cleanup.
- Performance is correctness: check websocket volume, repeated
  serialization, render-triggered effects, polling, and work that scales
  with thread history; test with realistic data for long threads and remote
  connections.
- Choose the smallest coherent PR; strip adjacent cleanup, speculative
  generalization, and unrelated dependency or formatting changes.

## At proof (`swiftui-feature-work` / `swiftui-deliver`)

- Match proof to risk per the guide's table. Native work needs focused tests
  and static checks plus the affected simulator or device; shared behavior
  needs an explicit client/provider/platform/connection matrix with
  unsupported paths named.
- Focused checks only: `vp test run <files>` plus targeted lint/format/type
  for changed code. No repository-wide checks by default.
- Platform claims need platform proof; a shared TypeScript build proves no
  platform. Isolated T3 state for integrated checks; confirm environment and
  version match.
- Never make a passing test depend on a sleep or polling interval; wait on
  receipts and worker drains.
- The primary agent asks before launching browsers, computer use, or a dev
  server; subagents never launch their own dev servers.
- Record exact commands and results. A skipped check, authorization gate, or
  partial scan is not a pass — say what was not exercised.

## At PR time (`swiftui-deliver`, open-pr mode)

Evidence format:

- Full-size before and after images under SEPARATE headings — never narrow
  side-by-side tables. Light and dark when appearance can differ. Platform
  chrome and nearby layout when relevant. Video for motion, scrolling,
  focus, timing, or gestures.
- For a port of a web or React Native feature, the description also shows
  the source versions — full-size web and React Native captures under
  separate headings — so the PR compares the web original, the React Native
  app, and the SwiftUI result.
- Show loading, empty, stale, error, disabled, retry, and reconnecting
  states when affected.
- Upload evidence to GitHub; never commit PR-only screenshots, videos, or
  research artifacts.

Description (keep current with the head at all times):

1. what users observed and how to reproduce; 2. the cause; 3. what changed
   and why this boundary; 4. what is intentionally unchanged or deferred;
2. affected clients/providers/platforms/contracts/connection modes;
3. exact validation commands and results; 7. known risks and anything not
   tested; 8. before/after evidence (+ video for interaction); 9. the owning
   issue, discussion, or stacked PR. No internal Discord links or routing
   details. Confirm co-authorship before crediting.

Branch hygiene before requesting review:

- Rebase or otherwise resolve conflicts against the current target; rerun
  affected checks after conflict resolution; remove temporary plans,
  research notes, debug output, and accidental generated changes; explain
  stacked-PR dependencies; enable maintainer edits on the fork PR (if that
  is impossible, be ready to cherry-pick a requested maintainer commit);
  keep the title and description describing the current head. Use the PR
  template and remove stale generated recaps. Capture the running product,
  never a mockup or a manually recreated state.

Review response:

- Check every human and automated finding against the current source. Each
  gets exactly one of: fixed (name commit and focused test), intentional
  (with source or product evidence), or follow-up (clearly named, out of
  agreed scope). Never broaden the PR because a reviewer mentioned nearby
  work; never resolve a thread because the line moved; bot approval and
  green CI are not human approval. On material change: update description,
  rerun affected proof, re-request review on the current head.

## Gate

`accepted -> pr-open` additionally requires the guide's final handoff
checklist to pass, recorded in the open-pr generation receipt as
`vouchedHandoffChecklist: "pass"` with any stated gaps in
`vouchedHandoffGaps` (enforced by `validate-generation-receipt`). The
twelve items, restated so this package stands alone:

1. one clear problem, no unrelated work; 2. description explains observed
   problem, cause, change, and non-goals; 3. existing ownership boundaries and
   shared components reused; 4. affected clients/providers/platforms/
   contracts/connection modes named; 5. focused tests cover behavior and
   failure paths where automated coverage adds value, otherwise direct proof
   recorded; 6. targeted lint/format/type/build checks pass where applicable;
2. runtime, platform, and performance claims have direct evidence; 8. UI
   changes have real before/after images, video when needed; 9. missing proof
   and known limitations stated plainly; 10. branch current, mergeable, free
   of temporary or unrelated files; 11. description and review replies match
   the current head; 12. a human can tell whether the PR is ready without
   repeating the investigation.
