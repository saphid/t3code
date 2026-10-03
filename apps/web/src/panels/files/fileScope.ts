import { useCallback, useLayoutEffect, useRef } from "react";

import type { AddToChatResult } from "~/components/files/FileBrowserPanel";
import { useComposerHandleContext } from "~/composerHandleContext";

/**
 * Tells async work started in one scope whether the panel still shows that
 * scope. The returned check is stable per `scopeKey`, so work keeps the check
 * from the scope it started in. It turns false once the panel moves to another
 * scope (another thread, or the same thread id in another environment) or
 * unmounts.
 */
export function useScopeLifetime(scopeKey: string): () => boolean {
  const currentRef = useRef<string | null>(null);
  // Set on commit, so a discarded render never retires live work.
  useLayoutEffect(() => {
    currentRef.current = scopeKey;
    return () => {
      currentRef.current = null;
    };
  }, [scopeKey]);
  return useCallback(() => currentRef.current === scopeKey, [scopeKey]);
}

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
