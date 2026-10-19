# T3 Doctor

A native macOS app and a small local watchdog for T3 Code. Open **T3 Doctor**
from Spotlight or `~/Applications/T3 Doctor.app`.

The SwiftUI app has its own window, Dock icon, and menu-bar status. It starts
in **dark mode**. Choose Dark, Light, or Follow System from the toolbar or the
Appearance menu; the app remembers your choice.

Watching now shows threads, providers, last activity, and approval or question
waits. When runtime metadata is absent, the watcher reads the matching macOS T3
launch service and verifies its loopback environment endpoint to check reachability. Select a table row for run details and current findings. Incident history
shows unresolved and resolved reports. Select one to see readable observed facts,
recent activity, worker errors, and suggested next checks. Technical details and
log excerpts have full-width Show/Hide buttons. Raw JSON remains available there,
and the folder button reveals the report in Finder.

Finding cards in Watching now start collapsed, showing the observed symptom and
handling status, with the affected provider or thread underneath. Click anywhere on a card's header to show or hide its evidence and
actions. Each card expands independently and stays open during observation
refreshes. New incidents start collapsed.

**Investigate in T3 Code** starts a diagnostic thread for a finding or saved
incident. **Investigate findings needing attention** creates work for unassigned conditions
and reuses any existing investigation links. Provider details also have investigation buttons. A click
creates a thread in **T3 Code Contrib** using **GLM 5.3 Flash** and submits its
first message. The result shows the thread title with Open T3 Code and Copy
thread ID controls. Open T3 Code brings up the configured desktop app; locate
the displayed title in T3 Code Contrib.

The diagnostic prompt requires checking upstream issues, code, releases, and
PRs; our open, draft, closed, and merged PRs; local branches, worktrees, dirty
changes, and the patch stack. It requires identifying the exact running desktop
and server builds, then checking whether each relevant fix is actually included.
An existing unshipped fix should lead to an upgrade, rebuild, or backport
recommendation before any duplicate implementation.

Frozen evidence, the full prompt, and the thread receipt are saved under
`~/.local/state/t3-doctor/investigations/`. Each saved incident has a versioned SHA-256 fingerprint and carries its linked
investigation thread ID, title, project, environment, submission stage, and prompt
SHA-256 hash. Links remain visible after restarting the app. Existing 0.4 receipts
are attached to their incidents automatically.

Deduplication works per incident fingerprint across individual and combined
investigations. Investigating all findings and then selecting one of those
incidents reuses the same thread. Newly discovered findings receive a new
investigation without resubmitting issues already linked to another thread. Failed or timed-out submissions retain their
thread, message, and command IDs so retries cannot start a second turn. The
launcher checks the live environment and project before submitting and respects
the local usage budget. It uses the maintained T3 controller through temporary
API credentials, which are revoked after the request. Only an explicit button
click launches an agent; background monitoring never does. The diagnostic thread
may investigate and make a focused fix in an isolated worktree, but its prompt
requires separate authorization for live restarts, installations, or publishing.

**Handling status** is separate from observed recovery. Use Set status in a
finding, provider, or saved incident to choose Needs attention, In progress,
or Dismissed. Enter an owner and click Assign to mark it Assigned. An optional
note records the next action. These changes are local to the doctor; assignment
does not notify anyone. A verified investigation submission marks its incidents
In progress. The watcher does not infer resolution from the agent finishing.

Assigned, in-progress, and dismissed issues move out of Needs attention and into
Handled. They remain visible, continue to be monitored, and retain their evidence.
Incident history can filter Needs attention, Handled, or Cleared. Use Set status
then Needs attention to reopen one. Only a fresh observation can mark the
condition cleared. If it later recurs, it returns to attention with its previous
investigation link. New symptoms under the same provider key get a new report.

Fingerprints ignore timestamps, elapsed quiet time, and display names. They keep
the database/environment scope, provider account and failure, run identity for
stalls, worker type and error for repeated worker failures, and the failure details. They group exact normalized symptoms, not guessed root
causes. Different runs stay separate. Repeated matching incidents
share handling and thread links. The watcher suppresses duplicate notifications
for an active issue and records the suppression reason in the report.

**Check related investigations with Jev** looks for existing investigations whose
symptoms are similar even when their fingerprints differ. It uses the installed
TypeSafe client from `~/projects/stt-polish/stt_polish/jev.py`, with its existing
`TYPESAFE_API_KEY` or `~/.config/typesafe/api-key` credential setup. The client path
is recorded in the app's bundled `investigation-config.json`.

This check runs only when clicked. It sends short, redacted symptom summaries and
selected diagnostic facts to TypeSafe, excluding captured logs, conversation
history, thread titles, and credentials. It compares at most 12 incidents from
the same environment and category that have a verified investigation link.
Jev match scores of 0.75 or higher appear as suggestions. These are model judgments,
not proof of a shared cause. Unchanged comparisons use the saved assessment.

Reuse this investigation links the selected incident to the suggested thread,
saves the match provenance, and marks it In progress. It does not start another
thread or send another turn. Existing investigation links are preserved. Unlink
reused investigation reverses that action and returns the incident to Needs
attention. Jev scores alone never change handling or hide an incident. A missing
key, failed API call, or invalid response leaves exact deduplication and handling
available. Assessment timestamps, model, scores, and matches are saved with the
incident so they remain visible after restart.

`triage.json` is the persistent handling ledger. Fingerprints, handling, and
investigation links are also written into the saved incident JSON and current
observations. A shared file lock protects watcher updates and UI edits; evidence,
notification outcomes, and recovery information are preserved when handling changes.

A run marked running without a provider turn is checked separately from quiet
activity. Doctor matches the current attempt, captures any failed startup worker
and its error, and reports the mismatch even when the session log is still busy.
A start that has not failed gets the configured startup grace period. Completed
provider turns waiting for finalisation are not classified as missing turns, and
interrupted or completed runs clear the condition. Doctor never interrupts a run
automatically.

**Providers** shows each configured provider account separately, including its
installed version, authentication result, active run count, and diagnostic
timestamp. The doctor reads T3's provider status cache and directly checks any
configured executable. It does not send model prompts or run provider login
flows. Diagnostics older than 15 minutes are marked unverified. Disabled and
removed custom accounts do not cause alerts; unknown authentication alone does
not imply a provider failure. Fresh warnings and errors produce incidents after
two checks. If a result becomes unverified, an existing incident stays open.

**App updates** is the home for version status. New versions are informational;
they do not create findings, incidents, attention counts, or stall notifications.
The doctor compares installed T3 desktop and server versions with published
GitHub releases once an hour. Check now requests a fresh release lookup on the
doctor's next scan. View release opens the published release details. The doctor
does not download or install updates. Drafts, other release channels, and
releases missing the relevant Apple Silicon artifact are excluded.

Release settings live in `~/.local/state/t3-doctor/checks.json`:

```json
{
  "release_repository": "saphid/t3code",
  "release_channel": "nightly-v2",
  "desktop_app": "/path/to/T3 Code.app"
}
```

This Mac targets the installed OV2 preview and the fork's Nightly V2 channel.
For the same release channel, App updates counts newer releases with a matching
artifact. If the installed release is outside the latest 100 fetched releases,
the count is labelled At least. Versions on different channels are not given an
invented release distance.

For the desktop, the doctor reads its packaged source SHA and compares it with
the published release tag. Packaged server releases can use their exact release
tag when that tag is present in the fetched list. App updates shows commits behind
and ahead. Diverged histories show commits unique to each build; these counts do
not establish which fixes are missing, especially with cherry-picked patches.
Unknown build provenance or failed comparisons stay unknown. Compare source opens
the GitHub comparison. Public API rate limits fall back to the configured `gh` CLI,
without requesting login or extracting credentials.

Earlier app-update incident reports move to `update-history/`, preserving evidence
and investigation thread links. Previous update reports in App updates opens that
archive. They are excluded from incident history and its saved-incident count.

An unversioned source server is shown as unknown. The running server's executable
determines its version; the runtime's saved active-version pointer can be stale
and is not used. Update checks retain their cache across restarts and report
network failures as unknown. They inspect the latest 100 releases from the
configured repository. The doctor itself is a local build without a release feed.

The app reads `~/.local/state/t3-doctor` directly every five seconds. No browser
or local web server is needed. The doctor normally checks T3 every
30 seconds. Refreshing the app rereads the saved observations. Stale or missing
observations produce a warning instead of an all-clear.

Closing the window leaves the menu-bar app available. Quit T3 Doctor quits the
viewer; the background watcher continues watching and sending notifications.
The watcher opens the T3 database read-only and never changes threads, sessions,
or provider processes.

Build and install on Apple Silicon with macOS 14 or later and Xcode installed:

```sh
python3 scripts/t3-doctor/native/build_app.py --test --install
open "$HOME/Applications/T3 Doctor.app"
```

The local build uses SwiftUI and AppKit, has an ad-hoc code signature, and needs
no third-party packages. The watcher requires Python 3.9 or later.

```sh
python3 scripts/t3-doctor/doctor.py install
python3 scripts/t3-doctor/doctor.py status
python3 scripts/t3-doctor/doctor.py uninstall
```

`doctor.py install` copies the watcher into `~/Library/Application Support/T3 Doctor`
and starts its macOS LaunchAgent. The watcher runs at login and restarts if it
exits. Re-run install after changing the watcher source. It also removes the
superseded web dashboard service. Uninstall stops the watcher and removes login
startup, retaining the native app and captured reports.

Every 30 seconds it checks the OV2 database, or the legacy database when OV2 is
absent. Use `--home /path/to/userdata` or `--db /path/to/state.sqlite` to select
another environment. If an unused OV2 database exists, select the active database
explicitly. The default targets this machine's `~/.t3/userdata`.

It flags active runs with 15 minutes of silence, startup delays over 3 minutes,
and OV2 worker effects overdue by 3 minutes after availability or lease expiry.
Pending approvals and questions appear as waiting. Queued runs behind an active
run are not treated as startup failures. Message updates, tool updates, and
per-thread provider log writes count as progress. An idle session is healthy.

A condition must survive two checks before a macOS notification is submitted.
Each incident alerts once, including across watcher restarts, and can alert
again after it clears and recurs. macOS notification permissions and Focus can
suppress delivery. Notification submission results are recorded in the report.

Reports and `status.json` live in `~/.local/state/t3-doctor`. Reports include
thread/run IDs, provider session state, unfinished nodes, recent tool details,
worker errors, and bounded provider/server/desktop log excerpts. Common credential
patterns are redacted. Reports can still contain private conversation or tool
content; the output directory is private to your account. The last 100 reports
are retained, plus unresolved incidents.

Silence is a suspected stall, not proof. Long silent commands can trigger alerts.
TCP reachability only establishes that the server's recorded local port accepts
connections; it cannot prove the application is responsive. Worker errors and log
excerpts are evidence to investigate, not an automatic root-cause diagnosis.
The doctor does not restart T3 or terminate work. Background monitoring uses no
AI calls. On-demand related-investigation checks send redacted summaries to
TypeSafe. Release checks fetch public metadata from GitHub. Clicking Investigate
submits the diagnostic prompt to T3 Code and the selected provider; the agent can
read the saved evidence. Background observations and notifications stay on this Mac.

For a single read-only check, without alerts:

```sh
python3 scripts/t3-doctor/doctor.py once
```

For foreground monitoring or different thresholds:

```sh
python3 scripts/t3-doctor/doctor.py watch --quiet 1200 --startup 300
```

Use the same options with `install` to persist them. `--no-notify` keeps reports
without notifications. An incompatible schema or failed database read becomes
a doctor incident instead of a healthy result. Inspect `checked_at` in status
and the LaunchAgent if the doctor itself stops. The source database has a
five-second query budget per scan and no write access.

Run the focused tests:

```sh
python3 -m unittest discover -s scripts/t3-doctor -p 'test_*.py' -v
python3 scripts/t3-doctor/native/build_app.py --test
```
