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
  readonly position: { readonly x: number; readonly y: number };
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
    position: input.position,
    canOpenInPreview: true,
    showContextMenu: (items, position) => input.localApi.contextMenu.show(items, position),
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
    copyLink: (href) => writeTextToClipboard(href, "link"),
    reportFailure,
  });
}
