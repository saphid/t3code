import {
  pluginNotificationChanges,
  type PluginNotificationMark,
} from "@t3tools/client-runtime/state/plugin-notifications";
import { EnvironmentId, type PluginNotificationFrame } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import {
  type Banner,
  queueBannerChanges,
  removeEnvironmentBanners,
} from "./plugin-notification-banners";

const A = EnvironmentId.make("env-a");
const B = EnvironmentId.make("env-b");

/** The same epoch and sequences in each environment, so only the environment differs. */
const frame = (titles: ReadonlyArray<string>): PluginNotificationFrame => ({
  epoch: "epoch-1",
  notifications: titles.map((title, index) => ({
    sequence: index + 1,
    pluginId: "acme.notifier",
    pluginName: "Notifier",
    title,
    createdAt: "2026-10-04T00:00:00.000Z",
  })),
});

/** Feeds frames through the shared helper as each environment's host component does. */
function receive(
  queue: ReadonlyArray<Banner>,
  marks: Map<EnvironmentId, PluginNotificationMark | undefined>,
  environmentId: EnvironmentId,
  next: PluginNotificationFrame,
) {
  const changes = pluginNotificationChanges(marks.get(environmentId), next);
  marks.set(environmentId, changes.mark);
  return queueBannerChanges(queue, environmentId, changes.show, changes.keep);
}

const shown = (queue: ReadonlyArray<Banner>) =>
  queue.map((banner) => `${banner.environmentId}:${banner.entry.notification.title}`);

it("drops a removed environment's queued banners and keeps the others", () => {
  const marks = new Map<EnvironmentId, PluginNotificationMark | undefined>();
  let queue: ReadonlyArray<Banner> = [];
  queue = receive(queue, marks, A, frame([]));
  queue = receive(queue, marks, B, frame([]));
  queue = receive(queue, marks, A, frame(["a1", "a2"]));
  queue = receive(queue, marks, B, frame(["b1"]));
  expect(shown(queue)).toEqual(["env-a:a1", "env-a:a2", "env-b:b1"]);

  queue = removeEnvironmentBanners(queue, A);
  expect(shown(queue)).toEqual(["env-b:b1"]);
  expect(removeEnvironmentBanners(queue, A)).toBe(queue);
});
