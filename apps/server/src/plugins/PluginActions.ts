/**
 * The actions enabled plugins offer, and running one.
 *
 * Actions come from the manifest of each enabled installation, so listing
 * them never starts a plugin. Each listed action carries an id naming the
 * installation's registration (`<installationId>:<generation>:<name>`). An
 * invoke with an id from an earlier registration is refused as `stale`, and
 * the catalogue's own generation check refuses one that races a re-enable,
 * so a click never reaches a plugin the list did not show.
 *
 * Running an action calls the plugin's `action:<name>` handler with the
 * resolved target (see pluginApi.ts) under a deadline. Interrupting the
 * caller (a client that goes away) cancels the call.
 */
import {
  PLUGIN_ACTION_MESSAGE_MAX_LENGTH,
  PluginActionError,
  PluginActionId,
  PluginInstallationId,
  pluginInstallationStatus,
  type PluginAction,
  type PluginActionInvokeInput,
  type PluginActionInvokeResult,
  type PluginActionsSnapshot,
  type PluginActionTarget,
  type PluginCatalogError,
  type PluginCatalogSnapshot,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { PluginCatalog } from "./PluginCatalog.ts";
import type { PluginInvokeError } from "./PluginSupervisor.ts";

export const PLUGIN_ACTION_TIMEOUT: Duration.Input = "30 seconds";

/** What an action handler receives as `input.target`: the target the user picked, resolved. */
export type PluginActionTargetContext =
  | { readonly kind: "environment" }
  | { readonly kind: "project"; readonly projectId: string; readonly workspaceRoot: string }
  | {
      readonly kind: "thread";
      readonly threadId: string;
      readonly projectId: string;
      /** The thread's worktree, or its project's workspace root. */
      readonly cwd: string;
      readonly branch: string | null;
    };

/** Looks a target up in this environment; none when it does not exist here. */
export type ResolvePluginActionTarget = (
  target: PluginActionTarget,
) => Effect.Effect<Option.Option<PluginActionTargetContext>, PluginActionError>;

/** Resolves targets from this environment's projects and threads. */
export const resolvePluginActionTargetFrom = <ThreadError, ProjectError>(lookups: {
  readonly getThreadShell: (threadId: ThreadId) => Effect.Effect<
    {
      readonly projectId: ProjectId;
      readonly worktreePath: string | null;
      readonly branch: string | null;
    } | null,
    ThreadError
  >;
  readonly getProjectShell: (
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<{ readonly workspaceRoot: string }>, ProjectError>;
}): ResolvePluginActionTarget =>
  Effect.fnUntraced(
    function* (target) {
      switch (target._tag) {
        case "environment":
          return Option.some({ kind: "environment" as const });
        case "project": {
          const project = yield* lookups.getProjectShell(target.projectId);
          return Option.map(project, (shell) => ({
            kind: "project" as const,
            projectId: target.projectId,
            workspaceRoot: shell.workspaceRoot,
          }));
        }
        case "thread": {
          const thread = yield* lookups.getThreadShell(target.threadId);
          if (thread === null) return Option.none();
          const project = yield* lookups.getProjectShell(thread.projectId);
          if (Option.isNone(project)) return Option.none();
          return Option.some({
            kind: "thread" as const,
            threadId: target.threadId,
            projectId: thread.projectId,
            cwd: thread.worktreePath ?? project.value.workspaceRoot,
            branch: thread.branch,
          });
        }
      }
    },
    Effect.mapError(() => actionError("unavailable", "Could not look up the action's target.")),
  );

export interface PluginActions {
  /** The current actions now, then a new list whenever it changes. */
  readonly subscribe: Stream.Stream<PluginActionsSnapshot>;
  readonly invoke: (
    input: PluginActionInvokeInput,
  ) => Effect.Effect<PluginActionInvokeResult, PluginActionError>;
}

export const pluginActionHandlerName = (name: string) => `action:${name}`;

const actionId = (installationId: string, generation: number, name: string) =>
  PluginActionId.make(`${installationId}:${generation}:${name}`);

const parseActionId = (id: PluginActionId) => {
  const parts = id.split(":");
  const name = parts.pop();
  const generation = Number(parts.pop());
  if (name === undefined || !Number.isSafeInteger(generation) || parts.length === 0)
    return undefined;
  return { installationId: PluginInstallationId.make(parts.join(":")), generation, name };
};

/** The actions a catalogue snapshot offers: enabled installations that can run. */
export const pluginActionsFromCatalog = (
  snapshot: PluginCatalogSnapshot,
): PluginActionsSnapshot => ({
  actions: snapshot.installations.flatMap((installation): ReadonlyArray<PluginAction> => {
    const { manifest } = installation;
    if (manifest === null || pluginInstallationStatus(installation) !== "enabled") return [];
    if (!manifest.capabilities.includes("actions")) return [];
    // These wait for someone to resume them; an action could only fail.
    const state = installation.hostState?._tag;
    if (state === "quarantined" || state === "incompatible") return [];
    return (manifest.actions ?? []).map((declaration) => ({
      id: actionId(installation.installationId, installation.generation, declaration.name),
      pluginId: manifest.id,
      pluginName: manifest.name,
      name: declaration.name,
      title: declaration.title,
      ...(declaration.description === undefined ? {} : { description: declaration.description }),
      target: declaration.target,
      placements: declaration.placements,
    }));
  }),
});

const actionError = (reason: string, message: string) =>
  new PluginActionError({ reason, message: bound(message) });

/** At most the message bound, without splitting a surrogate pair. */
const bound = (text: string) => {
  const characters = Array.from(text);
  return characters.length <= PLUGIN_ACTION_MESSAGE_MAX_LENGTH
    ? text
    : `${characters.slice(0, PLUGIN_ACTION_MESSAGE_MAX_LENGTH - 1).join("")}…`;
};

/** A plugin's `{ message }`, if it returned one. */
const resultMessage = (value: Schema.Json): string | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const message = (value as { readonly [key: string]: Schema.Json })["message"];
  if (typeof message !== "string" || message.trim() === "") return null;
  return bound(message.trim());
};

const fromInvokeError = (
  error: PluginCatalogError | PluginInvokeError,
  title: string,
): PluginActionError => {
  switch (error._tag) {
    case "PluginCatalogError":
      return error.reason === "generation-changed"
        ? actionError("stale", "The plugin was enabled again since this action was listed.")
        : error.reason === "not-found"
          ? actionError("not-found", "That plugin is no longer installed.")
          : actionError("unavailable", error.message);
    case "PluginTimeoutError":
      return actionError("timeout", `${title} did not finish in time.`);
    case "PluginBusyError":
      return actionError("busy", `${title} could not start: the plugin is busy.`);
    case "PluginStoppedError":
      return actionError("stopped", "The plugin was disabled while the action ran.");
    case "PluginCallFailedError":
      return actionError("failed", error.reason);
    default:
      return actionError("unavailable", error.message);
  }
};

export const makePluginActions = (options: {
  readonly catalog: PluginCatalog["Service"];
  readonly resolveTarget: ResolvePluginActionTarget;
  readonly timeout?: Duration.Input;
}): PluginActions => {
  const { catalog, resolveTarget } = options;

  const invoke = Effect.fn("PluginActions.invoke")(function* (input: PluginActionInvokeInput) {
    const parsed = parseActionId(input.actionId);
    if (parsed === undefined)
      return yield* actionError("not-found", "That action is not available here.");
    const snapshot = yield* catalog.list;
    const installation = snapshot.installations.find(
      (candidate) => candidate.installationId === parsed.installationId,
    );
    if (installation === undefined)
      return yield* actionError("not-found", "That plugin is no longer installed.");
    if (installation.generation !== parsed.generation)
      return yield* actionError(
        "stale",
        "The plugin was enabled again since this action was listed.",
      );
    const action = pluginActionsFromCatalog({ installations: [installation] }).actions.find(
      (candidate) => candidate.name === parsed.name,
    );
    if (action === undefined)
      return yield* actionError("not-found", "That action is not available now.");
    if (action.target !== input.target._tag)
      return yield* actionError("target-mismatch", `${action.title} runs on a ${action.target}.`);
    const target = yield* resolveTarget(input.target);
    if (Option.isNone(target))
      return yield* actionError("target-not-found", `That ${action.target} does not exist here.`);
    const value = yield* catalog
      .invoke(
        installation.installationId,
        pluginActionHandlerName(action.name),
        { action: action.name, target: target.value },
        { generation: parsed.generation, timeout: options.timeout ?? PLUGIN_ACTION_TIMEOUT },
      )
      .pipe(Effect.mapError((error) => fromInvokeError(error, action.title)));
    return { message: resultMessage(value) };
  });

  return {
    // Process state changes reach the catalogue too; most leave the list as it was.
    subscribe: catalog.subscribe.pipe(Stream.map(pluginActionsFromCatalog), Stream.changes),
    invoke,
  };
};
