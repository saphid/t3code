import {
  type AuthSessionState,
  type PluginInstallation,
  PluginInstallationId,
  PluginInstallationManifest,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "@effect/vitest";

import {
  canManagePlugins,
  createPluginActionGate,
  describePluginSource,
  pluginAddDirectory,
  presentPluginInstallation,
  resolvePluginCatalogState,
  resolvePluginDetail,
  resolvePluginManageAccess,
  startPluginAddHandoff,
} from "./pluginPresentation.ts";
import type { PluginCatalogView } from "./plugins.ts";

/** Resolves once the atom's value satisfies `done`, without polling. */
function settled<A>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<A>,
  done: (value: A) => boolean,
): Promise<void> {
  if (done(registry.get(atom))) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = registry.subscribe(atom, (value) => {
      if (!done(value)) return;
      unsubscribe();
      resolve();
    });
  });
}

const DIGEST = `sha256:${"a".repeat(64)}`;
const OLD_DIGEST = `sha256:${"b".repeat(64)}`;

const MANIFEST = Schema.decodeSync(PluginInstallationManifest)({
  id: "acme.notifier",
  name: "Notifier",
  version: "1.0.0",
  capabilities: [],
  proposedApi: false,
});

const installation = (overrides: Partial<PluginInstallation> = {}): PluginInstallation => ({
  installationId: PluginInstallationId.make("installation-1"),
  generation: 1,
  directory: "/srv/plugins/notifier/",
  manifest: MANIFEST,
  source: { digest: DIGEST, files: 3, bytes: 2048 },
  problem: null,
  inspectedAt: "2026-10-04T00:00:00.000Z",
  consent: { digest: DIGEST, capabilities: [], grantedAt: "2026-10-04T00:00:00.000Z" },
  enabled: true,
  hostState: { _tag: "idle" },
  addedAt: "2026-10-04T00:00:00.000Z",
  ...overrides,
});

describe("presentPluginInstallation", () => {
  it("treats an enabled plugin with an unknown host state as unknown, not idle", () => {
    const { hostState: _, ...unknownState } = installation();
    const view = presentPluginInstallation(unknownState);
    expect(view.stateLabel).toBe("Unknown state");
    expect(view.canResume).toBe(false);
    expect(view.canEnable).toBe(false);
    expect(view.canDisable).toBe(true);
  });

  it("asks for a fresh review after the approved bytes changed", () => {
    const view = presentPluginInstallation(
      installation({
        enabled: false,
        hostState: undefined,
        consent: { digest: OLD_DIGEST, capabilities: [], grantedAt: "2026-10-04T00:00:00.000Z" },
      }),
    );
    expect(view.status).toBe("needs-consent");
    expect(view.stateLabel).toBe("Changed since approval");
    expect(view.canReview).toBe(true);
    expect(view.canEnable).toBe(false);
  });

  it("offers a first review to a plugin nobody approved yet", () => {
    const view = presentPluginInstallation(
      installation({ enabled: false, hostState: undefined, consent: null }),
    );
    expect(view.stateLabel).toBe("Needs approval");
    expect(view.canReview).toBe(true);
  });

  it("offers resume only for states that wait for it", () => {
    const resumable = (hostState: PluginInstallation["hostState"]) =>
      presentPluginInstallation(installation({ hostState })).canResume;
    expect(resumable({ _tag: "idle" })).toBe(false);
    expect(resumable({ _tag: "running" })).toBe(false);
    expect(
      resumable({
        _tag: "backoff",
        failures: 2,
        reason: "Exited.",
        retryAt: "2026-10-04T00:01:00.000Z",
      }),
    ).toBe(true);
    expect(resumable({ _tag: "quarantined", failures: 6, reason: "Exited." })).toBe(true);
    expect(resumable({ _tag: "incompatible", reason: "Uses top-level await." })).toBe(true);
  });

  it("keeps disable available for an enabled plugin whose directory became unreadable", () => {
    const view = presentPluginInstallation(
      installation({ source: null, problem: "The directory does not exist." }),
    );
    expect(view.status).toBe("unavailable");
    expect(view.detail).toBe("The directory does not exist.");
    expect(view.canDisable).toBe(true);
    expect(view.canEnable).toBe(false);
  });

  it("names a plugin without a readable manifest by its directory", () => {
    const view = presentPluginInstallation(
      installation({ manifest: null, source: null, problem: "No manifest.", enabled: false }),
    );
    expect(view.title).toBe("notifier");
  });
});

describe("describePluginSource", () => {
  it("summarizes the file count and size", () => {
    expect(describePluginSource({ digest: DIGEST, files: 1, bytes: 512 })).toBe("1 file, 512 B");
    expect(describePluginSource({ digest: DIGEST, files: 12, bytes: 3 * 1024 * 1024 })).toBe(
      "12 files, 3.0 MB",
    );
  });
});

describe("resolvePluginManageAccess", () => {
  it("requires access:write", () => {
    const access = (scopes: ReadonlyArray<string> | undefined) =>
      resolvePluginManageAccess({
        session: {
          authenticated: true,
          ...(scopes === undefined ? {} : { scopes: scopes as never }),
        },
        isPending: false,
        hasError: false,
      });
    expect(access(["orchestration:read", "access:write"])).toBe("granted");
    expect(access(["orchestration:read", "orchestration:operate"])).toBe("denied");
    expect(access(undefined)).toBe("denied");
  });

  it("waits while the session loads and grants nothing when it cannot be read", () => {
    expect(resolvePluginManageAccess({ session: null, isPending: true, hasError: false })).toBe(
      "pending",
    );
    expect(resolvePluginManageAccess({ session: null, isPending: false, hasError: true })).toBe(
      "unreadable",
    );
  });

  it("grants nothing from an earlier read while the current one fails or is in flight", () => {
    const session = { authenticated: true, scopes: ["access:write" as never] };
    expect(resolvePluginManageAccess({ session, isPending: false, hasError: true })).toBe(
      "unreadable",
    );
    expect(resolvePluginManageAccess({ session, isPending: true, hasError: false })).toBe(
      "pending",
    );
  });

  it("drops an administrative read once the credential changes, even if the new read fails", async () => {
    // Mirrors environmentSession.sessionStateAtom: re-read per prepared credential, with SWR.
    const reads = new Map<string, PromiseWithResolvers<AuthSessionState>>();
    const credential = Atom.make("admin");
    const sessionState = Atom.make((get) => {
      const read = Promise.withResolvers<AuthSessionState>();
      reads.set(get(credential), read);
      return Effect.tryPromise(() => read.promise);
    }).pipe(Atom.swr({ staleTime: 30_000, revalidateOnMount: true }));
    const registry = AtomRegistry.make();
    const unmount = registry.mount(sessionState);
    const access = () => {
      const result = registry.get(sessionState);
      return resolvePluginManageAccess({
        session: Option.getOrNull(AsyncResult.value(result)),
        isPending: result.waiting,
        hasError: AsyncResult.isFailure(result),
      });
    };
    try {
      expect(access()).toBe("pending");
      reads.get("admin")!.resolve({ authenticated: true, scopes: ["access:write"] } as never);
      await settled(registry, sessionState, AsyncResult.isSuccess);
      expect(access()).toBe("granted");

      registry.set(credential, "standard");
      expect(access()).toBe("pending");
      reads.get("standard")!.reject(new Error("session read failed"));
      await settled(registry, sessionState, AsyncResult.isFailure);
      // The failed result still carries the administrative read as its previous success.
      expect(Option.getOrNull(AsyncResult.value(registry.get(sessionState)))?.scopes).toEqual([
        "access:write",
      ]);
      expect(access()).toBe("unreadable");
    } finally {
      unmount();
      registry.dispose();
    }
  });
});

const available = (installations: ReadonlyArray<PluginInstallation>): PluginCatalogView => ({
  _tag: "available",
  installations,
});
const availableState = (view: PluginCatalogView, receivedAt = 0) =>
  resolvePluginCatalogState({ connected: true, data: view, error: null, receivedAt });

describe("plugin management readiness", () => {
  it("manages only with access:write and a live catalogue", () => {
    const live = availableState(available([installation()]));
    expect(canManagePlugins("granted", live)).toBe(true);
    for (const access of ["denied", "pending", "unreadable"] as const)
      expect(canManagePlugins(access, live)).toBe(false);
  });

  it("stops management when the subscription fails, even with a cached snapshot", () => {
    const catalog = resolvePluginCatalogState({
      connected: true,
      data: available([installation()]),
      error: "Subscription lost.",
      receivedAt: 0,
    });
    expect(catalog).toEqual({ _tag: "failed", message: "Subscription lost." });
    expect(canManagePlugins("granted", catalog)).toBe(false);
  });

  it("stops management while disconnected or loading", () => {
    for (const catalog of [
      resolvePluginCatalogState({
        connected: false,
        data: available([]),
        error: null,
        receivedAt: 0,
      }),
      resolvePluginCatalogState({ connected: true, data: null, error: null, receivedAt: 0 }),
      resolvePluginCatalogState({
        connected: true,
        data: { _tag: "unsupported" },
        error: null,
        receivedAt: 0,
      }),
    ])
      expect(canManagePlugins("granted", catalog)).toBe(false);
  });
});

describe("pluginAddDirectory", () => {
  it("sends nothing from a read-only session, even on keyboard submit", () => {
    expect(pluginAddDirectory({ canManage: false, busy: false, directory: "/srv/p" })).toBeNull();
  });

  it("sends nothing once an open add form loses its catalogue", () => {
    const access = "granted" as const;
    const before = availableState(available([]));
    const after = resolvePluginCatalogState({
      connected: true,
      data: available([]),
      error: "Subscription lost.",
      receivedAt: 0,
    });
    const directory = " /srv/plugins/notifier ";
    expect(
      pluginAddDirectory({ canManage: canManagePlugins(access, before), busy: false, directory }),
    ).toBe("/srv/plugins/notifier");
    expect(
      pluginAddDirectory({ canManage: canManagePlugins(access, after), busy: false, directory }),
    ).toBeNull();
    expect(
      pluginAddDirectory({ canManage: canManagePlugins("denied", before), busy: false, directory }),
    ).toBeNull();
  });

  it("sends nothing while busy or empty", () => {
    expect(pluginAddDirectory({ canManage: true, busy: true, directory: "/srv/p" })).toBeNull();
    expect(pluginAddDirectory({ canManage: true, busy: false, directory: "  " })).toBeNull();
  });
});

describe("resolvePluginDetail", () => {
  const id = PluginInstallationId.make("installation-1");
  const added = installation();
  const ADDED_AT = 2_000;

  it("shows a just-added plugin until a snapshot from after the add lists it", () => {
    const marker = { since: ADDED_AT, installation: added };
    expect(
      resolvePluginDetail({
        catalog: availableState(available([]), ADDED_AT - 1),
        installationId: id,
        added: marker,
      }),
    ).toEqual({ _tag: "found", installation: added });
    const listed = installation({ enabled: true });
    expect(
      resolvePluginDetail({
        catalog: availableState(available([listed]), ADDED_AT + 5),
        installationId: id,
        added: marker,
      }),
    ).toEqual({ _tag: "found", installation: listed });
  });

  it("waits for a snapshot from after the add without the reply, then finds the plugin", () => {
    const marker = { since: ADDED_AT, installation: null };
    expect(
      resolvePluginDetail({
        catalog: availableState(available([]), ADDED_AT - 1),
        installationId: id,
        added: marker,
      }),
    ).toEqual({ _tag: "loading" });
    expect(
      resolvePluginDetail({
        catalog: availableState(available([added]), ADDED_AT + 5),
        installationId: id,
        added: marker,
      }),
    ).toEqual({ _tag: "found", installation: added });
  });

  it("reports removal when a snapshot from after the add does not list the plugin", () => {
    // Covers a removal that reached the client before the detail screen opened.
    for (const reply of [added, null]) {
      for (const receivedAt of [ADDED_AT, ADDED_AT + 5]) {
        expect(
          resolvePluginDetail({
            catalog: availableState(available([]), receivedAt),
            installationId: id,
            added: { since: ADDED_AT, installation: reply },
          }),
        ).toEqual({ _tag: "missing" });
      }
    }
  });

  it("reports an absent plugin opened directly as missing, not loading", () => {
    expect(
      resolvePluginDetail({
        catalog: availableState(available([])),
        installationId: id,
        added: null,
      }),
    ).toEqual({ _tag: "missing" });
  });

  it("shows the subscription failure instead of the cached review data", () => {
    expect(
      resolvePluginDetail({
        catalog: resolvePluginCatalogState({
          connected: true,
          data: available([added]),
          error: "Subscription lost.",
          receivedAt: 0,
        }),
        installationId: id,
        added: null,
      }),
    ).toEqual({ _tag: "failed", message: "Subscription lost." });
  });
});

describe("startPluginAddHandoff", () => {
  const id = PluginInstallationId.make("installation-1");

  it("ends as missing when add and remove coalesce into an unchanged catalogue", async () => {
    // A subscription that drops repeats: after add+remove the server state equals
    // the old snapshot, so only a restarted subscription delivers it again.
    let now = 1_000;
    let serverInstallations: ReadonlyArray<PluginInstallation> = [];
    const catalog = Atom.make(
      Stream.concat(
        Stream.fromEffect(
          Effect.sync((): PluginCatalogView => available([...serverInstallations])),
        ),
        Stream.never,
      ),
    );
    const registry = AtomRegistry.make();
    const unmount = registry.mount(catalog);
    const state = () => {
      const result = registry.get(catalog);
      return resolvePluginCatalogState({
        connected: true,
        data: Option.getOrNull(AsyncResult.value(result)),
        error: null,
        receivedAt: AsyncResult.isSuccess(result) ? result.timestamp : 0,
      });
    };
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      await settled(registry, catalog, AsyncResult.isSuccess);
      // The plugin is added and removed again before the subscription reports either.
      serverInstallations = [installation()];
      serverInstallations = [];

      now = 2_000;
      let restarts = 0;
      const marker = startPluginAddHandoff({
        installation: null,
        restartCatalog: () => {
          restarts += 1;
          now = 2_001;
          registry.refresh(catalog);
        },
        now: 2_000,
      });
      expect(restarts).toBe(1);
      await settled(
        registry,
        catalog,
        (result) => AsyncResult.isSuccess(result) && result.timestamp >= marker.since,
      );
      expect(resolvePluginDetail({ catalog: state(), installationId: id, added: marker })).toEqual({
        _tag: "missing",
      });
    } finally {
      Date.now = originalNow;
      unmount();
      registry.dispose();
    }
  });
});

describe("createPluginActionGate", () => {
  const counted = () => {
    const calls: Array<string> = [];
    const step = (name: string) => () => {
      calls.push(name);
      return Promise.resolve({ value: name });
    };
    return { calls, step };
  };

  it("sends nothing from a confirmation opened before management was lost or its screen closed", async () => {
    const gate = createPluginActionGate();
    const { calls, step } = counted();
    gate.set(true);
    // A native confirmation keeps the callback it was opened with.
    const confirmRemove = () => gate.run([step("remove")]);
    gate.set(false);
    expect(await confirmRemove()).toEqual({ _tag: "refused" });
    expect(calls).toEqual([]);
  });

  it("stops between steps when management is lost mid-action", async () => {
    const gate = createPluginActionGate();
    const calls: Array<string> = [];
    gate.set(true);
    const outcome = await gate.run([
      () => {
        calls.push("consent");
        gate.set(false);
        return Promise.resolve({ value: null });
      },
      () => {
        calls.push("enable");
        return Promise.resolve({ value: null });
      },
    ]);
    expect(outcome).toEqual({ _tag: "refused" });
    expect(calls).toEqual(["consent"]);
  });

  it("runs every step once, one action at a time, and reports the first failure", async () => {
    const gate = createPluginActionGate();
    const { calls, step } = counted();
    gate.set(true);
    let started = 0;
    const first = gate.run([step("consent"), step("enable")], () => (started += 1));
    expect(await gate.run([step("remove")])).toEqual({ _tag: "refused" });
    expect(await first).toEqual({ _tag: "done" });
    expect(started).toBe(1);
    expect(calls).toEqual(["consent", "enable"]);
    expect(
      await gate.run([() => Promise.resolve({ error: "source-changed" }), step("enable")]),
    ).toEqual({ _tag: "failed", error: "source-changed" });
    expect(calls).toEqual(["consent", "enable"]);
  });
});
