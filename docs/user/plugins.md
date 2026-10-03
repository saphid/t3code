# Plugins

A plugin adds commands, agent tools, notifications, settings, panels, and more to T3 Code. Each
environment runs its own plugins: they live on the server's machine and run there, not on the
device you manage them from.

Plugins are trusted local code, not a sandbox. An enabled plugin runs as your user account on the
server's machine, with the same access to its files, programs, and network. Only add code you trust.

## Adding a plugin

Open **Settings** > **Plugins** (on mobile, **Settings** > **Server settings** > **Plugins**). Each
environment whose server supports plugins has its own list. Choose **Add plugin** and enter the
absolute path of the plugin directory on that environment's machine. Adding reads the manifest and
the files; nothing runs yet.

Add a plugin's build directory, not a git checkout. Every file in the directory counts, hidden files
included, and symbolic links are refused.

## Installing from npm

On servers that support it, **Install from npm** downloads a plugin package instead of adding a
directory. Enter the package name and an exact version or a tag such as `latest` (ranges are not
accepted); the registry is optional and defaults to npm's. The server downloads the package, checks
it against the registry's sha512 checksum, and unpacks it into a directory it manages. The checksum
shows the bytes are what the registry published, not who published them.

Installing never runs package scripts and never installs dependencies, so a plugin package must
bundle everything it needs. Nothing runs until you review and approve the downloaded files, exactly
as for a directory. Discarding a download you have not approved removes it.

To update an npm plugin, open its details and download a version or tag under **Updates**. The
download sits next to the installed version, which keeps running. Review the new files and their
capabilities, then **Apply update**: applying approves the new files in their place. If anything
fails before then, the installed version stays. A server restart discards a download you have not
applied. Removing an npm plugin deletes the server's copy.

## Approving a plugin

Review a plugin before it runs. The review shows the plugin ID, its directory, the number and size
of its files, a digest of their exact contents, and the capabilities it declares. Confirm that you
trust it, then choose **Approve and enable**. The plugin starts the first time it is used, not when
you enable it.

The plugin ID and version come from the plugin itself. They name the plugin; they do not prove who
wrote it.

## When a plugin changes

Your approval covers the exact files you reviewed. If any file in the directory changes, T3 Code
stops the plugin, disables it, and shows **Changed since approval** until you review it again. A
plugin that writes into its own directory will therefore stop itself; plugins must keep their data
elsewhere. Use **Check files again** to re-read a directory after you change it.

The digest records what you approved. It does not stop the directory's owner from changing it, and
code a plugin loads from outside its directory is not covered.

## Enabling, disabling, and removing

Use **Enable**, **Disable**, or **Remove** in the plugin's controls. Disabling stops the plugin at
once and keeps your approval and its settings. Removing stops it and forgets it, including its
settings and saved data. A directory you added yourself is kept; for a plugin installed from npm,
the server's copy is deleted. You can disable or remove a plugin even when its directory is gone.

Managing plugins needs administrative access to the environment. A device paired with a standard
link can see the plugins and their settings but not change them; pair it with an administrative link
to manage them.

## Plugin settings

A plugin can declare settings, such as a label, an option, or an API token. Set them in
**Settings** > **Integrations** under the plugin's name (on mobile, on the environment's screen in
**Settings**). You can change settings before the plugin first runs, and plugins read the new values
the next time they use them. Secrets are saved on the server and only the plugin can read them;
after saving, T3 Code shows only that a secret is set.

## What plugins can do

The review lists the capabilities a plugin declares. Each one lets the plugin do one kind of thing:

- **actions**: adds commands to the command palette, a thread's menu, or the composer's `/` menu.
  Choosing one runs it right away and shows its result; the command text is never sent to the agent.
- **tools**: offers tools that agents can call. Agents find them through T3 Code's own tools. Your
  provider's permission mode decides whether the agent asks before calling one. A thread whose agent
  session started before you enabled the plugin sees its tools once that session starts again.
- **events**: tells the plugin when a turn finishes, with the thread's title and outcome. It never
  includes messages.
- **notifications**: shows short notifications on connected devices, which can open the thread they
  are about. They are not saved: a device that is offline at the time may never see one.
- **status**: shows short labels at the top of a thread, beside statuses from your provider.
- **settings**: declares settings you can change, and keeps a small amount of private data on the
  server.
- **views**: adds panels. On the web and desktop app, open one from a thread's right panel, where
  each view is listed after the built-in panels. Plugin views are not available in the mobile app
  yet. A view runs isolated from T3 Code and can only talk to its own plugin.
- **transforms**: adds short context when you start a new turn, including a queued one, before the
  agent receives it. Messages that steer a running turn and slash commands get no added context.
  The thread shows what each plugin added; your message itself is never changed. At most four
  plugins add context to one turn.

A plugin's labels, notifications, and open views go away when it is disabled, removed, or changed.

## Troubleshooting

Each plugin shows its state in **Settings** > **Plugins**.

- **Restarting**: the plugin crashed or timed out and starts again on its next use, after a short
  wait.
- **Stopped after repeated failures**: it failed several times in a row and will not start again on
  its own. Fix the cause, then choose **Resume**.
- **Incompatible**: the plugin cannot run on this version of T3 Code. Update the plugin, then choose
  **Resume**.
- **Event delivery retrying** or **Event delivery stopped**: the plugin failed to handle a turn
  event. No events are skipped; after you fix the problem, **Resume** delivers them again from where
  it stopped.
- **Unavailable**: the directory is missing or its manifest is invalid. The detail says why. Fix it,
  then choose **Check files again**.
- **Needs approval** or **Changed since approval**: review the files and approve them to run the
  plugin.

If adding a plugin fails with "this server does not support" a capability, the environment's T3 Code
server is older than the plugin needs. Update the server.

## Writing a plugin

The [example plugins](../../examples/plugins/) show the smallest working plugin for a notification
on finished turns, an agent tool, and a setting shown as a thread status. Each one has a README with
install steps.
