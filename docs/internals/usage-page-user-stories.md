# Usage page user stories

Drafted from Alex's Usage redesign requests on 2026-09-14. These stories record the requested outcomes, not a claim that implementation is complete. Review target: Design A, branch `design/usage-page-a`, commit `de78158997`. Both original redesigns started from `bc93a41521`.

## Scope and decisions

Web and desktop share this UI. Mobile UX is deferred. The initial client-only restriction was relaxed to allow accurate model filtering within threads; component dollar accounting also required optional server/contract fields. Review new wire fields for honest mixed-version behavior.

Design A's project colors are preferred. The breakdown is the chart legend, with no duplicate legend under the chart. Threads belong under projects, never as a top-level dimension. The reference for feature ideas is the local token-usage project on port 8742, not an instruction to copy every feature from it.

## Requested user stories

### US-01: Understand activity at a glance

As a person using coding agents, I want API-rate estimates, tokens, cache-write estimates, and cache savings together so I can understand the selected period without hunting through the page.

Acceptance: all four summaries share one row when space permits; narrower windows stay readable. Estimates are not represented as subscription charges. Labels and supporting values match their units.

### US-02: Select a useful period

As a user investigating usage, I want date presets and a custom period so I can compare recent activity or investigate a particular interval.

Acceptance: the active period and timezone are clear; invalid or unsupported ranges are explained; all relevant summaries, charts, and breakdowns use the selected period.

### US-03: Zoom into a spike

As a user investigating a spike, I want to click and drag over the chart so I can inspect that exact time frame.

Acceptance: dragging works in both directions; only the selected region receives the drag outline; the rectangle stops at the baseline. The selected period is visible and applies to nested threads too. Reset and cancellation are discoverable. Keyboard users have a period-selection alternative.

### US-04: Compare dollars or tokens consistently

As a user comparing activity, I want the Cost/Tokens toggle to control component values and sorting so I do not mistake token volume for dollar impact.

Acceptance: Input, Output, Cache reads, and Cache writes display and sort in the selected units across Projects, Providers, Models, and nested Threads, including subtotals. Missing component prices show unavailable rather than invented zero. Explicit total Cost and Tokens columns may remain available through Columns; this is the current implementation choice, not a separately confirmed preference.

### US-05: Find the largest contributors

As a user deciding what to investigate, I want sortable project, provider, and model breakdowns so I can rank usage by the metric that matters to me.

Acceptance: headers make sorting discoverable, direction is visible and reversible, null values sort last, and favorite/nonfavorite groups retain meaningful ordering. There is no standalone Threads dimension.

### US-06: Use the breakdown as the legend

As a user reading the chart, I want table rows to identify their chart series so I can compare colors and hide or restore contributors in one place.

Acceptance: stable row colors match the chart; row visibility and show/hide-all are reversible; shown totals and hidden state are understandable; no extra legend sits underneath the chart.

### US-07: Choose the columns I need

As a user with a particular question or a narrow window, I want a Columns button so I can enable or disable metrics without losing the breakdown.

Acceptance: Input, Output, Cache reads, and Cache writes are available, choices persist, nested rows remain aligned, and wide tables scroll without crushing checkboxes, stars, swatches, or names together.

### US-08: Keep important projects nearby

As a user monitoring particular projects, I want to favorite them so they remain easy to find.

Acceptance: stars are available for every project-category row, including Outside T3 projects and Unknown attribution; favorites persist, appear first, and can be removed. Stars and visibility checkboxes are distinct controls with consistent alignment.

### US-09: Investigate threads within their project

As a user investigating project usage, I want threads nested beneath the project so I retain context while finding the responsible conversations.

Acceptance: expanding and collapsing a project is clear; threads share the parent's columns and selected period; their metrics can be sorted; loading, empty, failure, and grouped remainder states are explained. There is no option to sort the entire top-level breakdown by thread.

### US-10: Filter project threads accurately

As a user whose threads use different runtimes and models, I want provider and model filters inside a project's thread breakdown so I can isolate the usage I am investigating.

Acceptance: filtering counts actual record-level model attribution, including model switches and subagents; no attribution is guessed from the current thread model. Clear filters restores the view. The UI explains whether filters affect only threads or also project/chart totals, and old environments cannot silently return inaccurate model-filtered results.

### US-11: Read the page comfortably

As a user on web or desktop, I want a clean layout so the controls and values are easy to scan at normal and narrower window widths.

Acceptance: checkboxes align between header and rows; labels have breathing room; stars and swatches align across named and special project rows; tooltips remain readable near the right edge; selection does not outline the entire graph; the compact summary does not collide or mislabel content.

## Supporting stories inferred from existing behavior

These are useful review coverage, but were not all separately requested during this redesign. Do not expand implementation scope merely because they are listed.

### US-12: Read trends at the right resolution

As a user comparing short and long windows, I want sensible automatic grouping, optional manual grouping, axes, and hover details so I can read both overall trends and particular intervals. Check grouping bounds, empty data, local time labels, and tooltip coverage.

### US-13: Trust the completeness and meaning of the numbers

As a user combining environments and providers, I want freshness, partial reporting, pricing availability, and attribution limitations explained so I know what conclusions the data supports. Check duplicate-source handling, refresh states, unpriced/provider-reported records, component accounting, and remainder reconciliation.

### US-14: Continue an investigation

As a user who found a costly thread, I want to open it and inspect daily usage and subagents so I can understand what caused the activity. Check navigation and which details follow the selected filters and metric.

### US-15: Understand adjacent Usage features

As a user navigating the Usage page, I want Model prices, refresh, budget messages, and the Limits view to have clear purposes. Inventory these existing features separately from the redesign, including provider coverage and connection management where relevant. Do not treat unrelated Limits functionality as newly requested work.

## Review deliverable

For each story, explain the user outcome, visible controls/features, implemented behavior, evidence, status (met, partial, missing, or unverified), and important gaps. Distinguish code inspection, automated tests, primary-agent interaction evidence, and reviewer visual inspection. Include features with no matching story and unresolved product decisions. Do not silently turn implementation details into approved requirements.
