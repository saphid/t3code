import { uiEditorApi, type UiCapabilities } from "@t3tools/extension-sdk/catalogue";
import { bindApi } from "@t3tools/extension-sdk/capabilities";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useEffect, useState } from "react";

type EditorState =
  | { readonly kind: "idle" }
  | { readonly kind: "opening" | "opened"; readonly path: string }
  | { readonly kind: "failed"; readonly path: string; readonly message: string };

export function useExternalEditor(host: ClientHost, session: ViewSession) {
  const [support, setSupport] = useState<{
    readonly host: ClientHost;
    readonly session: ViewSession;
    readonly signal: AbortSignal;
    readonly capabilities?: UiCapabilities;
    readonly error?: string;
  } | null>(null);
  const [outcome, setOutcome] = useState<{
    readonly host: ClientHost;
    readonly session: ViewSession;
    readonly state: EditorState;
  } | null>(null);
  const state =
    outcome?.host === host && outcome.session === session
      ? outcome.state
      : { kind: "idle" as const };
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(uiEditorApi, host, session.context, "^1.1.0")
      .invoke("getCapabilities", {}, signal)
      .then(
        (capabilities) => {
          if (!signal.aborted) setSupport({ host, session, signal, capabilities });
        },
        (error: unknown) => {
          if (!signal.aborted)
            setSupport({
              host,
              session,
              signal,
              error:
                error instanceof Error ? error.message : "Editor support could not be checked.",
            });
        },
      );
    return () => controller.abort();
  }, [host, session]);
  const blockReason =
    support?.host !== host || support.session !== session
      ? "Checking editor support with the host…"
      : (support.error ??
        (support.capabilities?.operations.openPath === true
          ? null
          : "No connected client can open an editor."));
  const openInEditor = (path: string) => {
    if (
      blockReason !== null ||
      support === null ||
      support.signal.aborted ||
      state.kind === "opening"
    )
      return;
    const signal = support.signal;
    setOutcome({ host, session, state: { kind: "opening", path } });
    void bindApi(uiEditorApi, host, session.context, "^1.1.0")
      .invoke("openPath", { path, workspace: true }, signal)
      .then(
        (receipt) => {
          if (signal.aborted) return;
          setOutcome({
            host,
            session,
            state:
              receipt.status === "opened"
                ? { kind: "opened", path }
                : { kind: "failed", path, message: receipt.message },
          });
        },
        (error: unknown) => {
          if (!signal.aborted)
            setOutcome({
              host,
              session,
              state: {
                kind: "failed",
                path,
                message: error instanceof Error ? error.message : "Unable to open file in editor.",
              },
            });
        },
      );
  };
  return { blockReason, state, openInEditor };
}
