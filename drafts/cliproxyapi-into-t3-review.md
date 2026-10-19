# CLIProxyAPI in T3 Code: what to build, what to leave out

Date: 2026-10-02. Sources: CLIProxyAPI upstream main (`6fecc6e5`, exported to `/tmp/cliproxyapi-main`), T3 Code `upstream/main` (the local `feat/devcontainer` branch is 1904 commits behind), and the current Anthropic, OpenAI and Google terms. This is an engineering reading of the terms, not legal advice.

## 1. What CLIProxyAPI is

A single Go binary (about 330k lines including tests) that sits between any API client and many model backends. It takes in OpenAI, Anthropic or Gemini style requests and sends them out as whichever dialect the chosen backend speaks. Most of the code falls into five layers:

| Layer | What it does | Size | Where |
|---|---|---|---|
| Inbound surfaces | `/v1/chat/completions`, `/v1/responses` (+ websocket), `/v1/messages`, `/v1beta/models/*`, Interactions, Codex-native `/backend-api/codex/*`, realtime, images, videos, `/v1/models` | ~8k | `internal/api`, `sdk/api/handlers` |
| Dialect translation | 7 dialects, ~25 pairs, streaming and non-streaming, tool-call mapping, `apply_patch` bridge, canonical thinking config with per-provider appliers, thinking-signature replay caches | ~54k | `internal/translator`, `internal/thinking`, `internal/signature`, `internal/cache` |
| Credential conductor | Picks a credential per request: round-robin, weighted, fill-first, priority tiers, session affinity, cooldowns, `Retry-After`, retry rounds, request-scoped error rules, pre-first-byte stream failover | ~23k | `sdk/cliproxy/auth` |
| Executors | One per backend. Attach credentials and headers, apply payload rules, send, classify errors. This is also where client impersonation lives | ~54k | `internal/runtime/executor` |
| Login and storage | OAuth PKCE and device flows per vendor, token refresh loop, file, git, Postgres or S3 credential stores | ~6k | `internal/auth`, `sdk/auth`, `internal/store` |

Around those: model registry with aliases, prefixes and exclusions (refreshed every 3 h from `router-for-me/models`), inbound API keys, management API and web UI, TUI, config hot reload, c-shared plugin host and store, AI Studio browser relay, mDNS discovery, a "Home" cluster control plane over Redis RESP, request logging and usage buffers.

## 2. The ToS-sensitive core

The terms draw the line at three things: **taking the subscription token out of the official client**, **pretending to be the official client**, and **making one subscription serve other people or apps**. CLIProxyAPI does all three when a credential is a consumer OAuth token.

### Anthropic (Claude Pro/Max/Team via the Claude Code OAuth app)
- Login reuses Claude Code's OAuth client ID `9d1c250a-...` (`internal/auth/claude/anthropic_auth.go`), with an `axios/1.15.2` UA and native header order on the token endpoint.
- System prompt rewritten to lead with "You are Claude Code, Anthropic's official CLI for Claude." The caller's own system prompt is moved into mid-conversation messages, or dropped in `strict-mode` (`claude_executor_cloaking.go`).
- `x-anthropic-billing-header` with a replica of Claude Code's build fingerprint hash, and the `cch` body signature reproduced with xxHash64 and Claude Code's seed (`claude_signing.go`).
- `claude-cli/2.1.280 (external, cli)` UA, `X-App: cli`, `X-Stainless-*` Node SDK headers, Claude Code session and agent headers, a beta list trimmed to what real Claude Code 2.1.280 sends.
- Forged `metadata.user_id` with per-credential synthetic device IDs, pinned for 7 days.
- uTLS ClientHello that copies Node/OpenSSL, byte-exact header order and casing (`helps/utls_client.go`, `internal/httpwire`).
- Custom tool names rewritten to `mcp__<word>__<word>` aliases so the tool set looks like Claude Code MCP tools.
- Zero-width-space "sensitive words" obfuscation to slip past keyword filters.
- Client detection: a real Claude Code client passes through unchanged, everything else (T3, OpenCode, curl) gets cloaked.

### OpenAI (ChatGPT plans via the Codex OAuth app)
- Login reuses the Codex CLI client ID `app_EMoamEEZ73f0CkXaXp7hrann` and its `codex_cli_simplified_flow` param.
- Forces `User-Agent: codex-tui/0.154.0 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11` and `Originator: codex-tui` on every OAuth request, overriding the real caller.
- Calls `chatgpt.com/backend-api/codex` (the private ChatGPT backend, not `api.openai.com`) with a Chrome TLS fingerprint and Codex turn, window and routing-hint headers.

### Others
Antigravity (Google client ID and embedded secret, `cloudcode-pa` internal API), Grok Build, Kimi Code, Meta Muse, Devin: same pattern. Google has banned paid accounts for exactly this since February 2026.

### Pooling
Round-robin and fill-first across several consumer subscriptions, cooldowns tuned to rolling windows, per-credential proxy IPs and device identities, bulk credential upload. The tooling is built to stretch subscription limits across accounts.

### What the terms say (short version)
- Anthropic legal and compliance page: developers "may not collect, store, or intermediate Claude.ai credentials or session tokens", and may not "route requests through Free, Pro, or Max plan credentials on behalf of their users". Allowed: an end user signing in to "the unmodified Claude Code binary with their own Claude subscription". Spoofing the harness was actively blocked in January 2026.
- Agent SDK on a subscription is gray. The docs say API keys "unless previously approved". The June 2026 support article says SDK apps (T3 named in coverage) still draw from subscriptions, and promises notice before any change.
- OpenAI: the sanctioned route for third-party apps is now Sign in with ChatGPT (DevDay, about Sept 30), with OpenAI-registered OAuth clients. T3 is listed as an integration and already ships it on upstream (`CodexChatGptAuth.ts`, multi-profile). Reusing the Codex CLI's client ID has no official cover. No reselling or sharing.
- Google: third-party use of Gemini CLI or Antigravity OAuth is a violation, enforced with bans.

## 3. What T3 already has (upstream/main)

| CLIProxyAPI capability | T3 today |
|---|---|
| Multiple accounts per provider | Yes, as provider instances (`codex_work`, `claudeAgent_personal`). Codex also has ChatGPT profiles inside one instance. Manual selection only. |
| Official OAuth login | Codex via Sign in with ChatGPT (T3-owned tokens, sanctioned client). Antigravity via the native process. Claude, Cursor, Grok, OpenCode are CLI-owned. |
| Point a harness at a gateway | Only through per-instance env vars or wrapper binaries. No typed base URL, key or header fields on Claude or Codex. |
| Quota and usage across accounts | Yes. Usage > Limits, live rate-limit events, banked reset credits, and a CLIProxyAPI hub reader (`usage/cliproxyApi.ts`). |
| Cost accounting | Yes, post-hoc from CLI transcripts with LiteLLM pricing. Never in the request path. |
| Model catalog and aliases | Live discovery per driver plus a remote manifest for Claude. `customModels` per instance. Aliases are a tiny static map, no user aliases. |
| Failover or rotation | None. Limit hits only show a message. |
| Concurrency caps or admission queue | None per instance. |
| `/v1` endpoints, dialect translation | None. Adapters speak app-server, Agent SDK and ACP, never raw model HTTP. |

## 4. Recommended split

The main constraint: T3 drives agent CLIs and never sees the model requests. Anything CLIProxyAPI does per HTTP request either has a session-level equivalent in T3 or needs a proxy in the request path.

### A. Build into T3 core (clean, small to medium, fits the architecture)
1. **Typed gateway fields per Claude and Codex instance**: `baseUrl`, `apiKey` (sensitive, externalized to the secret store), optional `headers`. Maps to `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_CUSTOM_HEADERS` and to a Codex `-c model_providers.<id>` block. Replaces today's env-var recipes and wrapper scripts. Size: S.
2. **User model aliases** next to `customModels`, resolved in `normalizeModelSlug`. Size: S.
3. **Per-instance concurrency cap with a turn queue**. T3 owns turns, so this is more natural here than in a proxy. Covers the AI Enablers 3-request cap without forking CLIProxyAPI. Size: M.
4. **Instance pools**: group instances, pick a member at thread start by priority, weight or most headroom (using the `usageLimits` data T3 already has). On a limit hit, offer to continue on another member. Size: M to L. Constraints:
   - Mid-thread switching only works between instances with a matching `continuation.groupKey`. Codex profiles sharing a home can continue. Separate Claude config dirs cannot.
   - Automatic failover should be allowed only for API-key and org-provisioned members. For personal consumer subscriptions, make it a one-click prompt, not silent rotation. That keeps T3 clear of "coordinate across accounts to circumvent guardrails" and "ordinary, individual usage".
5. **Usage source widening**: the `cliproxy` usage source could become a generic "gateway" source that also reads API-key spend. Size: S to M, optional.

### B. Optional separate component, API-key only ("leave somewhere else" but could be ours)
Needs to sit in the request path. Keep it out of the core server: it is large, adds hot-path work on every token, and is not needed by most users.
- Dialect translation so a harness can run a model its vendor does not serve (Claude Code on GPT or GLM, Codex on Claude API keys). Anthropic calls non-Claude routing "unsupported", not forbidden. Reference is ~54k lines of Go. In TypeScript this is weeks to months to reach parity on streaming, tool calls and thinking signatures.
- Prompt-cache keep-warm (the earlier finding stands: T3 cannot replay requests itself).
- Request-level metering and per-thread attribution headers.
- Shared team gateway for org-issued keys (the GCP Cloud Run deployment pattern).

Choices for B: keep using CLIProxyAPI configured with API-key and org-issued upstreams only (zero build, cloaking off), point at existing tools the docs already mention (Claude Code Router, LiteLLM), or build a `t3 gateway` sidecar later if demand shows up. Start with the first.

### C. Never build, anywhere we own
- Any reuse of Claude Code, Codex CLI, Gemini CLI, Antigravity or other vendor OAuth client IDs for our own login.
- Holding, refreshing or forwarding consumer subscription tokens for traffic that does not come from the official binary.
- Everything in section 2: system-prompt injection, billing header and `cch` signing, UA and `X-Stainless` spoofing, forged `metadata.user_id` and device IDs, TLS and header-order fingerprinting, MCP tool-name aliasing, keyword obfuscation, `codex-tui` UA forcing, calls to `chatgpt.com/backend-api/codex` from non-Codex code.
- Re-exposing any subscription as an API to other apps or other people.
- Silent rotation across personal consumer subscriptions to stretch limits.

## 5. Things to raise honestly

1. **Alex's current gateway is in bucket C.** The Codex OAuth route sends a hardcoded `codex-tui ... iTerm.app` UA from a GCP IP. The Claude OAuth route (dead since about Sep 8) would be fully cloaked as Claude Code. The clean replacements: Sign in with ChatGPT in T3 for Codex (already on upstream, multi-account), the official `claude` binary signed in on each machine (or the VPS) for Claude, and CLIProxyAPI kept only for GLM and other API-key upstreams.
2. **Existing T3 code worth a maintainer look.** `apps/server/src/provider/Layers/claudeResetCredits.ts` reads the Claude CLI's OAuth access token from `.credentials.json` (non-macOS) and calls `api.anthropic.com/api/oauth/usage` and `/reset_rate_limits` directly. It reads rather than stores, and only hits account endpoints, but it is T3 code using the token outside the binary, which the "collect, store, or intermediate" sentence arguably covers. The CLIProxyAPI hub reader does the same through the hub. Not my call, but it belongs on the list.
3. **The Agent SDK subscription path itself is tolerated, not blessed.** Nothing in this plan changes that, but it is the base T3's Claude support sits on.

## 6. Proposed next steps
1. Upstream-shaped PR: typed `baseUrl` / `apiKey` / `headers` for Claude and Codex instances (A1). Smallest, most useful, unblocks retiring the wrapper scripts.
2. Ideas discussion for instance pools (A4) with the subscription vs API-key failover rule stated up front.
3. Reconfigure the GCP gateway to API-key upstreams only, with cloaking disabled, and move Codex to Sign in with ChatGPT.
4. Defer B until A1 to A4 exist and there is a concrete cross-vendor need.
