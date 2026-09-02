# Review usage

The Usage page combines Codex, Claude Code, and Grok Build activity from your connected
environments. It reads the providers' local session history and shows a public-list-rate estimate,
processed tokens, cache savings, provider shares, and model breakdowns. Subscription billing is
separate from this local estimate.

Claude Code accounting keeps the final progressive snapshot for each response and prices every
attempt in a model-fallback sequence. Five-minute and one-hour cache writes use their distinct
public rates when the transcript provides the TTL. Thinking tokens remain part of output rather
than being charged twice.

Grok Build totals come from persisted session updates. Interactive turns that never wrote a
completed-turn record will not appear.

Use **Past 24h** for an hourly chart covering the exact rolling 24-hour period. The **7 days**,
**30 days**, and **90 days** ranges use daily resolution. Cost and token toggles update both the
headline and chart, and refreshing rescans every connected environment.

The page warns when the latest calendar day's usage crosses the built-in budget levels. Claude
warnings use its API-rate estimate. API-equivalent warnings include subscription traffic such as
Codex. The warning level starts at $500 of Claude usage or $1,000 API-equivalent. Approval starts at
$1,000 or $1,500. The pause level is $2,000 for either measure.

T3 also applies two hard limits before it sends a new turn to any provider:

- A thread cannot continue after its latest reported context usage reaches the configured token
  limit, which defaults to 250,000 tokens and can be changed in General settings. Start a new thread
  instead of paying to resend the same long conversation. When this happens, the chat shows a
  warning with a **Handover to new thread** button. The button uses GPT
  5.6 Luna with high reasoning to summarize the thread, opens a new draft in the same checkout, and
  places the handover in its composer. It does not start the new thread, so you can choose its model
  and reasoning level before sending.
- At most eight top-level provider turns can run at once across T3. Ready, idle sessions do not
  count. Wait for a running turn to finish or interrupt it before starting another.

These limits cover work T3 launches directly for every provider and client. A provider CLI creates
its own internal subagents, so T3 cannot reject those before the provider starts them. Use the
agent-instruction fan-out limits and the independent usage watcher for that layer.

Opening the page starts a refresh, and a page left open refreshes every 30 minutes. Each refresh
hashes every observed transcript byte with bounded disk parallelism so same-size rewrites cannot
hide behind unchanged file metadata. It reuses cached parsed records for matching hashes and
for a grown file verifies the old prefix hash before parsing only its appended bytes. Rewritten
files are parsed from the beginning. Summary and thread scans are serialized against the same cache
and use request-start cutoffs, so one refresh represents one stable observed window.

Any daily chart zooms: drag across it to make the selection the new date window, and double-click
to return to the preset. The date fields beside the presets accept custom ranges up to 90 days.

The breakdown's **Thread** view drills into where the spend went: sessions group into the T3 Code
thread they belong to, with sessions that never ran through T3 Code listed under the first thing
you asked in them. Grok Build has no trusted prompt title, so its rows use a short session label.
Expanding a row splits its daily model-priced cost into cache writes, cache
reads, and fresh input plus output, alongside any Claude subagents the thread spawned.
Provider-reported totals are not split into estimated components.
Each connected environment contributes at most 40 rows, reserving room to group lower-cost rows
under **Other threads** by provider and project. Those grouped rows stay in the totals, so the
thread view still adds up to the selected project or full summary.
Rows that map to a thread carry a link that opens it.

The **Cache writes, estimated** total prices cache-creation tokens at each model's cache-write rate.
It only applies to model-priced records that report cache-creation tokens. Rows without cache
writes show a dash; incomplete or unavailable pricing is labeled **Unavailable** instead of zero.
Cache creation is a billing category, not evidence that a cache entry expired.

Usage is attributed to the project whose folder a session ran in, including sessions driven
outside T3 Code. The breakdown's **Project** view ranks projects by spend, and the project picker
narrows the whole page to one project; work that ran outside every project is grouped under
"Outside projects". Grok Build sessions record no folder, so they remain in overall totals but are
omitted from the project breakdown and project filters.
