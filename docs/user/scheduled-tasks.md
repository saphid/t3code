# Scheduled tasks

Scheduled tasks run a prompt on a recurring interval or at a fixed time of day,
even when no thread is active. Agents can also create them through the T3 MCP
`schedule_task` tool.

Manage them in **Settings → Scheduled tasks**. A thread's details panel also
shows an **Automations** section for tasks bound to that thread.

## Restricting when tasks run

An interval task can be limited to specific days and hours, and capped after a
number of runs:

- **Days.** Pick the weekdays it may run on; leave every day selected to run
  daily. A run that lands on an unselected day moves to the next allowed day.
- **Hours.** Turn on "Only between" to keep runs inside a local time window
  (for example 09:00–17:00 for business hours). Runs outside the window wait
  for the next opening instead of firing late, including a run that came due
  while T3 Code was closed or asleep.
- **Run limit.** "Stop after" caps the total number of runs. The task pauses
  itself when it reaches the limit and shows "Run limit reached"; raise or clear the
  limit in the task editor to resume it.

The window and run limit also apply to tasks agents create through the
`schedule_task` tool, so you can ask for something like "check every half hour
during business hours on weekdays, at most 16 checks".

## Where runs go

Each task either opens a fresh thread per run or posts its prompt into one
bound thread. Bound tasks show up under that thread's Automations section.

## Pausing

Toggle a task off to pause it without deleting it; re-enable it to resume.
The run clock restarts from the moment you re-enable, not from missed times.

## Archived and deleted threads

A bound task needs a thread that can accept a run:

- Archiving the bound thread pauses the task. It stays listed, keeps its run
  history, and stops firing — it will not accumulate failed runs against the
  archived thread.
- Unarchiving the thread does not restart the task. Re-enable it explicitly in
  Scheduled tasks or the thread's Automations section to resume it.
- Deleting the bound thread pauses the task the same way. To keep the
  schedule, edit the task so it no longer binds to the thread, or rebind it to
  another thread, then re-enable it.
- Enabling a task while its bound thread is archived is rejected until the
  thread is unarchived.

A run that was already dispatched when the archive landed is still recorded in
the task's run history; only future runs are paused.
