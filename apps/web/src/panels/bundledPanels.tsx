import { FileDiff, Globe2 } from "lucide-react";
import { Suspense, type ComponentType } from "react";

import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { isPreviewSupportedInRuntime } from "~/previewStateStore";

import { PanelErrorBoundary } from "./PanelErrorBoundary";
import { usePanelHost } from "./panelHost";
import { createPanelRegistry, type PanelMetadata, type PanelProps } from "./panelRegistry";

const bundledPanels = createPanelRegistry([
  {
    id: "diff",
    title: "Diff",
    icon: FileDiff,
    placement: "side-panel",
    launcherKey: "D",
    unavailableHint: "Available for Git repositories.",
    unavailableReason: "Diff is only available for server threads in Git repositories.",
    load: () => import("./diff/DiffSidePanel"),
  },
  {
    id: "preview",
    title: "Browser",
    icon: Globe2,
    placement: "side-panel",
    launcherKey: "B",
    isSupported: isPreviewSupportedInRuntime,
    unavailableHint: "Only available in the desktop app.",
    unavailableReason: "Browser previews are only available in the T3 Code desktop app.",
    load: () => import("./preview/PreviewSidePanel"),
  },
  {
    id: "pull-request",
    title: "Pull request",
    icon: PullRequestGlyph.pullRequest,
    placement: "side-panel",
    launcherKey: "P",
    unavailableHint: "No pull request on this branch yet.",
    unavailableReason: "This thread's branch has no pull request yet.",
    load: () => import("./pullRequest/PullRequestSidePanel"),
  },
  {
    id: "pull-requests",
    title: "Linked pull requests",
    icon: PullRequestGlyph.link,
    placement: "side-panel",
    launcherKey: "L",
    unavailableHint: "No linked pull requests available.",
    unavailableReason: "No linked pull requests are available for this thread.",
    load: () => import("./pullRequest/PullRequestsSidePanel"),
  },
]);

export type SidePanelId = (typeof bundledPanels.definitions)[number]["id"];

/** Metadata for launchers and tabs; reading it never loads a panel body. */
export function getSidePanelMetadata(id: SidePanelId): PanelMetadata {
  return bundledPanels.get(id);
}

type SidePanel = ReturnType<typeof bundledPanels.get>;
type SidePanelPropKey = SidePanel extends infer Panel
  ? Panel extends SidePanel
    ? keyof PanelProps<Panel>
    : never
  : never;

/**
 * One member per registered id. Other panels' prop keys are forbidden on each
 * member, so a widened id cannot carry props the selected panel does not take.
 */
export type RegisteredSidePanelProps = SidePanel extends infer Panel
  ? Panel extends SidePanel
    ? { id: Panel["id"] } & PanelProps<Panel> & {
          [Key in Exclude<SidePanelPropKey, keyof PanelProps<Panel>>]?: never;
        }
    : never
  : never;

export function RegisteredSidePanel({ id, ...props }: RegisteredSidePanelProps) {
  const { threadRef, surfaceId } = usePanelHost();
  const panel = bundledPanels.get(id);
  // The union caller already paired id with its props; destructuring loses that correlation.
  const Component = panel.Component as ComponentType<typeof props>;
  return (
    <PanelErrorBoundary
      resourceKey={`${threadRef.environmentId}:${threadRef.threadId}:${id}:${surfaceId}`}
      title={panel.title}
    >
      <Suspense fallback={null}>
        <Component {...props} />
      </Suspense>
    </PanelErrorBoundary>
  );
}
