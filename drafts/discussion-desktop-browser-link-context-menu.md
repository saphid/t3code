## Problem or use case

In the desktop app's in-app browser, links only respond to a left click, which navigates the current page. Right-clicking a link does nothing: there is no way to open a link in a new tab or copy the link address. The in-app browser already has tabs (they even persist across restarts since #7556 was fixed), so "open this link in a new tab" is a natural expectation that the UI silently ignores. Copying a link today means navigating to it, losing the page you were on, and then copying from the address bar.

## Proposed solution

Show a native context menu when right-clicking a link inside the in-app browser, with two items:

- **Open Link in New Tab**: opens the link's URL in a new tab of the same in-app browser, without leaving the current page.
- **Copy Link Address**: puts the link's URL on the system clipboard.

The menu only appears when the right-click target is a link. Right-clicking elsewhere on the page keeps today's behavior.

## Why this matters

Users drive agents against running dev servers and docs pages in this pane all day. Wanting to branch off a link without losing the current page, or to hand a URL to the agent or another app, is everyday browsing behavior. Its absence makes the pane feel broken compared to any real browser.

## Smallest useful scope

Desktop only, links only, the two menu items above. Non-goals for the first PR:

- A full Chrome-style page context menu (back/forward, reload, inspect, image saving, selection copy).
- "Open in external browser" from the menu (natural follow-up).
- Any change to left-click or target="_blank" behavior (that is #3577's territory).

## Alternatives considered

- **Cmd/middle-click to open in a new tab**: complementary, but undiscoverable, and does nothing for copying a link.
- **Do nothing, copy from the address bar**: loses the current page and requires a navigation just to read a URL.

## Risks or tradeoffs

- The menu should be a native menu driven from the main process, so there is no injected DOM UI and no per-frame rendering cost.
- Writing to the clipboard from the main process sidesteps the renderer clipboard permission problem previously seen in the preview (#3738).
- Web and mobile clients render previews differently and are out of scope; this is a desktop webContents feature.

## References

- #3577 - In App Browser: links that open a new tab do nothing (adjacent click-path bug, not the context menu).
- #7556 - Browser preview tabs persist across restart (establishes tabs as a first-class concept).
- #4155 - Copy Link in the chat link context menu (same affordance, different surface).
- #3738 - Preview browser silently denies clipboard writes.

## Contribution

I am happy to implement this. Planned branch: `agent/desktop-browser-link-context-menu`.
