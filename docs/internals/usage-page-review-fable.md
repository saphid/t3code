Review by Claude Fable 5.1, high effort, through Claude Code. Requested by Alex on 2026-09-14. Read-only run, no child agents or implementation changes. Review cost: $3.06 API-equivalent. Story source: [usage-page-user-stories.md](usage-page-user-stories.md).

# Usage page review: Design A, `design/usage-page-a` at de78158997

Basis: source inspection of the web components, shared merge and cost helpers, contracts, server thread and aggregation code, and the focused test files. No browser, server, or screenshot was available to me. **Visual layout is not independently verified.** Primary-agent Chrome evidence is cited only where marked.

## 1. Outcome and prioritized findings

The redesign implements every requested story at least partially in code, and the accounting layer is honest about missing prices in both directions. The main gaps are in period selection feedback, series color stability, unit consistency in Tokens mode, and completeness signals that the merge computes but the page never shows.

**Verified defects (code inspection)**

1. **Project and model colors are assigned by rank, not identity.** `apps/web/src/components/usage/UsagePage.tsx:186-190` and `:207-211` pick `SERIES_COLORS[index]` from `merged.projects`, which `usageMerge.ts:691` sorts by cost. Any drag selection, preset change, or refresh that reorders projects recolors every row and series. US-06 asks for stable colors; the row and chart agree with each other but not with the previous view. Providers are exempt because they use fixed colors.
2. **Invalid custom ranges are rejected silently.** `UsagePage.tsx:395-400` returns early for end before start or spans over 90 days, and the controlled input snaps back. US-02 requires an explanation.
3. **The second summary tile mislabels its supporting value in Tokens mode.** `UsagePage.tsx:562-572` shows label "Cost" with a dollar headline and a detail line of token counts. US-01 acceptance says labels and supporting values match units. It also drops the "estimate" qualifier that Cost mode carries.
4. **Doc and implementation disagree on empty cache writes.** `docs/user/usage.md:118` says rows without cache writes show a dash. The live cell path in `UsageColumns.tsx:96-97` renders `$0.00` or `0`. The dash lives only in `UsageCacheWriteCell.tsx`, which is reached solely from the unmounted `UsageThreadTable` component.
5. **Dead code shipped with the redesign.** `UsageThreadTable` (`UsageThreadTable.tsx:46-167`) and `UsageCacheWriteCell` are referenced only by tests and by the `ThreadRowGroup` export in the same file. `UsageProviderChart.tsx` survives only for `niceScale`. Not a user-facing bug, but it means the thread-table tests exercise a component users cannot reach.
6. **Custom after a selection hides a sub-day start.** Choosing Custom while zoomed keeps the selection's exact instants (`UsagePage.tsx:491-494`), then editing only one date preserves the other edge's mid-day time (`:396-397`) while the date input shows a whole day. Affects US-02 and US-03.
7. **Unknown attribution cache writes are always Unavailable in Cost mode.** `UsagePage.tsx:316` hardcodes `null` when writes exist because timeline cells lack `cacheWriteUsd` (`usageMerge.ts:77-88`). Reasonable given the data, but it is an invented gap rather than a pricing gap. US-04 and US-13.

**Design concerns**

8. **Chart tooltip clipping at narrow widths.** `UsageStackedChart.tsx:411` flips the tooltip left at 58 percent regardless of container width, with a fixed 14rem box offset 12px (`:584-588`). By geometry it fits when the chart is at least roughly 575px wide, so a 900px window is fine, but a narrow split view will clip against the right edge. US-11.
9. **Hiding every row shows "No usage in this window."** `UsageStackedChart.tsx:577-581` keys the message on `peak === 0`, which is also true when the user unchecked everything. US-06.
10. **Completeness signals are computed and dropped.** `duplicateSources`, `unpricedShare`, `providerReportedShare`, pricing status, and `staleEnvironments` are never rendered in the Usage view (only stale environments feed a thread failure count at `UsagePage.tsx:764`). US-13 is inferred, so this is a scope question, but the old page may have shown some of these.
11. **Thread drill-down ignores the metric.** The daily component chart and subagent lines are dollars only (`UsageThreadTable.tsx:327-405`). In Tokens mode the nested rows show tokens and the expanded detail shows dollars. US-04 and US-14.
12. **Every model-filter change is a server transcript rescan.** `UsageProjectThreads.tsx:67` re-keys `useUsageThreads` on the model, and `UsageService.ts:1777-1785` builds a fresh accumulator per request. The scan cache mitigates this, but expanding several projects and toggling models multiplies work on remote environments. Performance question for US-10.
13. **Default column set is wide.** With `hiddenColumns` undefined, projects show seven numeric columns plus a 16rem name column (`UsageBreakdownTable.tsx:134-137,181`). Horizontal scrolling is the fallback. Whether Input, Output, and Cache reads should be on by default is a product decision.

**Questions**

14. An explicit sort choice persists across the Cost/Tokens switch (`UsagePage.tsx:377-378`). Sorting by Input re-evaluates in the new units, but sorting by Cost stays on Cost in Tokens mode. Is that intended?
15. Refresh on the Limits view calls `refreshProviders` only for the primary environment (`UsagePage.tsx:415-418`); the doc says it re-checks every provider and hub.

## 2. Story-by-story assessment

**US-01 Understand activity at a glance. Status: partial.** The user opens Usage and sees four tiles in a `dl` grid that auto-fits 12rem columns (`UsagePage.tsx:548`), so four fit on one row above about 816px and wrap below. In Cost mode: "API-rate estimate" with session count, "Tokens" with cached/uncached/output detail, "Cache writes, estimated" or "Unavailable", and "Cache savings". The estimate label avoids implying a subscription charge. Gap is finding 3 in Tokens mode. Evidence: code; `UsagePage.test.tsx` only checks rendering.

**US-02 Select a useful period. Status: partial.** A segmented toggle offers 24 hours, 7 days, 30 days, 90 days, and Custom (`UsagePage.tsx:485-506`). Presets are rolling half-hour windows from now; the text beside them shows exact start and end (`:526-529`). Custom exposes two native date inputs bounded at 90 days. All summaries, chart, breakdown, and thread queries take the same window object (`:464-470`). Gaps: no timezone is displayed anywhere (`formatDateTimeShort` omits the zone name), and findings 2 and 6. The 7-day default is verified by `usagePagePreferences.test.ts:31`.

**US-03 Zoom into a spike. Status: met in code, visual unverified.** The user presses on the chart and drags; `chartSelection` snaps to half-hour buckets in either direction and ignores moves under 6px (`usageChartSelection.ts:12-15`, tested). On release the page sets preset "selection", remembers the prior window as `zoomBase`, and a "Reset zoom" button appears (`UsagePage.tsx:665-676`). Double-click or Reset restores the pre-zoom window; Escape cancels an in-progress drag. The selection rect spans `TOP` to `plotHeight`, so it ends at the baseline (`UsageStackedChart.tsx:539-549`), and the focus-ring class is dropped while a selection exists (`:422`). Thread requests carry `sinceTime`/`untilTime`. The keyboard alternative is Custom at day granularity only. Primary-agent evidence claims both directions and reset worked in Chrome; I did not see it.

**US-04 Compare dollars or tokens consistently. Status: met, with finding 11.** The Cost/Tokens toggle is persisted and drives `UsageMetricCells` (`UsageColumns.tsx:70-77`), which shows `componentCosts.*Usd` in Cost mode and token counts in Tokens mode, rendering "Unavailable" for null. Sorting uses the same switch (`usageBreakdownSort.ts:60-69`, tested at `:48-76`). Footer and filtered subtotals aggregate with `addUsageCostComponents`, which keeps a null sticky (`usageCostComponents.ts:10-21`). Server only prices components for model-priced records; provider-reported and unpriced records yield null (`usageAggregation.ts:290-304`, tested at `:67-88`). Explicit Cost and Tokens columns remain visible by default.

**US-05 Find the largest contributors. Status: met.** Every header is a button with `aria-sort`, an arrow that appears on hover and stays when active, and click-to-reverse (`UsageBreakdownTable.tsx:42-85`). Null values sink in both directions and ties keep order (`usageBreakdownSort.ts:78-99`, tested). Favorites are partitioned first, each group sorted (`UsageBreakdownTable.tsx:126-133`). Sort is stored per dimension plus a shared `threads` slot. There is no Threads dimension; the old preference migrates to Projects (`usagePagePreferences.ts:78`, tested).

**US-06 Use the breakdown as the legend. Status: partial.** Each row has a color swatch, a leading checkbox that hides it from the chart and shown totals, and a header checkbox with an indeterminate state for show/hide all (`UsageBreakdownTable.tsx:166-174, 222-228`). Hovering a row highlights its series; hovering a series highlights the row. The footer switches between "Total" and "Shown, N of M". No legend renders under the chart. Gaps: findings 1 and 9. Hidden state is intentionally session-only.

**US-07 Choose the columns I need. Status: met.** A Columns outline button opens a checkbox menu for Cost, Share, Tokens, Input, Output, Cache reads, Cache writes, plus Sessions on Providers (`UsageColumns.tsx:22-54`). Choices persist in `hiddenColumns`; hiding the active sort column resets that view to name ascending (`UsagePage.tsx:716-736`). Thread rows receive the parent's column list so cells align (`UsageProjectThreads.tsx:233-240`). The table wrapper is `overflow-x-auto`, and the checkbox cell has fixed `w-10 min-w-10` in header and body. Primary-agent evidence reports header and body checkbox edges aligned at x304; I did not measure.

**US-08 Keep important projects nearby. Status: met.** Star buttons render for every project row including Outside and Unknown (`UsageBreakdownTable.tsx:231-250`), with `aria-pressed`, persisted as series keys that include the environment id. Test `UsageBreakdownTable.test.tsx:66-79` confirms Outside and Unknown can be favorited and rise first. One caveat: keys embed the environment id, so re-pairing an environment orphans favorites.

**US-09 Investigate threads within their project. Status: met.** Clicking a project label (with chevron and `aria-expanded`) mounts `UsageProjectThreads`, which fetches only then. States: "Loading threads…", "No threads match these filters", "Thread activity could not be loaded", a remainder notice for folded rows, and an environments-failed count (`UsageProjectThreads.tsx:204-285`). Server caps named rows at 40 per environment (`UsageService.ts:104`) and folds the rest into "Other threads (N)" (`usageThreads.ts:608`), tested. Unknown attribution cannot expand, which is correct since it has no project key. Thread sort is one shared preference across all expanded projects, which may surprise but is defensible.

**US-10 Filter project threads accurately. Status: met.** Two native selects, "All providers" and "All models", sit in the expanded header with a Clear filters link. The provider filter narrows the environments and providers sent in the request; the model filter is a server-side record predicate applied after snapshot dedupe (`usageThreads.ts:171-173`), tested for model switches, subagents, and dedupe order (`usageThreads.test.ts:91-125`). Old environments disable the select with an update message, and the atom also counts pre-v14 environments as failed when a model is set (`state/usage.ts:349-353`). Explanatory text states filters affect only threads. Concern 12 applies.

**US-11 Read the page comfortably. Status: unverified.** Code shows consistent cell classes, `min-w-64` on the name column, `max-w-64 truncate` labels with Base UI tooltips that handle collision, and the chart-tooltip flip at 58 percent. I cannot confirm spacing, star and swatch alignment, or ring behavior without screenshots. Finding 8 is a geometric risk below roughly 575px chart width.

**US-12 Read trends at the right resolution. Status: met.** Auto grouping picks 1h up to a day, 6h up to ten days, else 1d (`UsageStackedChart.tsx:62-68`); the Group menu pins 30m to 1d. Y-axis labels, local midnight ticks thinned to eight, and a hover card listing total, top six series, and top three models of the highlighted series are present. Empty state text exists.

**US-13 Trust the numbers. Status: partial.** The status line reports data-through, snapshot time, refresh cadence, partial reporting, refresh errors, and failed environments (`UsagePage.tsx:883-926`). Merge dedupes physical sources by fingerprint and truncates to a common cutoff (`usageMerge.ts:168-242`). Finding 10 lists what is computed but hidden.

**US-14 Continue an investigation. Status: met, with finding 11.** Thread rows with a T3 thread id show an "Open thread" icon that navigates to the environment-scoped route (`UsageThreadTable.tsx:225-247`). Expanding a row shows a daily stacked SVG and subagent lines. The model filter applies to daily and agents server-side.

**US-15 Adjacent features. Status: met, existing.** Limits toggle, Model prices dialog with per-row reset, context-aware refresh icon, and the fixed-threshold budget alert are all present. None changed in this redesign beyond placement. Question 15 stands.

## 3. Feature-to-story inventory

| Feature                                                 | Story                                   |
| ------------------------------------------------------- | --------------------------------------- |
| Four summary tiles                                      | US-01                                   |
| Preset toggle, Custom dates, exact-time text            | US-02                                   |
| Drag select, Reset zoom, double-click, Escape           | US-03                                   |
| Cost/Tokens toggle                                      | US-04                                   |
| Sortable headers, per-dimension sort persistence        | US-05                                   |
| Row checkboxes, header checkbox, hover sync, swatches   | US-06                                   |
| Columns menu, sort reset on hide                        | US-07                                   |
| Stars, favorites-first partition                        | US-08                                   |
| Expandable projects, thread rows, remainder rows        | US-09                                   |
| Provider and model selects, Clear filters, version gate | US-10                                   |
| Group menu, axes, hover card                            | US-12                                   |
| Status line                                             | US-13                                   |
| Open thread link, daily chart, subagent lines           | US-14                                   |
| Limits, Model prices, refresh, budget alert             | US-15                                   |
| Dimension toggle Projects/Providers/Models              | none (implied by US-05/06)              |
| Sessions column on Providers                            | none                                    |
| "Unknown attribution" synthetic row from timeline cells | none (US-08 mentions it only for stars) |
| Skeleton while settling                                 | none                                    |
| Preference migration from old Threads view              | none                                    |

## 4. Story quality

**Confirmed intent** (from the draft's decisions section): project colors from Design A, breakdown as legend, no legend under the chart, threads only under projects, mobile deferred, server fields allowed for accurate filtering.

**Inferred or unconfirmed choices that the implementation made:**

- **Explicit Cost and Tokens columns alongside the units toggle.** In Tokens mode the table shows a Cost column in dollars, Input/Output/Cache reads/Cache writes in tokens, Share by tokens, and a Tokens column. The mixed row is readable but doubles as the confusion US-04 tried to prevent: a user scanning right-to-left sees dollars, then tokens, then tokens. The draft rightly flags this as an implementation choice. Acceptance should say whether the toggle is "units for components" or "units for the page".
- **Thread-only filters.** The text explains it, but there is no acceptance criterion for what the project row and chart should do. A user who filters to one model and then reads the project row's unchanged total may think the filter failed. Decide whether a filtered project should show a badge or dimmed total.
- **Partial component pricing.** "Unavailable" for null is correct, but the stories do not define behavior when a row is partly priced across models. Current behavior makes the whole cell Unavailable if any contributor is null (`usageCostComponents.ts:15`). That is conservative and should be stated as intended.
- **Keyboard date selection.** US-03 says keyboard users have an alternative, but Custom is day-granular and the chart is not keyboard-navigable. Either accept day granularity as the criterion or add arrow-key selection.
- **Narrow layouts and tooltip edges.** US-11 names "tooltips remain readable near the right edge" without a width. Specify the minimum supported width; the current code is safe at about 900px and not below roughly 575px chart width.
- **Timezone clarity** in US-02 has no matching UI.
- **Color stability** in US-06 should say "stable across period changes", which is the case that fails today.

**Missing stories worth adding:** reconnecting after an environment re-pairs (favorites keyed by environment id), seeing data-quality shares that the merge computes, and a mobile decision beyond "deferred" since contracts are additive and mobile already renders usage.

## 5. Recommendations

Decide three things before further UI work: whether the units toggle should govern the whole row or only components, whether project totals should reflect thread filters or stay explained, and the minimum window width the layout must support. Then fix the two clear defects that need no product input: color assignment by stable key and a visible message for rejected custom ranges. Add a timezone label to the period text.

For verification, request screenshots at 900px and at about 640px showing a held drag, a right-edge hover, the Tokens-mode summary row, and an expanded project with a model filter active. Add a focused test that colors survive a project reorder, and remove or wire up the unmounted thread table so tests cover the live path.
