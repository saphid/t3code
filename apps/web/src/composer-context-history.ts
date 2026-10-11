export function createComposerContextHistory(contextIds: ReadonlySet<string>) {
  return {
    current: contextIds,
    undo: [] as ReadonlySet<string>[],
    redo: [] as ReadonlySet<string>[],
  };
}

/**
 * Mirror the documents reachable through the editor's actual undo/redo depths,
 * storing only their context ids. Depth decreases without redo growth when
 * ProseMirror trims old groups; an ordinary edit also discards the redo branch.
 */
export function updateComposerContextHistory(
  history: ReturnType<typeof createComposerContextHistory>,
  input: { contextIds: ReadonlySet<string>; undoDepth: number; redoDepth: number },
): ReadonlySet<string> {
  if (input.undoDepth > history.undo.length) {
    history.undo.push(history.current);
  } else if (input.undoDepth < history.undo.length) {
    if (input.redoDepth > history.redo.length) {
      history.redo.push(history.current);
      history.undo.length = input.undoDepth;
    } else {
      history.undo.push(history.current);
      history.undo.splice(0, history.undo.length - input.undoDepth);
    }
  }
  history.redo.length = input.redoDepth;
  history.current = input.contextIds;
  return new Set([
    ...history.current,
    ...history.undo.flatMap((ids) => [...ids]),
    ...history.redo.flatMap((ids) => [...ids]),
  ]);
}
