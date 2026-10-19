## Problem or use case

With **Continue threads after restarts** on, a V2 thread that was mid-turn when the server restarted is continued automatically, unless it also had queued messages. Then nothing happens. Recovery holds the queue (`queueHeld`, which requires explicit consent before draining). `restartContinuationRun` picks the latest run by ordinal, which is the queued one, so no continuation is scheduled. The thread sits cancelled with a held queue until someone opens it and presses resume.

After a planned update on my machine, threads with queued runs stayed held until I released them by hand. Some had been held for 1 to 3 hours across two restarts.

## Proposed solution

When the setting is on and recovery cancels a thread's running run that has held queued runs behind it, release the held queue (`queue.resume`) instead of adding a "Continue where you left off" prompt. The queued message is the user's own next instruction, so it is a better continuation than the automatic prompt. With the setting off, nothing changes: the queue stays held and the existing resume control is the way out.

## Why this matters

Anyone who queues follow-ups and updates or restarts the server. The setting promises that work continues after a restart; today a queued follow-up is exactly what opts a thread out of that.

## Smallest useful scope

Server only, in `RestartContinuation.ts` and `ProviderRuntimeRecoveryService.ts`: select the interrupted run while ignoring queued runs, and dispatch `queue.resume` from `continueRestartedRun` when held queued runs follow it. Runs that were waiting on the user (a pending question or approval) are left alone. No contract or UI change.

## Alternatives considered

- Continue the interrupted run with the automatic prompt and leave the queue held. The agent resumes but the user's queued instruction still waits, so the thread runs ahead of instructions it cannot see.
- Leave it as is. The held queue is visible, but nothing tells the user that their opted-in thread did not continue.

## Risks or tradeoffs

This reverses the hold (from "fix(queue): preserve and hold queued messages after restart") only for environments that opted into continuing threads. A queued message written for a context that no longer applies would send without a second look. That is the same risk the automatic continuation already takes.

## References

- #14182 (live turns continue on every provider), #13901, #13895
- 1ad7275f638 (queue hold after restart)

## Contribution

I have a tested implementation and would open it against `t3code/codex-turn-mapping` if the direction is approved.
