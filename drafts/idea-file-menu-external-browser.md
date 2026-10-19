# Web: add Open in external browser to file-link menus

<!-- Ideas discussion draft. Local screenshot reference (not for publication,
     contains workspace content): .t3/drafts/file-menu-external-browser.png -->

## Problem or use case

Right-clicking a file chip in a thread offers **Open in editor**, **Open in integrated browser**, **Copy relative path**, and **Copy full path**. When an agent produces a self-contained HTML artifact — a report, a visualization, an explainer page — reviewing it in a real browser (devtools, extensions, full viewport) means copying the full path and opening it by hand. The menu has no **Open in external browser**.

## Proposed solution

Add an **Open in external browser** item to the file-link context menu, shown under the same condition as **Open in integrated browser** (the file is previewable). In the desktop app it opens the system default browser; in the web client it opens a new browser tab.

## Why this matters

Agents emit HTML artifacts constantly, and the integrated browser is deliberately minimal. Anyone who wants the artifact in their actual browser pays the copy-path-and-paste tax on every file, several times a day.

## Smallest useful scope

The chat file-chip context menu in the web client (`ChatMarkdown`), for files that already qualify for the integrated-browser action. Other file-link menus (pull-request markdown, file viewers) can follow up separately once the open-external plumbing exists.

## Alternatives considered

- Status quo: **Copy full path** plus a manual open works but is the friction this removes.
- Making the integrated browser open externally by default: changes existing behavior and loses the in-app preview people rely on.

## Risks or tradeoffs

- An external browser has no T3 session. When the client is remote (relay/tunnel), a bare filesystem path is useless and a served URL must be reachable and authorized from the user's machine; when client and server share a machine, the desktop app can open the file directly. The item may need to be desktop-only or local-only in the first slice.
- One more menu item; the menu stays a single flat list.

## References

- Menu implementation: `apps/web/src/components/ChatMarkdown.tsx` (file-chip context menu).
- Planned implementation branch: `agent/web-file-menu-external-browser`, mapping 1:1 to a single PR (`feat(web): open file links in an external browser`).

## Contribution

I would be open to helping implement this.
