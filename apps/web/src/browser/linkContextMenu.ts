import type { LocalApi, ScopedThreadRef } from "@t3tools/contracts";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";

import { recordVisitForThread } from "~/browserHistoryStore";
import {
  showExternalLinkContextMenu,
  type ExternalLinkContextMenuFailureOperation,
} from "~/components/chat/externalLinkContextMenu";
import { openPreviewSession } from "~/components/preview/openPreviewSession";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useRightPanelStore } from "~/rightPanelStore";

import type { OpenPreviewMutation } from "./openFileInPreview";

export class BrowserLinkContextMenuError extends Schema.TaggedErrorClass<BrowserLinkContextMenuError>()(
  "BrowserLinkContextMenuError",
  {
    operation: Schema.Literals([
      "show-link-context-menu",
      "open-link-in-preview",
      "open-link-external",
      "copy-link",
    ]),
    environmentId: Schema.String,
    threadId: Schema.String,
    targetOrigin: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Browser link menu operation ${JSON.stringify(this.operation)} failed for ${this.targetOrigin}.`;
  }
}

/**
 * The guest webview keeps input focus when the user right-clicks inside the
 * page, and Chromium refuses clipboard writes from an unfocused embedder
 * document. Reclaim focus and wait for it to land (bounded, in case the
 * window manager never delivers it) before writing.
 */
async function reclaimDocumentFocus(): Promise<void> {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  if (document.hasFocus()) return;
  window.focus();
  if (document.hasFocus()) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", done);
      resolve();
    };
    window.addEventListener("focus", done, { once: true });
    setTimeout(done, 250);
  });
}

/**
 * Guard for right-click targets inside the hosted browser webview. Only
 * http(s) links get a context menu; anything else (javascript:, blob:,
 * malformed hrefs, non-link right-clicks) keeps today's no-menu behavior.
 */
export function resolveBrowserLinkUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return null;
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

interface BrowserLinkContextMenuInput<E> {
  readonly url: string;
  readonly threadRef: ScopedThreadRef;
  readonly openPreview: OpenPreviewMutation<E>;
  readonly localApi: LocalApi;
}

/**
 * Show the app's standard link context menu for a right-clicked link in the
 * hosted browser webview — the same items a link gets everywhere else. "Open
 * in integrated browser" opens the link in a new tab of this browser (with
 * the configured browser defaults) and focuses it. Failures are reported to
 * the console and otherwise swallowed: a broken menu must never take the
 * page down with it.
 *
 * No position is forwarded: the guest event's coordinates are not reliably
 * in main-renderer client space once the viewport is offset or scaled, and a
 * native menu with no position anchors at the cursor, which for a real
 * right-click is exactly the clicked link.
 */
export async function showBrowserLinkContextMenu<E>(
  input: BrowserLinkContextMenuInput<E>,
): Promise<void> {
  const errorContext = {
    environmentId: input.threadRef.environmentId,
    threadId: input.threadRef.threadId,
    targetOrigin: new URL(input.url).origin,
  };
  const reportFailure = (operation: ExternalLinkContextMenuFailureOperation, cause: unknown) => {
    console.error(new BrowserLinkContextMenuError({ ...errorContext, operation, cause }));
  };

  await showExternalLinkContextMenu({
    href: input.url,
    position: { x: 0, y: 0 },
    canOpenInPreview: true,
    showContextMenu: (items) => input.localApi.contextMenu.show(items),
    openInPreview: async (href) => {
      const result = await openPreviewSession({
        openPreview: input.openPreview,
        threadRef: input.threadRef,
        url: href,
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          reportFailure("open-link-in-preview", result.cause);
        }
        return;
      }
      recordVisitForThread(input.threadRef, href);
      useRightPanelStore.getState().openBrowser(input.threadRef, result.value.tabId);
    },
    openExternal: (href) => input.localApi.shell.openExternal(href),
    copyLink: async (href) => {
      await reclaimDocumentFocus();
      await writeTextToClipboard(href, "link");
    },
    reportFailure,
  });
}
