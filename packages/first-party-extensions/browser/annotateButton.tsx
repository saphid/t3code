import { Tooltip } from "@t3tools/extension-sdk/authoring";
import type { BrowserCaptureTarget } from "@t3tools/extension-sdk/catalogue";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { CSSProperties } from "react";

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
  return (
    <Tooltip host={host} label={annotate.tooltip} showWhenDisabled={annotate.hoverWhileDisabled}>
      <button
        type="button"
        aria-label={annotate.ariaLabel}
        aria-description={blockReason ?? undefined}
        aria-pressed={annotate.picking}
        disabled={annotate.disabled}
        onClick={onPick}
        style={style}
      >
        ⌖
      </button>
    </Tooltip>
  );
}
