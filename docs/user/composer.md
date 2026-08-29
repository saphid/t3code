# Message composer

Messages can contain up to 120,000 characters. If a draft is longer, T3 Code keeps it in the
composer and shows how many characters need to be removed. Shorten the draft or split it into
multiple messages, then send again in the same thread.

On servers that support direct uploads, images upload as soon as you add them. The send button
becomes available after every upload finishes. Failed uploads can be retried or removed.

On SwiftUI mobile, paste an image from the message field's edit menu or drag an image onto the
composer to attach it. You can attach up to eight images to one message. The composer grows to
12 lines, then scrolls within the message field.

## Commands and skills

Type `/` to open the command menu. Type `$` to find and add a skill. Skill rows show their source,
such as System, Personal, Project, or App.

By default, the `/` menu includes skills. To keep this menu command-only, turn off **Show skills in
slash menu** in **Settings → General**. Skill results use the `/skill:Skill Name` label and add the
same `$name` skill token to your message. The original skill name remains searchable. If the provider
also reports that skill as a native slash command, T3 Code hides the duplicate native entry and keeps
the `/skill:Skill Name` label.

On desktop, press `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux from a new thread to
start it in the background. T3 Code opens another new thread and shows an **Open** action for the
thread that started. The new thread keeps the selected workspace mode and base branch. If **New
worktree** is selected, each background thread creates its own worktree.

## Recovering an interrupted provider

If a provider process ends unexpectedly during a turn, T3 Code marks that turn as failed while
keeping its completed messages and tool output. SwiftUI mobile shows a **Retry** action. Retry asks
the provider to inspect the current state and continue from the last completed step; it does not
automatically run the interrupted command again.

Using **Stop** is different: it intentionally interrupts the turn and does not report a provider
failure.
