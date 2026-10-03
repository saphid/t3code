"use client";

import { PreviewPanelShell } from "~/components/preview/PreviewPanelShell";
import { PreviewView } from "~/components/preview/PreviewView";
import { isPreviewSupportedInRuntime } from "~/previewStateStore";

import { usePanelHost } from "../panelHost";

interface PreviewSidePanelProps {
  tabId?: string | null;
  configuredUrls?: ReadonlyArray<string> | undefined;
}

// RightPanelTabs owns placement, so the side panel is always embedded.
export default function PreviewSidePanel({ tabId, configuredUrls }: PreviewSidePanelProps) {
  const { threadRef, visible, sendAnnotation } = usePanelHost();
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
        onSendAnnotation={sendAnnotation}
      />
    </PreviewPanelShell>
  );
}
