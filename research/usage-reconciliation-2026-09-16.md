# Usage reconciliation, September 16, 2026

T3's installed Usage page is severely undercounting Claude activity. A separate local dashboard also undercounts, for different reasons. Other tools use the same provider accounts without writing the transcript files either dashboard scans.

All comparisons below use September 9, 2026 at 00:00 UTC through September 16 at 00:00 UTC, end exclusive. These are seven complete UTC days. Today's partial day is excluded. The provider API returned seven complete daily buckets even when the query ended later on September 16. Local Sydney half-hour buckets were converted to UTC before comparison.

The audit fetched Anthropic organization usage and cost APIs with the existing local credential helper, OpenAI's authenticated ChatGPT/Codex usage endpoint, and Amp's authenticated usage CLI. It read local databases in read-only mode, provider transcripts, saved T3 usage data, and the installed application's bundled parser. No browser was opened, inference workload launched, running agent stopped, or live application changed.

| Anthropic comparison                          |      Tokens |    USD | What the dollars mean                                                              |
| --------------------------------------------- | ----------: | -----: | ---------------------------------------------------------------------------------- |
| Installed T3 parser, Claude models only       |  32,137,092 |  48.85 | Local token estimate with cache TTL pricing                                        |
| Independent dashboard, Claude models only     | 430,585,504 | 545.85 | Local token estimate, first streamed snapshot and five-minute cache prices         |
| Corrected local replay                        | 431,133,122 | 666.40 | Final streamed snapshots, serving-model fallback, actual cache TTL                 |
| Anthropic API, `t3-code` key                  | 454,298,700 | 849.69 | API-reported tokens priced at published standard rates, not a key-specific invoice |
| Anthropic API, `gcp-review-bot-prototype` key |   6,688,579 |  86.65 | API-reported tokens priced at published standard rates                             |

The two active keys total $936.34 at published rates. The organization Cost API returned $11,414.90 for the same period, but that is the entire organization's cost, not Alex's spend. Its documented grouping does not provide a per-key invoice. Other keys created by the same owner were checked: `AlexS T3 Code 2`, `alex-usage-readonly`, and `algolia-agent-fed-search` had no Messages usage rows in this interval.

The independent dashboard's whole `claude` category actually shows $548.59 and 448,789,640 tokens. That includes $2.74 and 18,204,136 tokens from GLM running through the Claude executable. Provider labels identify the executable, not necessarily the company serving the model. The Claude-only row above removes that contamination.

The decisive T3 defect is in the installed application's `parseClaudeLineRecords`, at line 176406 of the extracted server bundle. It sees an `iterations` array, requires each iteration to name its own model, and drops an iteration when `model` is null. Actual Claude records have a valid parent `message.model` and a serving iteration with `model: null`.

The audit replayed 382 recent Claude transcript files, approximately 166 MB, with the installed parser. It retained 342 distinct priced Claude requests. A diagnostic fallback to the parent model for the serving iteration retained 3,000. It recovered 398,996,030 tokens and $617.55 of local estimated usage. There were no unnamed non-serving iterations in the scanned period. This supports the fallback for the serving iteration without guessing the model of earlier attempts.

Run the minimal reproducer from the repository root:

```sh
node tmp/usage-audit-20260916/reproduce.mjs
```

It deliberately exits 1 against the installed parser:

```text
installed_records: 0
expected_records: 1
diagnostic_fallback_records: 1
recovered_tokens: 25558
FAIL: installed parser drops a real Claude usage record when its serving iteration has model:null.
```

The live scan cache confirms the same loss. For example, the GCP PAM transcript beginning September 15 contains hundreds of assistant usage snapshots, while T3's cache stores zero usage records for that file. The cache has already advanced to the file's end. A production repair therefore needs a parser change and invalidation of the affected scan cache, derived ledger, and saved summaries. Merely refreshing the page will not reparse unchanged files. No such production repair was applied during this audit.

The independent dashboard has two separate defects in `~/projects/onboarding/.scratch/token-spend/export_daily.py`:

- `aggregate_claude_file` retains the first occurrence of a message/request key. Later streamed snapshots contain additional output. Keeping the final snapshot adds 547,618 output tokens and $22.43 in this interval.
- `load_rates` exports one cache-write price, and the parser does not preserve five-minute versus one-hour cache creation. Pricing actual TTLs adds $98.12. Anthropic prices five-minute writes at 1.25 times input and one-hour writes at twice input. [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing).

Thus $545.85 becomes $568.27 after final-snapshot accounting and $666.40 after cache TTL accounting. This is still $183.29 below the key's API-priced usage. The residual is 23,165,578 tokens. Amp reports 17,978,824 Anthropic tokens outside the local Claude transcript scan, but its accounting scope differs, so this is evidence of an additional consumer, not an exact dollar reconciliation. The API also reports 2,780,030 Haiku tokens and 353,207 Opus 4.8 tokens with no matching locally scanned Claude model records. Their originating workloads remain unattributed. Fable 5's API and corrected local counts match exactly in every token category.

| Other consumer or route       | Evidence for the same seven complete UTC days                           | Accounting implication                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Amp linked OpenAI             | 1,114,324,096 tokens                                                    | Consumes the linked OpenAI account; Amp bills these inference tokens at $0                                             |
| Amp linked Anthropic          | 17,978,824 tokens                                                       | Provider-side usage is excluded from Amp's own dollar total                                                            |
| Amp native models and tools   | $7.05 recorded usage, all covered, $0 paid credits                      | Draws the included Amp tier agent pool, not a new $7.05 cash payment                                                   |
| Amp orbs                      | 9h 41m runtime, 38.9 normalized included orb hours                      | Separate allowance from the agent dollar pool                                                                          |
| OpenCode through AI Enablers  | 1,713,708,205 tokens across 11,932 assistant usage records              | Missing from T3's installed usage sources; local recorded cost is zero because no monetary amount is recorded          |
| GLM through Codex/CLIProxyAPI | 1,209,968,099 tokens recorded under T3's `codex` provider               | These are GLM tokens, not OpenAI usage; T3 leaves 6,781 records unpriced                                               |
| GLM through Claude            | Approximately 18.2 million tokens                                       | Labelled `claude` despite not being Anthropic inference                                                                |
| GCP review bot                | 6,688,579 API tokens, $86.65 at list prices                             | Separate active Anthropic key; absent from the local provider transcript dashboards                                    |
| Cursor                        | Installed and running, local conversation metadata updated September 10 | Activity confirmed; no billing total established from the inspected local stores                                       |
| Hermes                        | Two recorded custom-provider calls, last seen September 4               | No usage found in this seven-day interval                                                                              |
| Codex weekday morning brief   | Active scheduled automation at 07:30 on weekdays                        | Another scheduled consumer; native Codex transcripts may already include it, so do not add a separate estimated charge |

The OpenCode split is 688,762,425 tokens on `enablers/xlarge` and 1,024,945,780 on `enablers/large`. These aliases need the AI Enablers provider-side meter to establish cost. Local zero-valued fields do not prove zero infrastructure cost.

T3's GLM pricing failure is independently reproducible using its installed `parseRateTable` and `lookupRate`. The rate file has qualified GLM entries with inconsistent cache-write defaults, so T3 refuses to create an unambiguous bare-name alias. `lookupRate(table, "glm-5.3-flash")` returns null. The independent exporter chooses the first suffix match instead. This explains most of their Codex-dollar difference: T3 reports $1,193.37, while the independent dashboard reports $1,375.31, including GLM. Actual GPT models in T3 total 1,986,316,938 tokens; the full Codex-provider total is 3,196,322,174.

OpenAI's live ChatGPT/Codex API reports a Business account with 86,871.603 credits used against a 250,000-credit individual workspace limit, approximately 35 percent, and 163,128.397 remaining. The control resets October 1 UTC. It does not return a dollar invoice or this seven-day token history. The returned credit object says `unlimited: false`; older local notes claiming unlimited usage or guaranteed zero marginal cost should not be used as current billing evidence. This result does not, by itself, prove an overage charge either.

No OpenAI Platform admin key was available in the environment or the named local Keychain entry. Consequently the organization Costs endpoint could not be queried. A ChatGPT subscription credential and an API Platform organization billing credential cover different accounting scopes. [OpenAI organization usage API](https://developers.openai.com/api/reference/python/resources/admin/subresources/organization/subresources/usage).

For Anthropic, the API token fields preserve uncached input, cache reads, five-minute and one-hour cache writes, and output separately. All queried usage rows were standard service tier. Dollar estimates here use the current official rates for Fable 5.1, Fable 5, Opus 5, Opus 4.8, and Haiku 4.5. The organization Cost API reports decimal cents, converted to dollars. [Anthropic Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api).

The local usage guard was also checked. It reported a $138.73 Claude estimate for `Metis Deployment Speed / Measure Faster Multi-AZ Provisioning`, above its $100 pause threshold, and $83.65 for `Metis Perf Lab / Reproduce Snapshot N+1 Fix`, above its warning threshold. Those figures come from the imperfect independent exporter and may understate actual usage. The audit's own T3 Code Contrib project remained below its configured budget threshold. No child agents were launched.

Evidence and executable probes are in `../tmp/usage-audit-20260916/`: `collect.py`, `reproduce.mjs`, `reconcile.mjs`, `reconciliation.json`, `t3_utc_summary.json`, the provider API snapshots, the Amp reports, and `other_consumers.json`. Credentials and conversation message bodies are not stored in these audit artifacts. Raw provider results include private account usage metadata and should remain local.

The next implementation should repair the serving-iteration parser and rebuild its caches, correct the independent exporter's snapshot and TTL accounting, and add separately labelled provider-account feeds for Amp, OpenCode/AI Enablers, and bot keys. OpenAI credit consumption, API-equivalent estimates, included allowances, and provider-reported costs need separate fields. The remaining $183.29 Anthropic difference is not fully attributed and should remain visible as an unresolved reconciliation amount.

Follow-up: the record-dropping defect is specific to Fork Nightly's downstream changes. The same 25,558-token fixture was tested against both installed applications and the source of the latest upstream Nightly release available on September 16:

| Build                                             | Evidence tested                                                     | Records retained | Tokens retained |
| ------------------------------------------------- | ------------------------------------------------------------------- | ---------------: | --------------: |
| Fork Nightly `0.0.41-nightly.20260914.1722956577` | Installed bundled parser, build commit `1f55449b7947`               |                0 |               0 |
| Normal Nightly `0.0.34-nightly.20260831.2100`     | Installed bundled parser, build commit `ee16efeab47b`               |                1 |          25,558 |
| Normal Nightly `v0.0.41-nightly.20260916.1795`    | Exact released source at `3060cc461458e66842dfb656d979c4acca4dfb20` |                1 |          25,558 |

The latest upstream parser reads the parent `message.model` and top-level usage. It does not expand `usage.iterations`, so it does not encounter the fork's null-model rejection. [Upstream parser at the tested Nightly tag](https://github.com/pingdotgg/t3code/blob/v0.0.41-nightly.20260916.1795/apps/server/src/usage/usageTranscripts.ts#L99).

The downstream manifest's `Project spend usage dashboard` patch, commit `d3c2035d374cba088b053a0775d16f8f92f44e51`, contains the change from `parseClaudeLine` to `parseClaudeLineRecords` and the faulty fallback that produces an empty model for unnamed iterations. [Downstream patch](https://github.com/saphid/t3code/commit/d3c2035d374cba088b053a0775d16f8f92f44e51). GitHub no longer resolves the installed build's short generated commit, so installed behavior was verified directly from its bundle rather than inferred from today's manifest.

Re-run the comparison with `node tmp/usage-audit-20260916/compare-builds.mjs`. It asserts that Fork Nightly drops the fixture and both normal Nightly parsers preserve it. This finding applies to this specific dropped-record defect. It does not establish that upstream's first-snapshot or cache-pricing behavior is otherwise correct. That comparison was read-only.

Repair implementation on September 16: commit `b78aac269bb560007487515faf9d4c805c781766` on `agent/fork-claude-usage-fix` preserves iterations with absent, null, or empty model names by inheriting the message model. Explicit iteration models remain distinct. Scan cache version 6 invalidates the old parsed records; saved snapshots and compact ledgers now carry the scan version too, so the normal background refresh rebuilds outdated totals. The legacy v1 ledger migration remains available.

The corrected source parser replayed the same seven-day corpus and retained 3,000 Claude records with 431,133,122 tokens and a $666.3983195 estimate, versus 342 records, 32,137,092 tokens, and $48.85198825 before the repair. The separate provider API residual is unchanged. Evidence: `repair-corpus.mjs`, `repair-corpus.log`, and `repair-corpus-reconciliation.json`.

The source repair passes 144 focused tests across transcript parsing, scan caching, service restart persistence, file reading, aggregation, and pricing. Server-scoped typechecking and targeted lint pass. The four added regression cases were observed failing before the repair. The proposed manifest adds the immutable source commit after the existing 50 patches. All preceding patches and the repair apply cleanly to upstream `v0.0.41-nightly.20260915.1735`, the last successfully assembled base. The latest upstream `v0.0.41-nightly.20260916.1795` already fails on the unrelated Context-limit handovers patch, before reaching the usage patch.

The complete 51-patch assembled tree also passes all 144 focused usage tests, server-scoped typechecking, targeted lint, formatting, and `git diff --check`. The assembler's 21 tests and manifest parser pass. Both repair branches were pushed, and manifest commit `c5720421d6` was fast-forwarded to fork `main`, activating source pin `b78aac269bb560007487515faf9d4c805c781766` for subsequent nightly builds. No PR was created, no release was published during this repair, and the installed app and live data were not modified. The latest existing workflow result remains the unrelated context-handover assembly failure at https://github.com/saphid/t3code/actions/runs/35064970958, which predates the manifest repair.
