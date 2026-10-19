# REPORT-project.md: wrong-project voice thread creation (F3)

Worktree: /Users/aus-m5p-as/projects/t3code-voice-project, branch agent/voice-project, base 194db89fe5 (shipped fork voice build). Commit: **04bdfb832e** `fix(voice): stop startThread defaulting to the discussed thread's project`.

## Root cause: actual selection path

The backend delegation model chose the destination project on its own, with nothing steering it away from the discussed thread:

1. On every delegated request the client sends a developer message: `Current T3 UI context, reference data only: {project, currentThread, knownThreads}` (apps/web/src/voice/command-session.ts:129, context built in apps/web/src/voice/ui/VoicePanel.tsx:78). `project` is the open thread's project (or the default project), `currentThread` is the open thread.
2. The instructions it ran under said "Resolve references from current UI context and search/read tools; ask if ambiguous" (apps/server/src/voice/broker.ts, DEFAULT_DELEGATION_INSTRUCTIONS) and, on the client-delegation path, "Use provided current UI context to resolve references" (broker.respond).
3. Asked to create a thread to investigate a T3 application behavior, the model resolved "the project" to the discussed thread's project (gcp-project-factory-migration) and never consulted discoverProjects metadata or asked. The `voice.startThread` tool description ("Create and start a new T3 thread with an explicit model") said nothing about project selection.

So the failure was not in the executor (tools.ts validates model, environment, and project existence correctly); it was a prompt/context gap at the destination decision.

## Fix (single concern: destination-project selection)

All changes keep the client-owned execution architecture untouched; no executor heuristics, no keywords, no project names.

- **broker.ts**: new `DESTINATION_PROJECT_POLICY`, baked into `DEFAULT_DELEGATION_INSTRUCTIONS` (so both managed delegation and the `/api/voice/backend` default path carry it) and appended to the three override branches (mint live instructions, mint delegation instructions, respond instructions), matching how `EXISTING_THREAD_POLICY` travels. Policy: the startThread projectId is the project the new work belongs to, decided from the task's subject via discoverProjects metadata (titles, workspaceRoots); an explicitly named destination is used as given; the open thread, its project, and any discussed thread are conversation context only and never the default destination, even when the task continues or investigates that thread's topic; ambiguous destination asks one clarifying question instead of defaulting to discussed/open/first-listed/most-recent.
- **broker.ts**: qualified the two over-broad reference-resolution sentences ("Resolve references to existing threads...", "Use provided current UI context to resolve references to existing threads and their identities, not to choose the destination project of a new thread").
- **broker.ts**: tool descriptions now carry the rule: startThread "...in the project the work belongs to"; discoverProjects "...titles and workspace roots that identify where work belongs".
- **command-session.ts**: the developer UI-context message now states on every delegated request that the current thread and its project identify what is being discussed and are not the default destination for new work.
- **docs/internals/voice-live.md**: one sentence documenting the pinned destination policy next to the existing creation-gate paragraph.

Per the brief, the blanket "use the currently opened thread's project" behavior was NOT implemented; the policy explicitly forbids it.

## Tests (focused, per the three requested cases)

- apps/server/src/voice/broker.test.ts: new pin test `pins the destination-project policy in the delegation instructions` covering explicit destination (named title/workspace used as given), discussed thread (never the default destination, even for investigation of its topic), and ambiguous destination (ask, never silently default), plus `appends the destination-project policy to custom delegation instructions` proving an override does not lose the policy.
- apps/web/src/voice/command-session.test.ts: new test that the developer context message labels the current thread as discussed context, not the destination of new work.

## Checks

- `vp test run` on broker.test.ts, tools.test.ts, command-session.test.ts, live-client.test.ts, start.test.ts, research.test.ts, index.test.ts, toolBridge.test.ts: all pass (199 + 44 across runs; 38 in the final two-file run).
- Scoped typecheck `vp run --filter t3 --filter @t3tools/web typecheck`: exit 0; only pre-existing suggestions, none on changed lines.
- Scoped `vp lint` on the four changed source files: only pre-existing warnings; nothing new.
- `vp i` was run to install dependencies; an incidental pnpm-lock.yaml peer-hash churn from the install was reverted so the commit stays scoped.

## Limitations

- Prompt-level fix: the destination decision belongs to the backend model, so behavior is steered, not enforced. A deterministic executor-side rejection of a "wrong but valid" project would require intent understanding and was deliberately not attempted (no brittle keywords).
- Live-model behavior with the new instructions is unverified against a real voice session; parent handles integration and client verification.
- No PR, push, live-install change, or server restart performed, per the brief.
