# Draft: comment on pingdotgg/t3code discussion #7311 (V2 side chats)

Status: staged, NOT posted. Post only on explicit go-ahead; re-check `hasDiscussionsEnabled` first.
Venue: a comment on https://github.com/pingdotgg/t3code/discussions/7311 (canonical; #8343, #11818, issue #12793 were closed as duplicates of it).

---

**Side chats for V2: reuse fork and subagent lineage, add one presentation flag**

Earlier attempts (#8296, #9396/#9436/#9437, #12794) were closed because they targeted V1 orchestration or added a second ephemeral protocol. V2 (#2829) already has the parts: lazy fork from a run, merge-back, lineage, and subagent rows. This proposes the smallest addition on top of them.

**Two facts, kept separate**

- Lineage (existing): how a thread relates to its parent. A fork, a subagent, or a plain link with no context transfer. This stays true to what actually happened. A thread that inherited nothing is not called a fork.
- Presentation (new): a single flag on the thread, `sideChat`. It means: open in the right panel, keep out of the sidebar, discard on close. It is not a relationship kind, so there is no new lineage label and no second protocol.

**Two kinds of side chat**

- With history: `thread.fork` at the latest stable point (or a chosen run) plus `sideChat`. Same provider and model uses the native fork, so it can hit the prompt cache.
- Without history: a linked thread with no context transfer plus `sideChat`. Optionally seeded with a selected quote.

**Snapshot semantics**

Forking mid-run uses the latest completed checkpoint, per the lineage doc ("do not silently fork from partially streamed provider state"). The panel header says what it can see, for example "Sees up to run 4".

**Entry points (all call one command: source point, optional seed question, optional citation)**

- Selection toolbar: `Ask` next to `Cite`. Sends the quote; a modifier or toggle adds history.
- Fork icon on a response, and the other fork surfaces: a menu with "Fork to new thread" and "Ask about this response".
- `/side` (alias `/btw`), a keybinding, the command palette. `/btw <question>` sends immediately; bare `/side` reopens the latest.
- A "Side chats" section with a `+` in the thread details panel (see below).

**Surface**

- A right-panel surface per side chat that renders the normal chat view for the child thread, with tabs for several open at once. No panel-opening actions (diff, terminal, files) and no nested side chats.
- Thread details panel: a "Side chats" section next to Lineage, always visible so the `+` is reachable. Rows look like subagent rows (icon, title, status, elapsed). Closed ones stay listed under a collapsed "Previous" group. Side chats still appear in Lineage as normal related rows.

**Behavior**

- Read-only by default with a composer chip to allow edits (the side chat shares the parent's worktree).
- Model defaults to the parent's; the picker notes that changing it gives up the cache hit.
- Ways back: Promote to thread (clears the flag), Bring back to main (V2 merge-back, injected on the parent's next run, so it never interrupts the current one), Discard. Closing a side chat with no messages discards it.

**Not proposed**

A no-tools quick-answer mode. That is the second ephemeral protocol #8296 was rejected for.

**Providers**

Codex, Claude, OpenCode fork natively. Cursor, Grok, Pi need portable context handoff (unchecked in the V2 TODO); disable with a reason until then.

**Ask of maintainers**

Is one `sideChat` presentation flag on the thread acceptable, reusing existing lineage? That is the only contract change.

*(Add model and harness line before posting.)*
