import type { LocalApi, ScopedThreadRef } from "@t3tools/contracts";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";

import { openUrlInPreview, type OpenPreviewMutation } from "./openFileInPreview";

const browserLinkErrorContext = {
  environmentId: Schema.String,
  threadId: Schema.String,
  targetOrigin: Schema.String,
  cause: Schema.Defect(),
};

export class BrowserLinkContextMenuShowError extends Schema.TaggedErrorClass<BrowserLinkContextMenuShowError>()(
  "BrowserLinkContextMenuShowError",
  browserLinkErrorContext,
) {
  override get message(): string {
    return `Failed to show the context menu for browser link ${this.targetOrigin}.`;
  }
}

export class BrowserLinkOpenInNewTabError extends Schema.TaggedErrorClass<BrowserLinkOpenInNewTabError>()(
  "BrowserLinkOpenInNewTabError",
  browserLinkErrorContext,
) {
  override get message(): string {
    return `Failed to open browser link ${this.targetOrigin} in a new tab for thread ${this.threadId}.`;
  }
}

export class BrowserLinkCopyError extends Schema.TaggedErrorClass<BrowserLinkCopyError>()(
  "BrowserLinkCopyError",
  browserLinkErrorContext,
) {
  override get message(): string {
    return `Failed to copy the browser link ${this.targetOrigin} to the clipboard.`;
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
  readonly threadRef: ScopedThreadRef;
  readonly openPreview: OpenPreviewMutation<E>;
  readonly localApi: LocalApi;
}

/**
 * Show the native link menu for a right-clicked link in the hosted browser
 * webview. No position is passed so the menu pops at the cursor, which
 * sidesteps guest-to-window coordinate mapping across viewport scale and
 * zoom. Failures are reported to the console and otherwise swallowed: a
 * broken menu must never take the page down with it.
 */
export async function showBrowserLinkContextMenu<E>(
  input: BrowserLinkContextMenuInput<E>,
): Promise<void> {
  const errorContext = {
    environmentId: input.threadRef.environmentId,
    threadId: input.threadRef.threadId,
    targetOrigin: new URL(input.url).origin,
  };

  let choice: "open-link-in-new-tab" | "copy-link-address" | null;
  try {
    choice = await input.localApi.contextMenu.show([
      { id: "open-link-in-new-tab", label: "Open Link in New Tab" },
      { id: "copy-link-address", label: "Copy Link Address" },
    ]);
  } catch (cause) {
    console.error(new BrowserLinkContextMenuShowError({ ...errorContext, cause }));
    return;
  }

  if (choice === "open-link-in-new-tab") {
    const result = await openUrlInPreview({
      threadRef: input.threadRef,
      url: input.url,
      openPreview: input.openPreview,
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      console.error(new BrowserLinkOpenInNewTabError({ ...errorContext, cause: result.cause }));
    }
    return;
  }

  if (choice === "copy-link-address") {
    try {
      await writeTextToClipboard(input.url, "link address");
    } catch (cause) {
      console.error(new BrowserLinkCopyError({ ...errorContext, cause }));
    }
  }
}
