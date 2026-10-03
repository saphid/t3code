/**
 * Where a plugin-view surface stands, shared by the web/desktop and mobile
 * hosts. A host mounts a view only under `mount`, and a new key is a new
 * mount: the old one is torn down first.
 */
import type { PluginView } from "@t3tools/contracts";

import type { PluginViewsView } from "../state/pluginViews.ts";

export type PluginViewTarget =
  /** No session or no snapshot yet. */
  | { readonly _tag: "waiting" }
  /** The environment's server cannot serve views. */
  | { readonly _tag: "unsupported" }
  /** Not offered now: disabled, removed, changed on disk, still loading, or invalid (`problem`). */
  | { readonly _tag: "unavailable"; readonly problem: string | null }
  | { readonly _tag: "mount"; readonly view: PluginView; readonly key: string };

/**
 * Where a plugin-view surface stands in the current session's snapshot. The
 * caller passes only a snapshot that session produced. The mount key
 * changes with the session and the generation, so a reconnect, re-enable or
 * restart ends the old mount before the new one starts.
 */
export function resolvePluginViewTarget(input: {
  /** The snapshot from `session`, or null before it has sent one. */
  readonly views: PluginViewsView | null;
  readonly surface: { readonly installationId: string; readonly viewId: string };
  /** Identifies the environment's current session; null while it has none. */
  readonly session: number | null;
}): PluginViewTarget {
  const { views, surface, session } = input;
  if (session === null || views === null) return { _tag: "waiting" };
  if (views._tag === "unsupported") return { _tag: "unsupported" };
  const view = views.views.find(
    (candidate) =>
      candidate.installationId === surface.installationId &&
      candidate.viewId === surface.viewId &&
      candidate.placement === "side-panel",
  );
  if (view === undefined)
    return {
      _tag: "unavailable",
      problem:
        views.problems.find((problem) => problem.installationId === surface.installationId)
          ?.message ?? null,
    };
  return {
    _tag: "mount",
    view,
    key: `${session}:${view.installationId}:${view.generation}:${view.viewId}`,
  };
}

const sessionEpochs = new WeakMap<object, number>();
let lastSessionEpoch = 0;

/** A number per session object, for mount keys; null while there is no session. */
export function sessionEpoch(session: object | null): number | null {
  if (session === null) return null;
  let epoch = sessionEpochs.get(session);
  if (epoch === undefined) {
    lastSessionEpoch += 1;
    epoch = lastSessionEpoch;
    sessionEpochs.set(session, epoch);
  }
  return epoch;
}
