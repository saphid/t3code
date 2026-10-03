# Plugins

A plugin is a directory of JavaScript with a `t3-plugin.json` manifest. Each environment runs its own
plugins: they live on the server's machine and run there, not on the device you manage them from.

Plugins are trusted local code, not a sandbox. An enabled plugin runs as your user account on the
server's machine, with the same access to its files, programs, and network. Only add code you trust.

## Adding a plugin

Open **Settings** > **Plugins** (on mobile, **Settings** > **Server settings** > **Plugins**). Each
environment whose server supports plugins has its own list. Choose **Add plugin** and enter the
absolute path of the plugin directory on that environment's machine. Adding reads the manifest and
the files; nothing runs yet.

Review the plugin before it runs: the review shows the plugin ID, its directory, the number and size
of its files, a digest of their exact contents, and the capabilities it declares. Confirm that you
trust it, then **Approve and enable**. The plugin starts the first time it is used.

Add a plugin's build directory, not a git checkout. Every file in the directory counts, hidden files
included, and symbolic links are refused.

## When a plugin changes

Your approval covers the exact files you reviewed. If any file in the directory changes, T3 Code
stops the plugin, disables it, and shows **Changed since approval** until you review it again. A
plugin that writes into its own directory will therefore stop itself; plugins must keep their data
elsewhere. Use **Check files again** to re-read a directory after you change it.

The digest records what you approved. It does not stop the directory's owner from changing it, and
code a plugin loads from outside its directory is not covered.

## Managing plugins

Disable stops a plugin without forgetting your approval. Remove stops it and forgets it; the
directory itself is never deleted. Both are always available, even when the directory is gone.

A plugin that crashes waits briefly before its next start, and is stopped after repeated failures.
A plugin that cannot run on this version of T3 Code is marked **Incompatible**. Fix the problem,
then choose **Resume**.

Managing plugins needs administrative access to the environment. A device paired with a standard
link can see the plugins but not change them; pair it with an administrative link to manage them.

## Plugin views

A plugin with the `views` capability can show its own panels. On the web and desktop app, open one
from a thread's right panel, where each view is listed after the built-in panels. On iOS, open the
plugin in **Settings** > **Server settings** > **Plugins** and choose the view under **Views**. Plugin
views are not available on Android yet.

A view runs isolated from T3 Code and can only call its own plugin. Disabling, removing, or changing
the plugin closes its open views on every device.
