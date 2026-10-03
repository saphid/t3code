import {
  PluginInstallationId,
  PluginInstallationManifest,
  type PluginAction,
  PluginActionId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import { describePluginContributions } from "./pluginContributions.ts";

const decodeManifest = Schema.decodeUnknownSync(PluginInstallationManifest);

const manifest = (fields: Record<string, unknown>) =>
  decodeManifest({
    id: "acme.notifier",
    name: "Notifier",
    version: "1.0.0",
    capabilities: [],
    proposedApi: true,
    ...fields,
  });

const FULL = manifest({
  capabilities: ["actions", "tools", "views", "settings", "events"],
  actions: [
    {
      name: "summarize",
      title: "Summarize thread",
      target: "thread",
      placements: ["thread-menu", "composer-slash"],
    },
  ],
  tools: [
    {
      name: "word_count",
      description: "Count words.",
      inputSchema: { type: "object" },
      sideEffect: "read",
    },
  ],
  settings: [
    { type: "secret", key: "token", label: "API token" },
    { type: "boolean", key: "loud", label: "Loud", description: "Play a sound." },
  ],
});

const action = (pluginId: string): PluginAction => ({
  id: PluginActionId.make(`${pluginId}:1`),
  pluginId,
  pluginName: pluginId,
  name: "summarize",
  title: "Summarize thread",
  target: "thread",
  placements: ["thread-menu"],
});

const omitted = { plugins: 2, actions: 9 };

describe("describePluginContributions", () => {
  it("lists what the manifest declares, without starting the plugin", () => {
    const groups = describePluginContributions({
      manifest: FULL,
      offered: false,
      actions: null,
      views: null,
    });
    expect(groups.map((group) => group.kind)).toEqual([
      "actions",
      "tools",
      "views",
      "settings",
      "events",
    ]);
    expect(groups[0]?.items).toEqual([
      {
        key: "summarize",
        title: "Summarize thread",
        detail: "Runs on a thread · Thread menu, /summarize",
      },
    ]);
    expect(groups[1]?.items[0]).toMatchObject({
      title: "word_count",
      detail: "Reads only · Count words.",
    });
    expect(groups[3]?.items.map((item) => item.detail)).toEqual([
      "Secret, kept on the server",
      "On or off · Play a sound.",
    ]);
    // View titles are not in the manifest summary; they come from the views snapshot once enabled.
    expect(groups[2]).toMatchObject({ items: [], notice: expect.stringContaining("enabled") });
  });

  it("lists nothing for a plugin that declares no contributions", () => {
    expect(
      describePluginContributions({
        manifest: manifest({}),
        offered: true,
        actions: null,
        views: null,
      }),
    ).toEqual([]);
  });

  it("says when the environment's action limit left this plugin out", () => {
    const left = describePluginContributions({
      manifest: FULL,
      offered: true,
      actions: { actions: [action("other.plugin")], omitted },
      views: null,
    });
    expect(left[0]?.notice).toBe(
      "Not offered: this environment's action limit left out 2 plugins with 9 actions, including this one. Disable another plugin with actions to make room.",
    );
  });

  it("has no notice when its actions are offered, it is not enabled, or nothing was left out", () => {
    const notice = (input: Omit<Parameters<typeof describePluginContributions>[0], "manifest">) =>
      describePluginContributions({ manifest: FULL, ...input })[0]?.notice;
    expect(
      notice({
        offered: true,
        actions: { actions: [action("acme.notifier")], omitted },
        views: null,
      }),
    ).toBeNull();
    expect(notice({ offered: false, actions: { actions: [], omitted }, views: null })).toBeNull();
    expect(notice({ offered: true, actions: { actions: [] }, views: null })).toBeNull();
    expect(notice({ offered: true, actions: null, views: null })).toBeNull();
  });

  it("lists the views an enabled plugin offers, or why it offers none", () => {
    const installationId = PluginInstallationId.make("installation-1");
    const view = {
      installationId,
      generation: 2,
      pluginId: "acme.notifier",
      pluginName: "Notifier",
      viewId: "board",
      title: "Board",
      placement: "side-panel",
    };
    const views = (input: {
      views: Array<typeof view>;
      problems: Array<{
        installationId: typeof installationId;
        generation: number;
        message: string;
      }>;
    }) =>
      describePluginContributions({
        manifest: FULL,
        offered: true,
        actions: null,
        views: input,
      })[2];
    expect(views({ views: [view], problems: [] })).toMatchObject({
      items: [{ key: "board", title: "Board", detail: "Side panel on web and desktop" }],
      notice: null,
    });
    expect(
      views({
        views: [],
        problems: [{ installationId, generation: 2, message: "board.js is too large." }],
      })?.notice,
    ).toBe("board.js is too large.");
  });
});
