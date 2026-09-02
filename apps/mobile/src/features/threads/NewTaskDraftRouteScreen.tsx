import type { StaticScreenProps } from "@react-navigation/native";
import { useMemo } from "react";
import { NativeStackScreenOptions } from "../../native/StackHeader";

import { NewTaskDraftScreen } from "./NewTaskDraftScreen";

type NewTaskDraftRouteParams = {
  readonly environmentId?: string | string[];
  readonly projectId?: string | string[];
  readonly title?: string | string[];
  readonly pendingTaskId?: string | string[];
  readonly incomingShareId?: string | string[];
  readonly initialPrompt?: string | string[];
  readonly branch?: string | string[] | null;
  readonly worktreePath?: string | string[] | null;
};

export function NewTaskDraftRouteScreen({ route }: StaticScreenProps<NewTaskDraftRouteParams>) {
  const params = route.params ?? {};

  // Keyed on the params object so a fresh navigation to this (already
  // mounted) screen produces a new reference, letting the draft screen
  // re-apply the requested project.
  const initialProjectRef = useMemo(
    () => ({
      environmentId: Array.isArray(params.environmentId)
        ? params.environmentId[0]
        : params.environmentId,
      projectId: Array.isArray(params.projectId) ? params.projectId[0] : params.projectId,
    }),
    [route.params],
  );

  return (
    <>
      <NativeStackScreenOptions
        options={{
          title: Array.isArray(params.title) ? params.title[0] : (params.title ?? "New task"),
        }}
      />
      <NewTaskDraftScreen
        initialProjectRef={initialProjectRef}
        incomingShareId={
          Array.isArray(params.incomingShareId) ? params.incomingShareId[0] : params.incomingShareId
        }
        pendingTaskId={
          Array.isArray(params.pendingTaskId) ? params.pendingTaskId[0] : params.pendingTaskId
        }
        initialPrompt={
          Array.isArray(params.initialPrompt) ? params.initialPrompt[0] : params.initialPrompt
        }
        initialWorkspaceRef={
          params.branch !== undefined || params.worktreePath !== undefined
            ? {
                branch: Array.isArray(params.branch)
                  ? (params.branch[0] ?? null)
                  : (params.branch ?? null),
                worktreePath: Array.isArray(params.worktreePath)
                  ? (params.worktreePath[0] ?? null)
                  : (params.worktreePath ?? null),
              }
            : undefined
        }
      />
    </>
  );
}
