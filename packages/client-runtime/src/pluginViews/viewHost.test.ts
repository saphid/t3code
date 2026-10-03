import { describe, expect, it } from "@effect/vitest";
import { PluginInstallationId, type PluginView, type PluginViewProblem } from "@t3tools/contracts";

import type { PluginViewsView } from "../state/pluginViews.ts";
import { resolvePluginViewTarget, sessionEpoch } from "./viewHost.ts";

const board: PluginView = {
  installationId: PluginInstallationId.make("installation-1"),
  generation: 1,
  pluginId: "test.views-board",
  pluginName: "Board",
  viewId: "board",
  title: "Board",
  placement: "side-panel",
};
const surface = { installationId: "installation-1", viewId: "board" };
const available = (
  views: ReadonlyArray<PluginView>,
  problems: ReadonlyArray<PluginViewProblem> = [],
): PluginViewsView => ({ _tag: "available", views, problems });

describe("resolvePluginViewTarget", () => {
  it("waits for a session and a snapshot, and says when the server cannot serve views", () => {
    expect(resolvePluginViewTarget({ views: null, surface, session: 1 })._tag).toBe("waiting");
    expect(
      resolvePluginViewTarget({ views: available([board]), surface, session: null })._tag,
    ).toBe("waiting");
    expect(
      resolvePluginViewTarget({ views: { _tag: "unsupported" }, surface, session: 1 })._tag,
    ).toBe("unsupported");
  });

  it("unmounts a view as soon as it leaves the snapshot, with the plugin's problem if any", () => {
    const mounted = resolvePluginViewTarget({ views: available([board]), surface, session: 1 });
    expect(mounted).toMatchObject({ _tag: "mount", view: board });
    // Disable, remove or a byte change: the next snapshot no longer lists the view.
    expect(resolvePluginViewTarget({ views: available([]), surface, session: 1 })).toEqual({
      _tag: "unavailable",
      problem: null,
    });
    expect(
      resolvePluginViewTarget({
        views: available(
          [],
          [
            {
              installationId: board.installationId,
              generation: 2,
              message: "board.js is missing.",
            },
          ],
        ),
        surface,
        session: 1,
      }),
    ).toEqual({ _tag: "unavailable", problem: "board.js is missing." });
  });

  it("starts a new mount for a new generation or a new session, never reusing the old one", () => {
    const key = (view: PluginView, session: number) => {
      const target = resolvePluginViewTarget({ views: available([view]), surface, session });
      return target._tag === "mount" ? target.key : null;
    };
    const first = key(board, 1);
    expect(first).not.toBeNull();
    expect(key(board, 1)).toBe(first);
    expect(key({ ...board, generation: 2 }, 1)).not.toBe(first);
    expect(key(board, 2)).not.toBe(first);
  });

  it("only mounts placements this host implements, and only the surface's own view", () => {
    for (const other of [
      { ...board, placement: "bottom-dock" },
      { ...board, viewId: "list" },
      { ...board, installationId: PluginInstallationId.make("installation-2") },
    ])
      expect(resolvePluginViewTarget({ views: available([other]), surface, session: 1 })._tag).toBe(
        "unavailable",
      );
  });

  it("numbers sessions by identity", () => {
    const a = {};
    const b = {};
    expect(sessionEpoch(null)).toBeNull();
    expect(sessionEpoch(a)).toBe(sessionEpoch(a));
    expect(sessionEpoch(a)).not.toBe(sessionEpoch(b));
  });
});
