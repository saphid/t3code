import { Tooltip } from "@t3tools/extension-sdk/authoring";
import type { BrowserCaptureTarget } from "@t3tools/extension-sdk/catalogue";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import type { CSSProperties } from "react";

import {
  annotationControl,
  useBrowserCapture,
  type CapturePageView,
  type CaptureSessionRef,
} from "./capture.js";
import { useBrowserRecording } from "./recording.js";

export function BrowserCaptureButtons(props: {
  host: ClientHost;
  session: ViewSession;
  held: CaptureSessionRef | null;
  page: CapturePageView;
  onStatus?: (line: string | null) => void;
  style: CSSProperties;
}) {
  const { host, session, held, page, onStatus, style } = props;
  const capture = useBrowserCapture(host, session, held, page, onStatus);
  const recording = useBrowserRecording(host, session, held, page, onStatus);
  const capturing = capture.state.kind === "capturing" ? capture.state.target : null;
  return (
    <>
      <ScreenshotButton
        host={host}
        blockReason={capture.blockReason}
        capturing={capturing}
        pageFailed={page === "failed"}
        recording={recording.phase !== "idle"}
        recordingAvailable={recording.available}
        onCapture={(record) => {
          if (record || recording.phase !== "idle") void recording.toggle();
          else capture.capture("page");
        }}
        style={style}
      />
      <AnnotateButton
        host={host}
        blockReason={capture.blockReason}
        capturing={capturing}
        pageFailed={page === "failed"}
        onPick={() => capture.capture("element")}
        style={style}
      />
    </>
  );
}

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
        aria-description={annotate.picking ? undefined : (blockReason ?? undefined)}
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

/**
 * The header's screenshot and Shift-click recording button. A failed page
 * disables screenshots without a description; a running recording can
 * still be stopped when its page is no longer presented.
 */
export function ScreenshotButton(props: {
  host: ClientHost;
  blockReason: string | null;
  capturing: BrowserCaptureTarget | null;
  pageFailed: boolean;
  recording?: boolean;
  recordingAvailable?: boolean;
  onCapture: (record: boolean) => void;
  style: CSSProperties;
}) {
  const {
    host,
    blockReason,
    capturing,
    pageFailed,
    onCapture,
    style,
    recording = false,
    recordingAvailable = false,
  } = props;
  return (
    <Tooltip
      host={host}
      label={
        recording
          ? "Stop recording"
          : recordingAvailable
            ? "Screenshot · Shift-click to record"
            : "Screenshot"
      }
    >
      <button
        type="button"
        aria-label={recording ? "Stop recording" : "Capture screenshot"}
        aria-description={pageFailed ? undefined : (blockReason ?? undefined)}
        disabled={(!recording && blockReason !== null) || capturing !== null}
        onClick={(event) => onCapture(event.shiftKey)}
        style={{
          ...style,
          position: "relative",
          ...(recording
            ? { color: "var(--destructive, #dc2626)", background: "var(--secondary, #f1f1f1)" }
            : {}),
        }}
      >
        ▣
        {recording && (
          <span
            aria-hidden
            className="animate-status-pulse"
            style={{
              position: "absolute",
              right: 2,
              top: 2,
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--destructive, #dc2626)",
            }}
          />
        )}
      </button>
    </Tooltip>
  );
}
