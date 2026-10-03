import { useAtomValue } from "@effect/atom-react";
import {
  createPluginNotificationEnvironmentAtoms,
  type PluginNotificationFeed,
} from "@t3tools/client-runtime/state/plugin-notifications";
import type { EnvironmentId } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { serverEnvironment } from "./server";

export const pluginNotificationEnvironment = createPluginNotificationEnvironmentAtoms(
  connectionAtomRuntime,
  { configValueAtom: serverEnvironment.configValueAtom },
);

/** What an environment's plugins sent while subscribed; empty when its server lacks the capability. */
export function usePluginNotificationFeed(environmentId: EnvironmentId): PluginNotificationFeed {
  return useAtomValue(pluginNotificationEnvironment.feed(environmentId));
}
