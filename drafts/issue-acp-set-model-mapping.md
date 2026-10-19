<!--
Draft bug issue. Do not post without explicit go-ahead.
Title: [Bug]: Server: acpRegistry sends raw customModels slugs to session/set_model and the turn dies
Post with: gh issue create --repo pingdotgg/t3code --title "[Bug]: Server: acpRegistry sends raw customModels slugs to session/set_model and the turn dies" --body-file <this file> --label bug --label needs-triage
Planned branch: agent/server-acp-set-model-mapping (rename to fix/issueNNN-acp-set-model-mapping once this issue has a number)
-->

### Before submitting

- [x] I searched existing issues and did not find a duplicate.
- [x] I included enough detail to reproduce or investigate the problem.

### Area

apps/server

### Steps to reproduce

On branch `t3code/codex-turn-mapping` (PR #2829), against a scratch home:

1. Configure an `acpRegistry` instance for an authenticated agent whose advertised model ids are internal strings. Qwen Code is one: its `availableModels` entries carry ids like `$runtime|openai|claude-fable-5(openai)` with a human-readable `name`.
2. Add a `customModels` entry with the model's plain slug (for example `claude-fable-5`).
3. Create a thread on that instance, pick the custom model in the picker, and dispatch a message.

### Expected behavior

The selected slug is matched against the agent's advertised `availableModels` (by name or id) and `session/set_model` is called with the agent's actual model id, or set_model is skipped with a logged warning when nothing matches. The turn runs either way.

### Actual behavior

The turn dies with an unhandled error from the agent. `configureSession` forwards the selection verbatim: `requestedModel` is the raw `modelSelection.model` slug (the acpRegistry flavor defines no `resolveModelId`), and anything other than `""`, `"auto"`, or `"default"` goes straight into `runtime.setSessionModel(requestedModel)` (`apps/server/src/orchestration-v2/Adapters/AcpAdapterV2.ts:4600-4617`). The acpRegistry driver builds its model list as `["default", ...customModels]` with the slug used as the id (`apps/server/src/provider/Drivers/AcpRegistryDriver.ts:53-69`), so the agent receives a model id it never advertised. Selecting `default` works only because the set_model call is skipped on that branch of the condition.

Confirmed empirically on 2026-08-23 on a sandbox running the PR branch.

### Impact

Major degradation or frequent failure

### Version or commit

`t3code/codex-turn-mapping @ 2d623ac6b` (PR #2829)

### Environment

macOS 15 (Darwin 25.5), server via `pnpm dev` against a scratch home, Qwen Code v0.22.0 in `--acp` mode

### Logs or stack traces

```shell
# session/set_model rejected (summarized from provider event log):
# session/set_model modelId="claude-fable-5" -> agent error; agent advertises
# availableModels ids of the form "$runtime|openai|claude-fable-5(openai)"
```

### Workaround

Leave the model on `default` so `session/set_model` is never sent.

---

**Proposed fix (planned PR):** before calling `session/set_model`, resolve the selected slug against `sessionSetupResult.models.availableModels` (exact id match first, then name match); when nothing matches, skip set_model and log a warning instead of failing the turn. Non-goals: no changes to providers with dedicated flavors that already resolve model ids, no UI changes to the model picker.
