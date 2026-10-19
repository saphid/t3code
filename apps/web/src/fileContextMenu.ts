/**
 * Right-click actions for a workspace file: reveal it in the platform file
 * manager (server-side, so it works for every client and connection mode) and
 * open it in an editor (exec on the environment host, or a remote deep link
 * when this client is not on the environment's machine).
 */
import {
  buildRemoteOpenUrl,
  EDITORS,
  REMOTE_CAPABLE_EDITOR_IDS,
  type ContextMenuItem,
  type EditorId,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import { resolveDiffPathForWorkspace } from "./diffFileActions";
import { readLocalApi } from "./localApi";
import { isMacPlatform, isWindowsPlatform } from "./lib/utils";
import { openRemoteEditorUrl, useRemoteCapableEditors, useRemoteOpenState } from "./remoteOpen";
import { shellEnvironment } from "./state/shell";
import { useAtomCommand } from "./state/use-atom-command";
import { resolvePathLinkTarget } from "./terminal-links";
import { toastManager } from "./components/ui/toast";

export type FileContextMenuAction =
  | "reveal-in-folder"
  | "open"
  /** Submenu parent; never the activated id. */
  | "open-with"
  | `editor:${EditorId}`;

export interface FileContextMenuTarget {
  readonly environmentId: EnvironmentId | null;
  /** Repo- or workspace-relative file path, as shown in diffs. */
  readonly filePath: string;
  readonly workspaceRoot: string | undefined;
  readonly repositoryRoot?: string | undefined;
}

export function fileManagerMenuLabel(platform: string = navigator.platform): string {
  if (isMacPlatform(platform)) return "Finder";
  if (isWindowsPlatform(platform)) return "Explorer";
  return "file manager";
}

/** Absolute path on the environment host, or null when it cannot be resolved. */
export function resolveFileContextMenuAbsolutePath(target: FileContextMenuTarget): string | null {
  const workspaceFilePath = resolveDiffPathForWorkspace({
    filePath: target.filePath,
    workspaceRoot: target.workspaceRoot,
    repositoryRoot: target.repositoryRoot,
  });
  if (workspaceFilePath === null) return null;
  if (target.workspaceRoot === undefined) {
    return workspaceFilePath.startsWith("/") || /^[a-zA-Z]:/.test(workspaceFilePath)
      ? workspaceFilePath
      : null;
  }
  return resolvePathLinkTarget(workspaceFilePath, target.workspaceRoot);
}

const EDITOR_LABEL_BY_ID = new Map(EDITORS.map((editor) => [editor.id, editor.label]));

export function buildFileContextMenuItems(input: {
  readonly hasAbsolutePath: boolean;
  readonly canOpenDefault: boolean;
  readonly editorIds: ReadonlyArray<EditorId>;
  readonly platform?: string;
}): readonly ContextMenuItem<FileContextMenuAction>[] {
  // Without a resolvable absolute path nothing here can act on the file.
  if (!input.hasAbsolutePath) return [];
  const editorIds = input.editorIds.filter((id) => id !== "file-manager");
  const items: ContextMenuItem<FileContextMenuAction>[] = [];
  if (input.canOpenDefault) {
    items.push({ id: "open", label: "Open", icon: "pencil" });
  }
  items.push({
    id: "reveal-in-folder",
    label: `Show in ${fileManagerMenuLabel(input.platform)}`,
    icon: "folder-tree",
  });
  if (editorIds.length > 0) {
    items.push({
      id: "open-with",
      label: "Open with",
      children: editorIds.map((editorId) => ({
        id: `editor:${editorId}` as FileContextMenuAction,
        label: EDITOR_LABEL_BY_ID.get(editorId) ?? editorId,
      })),
    });
  }
  return items;
}

/**
 * Context-menu actions for files. The environment id is fixed per component
 * (a thread's environment, a file browser's environment), so editors and
 * remote-open mode resolve once per hook call.
 */
export function useFileContextMenu(environmentId: EnvironmentId | null) {
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const revealPath = useAtomCommand(shellEnvironment.revealPath, { reportFailure: false });
  const remote = useRemoteOpenState(environmentId);
  const remoteCapableEditors = useRemoteCapableEditors();

  return useMemo(() => {
    const buildItems = (
      target: FileContextMenuTarget,
      availableEditors: ReadonlyArray<EditorId>,
    ): readonly ContextMenuItem<FileContextMenuAction>[] => {
      // Remote links are restricted to editors with remote deep-link support,
      // probed on the viewing machine by the desktop app.
      const editorIds =
        remote.mode === "remote-unavailable"
          ? []
          : remote.mode === "remote-links"
            ? remoteCapableEditors.filter((id) => REMOTE_CAPABLE_EDITOR_IDS.includes(id))
            : availableEditors;
      return buildFileContextMenuItems({
        hasAbsolutePath: resolveFileContextMenuAbsolutePath(target) !== null,
        canOpenDefault:
          remote.mode === "local-exec" &&
          environmentId !== null &&
          availableEditors.includes("file-manager"),
        editorIds: editorIds.filter((id) => id !== "file-manager"),
      });
    };

    const activate = async (
      action: FileContextMenuAction,
      target: FileContextMenuTarget,
    ): Promise<void> => {
      const absolutePath = resolveFileContextMenuAbsolutePath(target);
      if (absolutePath === null || environmentId === null) return;

      if (action === "reveal-in-folder") {
        const result = await revealPath({ environmentId, input: { path: absolutePath } });
        if (result._tag === "Failure") {
          toastManager.add({
            type: "error",
            title: `Could not show in ${fileManagerMenuLabel()}`,
            description: absolutePath,
          });
        }
        return;
      }

      if (action === "open") {
        if (remote.mode !== "local-exec") return;
        const result = await openInEditor({
          environmentId,
          input: { cwd: absolutePath, editor: "file-manager" },
        });
        if (result._tag === "Failure") {
          toastManager.add({
            type: "error",
            title: "Could not open file",
            description: absolutePath,
          });
        }
        return;
      }

      const editor = action.slice("editor:".length) as EditorId;
      if (remote.mode === "remote-links") {
        const url = buildRemoteOpenUrl({
          editor,
          host: remote.host.host,
          absolutePath,
        });
        if (url !== undefined) await openRemoteEditorUrl(url);
        return;
      }
      if (remote.mode === "remote-unavailable") return;
      const result = await openInEditor({
        environmentId,
        input: { cwd: absolutePath, editor },
      });
      if (result._tag === "Failure") {
        toastManager.add({
          type: "error",
          title: `Could not open in ${EDITOR_LABEL_BY_ID.get(editor) ?? editor}`,
          description: absolutePath,
        });
      }
    };

    const show = async (
      target: FileContextMenuTarget,
      availableEditors: ReadonlyArray<EditorId>,
      position?: { x: number; y: number },
    ): Promise<void> => {
      const api = readLocalApi();
      const items = buildItems(target, availableEditors);
      if (items.length === 0 || api === undefined) return;
      const clicked = await api.contextMenu.show(items, position);
      if (clicked === null) return;
      await activate(clicked as FileContextMenuAction, target);
    };

    return { buildItems, activate, show };
  }, [environmentId, openInEditor, remote, remoteCapableEditors, revealPath]);
}

/** Convenience callback for onContextMenu handlers. */
export function useFileContextMenuHandler(
  environmentId: EnvironmentId | null,
  availableEditors: ReadonlyArray<EditorId>,
) {
  const contextMenu = useFileContextMenu(environmentId);
  return useCallback(
    (target: FileContextMenuTarget, event?: { clientX: number; clientY: number }) => {
      void contextMenu.show(
        target,
        availableEditors,
        event ? { x: event.clientX, y: event.clientY } : undefined,
      );
    },
    [availableEditors, contextMenu],
  );
}
