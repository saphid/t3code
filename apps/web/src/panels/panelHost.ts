import type { PreviewAnnotationPayload, ScopedThreadRef } from "@t3tools/contracts";
import { createContext, use, useCallback, useLayoutEffect, useRef } from "react";

import type { ComposerImageAttachment, DraftId } from "~/composerDraftStore";

import { useScopeLifetime } from "./scopeLifetime";

/**
 * What the chat view lends the panel it is rendering. A panel reads this
 * instead of receiving the same values as props, so only panel-specific
 * inputs stay on its props.
 */
export interface PanelHost {
  /** Thread the panel belongs to; its environmentId scopes every server call. */
  readonly threadRef: ScopedThreadRef;
  /** Right panel surface being rendered, unique within the thread. */
  readonly surfaceId: string;
  /** False while the right panel is collapsed but the panel stays mounted. */
  readonly visible: boolean;
  /** Draft that comments and attached context land in. */
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  /** Changes when a turn finishes mutating the workspace, so file views can refresh. */
  readonly workspaceMutationId: string | null;
  /**
   * Sends an annotation as its own message from this host's thread. A call that
   * arrives after the host left the thread it started in (even if it has since
   * returned) is dropped; the annotation stays attached to its own thread's draft.
   */
  readonly sendAnnotation: (
    annotation: PreviewAnnotationPayload,
    image: ComposerImageAttachment | null,
  ) => void;
}

export const PanelHostContext = createContext<PanelHost | null>(null);

export function usePanelHost(): PanelHost {
  const host = use(PanelHostContext);
  if (!host) throw new Error("usePanelHost must be used inside a panel host");
  return host;
}

type ComposerSend = (
  event: undefined,
  dispatchMode: "auto",
  submissionIntent: "foreground",
  directAnnotation: {
    annotation: PreviewAnnotationPayload;
    image: ComposerImageAttachment | null;
  },
) => unknown;

/**
 * Builds the host's `sendAnnotation` for the thread keyed by `threadKey`.
 * `send` is the composer's latest send for that thread. The callback stays
 * stable within one visit to that thread and is retired when the host leaves
 * it, so a pick that settles after navigation can never send through another
 * thread's composer (including a colliding thread id in another environment),
 * nor through the same thread after leaving and returning to it.
 */
export function useScopedAnnotationSender(
  threadKey: string | null,
  send: ComposerSend,
): PanelHost["sendAnnotation"] {
  const isVisitCurrent = useScopeLifetime(threadKey ?? "");
  const sendRef = useRef(send);
  // Updated on commit, so a discarded render never redirects a pending send.
  useLayoutEffect(() => {
    sendRef.current = send;
  });
  return useCallback(
    (annotation, image) => {
      if (threadKey === null || !isVisitCurrent()) return;
      void sendRef.current(undefined, "auto", "foreground", { annotation, image });
    },
    [threadKey, isVisitCurrent],
  );
}
