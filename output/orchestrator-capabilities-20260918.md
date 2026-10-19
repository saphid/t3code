# Orchestrator V2 capabilities

Captured: 2026-09-18T04:51:01.579Z

This is a readable snapshot of the live orchestrator_capabilities tool response for the current thread. It is generated from T3's provider registry, V2 adapter registry, and calling thread state. It is not a static startup configuration file.

- Parent thread: `19f76675-d149-47f5-ba43-9f7a9fb86966`
- Inherited provider: `cliproxyapi`
- Inherited model: `gpt-6-astra`
- Runtime mode: `full-access`
- Interaction mode: `default`

## Provider instances

| Display name              | Instance ID                  | Agent program | Can run child tasks | Advertised models |
| ------------------------- | ---------------------------- | ------------- | ------------------- | ----------------- |
| CLIProxyAPI Cloud         | `cliproxyapi`                | codex         | Yes                 | 41                |
| Codex                     | `codex`                      | codex         | Yes                 | 5                 |
| Work                      | `codex_work`                 | codex         | Yes                 | 5                 |
| AI Enablers GLM-5.3 Flash | `claudeAgent_enablers_glm53` | claudeAgent   | Yes                 | 11                |
| Claude old key            | `claudeAgent`                | claudeAgent   | Yes                 | 10                |
| Cursor                    | `cursor`                     | cursor        | No                  | 0                 |
| Grok                      | `grok`                       | grok          | Yes                 | 3                 |
| AI Enablers               | `opencode`                   | opencode      | Yes                 | 4                 |
| Antigravity               | `antigravity`                | antigravity   | No                  | 0                 |
| Pi                        | `pi`                         | pi            | No                  | 1                 |

## Features

- `appOwnedSubagents`: true
- `asyncPolling`: true
- `cancellation`: true
- `batchThreadCreation`: true
- `threadManagement`: true
- `incrementalThreadRead`: true
- `scheduledTasks`: true
- `maxBatchThreads`: 20

## Tools and construction

The orchestration tool definitions are separate from this capabilities response. The tools below let a model discover this inventory and act on it.

| Purpose                                                          | Tools                                                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Discover available providers, models and features                | `orchestrator_capabilities`                                                               |
| Delegate child work, read its result, or cancel it               | `delegate_task`, `task_status`, `task_cancel`                                             |
| Create ordinary top-level conversations                          | `t3_thread_start`, `create_threads`                                                       |
| Find and read conversations                                      | `t3_thread_list`, `t3_thread_read`                                                        |
| Send work, wait for a change, interrupt, or edit thread metadata | `t3_thread_send`, `t3_thread_wait`, `t3_thread_interrupt`, `t3_thread_update`             |
| Create, list, change, or delete recurring work                   | `schedule_task`, `list_scheduled_tasks`, `update_scheduled_task`, `delete_scheduled_task` |

The provider adapter connects the agent runtime to T3's MCP server and supplies orchestration instructions. The runtime makes tool definitions available to the model, sometimes lazily. Calling `orchestrator_capabilities` asks T3 to build a response from the calling thread and the provider/adapter registries. This file is a saved response, not the source of those capabilities.

Source inspected: `/Users/aus-m5p-as/projects/t3code-enablers-fix/apps/server/src/mcp/toolkits/orchestrator/tools.ts`, `apps/server/src/mcp/OrchestratorMcpService.ts`, and `apps/server/src/provider/T3OrchestrationInstructions.ts` in the same worktree. This source inspection does not establish the exact build revision of the running server.

## Models and constraints

### CLIProxyAPI Cloud

T3 reports this instance as available for child tasks.

| Model ID                         | Display label                  | Configurable options                                                                  |
| -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| `gpt-6-astra`                    | GPT 6.0 Astra                  | reasoningEffort: low, medium, high, xhigh, max, ultra; serviceTier: default, priority |
| `gpt-5.6-sol`                    | GPT 5.6 Sol                    | reasoningEffort: low, medium, high, xhigh, max, ultra; serviceTier: default, priority |
| `gpt-5.6-terra`                  | GPT 5.6 Terra                  | reasoningEffort: low, medium, high, xhigh, max, ultra; serviceTier: default, priority |
| `gpt-5.6-luna`                   | GPT 5.6 Luna                   | reasoningEffort: low, medium, high, xhigh, max; serviceTier: default, priority        |
| `gpt-5.5`                        | GPT 5.5                        | reasoningEffort: low, medium, high, xhigh; serviceTier: default, priority             |
| `claude-3-5-haiku-20241022`      | Claude 3.5 Haiku               | reasoningEffort: low, medium, high, xhigh; serviceTier: default, fast                 |
| `claude-3-7-sonnet-20250219`     | Claude 3.7 Sonnet              | serviceTier: default, fast                                                            |
| `claude-opus-4-20250514`         | Claude 4 Opus                  | serviceTier: default, fast                                                            |
| `claude-sonnet-4-20250514`       | Claude 4 Sonnet                | serviceTier: default, fast                                                            |
| `claude-opus-4-1-20250805`       | Claude 4.1 Opus                | serviceTier: default, fast                                                            |
| `claude-haiku-4-5-20251001`      | Claude 4.5 Haiku               | serviceTier: default, fast                                                            |
| `claude-opus-4-5-20251101`       | Claude 4.5 Opus                | serviceTier: default, fast                                                            |
| `claude-sonnet-4-5-20250929`     | Claude 4.5 Sonnet              | serviceTier: default, fast                                                            |
| `claude-opus-4-6`                | Claude 4.6 Opus                | reasoningEffort: low, medium, high, max; serviceTier: default, fast                   |
| `claude-sonnet-4-6`              | Claude 4.6 Sonnet              | reasoningEffort: low, medium, high, max; serviceTier: default, fast                   |
| `claude-fable-5`                 | Claude Fable 5                 | reasoningEffort: low, medium, high, xhigh, max; serviceTier: default, fast            |
| `claude-fable-5-1`               | Claude Fable 5.1               | reasoningEffort: low, medium, high, xhigh, max; serviceTier: default, fast            |
| `claude-opus-4-7`                | Claude Opus 4.7                | reasoningEffort: low, medium, high, xhigh, max; serviceTier: default, fast            |
| `claude-opus-4-8`                | Claude Opus 4.8                | reasoningEffort: low, medium, high, xhigh, max; serviceTier: default, fast            |
| `claude-opus-5`                  | Claude Opus 5                  | reasoningEffort: low, medium, high, xhigh, max; serviceTier: default, fast            |
| `claude-sonnet-5`                | Claude Sonnet 5                | reasoningEffort: low, medium, high, xhigh, max; serviceTier: default, fast            |
| `grok-composer-2.5-fast`         | Composer 2.5 Fast              | reasoningEffort: low, medium, high, xhigh; serviceTier: default, fast                 |
| `grok-3-mini`                    | Grok 3 Mini                    | reasoningEffort: low, medium, high; serviceTier: default, fast                        |
| `grok-3-mini-fast`               | Grok 3 Mini Fast               | reasoningEffort: low, medium, high; serviceTier: default, fast                        |
| `grok-4.20-0309-non-reasoning`   | Grok 4.20 0309 Non Reasoning   | reasoningEffort: low, medium, high, xhigh; serviceTier: default, fast                 |
| `grok-4.20-0309-reasoning`       | Grok 4.20 0309 Reasoning       | reasoningEffort: low, medium, high, xhigh; serviceTier: default, fast                 |
| `grok-4.20-multi-agent-0309`     | Grok 4.20 Multi Agent 0309     | reasoningEffort: low, medium, high; serviceTier: default, fast                        |
| `grok-4.3`                       | Grok 4.3                       | reasoningEffort: none, low, medium, high; serviceTier: default, fast                  |
| `grok-4.5`                       | Grok 4.5                       | reasoningEffort: low, medium, high; serviceTier: default, fast                        |
| `grok-4.6`                       | Grok 4.6                       | reasoningEffort: low, medium, high, xhigh; serviceTier: default, fast                 |
| `grok-build-0.1`                 | Grok Build 0.1                 | reasoningEffort: low, medium, high, xhigh; serviceTier: default, fast                 |
| `glm-5.3-flash`                  | xlarge                         | reasoningEffort: low, medium, high, xhigh; serviceTier: default, fast                 |
| `codex-auto-review`              | codex-auto-review              | reasoningEffort: low, medium, high, xhigh, max, ultra; serviceTier: default, priority |
| `gpt-image-1.5`                  | gpt-image-1.5                  | reasoningEffort: low, medium, high, xhigh, max, ultra; serviceTier: default, priority |
| `gpt-image-2`                    | gpt-image-2                    | reasoningEffort: low, medium, high, xhigh, max, ultra; serviceTier: default, priority |
| `grok-imagine-image`             | grok-imagine-image             | reasoningEffort: low, medium, high, xhigh, max, ultra; serviceTier: default, priority |
| `grok-imagine-image-2.0`         | grok-imagine-image-2.0         | reasoningEffort: low, medium, high, xhigh, max, ultra; serviceTier: default, priority |
| `grok-imagine-image-quality`     | grok-imagine-image-quality     | reasoningEffort: low, medium, high, xhigh, max, ultra; serviceTier: default, priority |
| `grok-imagine-video`             | grok-imagine-video             | reasoningEffort: low, medium, high, xhigh, max, ultra; serviceTier: default, priority |
| `grok-imagine-video-1.5`         | grok-imagine-video-1.5         | reasoningEffort: low, medium, high, xhigh, max, ultra; serviceTier: default, priority |
| `grok-imagine-video-1.5-preview` | grok-imagine-video-1.5-preview | reasoningEffort: low, medium, high, xhigh, max, ultra; serviceTier: default, priority |

### Codex

T3 reports this instance as available for child tasks.

| Model ID        | Display label | Configurable options                                                                  |
| --------------- | ------------- | ------------------------------------------------------------------------------------- |
| `gpt-5.6-sol`   | GPT-5.6-Sol   | reasoningEffort: low, medium, high, xhigh, max, ultra; serviceTier: default, priority |
| `gpt-5.6-terra` | GPT-5.6-Terra | reasoningEffort: low, medium, high, xhigh, max, ultra; serviceTier: default, priority |
| `gpt-5.6-luna`  | GPT-5.6-Luna  | reasoningEffort: low, medium, high, xhigh, max; serviceTier: default, priority        |
| `gpt-6-astra`   | GPT-6-Astra   | reasoningEffort: low, medium, high, xhigh, max, ultra; serviceTier: default, priority |
| `gpt-5.5`       | GPT-5.5       | reasoningEffort: low, medium, high, xhigh; serviceTier: default, priority             |

### Work

T3 reports this instance as available for child tasks.

| Model ID        | Display label | Configurable options                                                                  |
| --------------- | ------------- | ------------------------------------------------------------------------------------- |
| `gpt-5.6-sol`   | GPT-5.6-Sol   | reasoningEffort: low, medium, high, xhigh, max, ultra; serviceTier: default, priority |
| `gpt-5.6-terra` | GPT-5.6-Terra | reasoningEffort: low, medium, high, xhigh, max, ultra; serviceTier: default, priority |
| `gpt-5.6-luna`  | GPT-5.6-Luna  | reasoningEffort: low, medium, high, xhigh, max; serviceTier: default, priority        |
| `gpt-6-astra`   | GPT-6-Astra   | reasoningEffort: low, medium, high, xhigh, max, ultra; serviceTier: default, priority |
| `gpt-5.5`       | GPT-5.5       | reasoningEffort: low, medium, high, xhigh; serviceTier: default, priority             |

### AI Enablers GLM-5.3 Flash

T3 reports this instance as available for child tasks.

| Model ID            | Display label     | Configurable options                                                                                          |
| ------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `claude-fable-5-1`  | Claude Fable 5.1  | effort: low, medium, high, xhigh, max, ultracode, ultrathink; contextWindow: 200k, 1m                         |
| `claude-fable-5`    | Claude Fable 5    | effort: low, medium, high, xhigh, max, ultracode, ultrathink; contextWindow: 200k, 1m                         |
| `claude-opus-5`     | Claude Opus 5     | effort: low, medium, high, xhigh, max, ultracode, ultrathink; fastMode: true / false; contextWindow: 200k, 1m |
| `claude-opus-4-8`   | Claude Opus 4.8   | effort: low, medium, high, xhigh, max, ultracode, ultrathink; fastMode: true / false                          |
| `claude-opus-4-7`   | Claude Opus 4.7   | effort: low, medium, high, xhigh, max, ultrathink; fastMode: true / false                                     |
| `claude-opus-4-6`   | Claude Opus 4.6   | effort: low, medium, high, max, ultrathink; fastMode: true / false; contextWindow: 200k, 1m                   |
| `claude-opus-4-5`   | Claude Opus 4.5   | effort: low, medium, high, max; fastMode: true / false                                                        |
| `claude-sonnet-5`   | Claude Sonnet 5   | effort: low, medium, high, xhigh, max, ultrathink; contextWindow: 200k, 1m                                    |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | effort: low, medium, high, max, ultrathink; contextWindow: 200k, 1m                                           |
| `claude-haiku-4-5`  | Claude Haiku 4.5  | thinking: true / false                                                                                        |
| `xlarge`            | xlarge            |                                                                                                               |

### Claude old key

T3 reports this instance as available for child tasks.

| Model ID            | Display label     | Configurable options                                                                                          |
| ------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `claude-fable-5-1`  | Claude Fable 5.1  | effort: low, medium, high, xhigh, max, ultracode, ultrathink; contextWindow: 200k, 1m                         |
| `claude-fable-5`    | Claude Fable 5    | effort: low, medium, high, xhigh, max, ultracode, ultrathink; contextWindow: 200k, 1m                         |
| `claude-opus-5`     | Claude Opus 5     | effort: low, medium, high, xhigh, max, ultracode, ultrathink; fastMode: true / false; contextWindow: 200k, 1m |
| `claude-opus-4-8`   | Claude Opus 4.8   | effort: low, medium, high, xhigh, max, ultracode, ultrathink; fastMode: true / false                          |
| `claude-opus-4-7`   | Claude Opus 4.7   | effort: low, medium, high, xhigh, max, ultrathink; fastMode: true / false                                     |
| `claude-opus-4-6`   | Claude Opus 4.6   | effort: low, medium, high, max, ultrathink; fastMode: true / false; contextWindow: 200k, 1m                   |
| `claude-opus-4-5`   | Claude Opus 4.5   | effort: low, medium, high, max; fastMode: true / false                                                        |
| `claude-sonnet-5`   | Claude Sonnet 5   | effort: low, medium, high, xhigh, max, ultrathink; contextWindow: 200k, 1m                                    |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | effort: low, medium, high, max, ultrathink; contextWindow: 200k, 1m                                           |
| `claude-haiku-4-5`  | Claude Haiku 4.5  | thinking: true / false                                                                                        |

### Cursor

- Provider instance is disabled.
- Provider executable is not installed.
- Cursor is disabled in T3 Code settings.

| Model ID | Display label | Configurable options |
| -------- | ------------- | -------------------- |

### Grok

T3 reports this instance as available for child tasks.

| Model ID     | Display label | Configurable options                      |
| ------------ | ------------- | ----------------------------------------- |
| `grok-4.6`   | Grok 4.6      | reasoningEffort: xhigh, high, medium, low |
| `grok-build` | Grok Build    |                                           |
| `grok-4.5`   | Grok 4.5      | reasoningEffort: high, medium, low        |

### AI Enablers

T3 reports this instance as available for child tasks.

| Model ID          | Display label                 | Configurable options                                  |
| ----------------- | ----------------------------- | ----------------------------------------------------- |
| `enablers/large`  | large (glm-5.3-flash)         | variant: low, medium, high, xhigh; agent: build, plan |
| `enablers/medium` | medium (gemma-4-31b-it-nvfp4) | variant: low, medium, high, xhigh; agent: build, plan |
| `enablers/small`  | small (gemma-4-26b-a4b-nvfp4) | variant: low, medium, high, xhigh; agent: build, plan |
| `enablers/xlarge` | xlarge (glm-5.3-flash)        | variant: low, medium, high, xhigh; agent: build, plan |

### Antigravity

- Provider instance is disabled.
- Provider executable is not installed.
- Antigravity is disabled in T3 Code settings.

| Model ID | Display label | Configurable options |
| -------- | ------------- | -------------------- |

### Pi

- Provider instance is disabled.
- Provider executable is not installed.
- Pi is disabled in T3 Code settings.

| Model ID  | Display label | Configurable options |
| --------- | ------------- | -------------------- |
| `default` | Pi default    |                      |

This reports the configured catalogs and cached provider health. It does not test every advertised model with an inference request. The accompanying JSON preserves the exact field names, defaults, option descriptors, and constraints returned by the tool.
