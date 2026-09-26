/**
 * Hook-held state for the file-comment toolbar, lifted out of
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
  buildCommentExcerpt,
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
 * A selection is a pair of offsets into one buffer, so it is captured pinned
 * to that buffer (path + contents identity) and dies the moment either
 * changes: a path switch (or re-selecting the current file), a local edit, a
 * reload, an external sync. Liveness is derived at read rather than cleared
 * in an effect — the toolbar never renders one frame of a stale range. And
 * without the pin at all, reopening a file re-arms stale offsets over lines
 * that drifted underneath them, offering "Comment on L40 to L42" for a
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
  const [pinned, setPinned] = useState<{
    readonly contents: string | null;
    readonly selected: string | null;
    readonly selection: EditorSelection | null;
  }>({ contents: null, selected: null, selection: null });
  const contents = surface?.contents ?? null;
  // The pin is on the contents string, not the surface object: a save-state
  // flip swaps the object while the string value still compares equal.
  const editorSelection =
    pinned.contents === contents && pinned.selected === selected ? pinned.selection : null;
  if (pinned.selection !== null && (pinned.selected !== selected || pinned.contents !== contents)) {
    // The selection's file or buffer was left — even away and back. Retire
    // the pin in render (React's adjust-state-when-props-change shape) on
    // EITHER input's mismatch: `===` on string primitives is value equality,
    // so a byte-identical reopen or revert would re-match a lingering pin
    // and re-arm offsets nobody is holding. The pin is already dead at read
    // on a contents mismatch, so retiring it there is free.
    setPinned({ contents: null, selected, selection: null });
  }
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
    setSelection: (selection) => setPinned({ contents, selected, selection }),
    clearSelection: () => setPinned({ contents, selected, selection: null }),
  };
}

/** The open comment draft — range + excerpt captured against one buffer. */
export interface CommentDraft {
  readonly path: string;
  readonly range: FileCommentRange;
  readonly excerpt: string;
  readonly truncated: boolean;
}

/**
 * The comment draft pinned to the buffer its range and excerpt were
 * captured against — the same pin-at-capture shape as the selection above,
 * one level deeper at the write path. The editor textarea stays live under
 * an open draft, so the captured offsets are only honest while the buffer
 * is byte-identical: a local edit, a reload, or an external sync turns the
 * form stale (`draftStale`) rather than letting submit retarget drifted
 * lines — `attachAnnotation` must never receive offsets captured against
 * different bytes than the buffer live at submit. And a draft dies with
 * navigation the way a held selection does ("selecting is navigating"):
 * `select()` closes it, and the pin retires in render the moment the
 * selected path changes so a byte-identical reopen cannot re-arm it —
 * `===` on string primitives is value equality, so a reopened file's
 * identical bytes are indistinguishable to the contents pin alone.
 */
export function useCommentDraft(
  surface: EditorSurface | null,
  selected: string | null,
): {
  readonly draft: CommentDraft | null;
  readonly draftStale: boolean;
  readonly openDraft: (range: FileCommentRange) => void;
  readonly closeDraft: () => void;
} {
  const [pinned, setPinned] = useState<{
    readonly contents: string | null;
    readonly selected: string | null;
    readonly draft: CommentDraft | null;
  }>({ contents: null, selected: null, draft: null });
  const contents = surface?.contents ?? null;
  if (pinned.draft !== null && pinned.selected !== selected) {
    setPinned({ contents: null, selected, draft: null });
  }
  const draft = pinned.draft !== null && pinned.selected === selected ? pinned.draft : null;
  // Stale stays visible: the form keeps the user's text and names the
  // drift, but submit is dead while the pinned buffer no longer matches.
  const draftStale = draft !== null && pinned.contents !== contents;
  return {
    draft,
    draftStale,
    openDraft: (range) => {
      if (selected === null || surface === null) return;
      const { excerpt, truncated } = buildCommentExcerpt(surface.contents, range);
      setPinned({ contents, selected, draft: { path: selected, range, excerpt, truncated } });
    },
    closeDraft: () => setPinned({ contents, selected, draft: null }),
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
            operations: {
              attachAnnotation: false,
              listAnnotations: false,
              removeAnnotation: false,
            },
          });
        },
      );
    return () => controller.abort();
  }, [host, session]);
  // threadId is read per render, not captured in the effect: a project-scoped
  // surface can switch threads under a mounted panel.
  return capabilities === null ? CHECKING_REASON : commentUnavailableReason(capabilities, threadId);
}
