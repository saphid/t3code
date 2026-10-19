### Problem or use case

**Usage** says which provider and model spent the money, but not where it went: which project, which thread (and the sub-agents it started), which account paid, or which machine. With several projects, accounts and connected environments, that is the question people open the page to answer, and today it cannot be answered there. The last attempt (#9015, project breakdown only) was closed for missing approval, so I'm asking for direction here first.

### Proposed solution

One **Group by** switch on the Cost and Tokens views: **Projects**, **Providers**, **Models**, **Environments** (with more than one selected), and **Threads** inside a focused project. It drives a stacked chart and an expandable list that doubles as the chart's legend. Rows open in place (a project lists its threads, a thread its sub-agents), and **Focus** narrows the page to one row.

On the server, `getUsageSummary` takes an optional `groupByThread`. Buckets then carry the provider instance and a thread index, attributed from the V2 read model (`nativeThreadRef`, subagent `nativeTaskRef`, lineage). Sessions run outside T3 are placed by the folder they ran in. Without the flag the summary is unchanged, so older clients and mobile see no difference.

Across environments: each history folder counts once, under the environment that ran the work in its own threads. Same-named servers are told apart by host. An environment that is offline shows the usage it last reported, marked with when it was read, instead of a spinner or a missing total.

### Why this matters

Anyone running more than one project, account or machine. It also makes the cost of sub-agents and cache-heavy threads visible, which is where unexpected spend usually hides.

### Smallest useful scope

The implementation is ready as #15902, green and mergeable, with before/after media and a live three-server test. It is one PR because the pieces share one data path (attributed buckets, merged across environments). If you'd rather take it in parts, I can split it along these lines, each usable on its own:

1. Server attribution plus the Projects and Threads breakdown.
2. Accounts and Environments grouping, with multi-environment ownership of shared folders.
3. Offline environments showing saved usage.
4. Zoom and exact dates (overlaps #9014).

### Alternatives considered

- A project filter only (#9015): answers "how much did project X cost" but not "which thread", and still double counts shared folders across environments.
- Server-side reports per project: would not merge across environments and would need a second contract.

### Risks or tradeoffs

- Payload: threads and projects are only sent when asked for, and only for usage inside the window.
- The scan cache moves to v6 to keep each session's folder; live transcripts re-parse once.
- Offline saved usage lives in IndexedDB per browser (up to four windows per environment) and is cleared when an environment is removed.
- Mixed versions: older servers fall back to whole days for spans they reject hourly; mobile is untouched.

### References

- #15902 (implementation)
- #9015 (closed, project breakdown)
- #9014 (zoom and custom dates)
- #13810 (longer usage history)

### Contribution

Implemented and maintained by me; I'll follow whatever scope or split you prefer.
