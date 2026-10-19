<!--
Draft Ideas discussion. Do not post without explicit go-ahead.
Title: Web: expose acpRegistry providers in the thread provider picker
Note: prior memory said Ideas discussions were disabled upstream; a live check on
2026-08-23 shows discussions enabled with an Ideas category, so this can be posted
via GraphQL on go-ahead (see author-upstream-issues skill for the mutation).
Planned branch: agent/web-acp-registry-picker
-->

## Problem or use case

The orchestrator v2 stack (PR #2829) ships an `acpRegistry` driver that can run any registry-listed ACP agent from settings alone. Users can configure such an instance in Settings, but the web composer's provider picker never offers it: `PROVIDER_OPTIONS` in `apps/web/src/session-logic.ts:26-46` lists only codex, claudeAgent, opencode, cursor, and grok. The result is a provider that is configurable but unusable from the UI.

## Proposed solution

Show configured `acpRegistry` instances in the thread provider picker, labeled by their instance name (the agent they wrap), so a user who set one up in Settings can start a thread on it from the composer like any other provider.

## Why this matters

The driver already works end to end. On 2026-08-23, GitHub Copilot CLI, Qwen Code, and Amp each ran chat and tool-use turns through `acpRegistry` with settings-only configuration (trivial/tool-use turn timings: copilot 6.8s/10.2s, qwen 5.1s/9.4s, amp 10.4s/15.7s). That is zero-code onboarding for any ACP agent, and it benefits every user who wants an agent T3 has no dedicated adapter for. Right now that value is stranded behind a picker omission.

## Smallest useful scope

Add `acpRegistry` entries to the web picker, gated on at least one enabled instance existing, with the instance name as the label. One PR touching the web picker wiring only.

## Alternatives considered

- A dedicated adapter per agent: exactly what `acpRegistry` exists to avoid, and it does not scale to the ACP ecosystem.
- Keeping it settings-only as a maintainer escape hatch: leaves a one-way door (configurable, not usable), which the project treats as a bug pattern.

## Risks or tradeoffs

- Picker crowding when many instances are configured; mitigated by showing only enabled instances.
- Registry agents vary in quality; an `experimental`-style badge (the picker already supports badges) can set expectations.
- Mobile has its own picker and would need a follow-up to reach parity; this proposal deliberately scopes to web.

## References

- PR #2829 (`t3code/codex-turn-mapping`), which introduces the acpRegistry driver.
- Related bug drafts filed against the same branch: eager ACP authenticate, set_model slug mapping, terminal failure on dead-lettered turn starts.

## Contribution

Happy to implement; the planned PR maps one-to-one to the scope above.
