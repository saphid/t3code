import { sidePanelPluginViews } from "@t3tools/client-runtime/state/pluginViewSessions";
import type { PluginViewsView } from "@t3tools/client-runtime/state/pluginViews";
import { PLUGIN_VIEWS_CAPABILITY, type PluginView } from "@t3tools/contracts";

/**
 * Whether this platform may host plugin views. iOS has the patched WebView
 * that drops subframe messages and refuses subframe navigation. Android is
 * unsupported in v1 until the same tests pass there, so it never subscribes,
 * fetches a bundle, or mounts a view.
 */
export const pluginViewsHostedOn = (os: string) => os === "ios";

export type PluginViewEntries =
  /** Nothing to show: the plugin declares no views and the session lists none. */
  | { readonly _tag: "none" }
  /** The plugin declares views, and this platform cannot host them. */
  | { readonly _tag: "unsupported-platform" }
  /** The plugin declares views; the current session has not listed views yet. */
  | { readonly _tag: "waiting" }
  | { readonly _tag: "views"; readonly views: ReadonlyArray<PluginView> }
  /** The plugin declares views, and none is offered now; `problem` explains why when the server knows. */
  | { readonly _tag: "unavailable"; readonly problem: string | null };

/**
 * The views a plugin's screen offers to open, from the current session's
 * snapshot only (`views` is null until that session has sent one).
 */
export function pluginViewEntries(input: {
  readonly hosted: boolean;
  readonly installationId: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly views: PluginViewsView | null;
}): PluginViewEntries {
  const declared = input.capabilities.includes(PLUGIN_VIEWS_CAPABILITY);
  if (!input.hosted) return declared ? { _tag: "unsupported-platform" } : { _tag: "none" };
  if (input.views === null) return declared ? { _tag: "waiting" } : { _tag: "none" };
  if (input.views._tag === "unsupported") return { _tag: "none" };
  const views = sidePanelPluginViews(input.views).filter(
    (view) => view.installationId === input.installationId,
  );
  if (views.length > 0) return { _tag: "views", views };
  const problem =
    input.views.problems.find((candidate) => candidate.installationId === input.installationId)
      ?.message ?? null;
  return declared || problem !== null ? { _tag: "unavailable", problem } : { _tag: "none" };
}
