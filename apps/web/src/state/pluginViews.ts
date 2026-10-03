import {
  createPluginViewEnvironmentAtoms,
  type PluginViewsView,
} from "@t3tools/client-runtime/state/pluginViews";
import type { EnvironmentId, PluginView } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";

export const pluginViewEnvironment = createPluginViewEnvironmentAtoms(connectionAtomRuntime);

/**
 * One environment's plugin views, or null before its first answer. A server
 * without the `pluginViews` capability answers `unsupported` without a request.
 */
export function usePluginViews(environmentId: EnvironmentId | null): PluginViewsView | null {
  return useEnvironmentQuery(
    environmentId === null ? null : pluginViewEnvironment.views({ environmentId, input: {} }),
  ).data;
}

const NO_VIEWS: ReadonlyArray<PluginView> = [];

/** The views this client can place in the right panel; other placements are skipped. */
export function sidePanelPluginViews(views: PluginViewsView | null): ReadonlyArray<PluginView> {
  if (views?._tag !== "available") return NO_VIEWS;
  const placed = views.views.filter((view) => view.placement === "side-panel");
  return placed.length === views.views.length ? views.views : placed;
}
