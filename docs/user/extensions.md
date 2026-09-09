# Environment extensions

Environment extensions add tools and views to T3 Code. Install a package in the environment that owns the projects it will use. Extension views are available in web and desktop; React Native mobile and SwiftUI mobile do not support these views.

Packages run trusted code in the environment and client. Install only code you trust. Project and capability grants control access to T3-provided services; they do not sandbox the package.

## Install a package

1. Open **Settings → Integrations → Environment extensions** and select the environment.
2. Enter the package directory on that environment's machine. A path on your client machine will not work for a remote environment unless the package also exists there.
3. Select the projects and capabilities to grant. Check each project's workspace path, especially when projects have the same name.
4. Read and select the trust acknowledgement, then choose **Install package**.

Managing packages requires access-management permission on the selected environment. Installation does not automatically open a view.

## Use an extension

Open a thread in an allowed project and choose a compatible view from the thread header's **Extensions** menu. Extensions can appear in a side panel or bottom dock.

For the workspace reader, enter a relative file path and choose **Read file**. To include the last successful read in a prompt, explicitly select its composer context contribution. Reading alone does not add text to your prompt. Review the captured text before sending; it is a snapshot, so read and select again when you need newer content.

An extension can also provide agent tools. Availability depends on its enabled state, project and capability grants, and the provider session. A view and an agent tool are separate contributions; a package need not provide both.

## Disable, update or remove

Return to **Environment extensions** to choose **Disable**, **Enable** or **Remove**. Disabling makes the package unavailable and revokes its T3-provided operations. Captured context already in drafts or messages remains readable. Saved views can show a fallback until their extension is available again.

To update, enter the replacement package directory, acknowledge trust and choose **Update from package directory** on the package. Updates keep existing grants. To change grants, remove the package and reinstall it with the intended permissions.

Use **Refresh extensions** after changing packages from another connected client. Changes are not pushed automatically to every client; an old view can remain visible until refresh even though its obsolete tool calls are rejected.

The built-in Files, Diff, Version Control, Browser, Terminal and Agents panels are bundled integrations. They are not separately installed or removed through this package list.
