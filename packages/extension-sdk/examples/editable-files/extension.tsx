import {
  textEditsApi,
  type ReadSnapshotResult,
  type SaveResult,
} from "@t3tools/extension-sdk/catalogue";
import { defineExtension, requireApi } from "@t3tools/extension-sdk/authoring";
import { bindApi } from "@t3tools/extension-sdk/capabilities";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useEffect, useRef, useState } from "react";

const manifestId = "example.editable-files";

type Draft = {
  readonly relativePath: string;
  readonly contents: string;
  readonly revision: string;
};

/**
 * Draft state lives in the component, never in the host: a conflict keeps the
 * unsent contents on screen so the user can decide what wins.
 */
function EditorView(props: { host: ClientHost; session: ViewSession }) {
  const { host, session } = props;
  const [pathInput, setPathInput] = useState("README.md");
  const [snapshot, setSnapshot] = useState<ReadSnapshotResult | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [status, setStatus] = useState("Enter a workspace-relative path and open it.");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  useEffect(
    () =>
      session.onVisibility((visible) => {
        if (!visible) return;
        generation.current += 1;
      }),
    [session],
  );

  const openPath = (relativePath: string) => {
    const id = ++generation.current;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    setBusy(true);
    setSnapshot(null);
    setDraft(null);
    setStatus("Reading " + relativePath + "…");
    void bindApi(textEditsApi, host, session.context)
      .invoke("readSnapshot", { relativePath }, signal)
      .then(
        (value) => {
          if (signal.aborted || id !== generation.current) return;
          setSnapshot(value);
          setStatus(
            value.kind === "editable"
              ? "Opened " + relativePath + " (revision " + value.revision.slice(0, 8) + "…)"
              : "Not editable: " + value.reason,
          );
          if (value.kind === "editable") setDraft(value.contents);
        },
        (cause) => {
          if (!signal.aborted && id === generation.current)
            setStatus(cause instanceof Error ? cause.message : "Read failed");
        },
      )
      .finally(() => {
        if (id === generation.current) setBusy(false);
      });
  };

  const save = () => {
    const current = snapshot;
    if (current?.kind !== "editable" || draft === null) return;
    const id = ++generation.current;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    setBusy(true);
    setStatus("Saving " + current.relativePath + "…");
    void bindApi(textEditsApi, host, session.context)
      .invoke(
        "save",
        {
          relativePath: current.relativePath,
          expectedRevision: current.revision,
          contents: draft,
        },
        signal,
      )
      .then(
        (value: SaveResult) => {
          if (signal.aborted || id !== generation.current) return;
          if (value.kind === "saved") {
            // Advance the local baseline so the next save diffs against the
            // bytes now on disk.
            setSnapshot({
              kind: "editable",
              relativePath: value.relativePath,
              contents: draft,
              revision: value.revision,
            });
            setStatus("Saved (revision " + value.revision.slice(0, 8) + "…)");
          } else {
            // Conflict: the draft stays on screen; reread to pick up whoever
            // else wrote the file.
            setStatus(
              "Conflict: " +
                current.relativePath +
                " changed on disk. Your draft is retained — refresh to compare.",
            );
          }
        },
        (cause) => {
          if (signal.aborted || id !== generation.current) return;
          // A rejection after dispatch leaves the outcome genuinely unknown:
          // the bytes may or may not have landed. The draft is kept and a
          // manual reread is the only way to re-sync — no optimistic "saved".
          setStatus(
            "Save outcome unknown (" +
              (cause instanceof Error ? cause.message : "rejected") +
              "). Draft retained — refresh to check what is on disk.",
          );
        },
      )
      .finally(() => {
        if (id === generation.current) setBusy(false);
      });
  };

  const refresh = () => {
    if (snapshot) openPath(snapshot.relativePath);
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%" }}>
      <header style={{ display: "flex", gap: 4 }}>
        <input
          aria-label="Workspace-relative path"
          placeholder="docs/notes.md"
          value={pathInput}
          onChange={(event) => setPathInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") openPath(pathInput.trim());
          }}
        />
        <button
          type="button"
          disabled={busy || pathInput.trim() === ""}
          onClick={() => openPath(pathInput.trim())}
        >
          Open
        </button>
        <button type="button" disabled={busy || !snapshot} onClick={refresh}>
          Refresh
        </button>
      </header>
      {snapshot?.kind === "editable" ? (
        <textarea
          aria-label="File contents"
          style={{ flex: 1, minHeight: 0, fontFamily: "monospace" }}
          value={draft ?? ""}
          onChange={(event) => setDraft(event.target.value)}
        />
      ) : (
        <pre aria-label="File status" style={{ flex: 1, minHeight: 0 }}>
          {snapshot ? "Not editable: " + snapshot.reason : status}
        </pre>
      )}
      <footer style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <button
          type="button"
          disabled={
            busy || snapshot?.kind !== "editable" || draft === null || draft === snapshot.contents
          }
          onClick={save}
        >
          Save
        </button>
        <output aria-label="Editor status">{status}</output>
      </footer>
    </section>
  );
}

export default defineExtension({
  id: manifestId,
  version: "1.0.0",
  provides: [],
  serverEntry: undefined,
  requires: [requireApi(textEditsApi)],
  surfaces: [
    {
      name: "view",
      title: "Editable files",
      scope: "project",
      placements: ["side-panel"],
      clients: ["web", "desktop"],
      capabilities: [],
      stateVersion: 1,
      createView(host, session) {
        return { renderer: () => <EditorView host={host} session={session} /> };
      },
    },
  ],
});
