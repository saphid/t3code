import {
  type ContributionStatusItem,
  type ContributionStatusSnapshot,
  type EnvironmentId,
  type ServerConfig,
  type ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcSubscriptionAtomFamily } from "./runtime.ts";

const EMPTY_SNAPSHOT: ContributionStatusSnapshot = { threads: [] };
const NO_ITEMS: ReadonlyArray<ContributionStatusItem> = [];

/** Older servers lack the stream; clients show nothing for them and never subscribe. */
function supportsContributionStatus(config: ServerConfig | null): boolean {
  return config?.environment.capabilities.contributionStatus === true;
}

/** A thread's statuses from every source, in source then key order. */
function threadContributionStatusItems(
  snapshot: ContributionStatusSnapshot,
  threadId: ThreadId,
): ReadonlyArray<ContributionStatusItem> {
  const items = snapshot.threads.flatMap((thread) =>
    thread.threadId === threadId ? thread.items : [],
  );
  return items.length === 0 ? NO_ITEMS : items;
}

function sameItems(
  left: ReadonlyArray<ContributionStatusItem>,
  right: ReadonlyArray<ContributionStatusItem>,
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        item.key === other.key &&
        item.text === other.text &&
        item.tone === other.tone &&
        item.tooltip === other.tooltip
      );
    })
  );
}

/**
 * Live thread statuses per environment for the web and mobile renderers.
 * Nothing subscribes until a renderer reads an atom, and only against servers
 * that advertise the capability. Each server frame is a full replacement, so a
 * reconnect's first frame drops statuses that ended while disconnected.
 */
export function createContributionStatusEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  options: {
    readonly configValueAtom: (environmentId: EnvironmentId) => Atom.Atom<ServerConfig | null>;
  },
) {
  const subscription = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:contribution-status",
    tag: WS_METHODS.subscribeContributionStatus,
  });
  const snapshotAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): ContributionStatusSnapshot => {
      if (!supportsContributionStatus(get(options.configValueAtom(environmentId)))) {
        return EMPTY_SNAPSHOT;
      }
      return Option.getOrElse(
        AsyncResult.value(get(subscription({ environmentId, input: {} }))),
        () => EMPTY_SNAPSHOT,
      );
    }).pipe(Atom.withLabel(`environment-data:contribution-status:snapshot:${environmentId}`)),
  );
  const threadItemsFamily = Atom.family((key: string) => {
    const [environmentId, threadId] = JSON.parse(key) as [EnvironmentId, ThreadId];
    // A change on another thread keeps this thread's array, so its row does not re-render.
    let previous = NO_ITEMS;
    return Atom.make((get) => {
      const next = threadContributionStatusItems(get(snapshotAtom(environmentId)), threadId);
      if (!sameItems(previous, next)) previous = next;
      return previous;
    }).pipe(Atom.withLabel(`environment-data:contribution-status:thread:${key}`));
  });
  return {
    snapshot: snapshotAtom,
    threadItems: (environmentId: EnvironmentId, threadId: ThreadId) =>
      threadItemsFamily(JSON.stringify([environmentId, threadId])),
  };
}
