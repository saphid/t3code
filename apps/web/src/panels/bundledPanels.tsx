import type { ComponentType } from "react";

import { createPanelRegistry, type PanelProps } from "./panelRegistry";

const bundledPanels = createPanelRegistry([
  {
    id: "diff",
    title: "Diff",
    placement: "side-panel",
    load: () => import("./diff/DiffSidePanel"),
  },
  {
    id: "preview",
    title: "Browser",
    placement: "side-panel",
    load: () => import("./preview/PreviewSidePanel"),
  },
]);

type SidePanel = NonNullable<ReturnType<typeof bundledPanels.get>>;

/** One member per registered id, so a widened id cannot be paired with another panel's props. */
export type RegisteredSidePanelProps = SidePanel extends infer Panel
  ? Panel extends SidePanel
    ? { id: Panel["id"] } & PanelProps<Panel>
    : never
  : never;

export function RegisteredSidePanel({ id, ...props }: RegisteredSidePanelProps) {
  const panel = bundledPanels.get(id);
  if (!panel) throw new Error(`Unknown panel id: ${id}`);
  // The union caller already paired id with its props; destructuring loses that correlation.
  const Component = panel.Component as ComponentType<typeof props>;
  return <Component {...props} />;
}
