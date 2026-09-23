/**
 * Hook-held state for the file-comment toolbar (parity row 14), lifted out of
 * the view so its lifecycle is testable.
 */

import { useEffect, useState } from "react";

import type { EditorSurface } from "./editorSession.ts";
import { selectionLineRange, type FileCommentRange } from "./fileComments.ts";

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
  const selectionRange =
    editorSelection !== null &&
    editorSelection.path === selected &&
    surface !== null &&
    surface.open.editable
      ? selectionLineRange(surface.contents, editorSelection.start, editorSelection.end)
      : null;
  return {
    selectionRange,
    setSelection: setEditorSelection,
    clearSelection: () => setEditorSelection(null),
  };
}
