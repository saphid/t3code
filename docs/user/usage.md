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

The **Limits** view shows how much of each subscription window you have used on Codex and Claude
Code, per connected environment: the session and weekly windows, plus a per-model weekly window
such as Fable when your plan has one. Each window is a bar from the moment it opened to its reset,
filled by the share of quota spent; a thin line marks how far into the window you are, which is
also where even spending would have put the fill, and the icon beside the label says whether you
are ahead of, on, or under that pace. Hover a bar for the exact reset time. Limits refresh on the
provider health-check interval and update live while a turn runs. API-key accounts have no
subscription windows and say so; that includes a Claude Code that reaches Anthropic through a proxy
via `ANTHROPIC_AUTH_TOKEN`, since the CLI then treats itself as an API-key client.

If you pool accounts behind a CLIProxyAPI hub, open **Settings → Providers → Usage providers**
and choose **Add hub**. Select the device that should connect to the hub; its accounts appear on
the Limits view. Remove hubs from the same settings section. Each limits row shows its provider
and instance name, or a small _CLI Proxy_ label for
hub accounts. When a connected provider reports limits for the same provider and email, its row
replaces the hub copy, keeping details such as banked reset credits. The hub copy remains visible
if the connected provider cannot report limits. Enter the hub's URL and management key; the key
is stored on the server and never sent back to a client. Emails are blurred until clicked, as in
provider settings.

The usage chart defaults to **7 days**, **Projects**, and **12h** grouping. Every preset retains
half-hour source buckets, including **24 hours**, **30 days**, and **90 days**. Use **30m**, **1h**,
**6h**, **12h**, or **1d** to change only the visual grouping; the hover cursor still advances in
30-minute increments. The page labels the latest time represented by the data. Usage refreshes in the background
when the server starts and every 30 minutes, so opening the page can use the last successful
snapshot without waiting for a transcript scan. The Cost and Tokens switch sits with the graph.
Manually refreshing rescans every connected environment and refetches model pricing on each
of them, so a newly released model that showed $0.00 gets a price without waiting for the daily
pricing update.

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
- **Settings → General → Maximum concurrent threads** controls how many threads can run at once
  on each server. The default is eight; choose a positive whole number or reset it to eight.
  Changes apply to new work immediately, including work started from other connected clients.
  Lowering the limit lets running work finish. Ready, idle sessions do not count; handover
  generation does. AI Enablers providers remain exempt from this concurrency limit.
  At the limit, wait for a running turn to finish or interrupt it, then retry the new turn.

These limits cover work T3 launches directly for every provider and client. A provider CLI creates
its own internal subagents, so T3 cannot reject those before the provider starts them. Use the
agent-instruction fan-out limits and the independent usage watcher for that layer.

The presets and custom date fields share one date-selection row. Custom ranges can span up to 90
days.

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
outside T3 Code. Each project has the same color in the stacked graph, its legend, and the project
breakdown. Hovering any of those locations highlights the same project everywhere. Click projects
to show or hide several at once, or use **Select all** and **Deselect all**. Work outside every
project and usage whose transcript has no trusted folder remain separate groups.

The left side lists providers and their models. Click a provider to show or hide all of its models,
expand it to control individual models, and use the **Providers** graph when a provider-level view
is more useful. Grok Build remains present in provider totals and model controls even when its
sessions have unknown project attribution.
