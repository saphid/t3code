/**
 * Hook-held state for the file-comment toolbar (parity row 14), lifted out of
 * the view so its lifecycle is testable.
 */

import {
  messagesEnrichmentApi,
  type MessagesEnrichmentCapabilities,
} from "@t3tools/extension-sdk/catalogue";
import { bindApi } from "@t3tools/extension-sdk/capabilities";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useEffect, useMemo, useState } from "react";

import type { EditorSurface } from "./editorSession.ts";
import {
  commentUnavailableReason,
  selectionLineRange,
  type FileCommentRange,
} from "./fileComments.ts";

/** A textarea character selection, pinned to the path it was made in. */
export interface EditorSelection {
  readonly path: string;
  readonly start: number;
  readonly end: number;
}

/**
 * The editor selection the comment toolbar offers, expanded to whole lines.
 * A selection is a pair of offsets into one buffer, so it dies with that
 * buffer: a path switch (or re-selecting the current file) and any new
 * contents identity — a local edit, a reload, an external sync — invalidate
 * it. Without that, reopening a file re-arms the stale offsets over lines
 * that drifted underneath them and offers "Comment on L40 to L42" for a
 * selection nobody is holding.
 */
export function useEditorSelection(
  surface: EditorSurface | null,
  selected: string | null,
): {
  readonly selectionRange: FileCommentRange | null;
  readonly setSelection: (selection: EditorSelection) => void;
  readonly clearSelection: () => void;
} {
  const [editorSelection, setEditorSelection] = useState<EditorSelection | null>(null);
  const contents = surface?.contents ?? null;
  useEffect(() => {
    setEditorSelection(null);
  }, [contents, selected]);
  // Drag-select re-renders on every mousemove while a selection is held, and
  // expanding two offsets into lines scans the buffer from offset 0 — the
  // memo bounds that to one scan per actual input change.
  const selectionRange = useMemo(
    () =>
      editorSelection !== null &&
      editorSelection.path === selected &&
      surface !== null &&
      surface.open.editable
        ? selectionLineRange(surface.contents, editorSelection.start, editorSelection.end)
        : null,
    [surface, editorSelection, selected],
  );
  return {
    selectionRange,
    setSelection: setEditorSelection,
    clearSelection: () => setEditorSelection(null),
  };
}

/** The grant-free `t3.messages/enrichment` capability probe, as the toolbar consumes it. */
const CHECKING_REASON = "Checking comment support with the host…";

/**
 * Why commenting is unavailable right now, or null when a selection can be
 * submitted. The probe itself is grant-free; a denied write grant can only
 * surface as the invoke's named error at submit, which the form shows inline.
 * A rejected probe is a degraded capability answer in the host's own
 * `transport: "unavailable"` vocabulary — never a "Checking…" state that
 * outlives the probe that died.
 */
export function useCommentBlockReason(
  host: ClientHost,
  session: ViewSession,
  threadId: string | undefined,
): string | null {
  const [capabilities, setCapabilities] = useState<MessagesEnrichmentCapabilities | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(messagesEnrichmentApi, host, session.context)
      .invoke("getCapabilities", {}, signal)
      .then(
        (resolved) => {
          if (!signal.aborted) setCapabilities(resolved);
        },
        (error) => {
          if (signal.aborted) return;
          setCapabilities({
            adapter: "unknown",
            transport: "unavailable",
            detail:
              error instanceof Error
                ? error.message
                : "Comment support could not be checked with the host.",
            operations: { attachAnnotation: false },
          });
        },
      );
    return () => controller.abort();
  }, [host, session]);
  // threadId is read per render, not captured in the effect: a project-scoped
  // surface can switch threads under a mounted panel.
  return capabilities === null ? CHECKING_REASON : commentUnavailableReason(capabilities, threadId);
}
