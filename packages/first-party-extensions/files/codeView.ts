/**
 * Files row 18, read-only half: files the editor cannot open (past the edit
 * bound, binary-adjacent, non-UTF-8) render through the host's
 * `ClientHost.codeView.File` — the native read-only source preview with
 * shared-pool highlighting and virtualization — when the host offers it.
 * Hosts without the member keep the panel's own `<pre>`. Editable files use
 * the native host editor on compatible clients and remain read-only otherwise.
 */
import {
  resolveCodeView,
  resolveCodeEditor,
  type ClientHost,
  type CodeViewFileProps,
  type CodeViewEditorProps,
} from "@t3tools/extension-sdk/environment";
import { uiEditorApi } from "@t3tools/extension-sdk/catalogue";
import { bindApi } from "@t3tools/extension-sdk/capabilities";
import { satisfiesSemverRange } from "@t3tools/shared/semver";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { createElement, useEffect, useState, type ReactNode } from "react";

/** The read-only file body: the host's view when offered, else the panel's own. */
export function ReadOnlyFileBody(props: {
  readonly host: Pick<ClientHost, "codeView">;
  readonly path: string;
  readonly contents: string;
  /** Null when `t3.ui/preferences` is unavailable: the host's own setting applies. */
  readonly wordWrap: boolean | null;
  readonly reveal: { readonly line: number; readonly requestId: number } | null;
  readonly renderFallback: () => ReactNode;
}): ReactNode {
  const codeView = resolveCodeView(props.host);
  if (codeView === null) return props.renderFallback();
  const file: CodeViewFileProps = {
    path: props.path,
    contents: props.contents,
    ...(props.wordWrap === null ? {} : { wordWrap: props.wordWrap }),
    ...(props.reveal === null ? {} : { reveal: props.reveal }),
  };
  // Same frame as the own `<pre>`: a top rule, filling the panel's column.
  return createElement(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        borderTop: "1px solid var(--t3-files-border, var(--border, #dfe3e8))",
      },
    },
    createElement(codeView.File, file),
  );
}

export function EditableFileBody(
  props: Omit<CodeViewEditorProps, "wordWrap" | "reveal"> & {
    readonly host: ClientHost;
    readonly session: ViewSession;
    readonly wordWrap: boolean | null;
    readonly reveal: NonNullable<CodeViewFileProps["reveal"]> | null;
    readonly renderFallback: () => ReactNode;
  },
): ReactNode {
  const Editor = resolveCodeEditor(props.host);
  const [enabledFor, setEnabledFor] = useState<{ host: ClientHost; session: ViewSession } | null>(
    null,
  );
  useEffect(() => {
    if (Editor === null) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, props.session.signal]);
    void props.host
      .discoverApis(props.session.context, signal)
      .then(async (apis) => {
        const supported = apis.some(
          (api) =>
            api.id === uiEditorApi.definition.id && satisfiesSemverRange(api.version, "^1.1.0"),
        );
        if (!supported || signal.aborted) return;
        const capability = await bindApi(
          uiEditorApi,
          props.host,
          props.session.context,
          "^1.1.0",
        ).invoke("getCodeViewCapabilities", {}, signal);
        if (!signal.aborted && capability.editable)
          setEnabledFor({ host: props.host, session: props.session });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [props.host, props.session, Editor]);
  if (Editor === null || enabledFor?.host !== props.host || enabledFor.session !== props.session) {
    return createElement(
      "div",
      { style: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 } },
      createElement(
        "div",
        { role: "status", style: { padding: "6px 10px", fontSize: 12 } },
        "Native code editor unavailable on this client — read only",
      ),
      createElement(ReadOnlyFileBody, props),
    );
  }
  return createElement(Editor, {
    documentId: props.documentId,
    path: props.path,
    contents: props.contents,
    onChange: props.onChange,
    onSave: props.onSave,
    ...(props.onSelectionChange === undefined
      ? {}
      : { onSelectionChange: props.onSelectionChange }),
    ...(props.wordWrap === null ? {} : { wordWrap: props.wordWrap }),
    ...(props.reveal === null ? {} : { reveal: props.reveal }),
  });
}
