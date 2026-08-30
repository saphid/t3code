# Edit files in the SwiftUI app

The native SwiftUI app can edit complete text-file previews. Tap **Edit**, make your changes, then tap **Save**. Closing the editor, navigating away, switching environments, or backgrounding the app does not save the buffer.

Each save is checked against the file version that the editor loaded. If an agent, another device, or another client changed, replaced, moved, or deleted the file, T3 Code leaves both versions untouched and shows a conflict. You can inspect your buffer and the latest file, then choose:

- **Keep Mine** checks the latest version again before replacing it.
- **Reload Latest** replaces the editor buffer with the latest file.
- **Save Copy** writes your buffer to a new sibling file without replacing an existing file.
- **Cancel** returns to the dirty editor without writing.

Large partial previews and servers that do not support versioned writes stay read-only.
