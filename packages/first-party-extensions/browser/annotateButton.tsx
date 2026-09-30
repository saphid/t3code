import { Tooltip } from "@t3tools/extension-sdk/authoring";
import type { BrowserCaptureTarget } from "@t3tools/extension-sdk/catalogue";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { CSSProperties } from "react";
import { resolveUiKit } from "@t3tools/extension-sdk/ui";

import { annotationControl } from "./capture.js";

/** The header's annotate (element pick) button with native's tooltip. */
export function AnnotateButton(props: {
  host: ClientHost;
  blockReason: string | null;
  capturing: BrowserCaptureTarget | null;
  pageFailed: boolean;
  onPick: () => void;
  style: CSSProperties;
}) {
  const { host, blockReason, onPick, style } = props;
  const annotate = annotationControl(props);
  const kit = resolveUiKit(host);
  const Button = kit?.Button ?? "button";
  return (
    <Tooltip host={host} label={annotate.tooltip} showWhenDisabled={annotate.hoverWhileDisabled}>
      <Button
        {...(kit
          ? ({ variant: annotate.picking ? "secondary" : "ghost", size: "icon-xs" } as const)
          : {})}
        type="button"
        aria-label={annotate.ariaLabel}
        aria-description={annotate.picking ? undefined : (blockReason ?? undefined)}
        aria-pressed={annotate.picking}
        disabled={annotate.disabled}
        onClick={onPick}
        style={kit ? undefined : style}
      >
        {kit ? <kit.Icon name="annotate" /> : "⌖"}
      </Button>
    </Tooltip>
  );
}

/**
 * The header's screenshot button. Native says "Screenshot · Shift-click to
 * record"; this pack has no recording, so it keeps only the part that is
 * true here. A failed page disables it without a description: native's
 * failed-page reason belongs to the pick control beside it.
 */
export function ScreenshotButton(props: {
  host: ClientHost;
  blockReason: string | null;
  capturing: BrowserCaptureTarget | null;
  pageFailed: boolean;
  onCapture: () => void;
  style: CSSProperties;
}) {
  const { host, blockReason, capturing, pageFailed, onCapture, style } = props;
  const kit = resolveUiKit(host);
  const Button = kit?.Button ?? "button";
  return (
    <Tooltip host={host} label="Screenshot">
      <Button
        {...(kit ? ({ variant: "ghost", size: "icon-xs" } as const) : {})}
        type="button"
        aria-label="Capture screenshot"
        aria-description={pageFailed ? undefined : (blockReason ?? undefined)}
        disabled={blockReason !== null || capturing !== null}
        onClick={onCapture}
        style={kit ? undefined : style}
      >
        {kit ? <kit.Icon name="camera" /> : "▣"}
      </Button>
    </Tooltip>
  );
}
