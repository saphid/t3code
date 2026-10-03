import { FileDiff, Files, Globe2, Puzzle, Smartphone, TerminalSquare } from "lucide-react";
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
    id: "terminal",
    title: "Terminal",
    icon: TerminalSquare,
    placement: "side-panel",
    launcherKey: "T",
    unavailableHint: "Available when a project is open.",
    unavailableReason: "Terminal surfaces are only available from a project thread.",
    load: () => import("./terminal/TerminalSidePanel"),
  },
  {
    id: "device",
    title: "Device",
    icon: Smartphone,
    placement: "side-panel",
    launcherKey: "M",
    unavailableHint: "Available from a thread.",
    unavailableReason: "Devices are only available from a thread.",
    load: () => import("./device/DeviceSidePanel"),
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
  {
    id: "files",
    title: "Files",
    icon: Files,
    placement: "side-panel",
    launcherKey: "F",
    unavailableHint: "Available when a project is open.",
    unavailableReason: "Files are only available when a project is open.",
    load: () => import("./files/FilesSidePanel"),
  },
  {
    // One definition hosts every plugin view. Its launcher rows and tab titles come from the
    // environment's views snapshot, so it has no letter of its own.
    id: "plugin-view",
    title: "Plugin view",
    icon: Puzzle,
    placement: "side-panel",
    launcherKey: "",
    unavailableHint: "Available when an enabled plugin offers a view.",
    unavailableReason: "Plugin views appear when an enabled plugin in this environment offers one.",
    load: () => import("./pluginView/PluginViewSidePanel"),
  },
]);

export type SidePanelId = (typeof bundledPanels.definitions)[number]["id"];

/** Panels the launcher lists by their own definition; plugin views are listed per view. */
export type LauncherSidePanelId = Exclude<SidePanelId, "plugin-view">;

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
