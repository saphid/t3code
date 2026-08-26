# Front-door skills (source of truth)

These are the harness-installed entry points. Install by copying (or
symlinking) each `<name>.SKILL.md` to `~/.codex/skills/<name>/SKILL.md` and
symlinking `~/.claude/skills/<name>` to that directory. `scripts/setup`
verifies the canonical checkout pointer these files rely on. When editing a
front door, edit here first and re-install; the installed copies are
deployments, not sources.
