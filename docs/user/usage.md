# Review usage

The Usage page combines Codex, Claude Code, and Grok Build activity from your connected
environments. It reads the providers' local session history and shows API-equivalent token cost,
processed tokens, cache savings, provider shares, and model breakdowns. Subscription billing is
separate from the raw token cost shown here.

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

Use **Past 24h** for an hourly chart covering the exact rolling 24-hour period. The **7 days**,
**30 days**, and **90 days** ranges use daily resolution and end at the last complete calendar day.
The page labels the latest day or time represented by the data. Usage refreshes in the background
when the server starts and every 30 minutes, so opening the page can use the last successful
snapshot without waiting for a transcript scan. Cost and token toggles update both the headline and
chart. Manually refreshing rescans every connected environment and refetches model pricing on each
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
- At most eight top-level provider turns can run at once across T3. Ready, idle sessions do not
  count. Wait for a running turn to finish or interrupt it before starting another.

These limits cover work T3 launches directly for every provider and client. A provider CLI creates
its own internal subagents, so T3 cannot reject those before the provider starts them. Use the
agent-instruction fan-out limits and the independent usage watcher for that layer.
