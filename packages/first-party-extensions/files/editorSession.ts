/**
 * Editor session for one workspace path (F1 #2/#3/#4). A package-owned
 * FileEditCoordinator drives debounced autosave through the revisioned
 * `t3.workspace/text-edits@1.1.0` contract: the textarea renders the buffered
 * contents optimistically, saves compare-and-swap on the confirmed base
 * revision, conflicts halt autosave until the user resolves them, and the
 * session flushes pending edits when the file changes or the view unmounts —
 * the native panel's unmount-dispose semantics.
 */

import { textEditsApi } from "@t3tools/extension-sdk/catalogue";
import { bindApi } from "@t3tools/extension-sdk/capabilities";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useEffect, useRef, useState } from "react";

import { FILE_SAVE_DEBOUNCE_MS, FileEditCoordinator } from "./saveCoordinator.ts";
import type { EditorSaveState } from "./saveCoordinator.ts";
import { describeSnapshot } from "./viewModel.ts";
import type { EditorOpen, PreviewKind } from "./viewModel.ts";

export interface EditorSurface {
  readonly path: string;
  readonly open: EditorOpen;
  readonly contents: string;
  readonly saveState: EditorSaveState;
}

export function useFileEditor(
  host: ClientHost,
  session: ViewSession,
  selected: string | null,
  selectedKind: PreviewKind,
  refreshRevision: number,
  visible: boolean,
) {
  const [surface, setSurface] = useState<EditorSurface | null>(null);
  const activeRef = useRef<{ path: string; coordinator: FileEditCoordinator } | null>(null);
  const lastRefreshRef = useRef(-1);
  const editing = selected !== null && selectedKind === "text" && visible;

  useEffect(() => {
    const active = activeRef.current;
    if (!editing || selected === null) {
      if (active) {
        active.coordinator.dispose();
        activeRef.current = null;
      }
      // A stale surface is filtered at render (`surface.path === selected`), so
      // nothing to clear synchronously here.
      return;
    }

    const path = selected;
    // This effect's controller bounds only the refresh-read lifetime: each
    // rerun aborts it so a superseded readSnapshot cannot overwrite newer
    // state. The coordinator's persist deliberately uses `session.signal`
    // instead — the session outlives refresh cycles, and a coordinator
    // retained across one must still be able to save (and flush on dispose).
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    let current = activeRef.current;
    const pathChanged = !current || current.path !== path;
    // Re-read the snapshot on open and on every tree refresh; identical
    // revisions skip the network round-trip.
    if (!pathChanged && refreshRevision === lastRefreshRef.current) {
      return () => controller.abort();
    }
    lastRefreshRef.current = refreshRevision;
    if (pathChanged) {
      current?.coordinator.dispose();
      const coordinator = new FileEditCoordinator({
        debounceMs: FILE_SAVE_DEBOUNCE_MS,
        persist: async (contents, expectedRevision) => {
          try {
            return await bindApi(textEditsApi, host, session.context).invoke(
              "save",
              { relativePath: path, expectedRevision, contents },
              session.signal,
            );
          } catch (error) {
            return {
              kind: "error",
              message: error instanceof Error ? error.message : "Save failed",
            };
          }
        },
        onStateChange: (saveState) =>
          setSurface((previous) =>
            previous && previous.path === path ? { ...previous, saveState } : previous,
          ),
      });
      current = { path, coordinator };
      activeRef.current = current;
    }
    const coordinator = current!.coordinator;

    void (async () => {
      try {
        const snapshot = await bindApi(textEditsApi, host, session.context).invoke(
          "readSnapshot",
          { relativePath: path },
          signal,
        );
        if (signal.aborted) return;
        const open = describeSnapshot(snapshot);
        if (!open.editable) {
          setSurface({ path, open, contents: "", saveState: coordinator.state() });
          return;
        }
        const kind = coordinator.state().kind;
        if (kind === "dirty" || kind === "saving" || kind === "error") {
          // Refresh reconciliation: the remote file moved under pending edits —
          // latch the conflict rather than clobbering the user's buffer.
          coordinator.noteRemoteRevision(open.revision);
          setSurface((previous) => ({
            path,
            open,
            contents: previous?.path === path ? previous.contents : coordinator.contents(),
            saveState: coordinator.state(),
          }));
        } else {
          coordinator.seed(open.revision, open.contents);
          setSurface({
            path,
            open,
            contents: open.contents,
            saveState: coordinator.state(),
          });
        }
      } catch (error) {
        if (!signal.aborted)
          setSurface((previous) => ({
            path,
            open: {
              editable: false,
              reason: "io-error",
              message: error instanceof Error ? error.message : "File could not be read",
            },
            contents: previous?.path === path ? previous.contents : "",
            saveState: coordinator.state(),
          }));
      }
    })();
    return () => controller.abort();
  }, [host, session, selected, editing, refreshRevision]);

  // Unmount flush: pending edits persist, exactly like the native panel's
  // coordinator disposal.
  useEffect(
    () => () => {
      activeRef.current?.coordinator.dispose();
      activeRef.current = null;
    },
    [],
  );

  const change = (contents: string) => {
    const active = activeRef.current;
    if (!active || active.path !== selected) return;
    active.coordinator.change(contents);
    setSurface((previous) =>
      previous && previous.path === selected ? { ...previous, contents } : previous,
    );
  };

  /** Reload: discard local edits and adopt the remote snapshot. */
  const reload = () => {
    const active = activeRef.current;
    if (!active || active.path !== selected) return;
    const coordinator = active.coordinator;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(textEditsApi, host, session.context)
      .invoke("readSnapshot", { relativePath: active.path }, signal)
      .then((snapshot) => {
        if (signal.aborted) return;
        const open = describeSnapshot(snapshot);
        if (open.editable) {
          coordinator.adoptRemote(open.contents, open.revision);
          setSurface({
            path: active.path,
            open,
            contents: open.contents,
            saveState: coordinator.state(),
          });
        } else {
          setSurface((previous) =>
            previous && previous.path === active.path
              ? { ...previous, open, saveState: coordinator.state() }
              : previous,
          );
        }
      })
      .finally(() => controller.abort());
  };

  /** Keep mine: deliberately write the buffer over the fresh remote revision. */
  const keepMine = () => {
    const active = activeRef.current;
    if (!active || active.path !== selected) return;
    const coordinator = active.coordinator;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(textEditsApi, host, session.context)
      .invoke("readSnapshot", { relativePath: active.path }, signal)
      .then((snapshot) => {
        if (signal.aborted) return;
        const open = describeSnapshot(snapshot);
        if (open.editable) coordinator.forcePersist(open.revision);
        else
          setSurface((previous) =>
            previous && previous.path === active.path
              ? { ...previous, open, saveState: coordinator.state() }
              : previous,
          );
      })
      .finally(() => controller.abort());
  };

  const retry = () => activeRef.current?.coordinator.retry();

  return { surface, change, reload, keepMine, retry };
}
