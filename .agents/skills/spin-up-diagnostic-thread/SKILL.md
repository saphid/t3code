---
name: spin-up-diagnostic-thread
description: Standard process for escalating an agent-side failure into a dedicated diagnostic thread in the T3 Code Contrib project (GLM 5.3 Flash). Use when an action fails with an unhelpful error (for example "[object Object]") and Alex says "spin up a thread to fix that", "make a work task to fix that", "sort out a bug report", or similar. Also use to refresh the process itself.
---

# Spin up a diagnostic thread

When something you tried to do for Alex fails and the failure is not something
you can fix inside the current conversation, escalate it into its own worker
thread instead of thrashing on retries. Alex then says "make a work task" or
"spin up a thread" and expects this exact procedure.

Two callers use this process:

- Harness agents (you, reading this skill): follow it directly.
- The voice agent: it has the frozen `voice.escalate` tool, which starts a
  thread with the environment's default chat model and no spoken new-thread
  gate. Projectless escalations land in the environment's voice workspace
  project ("Voice Agent", rooted at the descriptor's `voiceWorkspaceRoot`,
  inside the T3 home) — that directory is the voice agent's cross-session
  memory; this skill defines what its task text should contain.

## 1. Collect the evidence before creating anything

- The conversation excerpt that led up to the failure (verbatim, with "You:" /
  "Assistant:" turns trimmed to the relevant span).
- The exact error text, verbatim, including useless renderings like
  `[object Object]` (that rendering itself is a clue: an Error object was
  stringified somewhere client-side).
- Timeline: when it happened, how many attempts, which UI surfaces.
- The ids involved: thread ids, project ids, command types attempted.
- What still worked afterwards (helps separate auth, decode, and decider
  failures).

Do a cheap pre-dig so the worker thread starts warm. Run the doctor first — it
knows where every piece lives (servers, databases, logs, worktrees) and
produces an evidence bundle:

```bash
bun ~/projects/t3-doctor/doctor.ts check        # health report
bun ~/projects/t3-doctor/doctor.ts threads      # sidebar state
bun ~/projects/t3-doctor/doctor.ts evidence     # writes /tmp/t3-doctor/<stamp>/ for handoff
bun ~/projects/t3-doctor/doctor.ts voice        # voice-agent pipeline: source install,
                                                # build drift, voice threads, known
                                                # failure classes checked against source
```

Then, by hand if you need to go deeper:

- Server traces: `grep <traceId> ~/.t3/userdata/logs/server.trace.ndjson`
  (a traceId comes back in every HTTP error body). Look at span exits and the
  event `cause` on the failing span.
- Rejected commands: `select * from orchestration_command_receipts where
status='rejected' order by accepted_at desc limit 20` in
  `~/.t3/userdata/state.sqlite` (open read-only).
- If there is no receipt for the failed client command, the failure happened
  before the decider: decode/validation or client-side error mapping.

## 2. Authenticate against the live server

Never point a server at `~/.t3`; mint a short-lived credential instead:

```bash
node apps/server/src/bin.ts pair --label agent-diagnostic --ttl 15m
# then exchange the printed token for an access token:
curl -s -X POST http://127.0.0.1:3773/oauth/token \
  -H "content-type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  --data-urlencode "subject_token=<PAIRING_TOKEN>" \
  --data-urlencode "subject_token_type=urn:t3:params:oauth:token-type:environment-bootstrap" \
  --data-urlencode "requested_token_type=urn:ietf:params:oauth:token-type:access_token" \
  --data-urlencode "scope=orchestration:read orchestration:operate" \
  --data-urlencode "client_label=agent-diagnostic"
```

The port comes from `~/.t3/userdata/server-runtime.json`.

## 3. Create the thread and start its turn

Two dispatches: `thread.create`, then `thread.turn.start`. (The running
nightly rejects a `thread.turn.start` whose `bootstrap.createThread` targets a
nonexistent thread, and requires top-level `runtimeMode` and
`interactionMode` on turn.start even though the main-branch schema gives them
defaults. Two plain commands sidestep both drifts.)

Fixed choices:

- Project: **T3 Code Contrib** → `bc15f253-9156-4469-8723-f00ab80a0d38`
- Model: **GLM 5.3 Flash** → `{"instanceId": "opencode", "model": "enablers/xlarge"}`
- runtimeMode: `full-access` (matches the other voice repair threads)
- Title: `Diagnose: <symptom in a few words>`

```jsonc
// dispatch 1
{
  "type": "thread.create",
  "commandId": "<uuid4>",
  "threadId": "<uuid4>",          // client-generated, keep for lookup
  "projectId": "bc15f253-9156-4469-8723-f00ab80a0d38",
  "title": "Diagnose: <symptom>",
  "modelSelection": { "instanceId": "opencode", "model": "enablers/xlarge" },
  "runtimeMode": "full-access",
  "interactionMode": "default",
  "branch": null,
  "worktreePath": null,
  "createdAt": "<iso>"
}
// dispatch 2 (same threadId)
{
  "type": "thread.turn.start",
  "commandId": "<uuid4>",
  "threadId": "<threadId>",
  "message": { "messageId": "<uuid4>", "role": "user", "text": "<brief below>", "attachments": [] },
  "runtimeMode": "full-access",
  "interactionMode": "default",
  "createdAt": "<iso>"
}
```

## 4. The brief must contain

1. Symptom and verbatim error, up top.
2. The conversation excerpt and what you attempted.
3. Environment facts: server version (from `/.well-known/t3/environment`),
   T3 home, log paths, relevant worktrees.
4. Your pre-dig findings (attach the doctor's evidence bundle contents or its
   path) and current hypothesis, clearly labeled as hypothesis.
5. Starting pointers: files, tables, trace ids.
6. Deliverable: root cause, the minimal fix, a focused test that would have
   caught it, and a draft bug report if it is an upstream T3 Code bug.
7. Guardrails: read-only on `~/.t3/userdata` (never write to the live
   database), no restarting the live server, no killing processes by pattern.

## 5. Verify and report back

- Confirm the turn started: `GET /api/orchestration/threads/<threadId>` with
  the bearer token; check the session goes `starting` → `running`.
- Tell Alex the thread title and where to find it (T3 Code Contrib project).
- If dispatch fails, surface the real HTTP error body (it contains a traceId),
  never `[object Object]`.

## Known failure shapes (learned 2026-09-15)

- A schema decode failure returns HTTP 400 with an **empty body** — no
  traceId, no reason. If a dispatch 400s with an empty body, suspect contract
  drift between this repo's schema and the running build's, and bisect by
  simplifying the payload.
- A decider rejection (invariant or settle-blocked) returns HTTP 500
  `EnvironmentInternalError` / `orchestration_dispatch_failed` with a
  traceId; grep that traceId in `~/.t3/userdata/logs/server.trace.ndjson` and
  read the failing span's event `cause` for the real error tag.
