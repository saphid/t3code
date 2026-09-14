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

If you pool accounts behind a CLIProxyAPI hub, **Add hub** on the Limits view shows the accounts
the hub manages. Each row shows its provider and instance name, or a small _CLI Proxy_ label for
hub accounts. When a connected provider reports limits for the same provider and email, its row
replaces the hub copy, keeping details such as banked reset credits. The hub copy remains visible
if the connected provider cannot report limits. Enter the hub's URL and management key; the key
is stored on the server and never sent back to a client. Emails are blurred until clicked, as in
provider settings.

The page opens on **7 days** of cost by project and remembers the period, metric, breakdown, grouping,
and sort you last used. The **Cost** and **Tokens** switch changes the headline, chart, shares,
and default row order. Input, Output, Cache reads, and Cache writes show and sort by dollars in
Cost mode and token counts in Tokens mode. The total column follows the selected metric too. The four summary tiles keep their labels and positions. Every preset retains half-hour source
buckets, including **24 hours**, **30 days**, and **90 days**. The chart groups those buckets
automatically: hourly for a day, six-hourly for up to ten days, daily beyond that. Use **Group**
above the chart to pin **30 minutes** through **1 day** instead; the hover cursor still advances in
30-minute increments. The stacked boundaries use shape-preserving curves, while the values remain
the exact totals for the selected grouping. The chart labels its value axis and marks each local
midnight, and hovering any point lists that interval's total with its largest series. The page
labels the latest time represented by the data. Usage refreshes in the background when the server
starts and every 30 minutes, so opening the page can use the last successful snapshot without
waiting for a transcript scan.
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

Choose **Custom** in the date row to type a start and end day. Custom ranges can span up to 90
days, and picking a preset again returns to a rolling window. Custom ranges cover whole local
calendar days, even after zooming into part of a day. Invalid ranges show an explanation and keep
the last valid data visible. The period controls identify the timezone.

Drag across the chart in either direction to select a narrower time range. The selection snaps
to half-hour source buckets and updates the chart, summary, and breakdown. Thread breakdowns use
the selected range too.
The date row shows the exact selected times. Drag again to narrow further; **Reset zoom** or a
double-click on the chart restores the range before your first selection. Press Escape to cancel
an unfinished drag. The Custom date controls remain available as a keyboard alternative.

Expand a project in the breakdown to see its threads: sessions group into the T3 Code
thread they belong to, with sessions that never ran through T3 Code listed under the first thing
you asked in them. Grok Build has no trusted prompt title, so its rows use a short session label.
Expanding a row splits its daily model-priced cost into cache writes, cache
reads, and fresh input plus output, alongside any Claude subagents the thread spawned.
Provider-reported totals are not split into estimated components.
Each connected environment contributes at most 40 rows per expanded project, reserving room to group lower-cost rows
under **Other threads** by provider and project. Those grouped rows stay in the totals, so the
thread view still adds up to the selected project.
Rows that map to a thread carry a link that opens it.

Each expanded project has **All providers** and **All models** filters. Model filtering includes
only that model's usage, even when a thread switched models or its subagents used another model.
Daily charts, cache costs, and token counts follow the filter. Shares are within the filtered
threads, and a filtered subtotal appears below them. The project row and main chart keep their
full totals. **Clear filters** restores all threads. Model filtering requires an updated environment;
older environments show an update message instead of returning misleading totals.

Star a project to keep it above the other projects. Sorting applies within favorites and within
the remaining projects. Click its star again to remove it from favorites.

Use **Columns** to show or hide the selected total metric, Share, Input, Output, Cache reads, and Cache writes.
The provider table also offers Sessions. Column choices and favorites are remembered on this client.
The nested thread table uses the same columns, with its own sortable headers. **Input** counts
uncached input; cache reads and cache writes are separate components. Output includes reasoning,
so the four token counts add up to Tokens without counting reasoning twice. Their dollar values
use each model's rates. Missing pricing or provider-reported totals that cannot be split show
**Unavailable**, and sort after priced values in either direction. Narrow windows let the table
scroll horizontally.

The **Cache writes, estimated** total prices cache-creation tokens at each model's cache-write rate.
It only applies to model-priced records that report cache-creation tokens. Rows without cache
writes show zero; incomplete or unavailable pricing is labeled **Unavailable** instead of zero.
Cache creation is a billing category, not evidence that a cache entry expired.

Usage is attributed to the project whose folder a session ran in, including sessions driven
outside T3 Code. The breakdown below the chart switches between **Projects**, **Providers**,
and **Models**; the chart stacks by the same dimension, and each row keeps its color in
both. Project and model colors stay attached to their identities when dates or rankings change.
Click a column header to sort by it and click again to reverse; the page remembers the sort
for each dimension. Hovering a row highlights its series in the chart. The checkbox at the start of
a row removes it from the chart and from the shown totals in the table footer, and the header
checkbox shows or hides every row at once. The table is the chart legend; there is no separate
legend underneath the graph. Work outside every project and usage whose transcript has
no trusted folder remain separate rows.

If a window looks stale, refresh Limits to re-check every provider and hub.

Pick `/usage-limits` from the composer's command menu, or send it as a message, to check the
current model's limits without leaving the conversation. The result opens above the composer and
closes when you dismiss it or send your next message. It uses the same snapshot as **Usage → Limits**, so it does not run the agent or refresh
anything. The command is offered only for providers that appear under **Usage → Limits**.

API-key accounts may not report subscription limits. This also applies to Claude connections
using a proxy through `ANTHROPIC_AUTH_TOKEN`.

## Connect a CLIProxyAPI hub

To see pooled accounts, open **Settings → Providers → Usage providers → Add hub**. Choose the
environment that will connect to the hub and enter its URL and management key.

The accounts appear under **Usage → Limits**. Codex accounts show banked reset credits; select an
account and choose **Use reset** to redeem one. No hub plugin is required.

This connection supplies usage information; configure
the provider separately to send agent requests through the hub. Remove the hub from the same
settings section when you no longer need it.

## Context and concurrency limits

T3 stops a thread after its latest reported context usage reaches the configured token limit,
which defaults to 250,000 tokens and can be changed in General settings. The chat then offers a
handover to a new thread in the same checkout. It prepares the handover without sending the new
thread, so you can choose its model and reasoning level first.

T3 also limits concurrent top-level provider turns. Ready, idle sessions do not count. Provider
CLIs may create their own internal subagents, which T3 cannot reject before the provider starts
them.

The **Providers** view adds a session count per provider, and the **Models** view lists every model
with its provider mark. Visibility is remembered separately for each breakdown, so the graph
always shows exactly the rows checked in the current table. Grok Build remains present in provider totals and
model rows even when its sessions have unknown project attribution.
