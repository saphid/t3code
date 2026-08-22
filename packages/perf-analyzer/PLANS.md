# Perf analyzer: gap plans and suite map

Written 2026-08-21. Companion to COVERAGE.md (what exists and what does not)
and README.md (how to run). This file plans every identified gap and defines
which suite a change should run.

## Which suite to run for your change

Small runs prove a change is not a regression; the daily `full` run catches
everything else. Explicit CLI flags always override suite defaults.

| Your change touches | Run | Time (approx.) |
| --- | --- | --- |
| Anything (pre-merge minimum) | `--suite smoke` | ~2 min |
| Lists, chat rendering, markdown, CSS, virtualization | `--suite rendering` | ~15 min |
| Boot, routing, session/auth, bundle size | `--suite startup` | ~20 min |
| WS layer, contracts, snapshot payloads, reconnect | `--suite network` | ~25 min |
| Composer, editor, input handling | `--suite smoke` now; `composer` suite once scenario 1 lands | |
| Terminal | `--suite terminal` | ~10 min |
| Diffs/checkpoints | `--suite diff` | ~15 min |
| Server write path (decider, reactors, providers) | backend vitest benches (plans 11-15) | |
| Everything, once a day | `--suite full` (scheduled) | hours |

Usage: `node packages/perf-analyzer/src/cli.ts --suite rendering --headless`.
Add `--otlp http://192.168.1.221:4318` to publish into the shared Grafana.

## Planned scenarios: client (extends src/scenarios.ts)

Each entry: what it measures, the headline metric and its band, fixture work
needed, and the suite it joins. Numbering continues COVERAGE.md's ranked list.

1. **compose-typing-latency** (suite: composer, smoke)
   Type ~200 characters into the composer with the giant thread open;
   per-keystroke keypress-to-paint via performance.mark in the page, report
   p95. Band: good <= 50 ms, poor > 100 ms (editor-class input; RAIL 50 ms
   processing budget). Fixture: none. Implementation: page.keyboard.type with
   delay 30; a page-side rafter marks paint completion per input event.
2. **streaming-turn-append** (suite: rendering)
   Frame pacing and script time while assistant deltas append to an
   auto-scrolling timeline. Band: dropped frames <= 5%, GPU within scroll
   bands. Fixture: seeded streaming turn (is_streaming = 1) plus a replayed
   delta feed; needs either a mock provider turn through the real dispatch
   path or a WS-injected replay. Largest client gap; build after 1, 5, 7.
   Status: shipped on web via the mock-provider route (no page-side
   simulation). launch.ts provisions src/acpStreamingAgent.ts as an enabled
   Grok provider instance in the throwaway home (settings.json plus a shell
   wrapper that answers `--version`), so the server's real Grok ACP adapter
   drives the turn. Seeded threads are projection-only and the decider
   rejects them, so prepare() creates an event-backed project (once per env)
   and a fresh thread per run over POST /api/orchestration/dispatch using
   the paired page's own session cookie, then dispatches thread.turn.start
   and waits for the first painted delta; run() measures a fixed 10 s of
   streaming (wall time is exempt like the scroll scenarios; the agent
   streams ~20 s and the previous run's turn is interrupted so tails cannot
   bleed across windows). Note the shipped default is buffered assistant
   delivery: ingestion holds text deltas until the segment completes (a
   tool call closes it), and token-by-token rendering is the legacy
   enableLegacyTokenStreaming opt-in. The mock therefore streams text
   chunks punctuated by a completed tool call every ~1.3 s, so the
   timeline appends flushed segments plus tool cards at the real cadence.
   Desktop is a future refinement: the dispatch calls ride the browser
   session's same-origin cookie, which the desktop shell lacks.
3. **open-large-diff** (suite: diff)
   Checkpoint with ~40 files / ~5k changed lines; time to first painted hunk
   and full render, stacked and split. Band: interaction bands (INP). Fixture:
   populate checkpoint_files_json in seed.ts and a matching worktree with real
   file contents so the diff worker pool runs.
   Status: shipped, no server gap. The workspace repo commits 40 files x 120
   changed lines at two states and points real checkpoint refs
   (refs/t3/checkpoints/<base64url(threadId)>/turn/0 and /turn/1, the format
   of checkpointing/Utils.ts) at them; seed.ts writes the matching
   checkpoint_turn_count/checkpoint_ref/checkpoint_status/checkpoint_files_json
   on the giant thread's turn, so the server's real `git diff` resolves and
   full hunk bodies render. The scenario clicks the changed-files card's Open
   diff button and waits for the first hunk (also the t3perf.diff-open
   pageMeasure). Fresh environment per run: the client caches diff queries
   (30s SWR), so a reused session would measure cache hits. Split-mode and
   full-render sub-measures are a future refinement.
4. **terminal-output-burst** (suite: terminal)
   Stream ~10k lines into the Ghostty canvas; renderer + GPU cost, frame
   pacing. Band: dropped frames plus GPU scroll bands. Fixture: seeded
   terminal session; a script that emits bounded output.
   Status: shipped on web and desktop at the small size (terminal cost does
   not scale with the fixture). No seeded terminal session was needed:
   terminals are runtime state, not projections, so the scenario drives the
   real affordance. mod+j on the giant thread opens the drawer and a real
   PTY (terminal.open at the seeded workspace repo, no decider involvement).
   prepare() types a paced burst (seq through awk, ~10k lines over ~11 s,
   ~1k lines/s, a done-marker touch at the end) so run() only presses Enter
   and measures a fixed 10 s window while output streams; wall time is
   exempt like the scroll scenarios. Liveness is proven twice: the canvas's
   corner pixels must change across the window (Ghostty text never reaches
   the DOM), and the burst's workspace done marker must appear, which run()
   also waits for so the tail cannot bleed into the next run. Desktop gets
   an empty .zshrc in the throwaway HOME so zsh-newuser-install cannot open
   inside the measured terminal.
5. **command-palette-open** (suite: smoke, rendering)
   Palette keybinding to first painted results at large size, then filter
   latency for a 3-character query. Band: INP interaction bands. Fixture:
   none. Implementation: keyboard shortcut, wait for results list text.
6. **many-projects-sidebar** (suite: rendering)
   Sidebar mount and group expand/collapse with ~50 projects x 400 threads.
   The sidebar list is not virtualized (plain .map in Sidebar.tsx), so this
   is the most likely pre-existing regression finder. Band: interaction bands
   for expand/collapse; startup bands for mount. Fixture: loop
   projection_projects in seed.ts (new "wide" size or a project-count knob).
   Status: shipped at the new "wide" size (50 projects x 8 threads each plus
   the giant thread in project 1; each extra project gets its own non-git
   directory, since the default "repository" grouping merges same-repo
   projects into one sidebar group). The default sidebar has no per-project
   group toggles (legacy sidebar only), so the scenario drives the modern
   equivalent: the project scope menu, scoping to two seeded projects and
   back to all, each switch a t3perf.project-scope pageMeasure.
7. **settings-navigation** (suite: startup)
   Walk the 9 settings sections in order; per-transition wall (includes
   route-level code-split loads). Band: INP interaction bands. Fixture: none.
8. **sidebar-scroll-and-reorder** (suite: rendering)
   Wheel-scroll the 400-thread sidebar, then drag a pinned thread three
   positions. Band: GPU scroll bands plus interaction bands for the drop
   settling. Fixture: none (pin a few threads in seed.ts).
   Status: scroll half shipped; seed.ts pins three threads with real-shaped
   pin_order_keys and they render and drag, but the drop's
   thread.pin.reorder write fails the decider's thread-exists invariant
   (projection-only fixture rows have no backing events), so the reorder
   half waits on event-backed fixture threads.
9. **preview-pip-frames** (suite: rendering, desktop only)
   Desktop picture-in-picture window streaming preview frames while the main
   window renders; per-process GPU on both windows. Fixture: a local static
   page to preview. Needs the desktop preview flow driven by keyboard/UI.
   Status: shipped, desktop only, small size only (streaming cost does not
   scale with the fixture). The preview accepts only loopback http(s) URLs
   (normalizePreviewUrl rejects file: and data:), so the harness hosts its
   own animated-canvas target on 127.0.0.1 and drives the real flow: right
   panel toggle, Browser surface card, URL submit, then the chrome row menu's
   "Open separate preview window", which is the native PiP BrowserWindow fed
   12 fps capturePage JPEG frames over IPC by the desktop preview manager.
   run() measures a fixed 10 s of steady streaming (wall exempt like the
   scroll scenarios); liveness is a frame counter installed inside the PiP
   window via its own onFrame preload hook, failing loudly under 10 frames.
   One Electron GPU helper carries the main window, the guest, and the PiP
   window, so app GPU is the combined streaming cost; per-window GPU split
   is not attributable on this backend.
10. **environment-switch** (suite: network)
    Switch between two environments and re-render the sidebar scope. Band:
    interaction bands. Fixture: launch.ts gains a second server + saved
    environment; complements flaky-reconnect with planned transport change.
    Status: shipped, web only. launch.ts spawns a second small server under
    the same throwaway home and retitles its seeded rows (seeding is
    deterministic, so both environments would otherwise render byte-identical
    titles). prepare() pairs it once per environment through the real
    Settings -> Connections "Add environment" dialog (the full pairing URL
    pasted into Host fills both fields), which is also where the connection
    establishes, so measured switches are warm; the sidebar merges
    environments, so the project scope menu is the environment switcher, and
    each direction lands as a t3perf.env-switch pageMeasure with wall
    covering both. Desktop is out: its saved-environment flows are
    bridge-driven rather than the web dialog.

## Planned benches: server write path (vitest, not Playwright)

These live next to apps/server/integration (the sanctioned write-path route:
OrchestrationEngineHarness with mock adapters and typed receipts), emitting
the same results JSON shape with surface "server" so the report and Grafana
absorb them. Wire sizes are already budgeted in CI by
NetworkTransferMeasurement; these add latency and throughput.

11. **turn-dispatch-latency**: dispatch thread.turn.start against the replay
    adapter; time command-to-receipt (requested -> terminal receipt) at p50
    and p95, small and large event stores. The harness's waitForReceipt gives
    exact clock boundaries.
12. **snapshot-query-latency**: getShellSnapshot and getThreadDetailSnapshot
    against seeded projections at small/medium/large plus a 10x events
    variant; include the threadDetailCursor pagination path nothing currently
    pages through.
13. **projection-throughput**: replay 10k events through the projection
    pipeline; events/sec and projector lag (projection_state cursor delta).
14. **attachment-upload**: a 10 MB base64 image inline in turn.start (the
    contract allows up to 14 MB in one WS frame), plus the signed-URL
    read-back; wall per leg and peak server RSS.
15. **search-threads-latency**: orchestration.searchThreads p95 per query
    length at large fixture; it is a plain SQL scan with no FTS index, so
    this is the type-ahead cliff. Also exercise
    GET /api/orchestration/snapshot once (its handler comments an OOM risk
    and nothing but the CLI calls it today).

## Scheduling

- Daily full client run on the Mac (real GPU): launchd job, 02:17 local,
  `--suite full --otlp http://192.168.1.221:4318`, report regenerated after.
- Daily Linux release run on lxs02: crontab, benchmarks the latest published
  nightly with the network suite and publishes to the same collector, so
  Grafana always has a fresh release point.
- CI (future): `--suite smoke` per PR on a dedicated runner; counts
  (layoutCount, DOM nodes) are deterministic enough to gate on immediately,
  timings need the runner to be dedicated hardware first.

## Sequencing

Zero-fixture scenarios first (1, 5, 7, 8), then the seed extensions (3, 6, 4),
then the two harness extensions (2, 10). Server benches 11, 12, 15 first (all
machinery exists), then 13, 14. Every new scenario must declare its band in
report.ts's BANDS table with a citation, or explicitly mark the band derived.
