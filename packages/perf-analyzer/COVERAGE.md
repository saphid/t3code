# Interaction coverage

What the perf suite tests versus everything a user can touch. Compiled 2026-08-21
from a full sweep of `apps/web/src` and `apps/desktop/src`; counts are control
instances (buttons, menu items, form controls, keybound actions) and are lower
bounds since dynamic lists multiply at runtime.

**Total: roughly 950 to 1,050 discrete interaction points.** The current suite
drives 5 scenarios touching about 3 of them directly (a thread row click, a
wheel scroll, app boot), under 0.5% by count. The suite is built as archetype
proxies, not feature tests: each scenario stands in for a class of surfaces
that share a rendering or transport cost profile. Weighted by usage frequency
the effective coverage is far higher than the raw count suggests, but several
archetypes have no proxy at all (see gaps).

## Surface inventory

| Area | ~Interactions | Archetype(s) | Covered? | Evidence |
| --- | --- | --- | --- | --- |
| Routes / navigation | 20 paths, 21 route files | navigation, network | partial (only `/` and thread route) | `apps/web/src/routeTree.gen.ts` |
| Sidebar / thread list | ~40 | list render, navigation, drag | partial (initial render only) | `Sidebar.tsx` (3913 LOC) |
| Thread view timeline | ~104 | heavy content, streaming, GPU | partial (render + scroll; not streaming) | `chat/MessagesTimeline.tsx`, `ChatView.tsx` |
| Composer | ~45 | input latency, content render | no | `ComposerPromptEditor.tsx` (Lexical, 1844 LOC) |
| Approvals | ~8 | input latency, network | no | `chat/ComposerPendingApprovalPanel.tsx` |
| Plans | ~6 | heavy content render | no | `chat/ProposedPlanCard.tsx` |
| Checkpoints / diff review | ~25 | heavy content render, GPU | no | `DiffPanel.tsx`, `components/diffs/`, worker pool |
| Terminal (Ghostty WASM + canvas) | ~10 + unbounded output | streaming append, GPU | no | `terminal/ghostty/` (5231 LOC) |
| Preview browser | ~32 across 63 files | GPU, navigation, network | no | `components/preview/` |
| Settings (9 pages) | ~404 (largest area) | navigation, list, input | no | `routes/settings.*.tsx`, `components/settings/` (61 files) |
| Pull requests | ~104 across 44 files | list, content, network | no | `components/pullRequest/` |
| Command palette | ~30 static + dynamic, 4 modes | list render, input latency | no | `CommandPalette.tsx` (2533 LOC) |
| Keybindings | 44 static commands (cap 256 with scripts) | navigation, input | no | `packages/contracts/src/keybindings.ts:50-76` |
| Git / source control | ~32 | network, list | no | `GitActionsControl.tsx` |
| Files browser / picker | ~10 | list, content render | no | `components/files/` |
| Search (4 kinds) | ~8 | input latency, list, network | no | `components/search/`, `settingsSearch.ts` |
| Project management | ~20 | navigation, network | no | `routes/projects.$projectKey.tsx` |
| Environment / connections | ~30 | network, reconnect | partial (transport reconnect only) | `settings/ConnectionsSettings.tsx`, ssh/wsl/cloud |
| Onboarding / pairing | ~12 | navigation, network | no | `routes/pair.tsx`, `connect.tsx` |
| Notifications / toasts | ~15 | streaming arrival, input | no | `components/ui/toast.tsx` and coordinators |
| Context menus | 21 call sites (thread menu: 14 items) | input latency | no | `threadActionMenu.logic.ts:57-114` |
| Drag and drop | 8 surfaces | input latency, GPU | no | `chat/workspaceFileDrop.ts`, `Sidebar.tsx:2661` |
| Modals / dialogs / popovers | 33 files (~25 Dialog, 9 AlertDialog, 17 Popover) | navigation, content | no | `components/ui/` |
| Usage charts | ~5 | GPU | no | `components/usage/UsageProviderChart.tsx` |
| Agents panel | ~5 | list render | no | `components/AgentsPanel.tsx` |
| Desktop app menu | ~20 items | navigation, zoom | no | `desktop/src/window/DesktopApplicationMenu.ts:144-220` |
| Desktop IPC surface | 80 channels | network, GPU | no | `desktop/src/ipc/channels.ts` |
| Desktop PiP window | ~5 | GPU, streaming | no | `preview/Manager.ts:2804` |
| Desktop tray / global shortcuts | none exist | n/a | n/a | grep returns nothing; dock only |

## Why these five scenarios

Each is the cheapest deterministic proxy for one archetype, and together they
need only two fixture tables (`projection_threads`, `projection_thread_messages`):

- `startup`: navigation + list render + cold network. Stands in for app boot,
  the router, the sidebar, and query/atom warm-up.
- `open-giant-thread`: heavy content render. Stands in for the thread view and
  structurally for any large-payload panel.
- `scroll-giant-thread`: GPU and frame pacing. Stands in for every scrolling
  surface.
- `slow-network-startup`: latency/bandwidth-bound transport. Stands in for all
  RPC-backed panels and remote environments.
- `flaky-reconnect`: transport recovery and event replay.

## Archetype gaps (no proxy today)

1. **Input latency**: nothing types a character. The Lexical composer is the
   highest-frequency latency-sensitive surface in the product.
2. **Streaming append**: the fixture hard-codes `is_streaming = 0`; a live
   agent turn appending into an auto-scrolling timeline has a different cost
   curve than a static mount.
3. **Terminal output**: Ghostty (WASM + canvas) is never instantiated.
4. **Large diff review**: `checkpoint_files_json` is seeded empty, so the
   worker-pool-backed diff/highlight path never runs.
5. **Command palette open**: a cold list build over threads+projects+files on
   the critical interaction path.
6. **Settings navigation**: the biggest control surface, never visited.
7. **Many projects**: only one project is seeded. Notably, the sidebar thread
   list is NOT virtualized (`Sidebar.tsx` renders plain `.map()` at :2227,
   :2241, :2260, :2271); at 400 threads that is a full DOM list.

## Ranked next scenarios

| # | Scenario | Gap closed | Note |
| --- | --- | --- | --- |
| 1 | compose-typing-latency | input latency | keystroke-to-paint p95; no new fixture |
| 2 | streaming-turn-append | streaming append | needs a seeded streaming turn or replayed events |
| 3 | open-large-diff | diff-specific content render | needs checkpoint_files_json fixture + worktree |
| 4 | terminal-output-burst | streaming + GPU | needs a seeded terminal session |
| 5 | command-palette-open | list + input | no new fixture; bind palette toggle |
| 6 | many-projects-sidebar | list render ceiling | loop projects in seed.ts; likely finds a real regression |
| 7 | settings-navigation | navigation | drive the 9 sections in order |
| 8 | sidebar-scroll-and-reorder | GPU + drag input | reuse wheel pattern on sidebar |
| 9 | preview-pip-frames | desktop multi-window GPU | desktop only; needs a static page |
| 10 | environment-switch | planned transport change | shipped, web only; launch.ts spawns a second seeded server |

Scenarios 1, 5, 7, 8 need zero fixture work. 3, 4, 6 need one seed.ts extension
each. 2 and 10 need harness changes beyond seeding.

## Backend surface (server endpoints)

Compiled 2026-08-21. Totals: **99 wired WS RPC methods** (82 request/response,
17 streaming; ~55 mutating; `WS_METHODS` also declares 3 dead entries),
**29 HTTP routes** on the main listener (24 typed + 5 raw), **17 server-push
streams**, plus 14 MCP preview tools and 23 client command variants behind the
single `orchestration.dispatchCommand` fan-out.

Perf-suite touch: **~12 of 99 WS methods (~12%) and 8 of 29 HTTP routes
(~28%)**, all read-path except the auth handshake: pairing/oauth/session,
`/.well-known/t3/environment`, `subscribeShell`/`subscribeThread`, shell and
thread snapshot fetches, static assets, and WS reconnect/replay. Never
exercised: dispatch (all 23 command types), terminal (9), git/vcs (12), pull
requests (17), preview (11), files/projects (8), source-control host, review,
cloud/relay, MCP.

Why the skew is structural: the suite measures client render and transport
cost against directly seeded projections, deliberately bypassing the event
store, decider, projector, and reactors; consequential writes need a provider
session, which Playwright cannot stand up. The sanctioned write-path bench
route is `apps/server/integration/OrchestrationEngineHarness.integration.ts`
(real SQLite, mock adapters, `waitForReceipt` receipts = deterministic
clock boundaries), and wire sizes are already budgeted by
`NetworkTransferMeasurement.integration.ts`. The write-path gap is latency
and throughput, not bytes.

Top backend scenarios worth adding:
1. Turn dispatch command-to-receipt latency (harness + replay adapter).
2. Shell/thread snapshot query latency at large event counts, including the
   thread detail pagination path the fixture never pages through.
3. Projection pipeline throughput: events/sec replaying thousands of events.
4. Attachment upload cost: base64 image up to 14 MB inline in a WS frame,
   plus the signed-URL read-back leg.
5. `searchThreads` latency: a plain SQL scan over message projections (no
   FTS index exists), the classic keystroke-latency cliff at large fixtures.

Also flagged: `GET /api/orchestration/snapshot` carries an OOM warning in its
handler comment and is exercised by nothing but the CLI.
