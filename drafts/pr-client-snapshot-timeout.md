## Problem

A client gives each connection attempt one 15 second budget. It covers resolving credentials, creating the session, opening the socket and receiving the first config snapshot. When a server is slow to build that snapshot (a cold restart with a large database on a loaded machine), the attempt times out with the socket already open and working. The client tears it down and retries against a server that is no faster, and loops. I saw this loop for about 10 minutes. Fixes #14516.

## Change

`EnvironmentSupervisor` keeps the 15 second budget until the driver reports the `synchronizing` stage, which is when the session exists and the socket is opening. From then on the attempt has 75 seconds for the socket to open (still capped at 15 seconds by the RPC session) and for the first config snapshot to arrive. Attempts that never reach `synchronizing` time out after 15 seconds as before. A socket that closes still fails the attempt immediately.

The trade-off: a socket that opens but then never delivers a snapshot is now given up on after up to 90 seconds instead of 15. Web, desktop and mobile share this code.

## Scope and approval

Fixes triaged bug #14516. One timeout in `packages/client-runtime/src/connection/supervisor.ts`. No server, contract or UI changes.

## Verification

- New test "keeps a working socket open while a slow server config snapshot arrives": the snapshot arrives 40 seconds into the attempt and the connection is kept. On main the attempt is torn down at 15 s and the connection never reports connected, so the test fails. It passes here.
- "retries when a session never becomes ready" now checks that the attempt survives 74 s after `synchronizing` and times out at 75 s. It also fails on main.
- `vp test run src/connection/supervisor.test.ts` in packages/client-runtime: 39 passed. Typecheck, lint and format are clean on the changed files.
- Not exercised in a real client against a slow server.

Implemented and tested by Claude Sonnet 5.5 and Claude Opus 5.5 in Claude Code, running inside T3 Code. Reviewed by GPT-6 Astra.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
