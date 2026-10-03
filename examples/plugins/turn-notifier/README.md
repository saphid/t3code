# Turn notifier

Shows a notification when a turn finishes in any thread of the environment, with the thread's
title and whether the turn finished, failed, or was interrupted. The notification offers to open
the thread.

Capabilities: `events` (to learn when turns finish, including thread titles) and `notifications`.

## Install

1. Copy this directory to the machine that runs the T3 Code server.
2. In **Settings** > **Plugins**, choose **Add plugin** and enter the copy's absolute path.
3. Review the files and capabilities, then choose **Approve and enable**.

Notifications are best-effort: a device that is not connected when a turn finishes may not see
it. When many turns finish at once, some notifications are skipped rather than queued.
