# Review usage

The Usage page combines Codex, Claude Code, and Grok Build activity from your connected
environments. It reads the providers' local session history and shows a local public-list cost
estimate, processed tokens, cache savings, provider shares, and model breakdowns. Provider invoices
and subscription billing can differ from this estimate.

Grok Build totals come from persisted session updates. Interactive turns that never wrote a
completed-turn record will not appear.

Use **Past 24h** for an hourly chart covering the exact rolling 24-hour period. The **7 days**,
**30 days**, and **90 days** ranges use daily resolution. Cost and token toggles update both the
headline and chart, and refreshing rescans every connected environment.

Any daily chart zooms: drag across it to make the selection the new date window, and double-click
to return to the preset. The date fields beside the presets accept any custom range directly.

The **Cache writes, estimated** total prices cache creation at the model's rate, including separate
five-minute and one-hour rates when recorded. Cache writes do not establish that context expired.
Rows without cache writes show a dash.

The breakdown's **Thread** view drills into where the spend went: sessions group into the T3 Code
thread they belong to, with sessions that never ran through T3 Code listed under the first thing
you asked in them. Expanding a row shows a daily cost chart split into cache writes, cache reads,
and fresh input plus output, along with any Claude subagents the thread spawned and their share.
Provider-reported costs appear separately when their cache-component split is unknown.
The view names the 40 highest-cost rows and groups lower-cost rows under **Other threads** by
provider and project. Those grouped rows stay in the totals, so the thread view still adds up to
the selected project or full summary.
Rows that map to a thread carry a link that opens it.

Usage is attributed to the project whose folder a session ran in, including sessions driven
outside T3 Code. The breakdown's **Project** view ranks projects by spend, and the project picker
narrows the whole page to one project; work that ran outside every project is grouped under
"Outside projects". Grok Build sessions record no folder and always count there.
