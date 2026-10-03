"use client";

import type { PreviewAnnotationPayload, ScopedThreadRef } from "@t3tools/contracts";

import { PreviewPanelShell } from "~/components/preview/PreviewPanelShell";
import { PreviewView } from "~/components/preview/PreviewView";
import type { ComposerImageAttachment } from "~/composerDraftStore";
import { isPreviewSupportedInRuntime } from "~/previewStateStore";

export interface PreviewSidePanelProps {
  threadRef: ScopedThreadRef;
  tabId?: string | null;
  configuredUrls?: ReadonlyArray<string> | undefined;
  visible: boolean;
  onSendAnnotation?: (
    annotation: PreviewAnnotationPayload,
    image: ComposerImageAttachment | null,
  ) => void;
}

// RightPanelTabs owns placement, so the side panel is always embedded.
export default function PreviewSidePanel({
  threadRef,
  tabId,
  configuredUrls,
  visible,
  onSendAnnotation,
}: PreviewSidePanelProps) {
  if (!isPreviewSupportedInRuntime()) {
    return (
      <PreviewPanelShell mode="embedded">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">
            Preview is only available in the T3 Code desktop app.
          </p>
        </div>
      </PreviewPanelShell>
    );
  }

  return (
    <PreviewPanelShell mode="embedded">
      <PreviewView
        threadRef={threadRef}
        {...(tabId !== undefined ? { tabId } : {})}
        configuredUrls={configuredUrls}
        visible={visible}
        {...(onSendAnnotation ? { onSendAnnotation } : {})}
      />
    </PreviewPanelShell>
  );
}
