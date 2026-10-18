import type { ServerConfig } from "@t3tools/contracts";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import { PrimaryConnectionTarget } from "../connection/model.ts";
import type { EnvironmentShellState } from "./shell.ts";
import {
  createEnvironmentServerConfigsAtom,
  createEnvironmentShellStatusAtom,
  createEnvironmentShellSummaryAtom,
} from "./shell.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const OTHER_ENVIRONMENT_ID = EnvironmentId.make("environment-2");

function environmentEntry(environmentId: EnvironmentId, label: string) {
  return {
    target: new PrimaryConnectionTarget({
      environmentId,
      label,
      httpBaseUrl: `https://${environmentId}.example.test`,
      wsBaseUrl: `wss://${environmentId}.example.test`,
    }),
    profile: Option.none(),
  };
}

function shellState(input: {
  readonly status: EnvironmentShellState["status"];
  readonly updatedAt?: string;
  readonly error?: string;
  readonly snapshotSequence?: number;
}): EnvironmentShellState {
  return {
    snapshot:
      input.updatedAt === undefined
        ? Option.none()
        : Option.some({
            snapshotSequence: input.snapshotSequence ?? 1,
            updatedAt: input.updatedAt,
            projects: [],
            threads: [],
          }),
    status: input.status,
    error: input.error === undefined ? Option.none() : Option.some(input.error),
  };
}

function makeHarness() {
  const shellStateAtoms = Atom.family((environmentId: EnvironmentId) =>
    Atom.make<EnvironmentShellState>(
      environmentId === ENVIRONMENT_ID
        ? shellState({
            status: "cached",
            updatedAt: "2026-06-01T00:00:00.000Z",
          })
        : shellState({
            status: "synchronizing",
            updatedAt: "2026-06-02T00:00:00.000Z",
            error: "Retrying.",
          }),
    ),
  );
  const configAtoms = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<ServerConfig | null>(null),
  );
  const catalogValueAtom = Atom.make({
    isReady: true,
    entries: new Map([
      [ENVIRONMENT_ID, environmentEntry(ENVIRONMENT_ID, "Environment")],
      [OTHER_ENVIRONMENT_ID, environmentEntry(OTHER_ENVIRONMENT_ID, "Other environment")],
    ]),
  });
  const summaryAtom = createEnvironmentShellSummaryAtom({
    catalogValueAtom,
    shellStateValueAtom: shellStateAtoms,
  });
  const serverConfigsAtom = createEnvironmentServerConfigsAtom({
    catalogValueAtom,
    serverConfigValueAtom: configAtoms,
  });

  return {
    registry: AtomRegistry.make(),
    shellStateAtom: shellStateAtoms,
    configAtom: configAtoms,
    summaryAtom,
    serverConfigsAtom,
  };
}

describe("environment shell projections", () => {
  it("notifies status subscribers only when synchronization status changes", () => {
    const tasks = new Set<() => void>();
    const registry = AtomRegistry.make({
      scheduleTask: (task) => {
        tasks.add(task);
        return () => tasks.delete(task);
      },
    });
    const stateAtoms = Atom.family((_environmentId: EnvironmentId) =>
      Atom.make(shellState({ status: "live", snapshotSequence: 1 })),
    );
    const statusAtoms = createEnvironmentShellStatusAtom(stateAtoms);
    const notifications: EnvironmentShellState["status"][] = [];
    const unsubscribe = registry.subscribe(
      statusAtoms(ENVIRONMENT_ID),
      (status) => notifications.push(status),
      { immediate: true },
    );
    const flush = () => {
      while (tasks.size > 0) {
        const pending = [...tasks];
        tasks.clear();
        for (const task of pending) task();
      }
    };

    try {
      registry.set(
        stateAtoms(ENVIRONMENT_ID),
        shellState({ status: "live", snapshotSequence: 2, updatedAt: "2026-06-03T00:00:00Z" }),
      );
      registry.set(stateAtoms(OTHER_ENVIRONMENT_ID), shellState({ status: "synchronizing" }));
      flush();
      expect(notifications).toEqual(["live"]);

      registry.set(stateAtoms(ENVIRONMENT_ID), shellState({ status: "synchronizing" }));
      flush();
      registry.set(stateAtoms(ENVIRONMENT_ID), shellState({ status: "live" }));
      flush();
      expect(notifications).toEqual(["live", "synchronizing", "live"]);
    } finally {
      unsubscribe();
      registry.dispose();
    }
  });

  it("summarizes shell state and preserves identity when only irrelevant snapshot data changes", () => {
    const harness = makeHarness();
    const summary = harness.registry.get(harness.summaryAtom);

    expect(summary).toEqual({
      hasSnapshot: true,
      hasSynchronizingShell: true,
      hasCachedShell: true,
      hasLiveShell: false,
      firstError: "Retrying.",
      latestSnapshotUpdatedAt: "2026-06-02T00:00:00.000Z",
    });

    harness.registry.set(
      harness.shellStateAtom(ENVIRONMENT_ID),
      shellState({
        status: "cached",
        updatedAt: "2026-06-01T00:00:00.000Z",
        snapshotSequence: 2,
      }),
    );

    expect(harness.registry.get(harness.summaryAtom)).toBe(summary);
  });

  it("preserves server-config map identity until a config reference changes", () => {
    const harness = makeHarness();
    const empty = harness.registry.get(harness.serverConfigsAtom);
    const config = { cwd: "/repo" } as ServerConfig;

    harness.registry.set(harness.configAtom(ENVIRONMENT_ID), config);
    const withConfig = harness.registry.get(harness.serverConfigsAtom);

    expect(withConfig).not.toBe(empty);
    expect(withConfig.get(ENVIRONMENT_ID)).toBe(config);

    harness.registry.set(harness.configAtom(ENVIRONMENT_ID), config);
    expect(harness.registry.get(harness.serverConfigsAtom)).toBe(withConfig);
  });
});
