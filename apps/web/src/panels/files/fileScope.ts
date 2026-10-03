import { useCallback } from "react";

import type { AddToChatResult } from "~/components/files/FileBrowserPanel";
import { useComposerHandleContext } from "~/composerHandleContext";

/**
 * Inserts text at the end of the layout's chat composer while `isScopeCurrent`
 * holds. The composer ref is shared by the whole chat layout, so an action that
 * settles after navigation is dropped instead of reaching the newer thread.
 */
export function useScopedComposerInsert(isScopeCurrent: () => boolean) {
  const composerRef = useComposerHandleContext();
  return useCallback(
    (text: string): AddToChatResult => {
      if (!isScopeCurrent()) return "dropped";
      const composer = composerRef?.current;
      if (!composer) return "no-composer";
      return composer.insertTextAtEnd(text, { ensureLeadingBoundary: true })
        ? "inserted"
        : "not-ready";
    },
    [composerRef, isScopeCurrent],
  );
}
