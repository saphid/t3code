import { useAtomValue } from "@effect/atom-react";
import { createPluginActionEnvironmentAtoms } from "@t3tools/client-runtime/state/pluginActions";
import type { EnvironmentId, PluginAction } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useEnvironmentQuery } from "./query";

export const pluginActionEnvironment = createPluginActionEnvironmentAtoms(connectionAtomRuntime);

const NO_ACTIONS: ReadonlyArray<PluginAction> = [];

const actionsAtom = (environmentId: EnvironmentId) =>
  pluginActionEnvironment.actions({ environmentId, input: {} });

/** The environment's plugin actions, kept current while the caller is mounted. */
export function usePluginActions(environmentId: EnvironmentId | null): ReadonlyArray<PluginAction> {
  return (
    useEnvironmentQuery(environmentId === null ? null : actionsAtom(environmentId)).data ??
    NO_ACTIONS
  );
}

/** Keeps one environment's list subscribed so menus built on demand read it current. */
export function useMountPluginActions(environmentId: EnvironmentId): void {
  useAtomValue(actionsAtom(environmentId));
}

/** The list as last received, for menus built when they open. */
export function readPluginActions(environmentId: EnvironmentId): ReadonlyArray<PluginAction> {
  return Option.getOrElse(
    AsyncResult.value(appAtomRegistry.get(actionsAtom(environmentId))),
    () => NO_ACTIONS,
  );
}
