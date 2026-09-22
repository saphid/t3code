# @t3tools/extension-terminal — interactive terminal panel

Interactive terminal plugin driven entirely by public contracts:

- `t3.terminal/sessions@^1.1.0` — `inspect` plus the `list` metadata stream
  (snapshot → upsert/remove) that drives the session tabs
- `t3.terminal/control@^1.0.0` — open (client-chosen id via
  `nextTerminalId`), attach (`restartIfNotRunning`), write, resize, clear,
  restart, close; all gated behind the distinct `t3.terminal/operate` grant
- `t3.terminal/output-events` `subscribe` — snapshot → chunked output →
  reset/exit/closed lifecycle frames

## Rendering: real Ghostty VT (format 4)

The panel renders through the vendored libghostty-vt WASM closure in
`ghostty/` — the same handwritten adapter the native terminal drawer uses —
packaged as digest-verified extension assets:

- `assets/ghostty-vt.wasm` — terminal core, parser, render state
- `assets/ghostty-write-pty.wasm` — PTY-write callback trampoline
- `assets/SymbolsNerdFontMono-Regular.woff2` — symbol fallback font

The host delivers verified bytes via `host.readAsset`; `ghostty/runtime.ts`
instantiates one shared runtime and each surface allocates its own terminal
handle. A host without asset support still works: the panel falls back to a
bounded `<pre>` text view.

Vendoring deviations from `apps/web/src/terminal/ghostty/` (all mechanical,
none change VT semantics): imports repointed to package-local helpers;
`runtime.ts` loads WASM/font bytes from an injected asset loader instead of
`~/` URL-module imports (the upstream `~/` static-asset concatenation is
rewritten); the runtime and symbols-font URL reach the surface through
options rather than module scope; `cssFontFamilies` is a joined string
constant rather than a module glob; and `platform.ts` guards `navigator`
access for non-DOM hosts. The WASM bytes, parser, and encoder are
byte-identical to upstream.

## Attach semantics (honest degradation)

`vtAttachment.ts` mirrors the native attach reducer: snapshot frames reset
the parser and re-base it, chunked output reassembles before reaching the
parser, and `identity-changed`/bounded `overflow` closes resubscribe. A
**truncated** attach tail loses parser state that lived before the retained
8 KiB — the tab shows "earlier history was truncated" and does not claim
interactive parity until a full snapshot or reset re-bases the parser.

A host **history clear** only drops retained output — it never reaches the
process or renegotiates modes. A live surface therefore gets a
mode-preserving erase (ED 2 + ED 3, `clearScreen`), not an RIS reset, so
application-cursor/bracketed-paste/kitty state survives and input keeps
encoding the way the process expects. If the clear lands before the renderer
attaches, the mode-establishing bytes are gone from the replay base — the
tab stays degraded until a full snapshot re-proves parser state. Clearing
history is never treated as proof of recovered mode state.

A **renderer start failure** is sticky: output and snapshot frames keep
feeding the bounded replay buffer for a later remount, but they never
re-flag the pane "live" while no renderer exists — only an `attach` whose
replay completes clears the error (a throwing replay drops the
half-written sink and keeps the failure).

**Remount replay** splits around unanswered runs: bytes a live sink
already parsed were answered once and replay with the PTY writer detached
(`beginReplay`/`endReplay`), so DA/DSR/DECRQSS queries inside them are
not re-sent. Live output buffered while detached was never parsed — each
contiguous run of it replays _with_ the writer attached so its queries
get exactly one reply, at the cursor position those bytes actually
produce. Provenance is positional, never textual: the host reports each
snapshot's `contentsUnitStart` — the absolute UTF-16 offset of the tail
inside the retained-history window (`streamEpoch` + `clearGeneration`)
— and every run's absolute position is known from the stream's own
recorded start, so line eviction, byte eviction and tail truncation are
the same arithmetic. A run whose absolute position precedes the new
contents is provably evicted — dropped, never migrated onto a later
identical query — and a surviving run is still verified byte-for-byte at
its computed position. A same-epoch `clearGeneration` bump is a missed
clear: the old window's claims die with it. Runs are fenced to their
stream epoch in both directions: a pending reply belongs to the process
that asked and is discarded at incarnation end
(identity-changed/close/exit), and replay holds claims unreleased while
the epoch is unproven — a mount inside the beginStream→snapshot gap
answers nothing until a same-epoch snapshot re-proves the claim. Queries
inside snapshot/history bytes are treated as already-rendered history
and stay suppressed (the documented drop: only live output the
attachment saw go undelivered earns a reply).

Parser fidelity likewise needs host evidence, not observation history:
the replay base is faithful only when a snapshot reports
`clearGeneration === 0`, `contentsUnitStart === 0` and `truncated ===
false` — the retained window provably covers every byte since the
process started. An attachment whose first snapshot arrives after a
clear (`clearGeneration > 0`), or after any retention eviction, mounts
degraded instead of claiming modes it cannot reconstruct.

Sequencing uses two fences: the broker's per-subscription frame sequence and
the session's native `eventSequence` watermark, which must strictly increase
across snapshot boundary, output groups, resets, and exits. An output chunk
that does not continue an open group fails the stream rather than silently
swapping groups.

## Input: serialized-byte transport (B6)

`inputQueue.ts` batches input against the serialized `write` invocation —
`{terminalId, data}` as UTF-8 JSON — with a 48 KiB per-write budget and a
256 KiB pending cap, splitting surrogate-safe. On a write whose outcome is
unknown (transport failure, timeout, post-send server error) the queue
halts: the failed batch and everything behind it are discarded and never
resent. The tab shows an "input stopped" banner and only an explicit resume
(or restart) reopens input.

B6 is only partially solved here: a client-side timeout cannot prove whether
an in-flight write reached the PTY, and there are no host operation IDs,
cancellation, or ordering fences to disambiguate it — hence halt + discard +
explicit resume rather than replay. Host-side op-id fencing remains unsolved.

## Known limitations

- **Focus arbitration (B7):** the plugin does not emit `data-terminal-owner`
  and cannot claim focus-owner parity — without host-side arbitration, the
  native terminal close/split/new keybindings may still target the native
  terminal while the plugin has focus.
- **Dock sizing (B8):** dock geometry is host-owned; the plugin only sizes
  its own terminal content.
- **Remote pixels/frames:** out of scope; rendering is local WASM only.

## Development

- `pnpm run build` / `check` — pack and validate `.t3-extension/` (format 4)
- `pnpm test` — view-model, VT conformance (real WASM), input-transport,
  attach/recovery, PTY-fixture, and surface-level byte-transport oracle
  suites
- `pnpm run audit` — Gate-4 private-import audit
