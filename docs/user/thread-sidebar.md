# Organizing threads

Pin a thread from its context menu to keep it in the pinned section above your active work.
Pinned threads are shown independently of their project, including when you connect to more than
one environment.

Pinned threads still move to **Settled** when they become inactive. They also move when their pull
request merges if **Auto-settle merged threads** is enabled.

When new work wakes a settled thread, it returns with the newly active threads. Messages on a
thread that was already active do not move its row.

## Archived threads on native iOS

In the SwiftUI iOS app, select **Archived** at the bottom of Home to open the archive. Archived
threads are grouped by project instead of expanding into the Home list. Search matches thread
titles, and the sort menu switches between newest and oldest archives. The search and sort choices
remain in place when you leave the archive and return.

Swipe an archived thread or open its menu and choose **Restore** to return it to Home.

On web and desktop, drag a pinned thread to change its position. On mobile, open the thread's menu
and choose **Move up** or **Move down**. The order is stored by the server and appears on your
other connected devices.

If reordering is unavailable for one environment, update the T3 Code server running in that
environment. Older servers can still pin and unpin threads, but do not understand synced ordering;
their pinned threads keep the default newest-first order below the ones you have arranged.

## Project grouping on native iOS

In the SwiftUI iOS app, open **Settings** and select **Project grouping**. Choose **Group by
repository** to combine checkouts of the same repository, or **Keep separate** to show each
workspace as its own project. You can also keep different paths in a monorepo apart.

When more than one environment is enabled, select the environment whose grouping rules you want
to change. A project override replaces that environment's default for one workspace. Choose **Use
default** to clear the override and inherit the default again. The iOS app stores these choices for
each environment, so they remain in effect after the app reconnects or relaunches. Home updates its
project filter and thread labels to match the effective grouping rules.
Workspaces kept separate continue to use their individual project names.

## Environment artwork

Dev and Nightly environments can identify themselves with artwork at the top of the sidebar and in
the send button. Choose **Artwork**, **Version pill**, or **None** in Settings under environment
identification. Artwork is recolored to match each built-in theme. Custom themes use the **Version
pill** fallback because their colors are not controlled by T3 Code.

To generate a fresh title from the conversation, open a thread's context menu and choose
**Regenerate title**. While T3 Code is generating it, the action reads **Regenerating…** and cannot
be selected again. The option is hidden when the connected environment needs a server update.

## Summary timeline on native iOS

In the SwiftUI iOS app, swipe a thread row to the right to open its summary timeline. The first
entry summarizes the completed turns already in the thread. Later entries are added after each
group of eight completed turns and show the turn and date range they cover. Summaries stay in the
timeline and are never inserted into the conversation.
