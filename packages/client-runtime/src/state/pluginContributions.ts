import {
  PLUGIN_EVENTS_CAPABILITY,
  PLUGIN_VIEWS_CAPABILITY,
  type PluginActionDeclaration,
  type PluginActionsSnapshot,
  type PluginInstallationManifest,
  type PluginSettingField,
  type PluginToolDeclaration,
  type PluginView,
  type PluginViewProblem,
} from "@t3tools/contracts";

/** One declared contribution as a details screen lists it. */
export interface PluginContributionItem {
  readonly key: string;
  readonly title: string;
  /** What it does or where it shows; null when there is nothing to add. */
  readonly detail: string | null;
}

export type PluginContributionKind = "actions" | "tools" | "views" | "settings" | "events";

/** Everything a plugin adds of one kind, with why some of it is not offered right now. */
export interface PluginContributionGroup {
  readonly kind: PluginContributionKind;
  readonly label: string;
  readonly items: ReadonlyArray<PluginContributionItem>;
  readonly notice: string | null;
}

/** The views one installation's current registration offers, as the environment's views snapshot lists them. */
export interface PluginOfferedViews {
  readonly views: ReadonlyArray<PluginView>;
  readonly problems: ReadonlyArray<PluginViewProblem>;
}

const ACTION_PLACEMENTS: Record<string, string> = {
  "command-palette": "Command palette",
  "thread-menu": "Thread menu",
};

const ACTION_TARGETS: Record<PluginActionDeclaration["target"], string> = {
  environment: "the environment",
  project: "a project",
  thread: "a thread",
};

function actionItem(action: PluginActionDeclaration): PluginContributionItem {
  const placements = action.placements.map((placement) =>
    placement === "composer-slash"
      ? `/${action.name}`
      : (ACTION_PLACEMENTS[placement] ?? placement),
  );
  return {
    key: action.name,
    title: action.title,
    detail: [`Runs on ${ACTION_TARGETS[action.target]}`, placements.join(", "), action.description]
      .filter((part) => part !== undefined && part.length > 0)
      .join(" · "),
  };
}

const TOOL_SIDE_EFFECTS: Record<PluginToolDeclaration["sideEffect"], string> = {
  read: "Reads only",
  write: "Makes changes",
  destructive: "Can delete or overwrite",
};

function toolItem(tool: PluginToolDeclaration): PluginContributionItem {
  const effect = TOOL_SIDE_EFFECTS[tool.sideEffect] ?? tool.sideEffect;
  return {
    key: tool.name,
    title: tool.title && tool.title.length > 0 ? tool.title : tool.name,
    detail: [effect, tool.openWorld ? "Reaches outside this machine" : null, tool.description]
      .filter((part) => part !== null)
      .join(" · "),
  };
}

const SETTING_TYPES: Record<PluginSettingField["type"], string> = {
  text: "Text",
  secret: "Secret, kept on the server",
  boolean: "On or off",
  number: "Number",
  select: "Choice",
};

function settingItem(field: PluginSettingField): PluginContributionItem {
  return {
    key: field.key,
    title: field.label,
    detail: [SETTING_TYPES[field.type], field.description]
      .filter((part) => part !== undefined)
      .join(" · "),
  };
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

/**
 * What a plugin adds to T3 Code, read from its manifest summary; nothing here
 * starts the plugin. Only kinds it declares are listed. `offered` is true while
 * the installation is enabled, so its actions and views should appear on the
 * environment's snapshots; pass a snapshot as null when its server lacks the
 * capability or it has not arrived.
 */
export function describePluginContributions(input: {
  readonly manifest: PluginInstallationManifest;
  readonly offered: boolean;
  readonly actions: PluginActionsSnapshot | null;
  readonly views: PluginOfferedViews | null;
}): ReadonlyArray<PluginContributionGroup> {
  const { manifest, offered } = input;
  const groups: Array<PluginContributionGroup> = [];

  const actions = manifest.actions ?? [];
  if (actions.length > 0) {
    // The server takes plugins whole until its limit, so a left-out plugin offers none of its actions.
    const snapshot = input.actions;
    const omitted = snapshot?.omitted;
    const left =
      offered &&
      snapshot !== null &&
      omitted !== undefined &&
      !snapshot.actions.some((action) => action.pluginId === manifest.id);
    groups.push({
      kind: "actions",
      label: "Actions",
      items: actions.map(actionItem),
      notice: left
        ? `Not offered: this environment's action limit left out ${plural(omitted.plugins, "plugin", "plugins")} with ${plural(omitted.actions, "action", "actions")}, including this one. Disable another plugin with actions to make room.`
        : null,
    });
  }

  const tools = manifest.tools ?? [];
  if (tools.length > 0)
    groups.push({
      kind: "tools",
      label: "Tools for agents",
      items: tools.map(toolItem),
      notice: null,
    });

  if (manifest.capabilities.includes(PLUGIN_VIEWS_CAPABILITY)) {
    const views = offered ? input.views : null;
    groups.push({
      kind: "views",
      label: "Views",
      items: (views?.views ?? []).map((view) => ({
        key: view.viewId,
        title: view.title,
        detail: view.placement === "side-panel" ? "Side panel on web and desktop" : view.placement,
      })),
      notice:
        views === null
          ? "Declares views. Their titles show here while the plugin is enabled."
          : views.problems.length > 0
            ? views.problems.map((problem) => problem.message).join(" ")
            : views.views.length === 0
              ? "Declares no views it can show."
              : null,
    });
  }

  const settings = manifest.settings ?? [];
  if (settings.length > 0)
    groups.push({
      kind: "settings",
      label: "Settings",
      items: settings.map(settingItem),
      notice: null,
    });

  if (manifest.capabilities.includes(PLUGIN_EVENTS_CAPABILITY))
    groups.push({
      kind: "events",
      label: "Events",
      items: [
        {
          key: "runs",
          title: "Finished runs",
          detail:
            "Each run's outcome with its thread's title and IDs; never message contents. Delivered in order, at least once.",
        },
      ],
      notice: null,
    });

  return groups;
}
