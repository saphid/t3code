# T3 Code whimsy guide

Use this guide when reviewing T3 Code for opportunities to add warmth, play,
character, or satisfying interaction. Read the repository's applicable agent
instructions first. This guide directs a design review; it does not authorize
implementation, browser control, deployment, or changes to other repositories.

The aim is a capable tool that feels thoughtfully made and pleasant to return
to. Whimsy can live in an icon, a phrase, a material, a sound, a gesture, or a
discovery. It need not move. Preserve speed, readable state, and user control.

## Review procedure

1. **Establish the target.** Record repository, revision, worktree, dirty files,
   clients present, and evidence method. Inspect existing styles, icons, motion,
   preferences, and shared components. Identify existing personality worth
   keeping. Completion: a source inventory and explicit scope, including any
   client that is absent or cannot be inspected.
2. **Walk the journeys below.** Trace each applicable journey to its components,
   event/state source, and other entry points. Record current behavior before
   inventing a treatment. Completion: every journey has an evidence-backed
   finding, a reason to leave it alone, or a documented coverage gap.
3. **Develop opportunities.** For each promising moment, describe the user's
   action, the real system state, and the proposed response. Choose a mechanism
   from the palette. Consult [Apple references](./whimsy-references.md) when
   selecting or explaining a mechanism. Completion: each candidate has enough
   detail to assess its usefulness, character, and cost.
4. **Challenge the candidates.** Compare a subtle treatment with a more
   expressive alternative. Consider the hundredth use, keyboard/touch use,
   reduced motion, large histories, reconnects, and background clients. Keep the
   smallest treatment that produces the intended feeling. Completion: each
   shortlisted candidate passes the quality checks or is explicitly deferred.
5. **Deliver a ranked review.** Use the report contract below. Recommend a
   coherent first batch and explain which areas should stay calm. Completion:
   the report covers the applicable journeys and surfaces, includes exact
   source evidence, and distinguishes proposals from verified behavior.

During a source-only review, label behavior as source-observed and experiential
claims as unverified. Browser or simulator execution requires the authorization
and skills specified by the repository. Never invent screenshots or claim a
runtime pass from source inspection.

## Design principles

### Tell the truth with personality

Use actual application state as the trigger. A received command, active turn,
saved checkpoint, passing test, and completed project are different events.
Give them different meanings. A model saying it finished is not proof that a
test passed. Preserve status text and recovery actions alongside any expression.
Unknown, offline, interrupted, and failed states must remain understandable.

### Put delight where the user already acts

Prefer feedback attached to selection, creation, movement, completion, and
discovery. Keep reading, typing, code, diffs, and terminals visually stable.
An embellishment must never delay access to the next action. If removing the
embellishment makes a task harder, it was carrying information; provide that
information accessibly in every presentation.

### Build a recognizable family

Start with existing icon geometry, typography, spacing, colors, and components.
Choose a small set of related metaphors. Reuse those meanings across surfaces.
Project identity can carry through an icon and accent without tinting every
panel. Introduce original artwork; Apple characters and assets are references,
not material to copy into T3.

### Reward attention without demanding it

Keep frequent actions subtle. Reserve larger celebrations for meaningful,
infrequent achievements chosen by the user. Optional discoveries may live in
About, credits, or a deliberate gesture. Essential controls stay discoverable.
Never hide authorization, recovery, or data-loss information behind a joke.

### Match emotion to consequence

Sound capable, direct, and warm. During permission requests, outages, conflicts,
quota exhaustion, and failed work, lead with the fact and next action. Put humor
in low-stakes moments where it cannot feel like blame or mockery. Do not turn
errors into a mascot performance or productivity into a streak obligation.

## Palette: ten mechanisms to look for

| Mechanism                  | Look for                                             | Possible T3 treatment                                                         | Limit                                                               |
| -------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Friendly character         | A meaningful readiness or waiting state              | A small original mark changes pose once when the state changes                | Explicit status remains; avoid judging the person                   |
| Playful physics            | An object changes location or organization           | A thread moves toward its archive destination and returns on restore          | Preserve immediate interaction and a reduced-motion equivalent      |
| Familiar objects           | An abstract artifact needs a recognizable identity   | A checkpoint resembles a bookmark; an artifact preview resembles its contents | Use metaphors consistently; avoid decorative textures behind text   |
| Tiny functional details    | An icon can explain the state itself                 | A connection symbol joins when connected                                      | Keep shape/text cues in addition to color                           |
| Sound and touch            | A meaningful event may happen away from visual focus | An optional quiet completion cue with a mobile haptic                         | Honor mute/preferences and prevent duplicate cues                   |
| Creative play              | A person is exploring or personalizing               | A useful example in an empty state or a project identity preview              | Keep experimentation reversible and off production actions          |
| Expression and celebration | A verified, infrequent milestone                     | A short acknowledgment of the first successful connection                     | Never celebrate every message or inferred success                   |
| Little worlds              | A project or environment needs a sense of place      | A restrained project illustration or optional static seasonal accent          | Keep the working canvas calm and legible                            |
| Personal identity          | Objects belong to different projects or people       | Coordinated icon, accent, and artifact cover                                  | Retain contrast and meaningful distinctions across themes           |
| Authorship and discovery   | There is a safe place for a deeper detail            | An original credits illustration or optional About interaction                | No secret networking, data collection, or hidden essential features |

These are hypotheses to test against the app, not a required feature list. An
excellent review may recommend leaving a surface unchanged.

## Journey coverage

| Journey             | Inspect both directions and surrounding states                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Connect and onboard | First launch, pairing, successful connection, reconnect, unavailable environment, expired pairing    |
| Choose a project    | List/search, project icon and settings, create/open, rename, switch, empty project                   |
| Organize threads    | New draft, first send, list/search, pin/unpin, archive/restore, snooze/wake where supported          |
| Compose             | Typing, attachments, paste, model/provider selection, queued send, keyboard shortcuts, cancel        |
| Run work            | Accepted, starting, working, waiting for input, interruption, failure, completion, resumed turn      |
| Inspect results     | Tool activity, reasoning, long messages, code blocks, copy, files, diffs, artifacts, terminal        |
| Save and recover    | Checkpoints, restoration, undo where supported, stale/conflicting state, destructive confirmation    |
| Configure           | Appearance, sound/motion preferences, providers, connections, keybindings, command palette           |
| Return later        | Background/foreground, another device, another environment, history replay, loading and empty states |
| Discover            | Help, About, credits, successful milestones, optional personal touches                               |

For each journey, check web/local hosting, web/remote hosting, Electron shell,
and React Native mobile where present. Trace shared behavior through
`packages/client-runtime` and wire state through `packages/contracts` as needed.
Check Settings, command palette, and keybindings when they expose the same
action. A separate native SwiftUI repository is a coverage boundary, not an
implicit extension of this review. Record it if relevant; follow its delivery
workflow only when work there is separately authorized.

Provider-dependent proposals need a decision for Codex, Claude, Cursor, Grok,
and OpenCode: common behavior, adapter difference, unsupported, or unverified.
Prefer existing shared state over parsing provider prose for a celebration.

## Quality checks for every shortlisted opportunity

- **Useful and honest:** What information, confidence, orientation, expression,
  or discoverable pleasure does it add? What exact event permits the response?
- **Frequency:** How often will a heavy user see it? What happens on replay,
  reconnect, virtualization/remount, rapid repeated action, and multiple clients?
- **Attention:** Is it confined to the affected object? Can work continue while
  it plays? What cancels or supersedes it?
- **Motion:** Reuse existing motion conventions. If proposing new timing,
  specify a bounded duration as a design hypothesis and verify it later.
  Decorative motion must settle. No continuously repainting decoration,
  perpetual breathing indicators, or animation on every streamed token.
- **Performance:** Identify the rendering scope and likely cost. Keep lists
  virtualizable and long transcripts stable. Suspend optional effects offscreen
  or in background. Explain any extra assets, timers, network traffic, or state;
  avoid backend events solely to animate a client.
- **Accessibility:** Specify reduced-motion behavior, keyboard and touch access,
  focus continuity, screen-reader semantics, zoom, contrast, and high-contrast
  appearance. Exclude decorative elements from announcements. Never convey
  success or failure solely through movement, color, sound, or a facial pose.
- **Preferences:** Respect platform and app motion/audio settings. Sound is
  opt-in; preserve silent use. Prefer existing settings to adding a new control
  for each decoration. A static treatment must still feel considered.
- **Internationalization:** Allow translated text and right-to-left layout.
  Avoid jokes that require an English idiom or a particular cultural reference.
- **Recovery:** Specify failure, cancellation, reverse action, and unknown state.
  Keep the user in control when the effect is interrupted halfway through.

## Report contract

Write a Markdown report at the path provided in the dispatch. Include:

1. Target revision, scope, method, and runtime verification limits.
2. Existing details to preserve, supported by source locations.
3. Journey/client coverage table: inspected, not applicable with reason, or gap.
4. Ranked opportunities with stable IDs and priorities: first batch, later, or
   exploratory. Rank by benefit, fit, exposure frequency, and implementation
   cost; explain the tradeoff rather than inventing a precise numerical score.
5. Full specifications for the strongest five opportunities (or all candidates
   if fewer survive). A wider inventory may use compact rows, but every
   recommendation needs an exact source location and concrete proposed behavior.
6. Rejected/deferred ideas and why, plus a cohesive first batch with dependencies
   and focused verification steps. Include a plain description of the overall
   visual and interaction character this batch would establish.

Use this template for each full specification:

```text
ID / title / priority:
Journey and clients / entry points:
Current behavior and source evidence (path:line, symbol, revision):
User need and intended feeling:
Mechanism / Apple reference (link, transferable lesson):
Proposed trigger and behavior (before -> interaction -> settled state):
Subtle alternative / expressive alternative / recommendation:
Frequency and replay/reconnect behavior:
Failure, interruption, reverse action, and unknown state:
Keyboard, touch, reduced motion, screen reader, contrast, audio:
Rendering scope / performance risk / state or contract dependencies:
Reuse and likely implementation scope:
Acceptance points and focused verification:
Evidence confidence / unresolved questions:
```

## Completion boundary

A review is complete when its coverage and evidence meet the report contract.
Do not manufacture findings to meet a quota. Report uninspected paths honestly.
Leave source implementation unchanged during a review; write only the agreed
report and authorized work-state updates. Implementation is a separate task.
