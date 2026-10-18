/**
 * Read-only transcript of another thread (usually a subagent) opened in the
 * right panel beside the active conversation. Reuses the chat timeline with
 * every mutating interaction disabled; navigation happens through the
 * Lineage rows, not here.
 */
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import { deriveThreadActivityRun } from "@t3tools/client-runtime/state/thread-execution";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { type LegendListRef } from "@legendapp/list/react";
import { useMemo, useRef } from "react";

import { useTurnDiffSummaries } from "../../hooks/useTurnDiffSummaries";
import { useClientSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { deriveTimelineEntriesFromVisibleTurnItemsWithState } from "../../session-logic";
import {
  useProject,
  useThreadProjection,
  useThreadShell,
  useThreadVisibleTurnItems,
} from "../../state/entities";
import { MessagesTimeline } from "./MessagesTimeline";

const NOOP = () => {};
const WORKING_RUN_STATUSES = new Set(["preparing", "starting", "running", "waiting"]);

export interface ThreadTranscriptPanelProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly onNavigateToThread?: ((threadId: ThreadId) => void) | undefined;
}

export function ThreadTranscriptPanel(props: ThreadTranscriptPanelProps) {
  const ref = useMemo(
    () => scopeThreadRef(props.environmentId, props.threadId),
    [props.environmentId, props.threadId],
  );
  const projection = useThreadProjection(ref)?.projection ?? null;
  const visibleTurnItems = useThreadVisibleTurnItems(ref);
  const shell = useThreadShell(ref);
  const project = useProject(
    shell?.source.projectId === undefined
      ? null
      : scopeProjectRef(props.environmentId, shell.source.projectId),
  );
  const turnDiffSummaries = useTurnDiffSummaries(projection).turnDiffSummaries;
  const latestRun = projection === null ? null : deriveThreadActivityRun(projection);
  const timelineEntries = useMemo(
    () =>
      deriveTimelineEntriesFromVisibleTurnItemsWithState({
        visibleTurnItems,
        optimisticMessages: [],
        ...(projection === null
          ? {}
          : {
              attempts: projection.attempts,
              nodes: projection.nodes,
              plans: projection.plans,
            }),
      }).entries,
    [projection, visibleTurnItems],
  );
  const listRef = useRef<LegendListRef | null>(null);
  const { resolvedTheme } = useTheme();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const workspaceRoot = shell?.source.worktreePath ?? project?.workspaceRoot;
  const isWorking = latestRun !== null && WORKING_RUN_STATUSES.has(latestRun.status);

  if (timelineEntries.length === 0 && !isWorking) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground/30">No messages yet.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MessagesTimeline
        isWorking={isWorking}
        activeTurnInProgress={false}
        listRef={listRef}
        timelineEntries={timelineEntries}
        latestRun={latestRun}
        turnDiffSummaries={turnDiffSummaries}
        routeThreadKey={scopedThreadKey(ref)}
        onOpenTurnDiff={NOOP}
        onOpenThread={(threadId) => props.onNavigateToThread?.(threadId)}
        onForkFromRun={async () => {}}
        onRollbackCheckpoint={NOOP}
        supportsConversationRollback={false}
        onRevertToTurnCount={NOOP}
        isRevertingCheckpoint={false}
        onImageExpand={NOOP}
        activeThreadEnvironmentId={props.environmentId}
        markdownCwd={workspaceRoot}
        resolvedTheme={resolvedTheme}
        timestampFormat={timestampFormat}
        workspaceRoot={workspaceRoot}
        anchorMessageId={null}
        onAnchorReady={NOOP}
        onAnchorSizeChanged={NOOP}
        contentInsetEndAdjustment={0}
        liveFollowEnabled={true}
        onIsAtEndChange={NOOP}
        onManualNavigation={NOOP}
      />
    </div>
  );
}
