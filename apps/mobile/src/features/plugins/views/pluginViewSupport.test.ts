import type { PluginViewsView } from "@t3tools/client-runtime/state/pluginViews";
import { PluginInstallationId, type PluginView } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pluginViewEntries, pluginViewsHostedOn } from "./pluginViewSupport";

const board: PluginView = {
  installationId: PluginInstallationId.make("installation-1"),
  generation: 1,
  pluginId: "test.views-board",
  pluginName: "Board",
  viewId: "board",
  title: "Board",
  placement: "side-panel",
};
const available = (views: ReadonlyArray<PluginView>, problem?: string): PluginViewsView => ({
  _tag: "available",
  views,
  problems:
    problem === undefined
      ? []
      : [{ installationId: board.installationId, generation: 1, message: problem }],
});
const entries = (input: {
  hosted?: boolean;
  capabilities?: ReadonlyArray<string>;
  views: PluginViewsView | null;
}) =>
  pluginViewEntries({
    hosted: input.hosted ?? true,
    installationId: board.installationId,
    capabilities: input.capabilities ?? ["views"],
    views: input.views,
  });

describe("pluginViewsHostedOn", () => {
  it("hosts views on iOS only", () => {
    expect(pluginViewsHostedOn("ios")).toBe(true);
    for (const os of ["android", "web", "macos", "windows"])
      expect(pluginViewsHostedOn(os)).toBe(false);
  });
});

describe("pluginViewEntries", () => {
  it("says Android cannot host a declared view, even when the session offers it", () => {
    expect(entries({ hosted: false, views: available([board]) })).toEqual({
      _tag: "unsupported-platform",
    });
    expect(entries({ hosted: false, capabilities: [], views: null })).toEqual({ _tag: "none" });
  });

  it("offers only the current session's side-panel views of this plugin", () => {
    expect(entries({ views: null })).toEqual({ _tag: "waiting" });
    expect(entries({ views: available([board]) })).toEqual({ _tag: "views", views: [board] });
    expect(
      entries({
        views: available([
          { ...board, placement: "bottom-dock" },
          { ...board, installationId: PluginInstallationId.make("installation-2") },
        ]),
      }),
    ).toEqual({ _tag: "unavailable", problem: null });
  });

  it("drops the rows as soon as the view leaves the snapshot, with the server's reason", () => {
    expect(entries({ views: available([], "board.js is missing.") })).toEqual({
      _tag: "unavailable",
      problem: "board.js is missing.",
    });
    expect(entries({ views: available([]) })).toEqual({ _tag: "unavailable", problem: null });
  });

  it("shows nothing for an older server or a plugin without views", () => {
    expect(entries({ views: { _tag: "unsupported" } })).toEqual({ _tag: "none" });
    expect(entries({ capabilities: [], views: available([]) })).toEqual({ _tag: "none" });
    expect(entries({ capabilities: [], views: null })).toEqual({ _tag: "none" });
  });
});
