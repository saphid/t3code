# Luna plugin authoring trial — 9 September 2026

Status: completed bounded authoring attempts; Terminal and Browser replacements remain blocked. This is a framework readiness experiment, not a comparison of model quality.

Baseline: b94c3bef10f5425c8593c2b73acc568bc3dca1f6. Builders used separate lxso2 worktrees. Parent improvements were prepared in a third checkout without changing that baseline. Owning work record: https://github.com/saphid/personal-ops/issues/128.

## Roles and observation

A new Luna medium thread attempted Terminal, another new Luna medium thread attempted Browser, and a separate Luna medium thread monitored their code, receipts and claims. The harness initially refused a third new thread; Browser started after Terminal completion freed capacity. The monitor's canonical name remained luna_browser_builder after reassignment, while the actual Browser author was luna_browser_author.

The monitor reported that inter-agent messaging and wait tools were absent from its tool surface. The observed failure was missing intermediate message delivery; the underlying tool-surface explanation was not independently confirmed by the parent. Initial journal entries were therefore not delivered as intermediate messages. The parent changed the reporting transport to monitor/current-summary.md plus a chronological journal, read during active work. The monitor then recorded heartbeat and milestone summaries and independently reproduced the final Browser result. Future dispatch must verify reporting tools before promising pushed summaries; a final answer is not a persistent watcher.

## Observed results

| Attempt | Artifact and actual proof | Correct interpretation |
| --- | --- | --- |
| Terminal | Public-only format-1 negative probe; SDK validation and syntax checks passed, isolated runtime installation succeeded, invocation returned Host service unavailable | Loader works. The probe used an explicitly unsupported/illustrative t3.terminal/read name, so it does not exercise a real terminal API or prove terminal behavior |
| Browser initial | Format-2 package declares proposed t3.browser/sessions requirement and uses only public discovery; syntax/JSON checks passed | Author stopped before sufficient SDK/runtime verification despite a supplied compiled SDK |
| Browser corrected | Public SDK validator passed; isolated runtime install passed; catalogue returned missing-api / No available API provider and plugin unavailable; monitor independently reproduced it | Required unsupported APIs fail closed with an unavailable plugin. No native engine or functioning Browser contribution exists |
| Distribution correction | Fresh npm tarball installed outside the repo; included provider/consumer manifests, server export and authoring links validated; existing external consumer tests passed | The shipped SDK is now a usable starting point for the implemented Files capability slice; this adds no Terminal or Browser services |

Terminal package receipt: 8580e06d5e17697f54db5789e8e1da6ffb400ed432fcce57e3e1633015588461.
Browser package receipt: 1c12536bb68d5c8a004e68be8bd054e9b1efe98c9c04035cbc659b7587b69164.

Both builders stopped at missing public capabilities instead of importing private application components, calling raw app RPC, creating fake PTY output or substituting an iframe for the retained Browser engine. Negative-test command exit 0 means the expected failure was checked; it must not be presented as plugin functionality.

No real Terminal or Browser end-to-end replacement, parity, speed or resource-recovery result follows from these attempts. Runtime probes used isolated state, not a running application/native engine.

## Decisions from the experiment

| Finding | Decision | Acceptance before closing |
| --- | --- | --- |
| SDK README still emphasized old in-process/format-1 integration | Correct its entry point and separate installable authoring from low-level host integration | Author finds format-2 dependencies, public invocation/discovery and honest current support from the shipped package |
| npm files list omitted the complete Files provider and independent consumer | Include both examples and a self-contained AUTHORING.md | Fresh external tarball test validates all linked files, both manifests and server executable descriptor |
| Illustrative legacy service names encourage unsupported calls | Remove plausible-but-unimplemented domain names from the README; clearly distinguish catalogue support from proposed contracts | A missing API is reported with discovery/availability evidence, not fabricated as an implemented contract |
| Browser author skipped SDK validation because its checkout lacked dependencies | Provide explicit compiled/package fixture location in worker brief; require stage-specific receipts | Syntax, SDK validation, isolated runtime state and real app behavior are reported separately |
| Required Browser API is unavailable | Add actual browser services together with authenticated native engine attachment | Independent package owns chrome and drives real retained engine through public APIs; disconnect/revocation/restart tests pass |
| Terminal API and stream/resource support are unavailable | Add shared resource ownership, snapshot/live streaming, backpressure, ordered control receipts and package asset support before Terminal UI migration | Independent package drives real PTY and renderer with no private imports; input/output/resize/close/reconnect parity is proven |
| Intermediate monitor messages absent; tool limitation reported | Preflight watcher tool capabilities and use supported summary delivery | Parent receives regular watcher summaries during the job without personally inspecting builder code |

Keep the broker, deterministic dependency resolver and explicit unavailable states: the Browser attempt demonstrated the intended failure behavior. Do not add raw RPC escape hatches, fake engines or privileged wrapper exceptions to make authoring appear successful.

The Browser and Terminal plans remain the design starting points. Shared resource/stream contracts and authenticated connection identity require host implementation; the current immutable plugin-call metadata alone is insufficient. Repeat these same authoring attempts after a concrete public provider is available. Use a fresh author where possible to distinguish documentation discoverability from learning carried over from this trial.

## Evidence and review

All work and tests stayed on lxso2. Evidence root: /home/saphid/artifacts/t3-extensions-luna-trial-20260909. See experiment.md, thread-dispatch.json, terminal/, browser/, monitor/, improvement-ledger.md and authoring-package-test-receipt.json. The earlier Files end-to-end evidence remains separate under the capability checkpoint artifact root.

Direct Claude Opus 5 high review of the parent authoring changes was attempted with tools disabled; it exited 1 before any model execution because OAuth had expired. No cross-provider review is claimed.

The original Terminal Luna author retested the improved tarball: both shipped format-2 manifests validated, included JavaScript syntax checks passed, and it found no correctness blocker in supported/proposed API guidance. This is a same-author retest with prior context, not a fresh blind usability measurement. Optional catalogue-table and future-design links were suggested, not treated as runtime prerequisites.
