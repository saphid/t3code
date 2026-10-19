# Fork Nightly repair campaign - 2026-09-15

Status: paused mid-campaign. Resumed work should start from this file.

## Goal

Make the saphid/t3code Fork Nightly pipeline build the voice work again
(assemble + quality + publish), so the MacBook Pro gets updates through the
normal nightly feed.

## Already delivered (done, verified)

- Voice overlay work committed in `t3code-voice-repairs`
  (`agent/voice-repairs-integrated`): `1f55449b79` overlay redesign +
  `0ab8d76a74` test-environment fix.
- Manual release published so the MacBook is unblocked:
  `v0.0.41-nightly.20260915.1` on saphid/t3code (arm64 DMG/zip + blockmaps +
  nightly-mac.yml, ad-hoc signed, Fork bundle identity
  com.t3tools.t3code.fork-466f726b). Version is higher than the last GitHub
  nightly, so the updater will offer it. Verify after install by the new
  corner button, not the version string.

## Root causes found

1. The fork pipeline (`.github/workflows/downstream-nightly.yml` +
   `.github/downstream-nightly.json`) cherry-picks the patch stack onto the
   NEWEST upstream nightly on every run. Upstream shipped `.1735` (01:16Z)
   and `.1752` (~08:45Z) the same day; the old stack no longer applies, so
   "Assemble selected patches" fails. This was broken before this campaign.
2. The voice commits were never in the manifest, so even a green pipeline
   would not have included them.
3. Quality gate on `.1735` + refreshed stack failed deterministically
   (runs 34941019776, 34942212924, 34947116317): 4 web suites hang in React
   `act` with fake timers - CloudEnvironmentConnectList, DiffFileTree,
   useFileSaveCoordinator, PreviewView (15s timeouts). Local Mac reproduces
   them on the .1722 CI-green tree too, so local runs cannot discriminate.
   Leading hypothesis: older stack patches silently revert newer upstream
   code in auto-merged regions (confirmed concretely for the spend-dashboard
   patch over .1752, which reverts upstream's queued-turn-start reactor
   work). The manifest's "preserve/reconcile upstream seams" patch family
   exists to counter this and needs updating for .1735+ seams.

## State left behind

- Branch `oracle-voice-nightly-1735` on saphid/t3code: upstream `.1735`
  (b5b29e7b8b) + full stack with 4 conflict resolutions + 14 voice commits
  (tip 7df42c2889). Assembles clean against `.1735` only.
- `main` manifest (a37b40932..94022624d): 3 shas replaced with `.1735`
  refreshes + 14 voice entries appended. Assembles against `.1735`; breaks
  at patch 3 against `.1752` (upstream moved again).
- Local assembly sandbox (still on disk, resumable):
  `/var/folders/q_/t843n9r56p97tkk_q8t8wq3w0000gp/T/opencode/assemble/source`
  - mid-flight against `.1752` (50ff4c371e): 12 of 50 patches applied,
    conflicts resolved so far: refresh-context-handovers (ChatView ternary +
    threadCommands generateHandover into `commands` object), filter-sidebar
    (both describe blocks kept), recover-worktree-base (kept HEAD internals
    inside patch's Effect.gen/Effect.catch), navigation-history (mobile
    Stack/keyboard provider merged with palette feature), spend-dashboard
    CONFLICT UNRESOLVED PROPERLY - the patch reverts queued-turn-start
    reactor work; needs re-authoring against .1752, not a textual merge.
- The spend-dashboard patch (d3c2035d374) and possibly other older patches
  need real re-authoring against current upstream.

## Recommended next steps

1. Decide stack policy: either pin `upstream_tag` in scheduled runs and bump
   deliberately, or accept the refresh treadmill and re-author the heavy
   patches (spend dashboard, context handovers, navigation history) against
   the current upstream nightly.
2. Re-author/refresh the remaining patches against `.1752`, push a new stack
   branch, update manifest shas, dispatch
   `gh workflow run downstream-nightly.yml --ref main`.
3. Diagnose the 4 act-timeout suites only after the stack is re-authored;
   suspect silent reverts first. CI is the only ground truth (local Mac
   fails the CI-green tree too).
4. Cleanup: sandbox worktrees under
   `/var/folders/.../T/opencode/assemble/` (source, upstream-check,
   b-manifest), manifest clone at `.../T/opencode/manifest`.

Worked by opencode (enablers/xlarge).
