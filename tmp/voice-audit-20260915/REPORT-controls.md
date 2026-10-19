# Voice UI controls: discover and click any interface button

Thread: voice-ui-controls (worktree `~/projects/t3code-voice-ui-controls`, branch `agent/voice-ui-controls`)
Base: 194db89fe5 (shipped fork voice build; intentionally not upstream)
Final commit: **23959ff632** `feat(voice): discover and activate the attached UI's controls`

## What was built

Voice could navigate, read, and start work, but could not press any of the interface's own
buttons. Two new client-local voice tools close that gap with a generic visible-control
mechanism, no per-button switch registry:

- `voice.listControls`: enumerates the attached window's activatable controls (button, link,
  menuitem, menuitemcheckbox, menuitemradio, tab, switch, checkbox, radio, option) with stable
  opaque per-element ids, accessible name, role, state (`enabled`/`disabled`/`hidden`),
  occurrence, and an `ambiguous` flag for same-named duplicates. Optional `query` filter,
  `includeHidden` (default off), `limit` (default 60, max 200), `truncated` flag.
- `voice.clickControl`: re-resolves a listed id to the exact element at click time and performs
  a real activation (pointerdown/mousedown/pointerup/mouseup/click via native `click()` so
  default actions like checkbox toggle and link navigation run; native `option` sets selection
  plus input/change). Result states: `activated` (dispatch-level evidence on a resolved,
  enabled, visible control), `disabled`, `hidden`, `not_found` (stale or never listed),
  `unsupported` (no UI source on this client). Confirmation flows need no special casing: the
  dialog's buttons are listed and clicked like any other control.

Identity model (per review feedback): ids are opaque (`ctl-<n>`), assigned per element by a
session-lifetime registry (WeakMap element to id, WeakRef id to element). Click resolution keys
on element identity revalidated against a fresh DOM scan; name and occurrence are context only
and never retarget. A removed control's id is rejected as stale with a relist instruction; a
surviving same-named sibling is never pressed by the removed control's id. Regression tests
cover exactly the "Settle thread" scenario.

## Files

- `packages/contracts/src/voice.ts`: `VoiceUiControl*` schemas, `VoiceListControls*`,
  `VoiceClickControl*`, registry entries `listControls`/`clickControl`. No new error codes;
  both tools report outcomes in-band (the states above), so
  `voicePanelController.ts`'s exhaustive `ERROR_CODE_LABELS` needed no edit.
- `apps/web/src/voice/ui/domControls.ts` (new): pure core (registry, listing, resolution) plus
  the DOM adapter (accessible-name derivation per accname precedence, role derivation,
  disabled/hidden state, activation sequence).
- `apps/web/src/voice/tools.ts`: `VoiceUiControlHost` seam (optional `uiControls` on
  `VoiceToolHost`), executor methods with explicit unsupported refusal when the host has no UI
  source, and `createWebVoiceToolHost` wiring so the attached client owns execution (remote
  sessions work; execution stays client-local).
- `apps/web/src/voice/ui/toolBridge.ts`: dispatch cases for the two bare names.
- `apps/server/src/voice/broker.ts`: tool descriptions (advertisement derives from the frozen
  registry automatically, both in mint and the Responses backend) plus delegation-instruction
  sentences pinning the honesty rules (success only on state "activated").
- `apps/web/src/voice/command-policy.ts`: `isUiCommandPrefix` now also holds speech for
  click/press/tap/toggle/select-prefixed utterances.
- `apps/web/package.json` + `pnpm-lock.yaml`: `jsdom` devDependency (web only) for real-DOM
  adapter tests. The lockfile also picked up benign peer-hash re-resolutions (alchemy,
  vite-plus) from `pnpm add`.
- `docs/user/voice-controls.md` (new): supported/unsupported mapping, duplicates, stale
  rejection, honesty rules.

## Checks run (focused only, per instructions)

- `vp test run apps/web/src/voice apps/server/src/voice/broker.test.ts`: 14 files, 280 tests
  pass. New: 24 in `domControls.test.ts` (pure: registry stability, opaque ids, occurrence
  context, filters/truncation, retarget regression, stale/ambiguous/disabled refusals) and
  `domControls.dom.test.ts` (real jsdom DOM: accessible names, role derivation, disabled/hidden
  filters, full activation event sequence, native checkbox toggle and option selection,
  disabled no-event refusal, stale-id sibling-no-retarget regression against a live document,
  fabricated id rejection).
- Scoped `vp check` on all touched files: 0 errors; only pre-existing
  `no-inline-schema-compile` warnings in broker.ts/broker.test.ts.
- Typecheck: contracts, web, server, mobile all clean (`grep "error TS"` empty).

## Ownership notes and coordination items for parent

- Untouched as required: `live-client.ts`, `VoiceTranscript.tsx`, `voicePanelController.ts`,
  `VoicePanel.tsx`. Wiring flows entirely through `createWebVoiceToolHost`.
- Two small cross-file follow-ups another worker may want to own (both in files outside my
  scope, currently safe defaults):
  - `live-client.ts` (~line 401) and `command-session.ts` treat every tool outside
    `searchThreads/discoverEnvironments/discoverProjects/listModels` as substantive, so the
    model may narrate after `listControls`. If UI listing should be silent like navigation,
    add `listControls` (and possibly `clickControl`) to those non-substantive lists and extend
    the completion chime to successful clicks.
  - Broker delegation instructions now instruct the model on click honesty; the speak-suppression
    and chime policy for clicks is the UI side of that contract.
- Native `<select>` options are listed even when the dropdown is closed in some browsers
  (layout quirk); clicking one selects it for real. Documented as a feature, not a bug.

## Limitations

- "activated" is dispatch-level evidence: a real activation dispatched on a real enabled,
  visible element. Generic post-click visible-outcome verification (did a handler actually
  change state) is not attempted; the model can re-list to observe effects. The delegation
  instructions pin that only state "activated" may be spoken as success.
- Controls that exist only inside closed custom menus/dialogs are not in the DOM until opened;
  the instructions tell the model to open menus first. `aria-hidden` ancestors are not walked
  (element-level check plus layout rects covers the common cases).
- Mobile has no UI control source; the tools return an explicit unsupported/empty refusal
  there (contracts are additive, mobile typecheck verified).
- Unnamed controls (empty accessible name) are listed with an empty name; they are addressable
  by id but hard to refer to in speech.
