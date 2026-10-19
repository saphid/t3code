## Problem

A skill added or edited during a session does not appear in the `$` picker (or the slash menu) for a project that is already open. The picker reads a per-workspace skill snapshot that is scanned once and then held. Later health checks and provider refreshes reuse it, so the only ways to see the new skill are **Restart agent session** (#14542) or restarting T3 Code. This is the remaining part of #11497. When #12672 (a file-watch approach) was closed as superseded, a follow-up against current main was invited.

#11497 has reports for both Codex and Claude. In each, the skill was on disk and a fresh scan found it, but an open project's picker still left it out.

## Change

Claude and Codex instances now report the skill folders they scan for a workspace (`ProviderInstance.skillRoots`). The registry watches those folders for every workspace snapshot it holds. When a skill appears, disappears, is renamed, or its `SKILL.md` changes, it rescans the affected snapshots after a 500 ms debounce. The previous list stays visible until the rescan succeeds.

- **Claude:** the config directory's `skills` and `<cwd>/.claude/skills`, the same roots `discoverClaudeSkills` reads.
- **Codex:** `$CODEX_HOME/skills`, `~/.agents/skills`, and `.agents/skills` and `.codex/skills` in the cwd and each parent up to the repository root. I checked these against codex-cli 0.160.1 by creating a skill in each location and calling `skills/list`. The Codex home follows the same precedence as the spawned app-server (configured home, then `CODEX_HOME`, then `~/.codex`). This applies to both existing installations and managed Codex.
- **Filtered out:** changes deeper inside a skill folder other than its `SKILL.md`, such as scripts, assets, references, and editor temp files. Entries directly under a root are not filtered by name, because any directory name can hold a skill. A stray top-level file costs one debounced rescan.
- **Rescan path:** a rescan runs the existing `snapshotForCwd` scan for that cwd without invalidating caches or re-probing the provider. Rescans run one at a time, because a Codex scan starts an app-server. A rescan whose write loses to a concurrent scan scans again, up to three times, because the scan that won may have read the folder before it changed.
- **Watch cost:** the registry resolves roots only when the set of held workspaces changes, not on every status or usage update.
- **Missing roots:** a missing root is watched non-recursively from its nearest existing ancestor, one path segment at a time. That way the first `.claude/skills` or `.agents/skills` in a project is picked up. A home directory or filesystem root is never watched.
- **Replaced roots:** an existing root is watched recursively. Its parent is watched non-recursively, so a deleted or replaced root is watched again.
- **Not covered:** Cursor, Grok, OpenCode, Antigravity, and ACP keep the current behavior. They don't report `skillRoots`, so **Restart agent session** is still how to refresh them.
- **Known limits:**
  - Edits behind a symlinked skill folder are not seen, because the OS reports the link, not its target. Adding or removing a symlinked skill is seen.
  - A first user skill folder whose parent (such as `~/.agents`) does not exist yet is not picked up, because that would mean watching the home directory.

## Scope and approval

A focused reliability fix for a confirmed bug (#11497). There is no contract, client, or settings change. Only the server watches files and rescans what it already holds. `docs/user/composer.md` now says which skill changes show up without a restart and which still need **Restart agent session**. The restart is also still how the agent itself loads new skills, plugins, or MCP servers.

## Verification

- **New registry tests:**
  - `rescans a held workspace snapshot when its skill root changes`: a held snapshot plus a skill-root event (one ignored path and two relevant ones) produces exactly one rescan. The new skill is published and no caches are invalidated. With the rescan disabled, the test times out.
  - `keeps the newest skills when a rescan races an explicit refresh`: covers both completion orders. With the retry disabled, the test times out.
- **New `skillRootWatch.test.ts`:** covers the change filter, the recursive watch of an existing root (a watch that ends on its own is not restarted), a replaced root watched again, a missing root followed down from its nearest existing ancestor, and never watching a home directory or filesystem root.
- **New `CodexSkillRoots.test.ts`:** covers the Codex home precedence and the project roots up to the repository root. The managed Codex driver test now also checks its skill roots.
- On macOS with real files, a throwaway check (not committed) produced these watch events:
  - **Fired:** the first skill in a project whose `.claude` folder did not exist, a new skill, a `SKILL.md` edit, a new symlinked skill, deleting the skills folder, and recreating it with a skill. A skill added after the recreate also fired.
  - **Ignored:** an unrelated file in the repository root, `scripts/run.sh`, an edit behind a symlink, and an idle period. That run also ignored a top-level `.DS_Store`. Since review feedback, top-level entries are no longer filtered by name, so that file would now cause one rescan.
- `vp test run` on `ProviderRegistry.test.ts`, `skillRootWatch.test.ts`, `CodexSkillRoots.test.ts`, `CodexDriver.test.ts`, and `ClaudeSkills.test.ts`: 5 files, 100 tests passed.
- `tsc --noEmit` in `apps/server` passes. Lint and format are clean on the changed files.
- **Independent review:** GPT-6 Astra (high reasoning), run through T3 Code. Round 1 requested changes with five findings, all fixed in the second commit: the rescan race, managed Codex, an environment `CODEX_HOME`, missing roots, and replaced roots. Round 2 approved `8ffbd8c` with no new findings. Two changes came after that review. A merge of `main` resolved a test-file conflict with #16282's layer renames, and a Macroscope finding removed the top-level name filter. Neither was re-reviewed by Astra.
- **Not exercised:** a real client. Linux and Windows file watching were not run, and native watch overhead on busy parent directories was not measured.

Agent-authored with Claude Opus 5.5 in Claude Code (running in T3 Code), sponsored by @saphid.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
