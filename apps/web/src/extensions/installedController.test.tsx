import * as React from "react";
import { describe, it, expect, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, type ExtensionInstallation } from "@t3tools/contracts";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { Extension } from "@t3tools/extension-sdk/host";
import type { SurfaceRenderer } from "@t3tools/extension-sdk/react";
import { createCatalogueRefreshQueue } from "./catalogueRefresh";
import { createInstalledExtensionController, type InstalledSnapshot } from "./installedController";

const manifest = { id: "test.installed", version: "1.0.0", apiVersion: 1 as const, surfaces: [] };
const installation: ExtensionInstallation = {
  id: manifest.id,
  contentHash: "a".repeat(64),
  enabled: true,
  grants: { capabilities: ["t3.workspace/read-text"], projectIds: [ProjectId.make("project-a")] },
  package: {
    format: 1,
    manifest,
    clientEntry: "client.mjs",
    serverEntry: "server.mjs",
    tools: [
      {
        id: "test.installed/read",
        title: "Read",
        description: "Read file",
        readOnly: true,
        inputSchema: { type: "object" },
        capabilities: ["t3.workspace/read-text"],
      },
    ],
  },
};
const context = {
  client: "web",
  resource: {
    namespace: "test.installed",
    id: "view",
    environmentId: EnvironmentId.make("env-a"),
    projectId: "project-a",
    threadId: "thread-a",
  },
};
function harness(environmentId = "env-a") {
  let catalog: readonly ExtensionInstallation[] = [installation];
  let host!: ClientHost;
  const stop = vi.fn();
  const register = vi.fn((_extension: Extension<SurfaceRenderer>) => stop);
  const snapshots: InstalledSnapshot[] = [];
  const options = {
    environmentId,
    React,
    list: vi.fn(async (_signal: AbortSignal) => ({ installations: catalog })),
    client: vi.fn(async (_id: string, hash: string, _signal: AbortSignal) => ({
      code: "fixture module",
      contentHash: hash,
    })),
    load: vi.fn<(code: string) => Promise<unknown>>(
      async (_code: string) => (bindings: ClientHost) => {
        host = bindings;
        return { manifest, surfaces: [] };
      },
    ),
    invoke: vi.fn(async () => ({ contents: "actual-shaped result" })),
    invokeApi: vi.fn(async () => ({ contents: "public API result" })),
    discoverApis: vi.fn(async () => []),
    register,
    changed: (snapshot: InstalledSnapshot) => snapshots.push(snapshot),
  };
  const controller = createInstalledExtensionController(options);
  return {
    controller,
    options,
    stop,
    register,
    snapshots,
    setCatalog: (value: readonly ExtensionInstallation[]) => {
      catalog = value;
    },
    getHost: () => host,
  };
}
describe("installed environment controller", () => {
  it("retains unchanged factories and unloads disabled/replaced/removed generations", async () => {
    const h = harness();
    await h.controller.refresh();
    await h.controller.refresh();
    expect(h.register).toHaveBeenCalledTimes(1);
    expect(h.options.client).toHaveBeenCalledTimes(1);
    const old = h.getHost();
    h.setCatalog([{ ...installation, contentHash: "b".repeat(64) }]);
    await h.controller.refresh();
    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(h.register).toHaveBeenCalledTimes(2);
    await expect(
      old.invokeTool("test.installed/read", {}, context, new AbortController().signal),
    ).rejects.toThrow("unavailable");
    h.setCatalog([{ ...installation, enabled: false }]);
    await h.controller.refresh();
    expect(h.stop).toHaveBeenCalledTimes(2);
    h.setCatalog([]);
    await h.controller.refresh();
    expect(h.snapshots.at(-1)?.installations).toHaveLength(0);
    h.controller.dispose();
  });
  it("binds tool calls to exact environment/project/hash and refuses post-removal result", async () => {
    const h = harness();
    await h.controller.refresh();
    const host = h.getHost();
    for (const resource of [
      { ...context.resource, environmentId: "env-b" },
      { ...context.resource, projectId: "project-b" },
    ])
      await expect(
        host.invokeTool(
          "test.installed/read",
          {},
          { ...context, resource },
          new AbortController().signal,
        ),
      ).rejects.toThrow("scope");
    await expect(
      host.invokeTool("other.installed/read", {}, context, new AbortController().signal),
    ).rejects.toThrow("scope");
    expect(h.options.invoke).not.toHaveBeenCalled();
    let finish!: (value: { contents: string }) => void;
    h.options.invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = host.invokeTool(
      "test.installed/read",
      { relativePath: "README.md" },
      context,
      new AbortController().signal,
    );
    h.setCatalog([]);
    await h.controller.refresh();
    finish({ contents: "late" });
    await expect(pending).rejects.toThrow("expired");
    h.controller.dispose();
  });
  it("ignores late catalogs and module imports after a newer refresh or disposal", async () => {
    const h = harness();
    let finish!: (value: unknown) => void;
    let started!: () => void;
    const loading = new Promise<void>((resolve) => {
      started = resolve;
    });
    h.options.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
          started();
        }),
    );
    const first = h.controller.refresh();
    await loading;
    h.setCatalog([]);
    await h.controller.refresh();
    finish(() => ({ manifest, surfaces: [] }));
    await first;
    expect(h.register).not.toHaveBeenCalled();
    h.setCatalog([installation]);
    h.options.client.mockImplementationOnce(async () => ({
      code: "x",
      contentHash: "c".repeat(64),
    }));
    await h.controller.refresh();
    expect(h.register).not.toHaveBeenCalled();
    expect(h.snapshots.at(-1)?.error).toContain("changed");
    h.controller.dispose();
  });
  it("does not unload an unrelated installed package when another client fails", async () => {
    const h = harness();
    await h.controller.refresh();
    const other = {
      ...installation,
      id: "test.other",
      package: { ...installation.package, manifest: { ...manifest, id: "test.other" }, tools: [] },
    };
    h.setCatalog([installation, other]);
    h.options.load.mockRejectedValueOnce(new Error("Broken module"));
    await h.controller.refresh();
    expect(h.stop).not.toHaveBeenCalled();
    expect(h.snapshots.at(-1)?.error).toContain("Broken module");
    h.controller.dispose();
    expect(h.stop).toHaveBeenCalledTimes(1);
  });
});

it("keeps the same package ID independent across environment hashes and tool contexts", async () => {
  const a = harness("env-a");
  const b = harness("env-b");
  b.setCatalog([{ ...installation, contentHash: "b".repeat(64) }]);
  try {
    await Promise.all([a.controller.refresh(), b.controller.refresh()]);
    const signal = new AbortController().signal;
    await a.getHost().invokeTool("test.installed/read", {}, context, signal);
    const other = { ...context, resource: { ...context.resource, environmentId: "env-b" } };
    await b.getHost().invokeTool("test.installed/read", {}, other, signal);
    expect(a.options.invoke).toHaveBeenCalledWith(
      "test.installed/read",
      {},
      context,
      "a".repeat(64),
      expect.any(AbortSignal),
    );
    expect(b.options.invoke).toHaveBeenCalledWith(
      "test.installed/read",
      {},
      other,
      "b".repeat(64),
      expect.any(AbortSignal),
    );
    a.controller.dispose();
    await b.getHost().invokeTool("test.installed/read", {}, other, signal);
    expect(b.stop).not.toHaveBeenCalled();
  } finally {
    a.controller.dispose();
    b.controller.dispose();
  }
});

it("does not register a module that finishes importing after connection disposal", async () => {
  const h = harness();
  let finish!: (value: unknown) => void;
  let started!: () => void;
  const loading = new Promise<void>((resolve) => {
    started = resolve;
  });
  h.options.load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
        started();
      }),
  );
  const refresh = h.controller.refresh();
  await loading;
  h.controller.dispose();
  finish(() => ({ manifest, surfaces: [] }));
  await refresh;
  expect(h.register).not.toHaveBeenCalled();
});

it("revokes a factory's captured tool binding when registration validation fails", async () => {
  const h = harness();
  let captured!: ClientHost;
  h.options.load.mockResolvedValueOnce((bindings: ClientHost) => {
    captured = bindings;
    return { manifest: { ...manifest, version: "2.0.0" }, surfaces: [] };
  });
  try {
    await h.controller.refresh();
    expect(h.register).not.toHaveBeenCalled();
    await expect(
      captured.invokeTool("test.installed/read", {}, context, new AbortController().signal),
    ).rejects.toThrow("unavailable");
    expect(h.options.invoke).not.toHaveBeenCalled();
  } finally {
    h.controller.dispose();
  }
});

it("owns pending HTTP cancellation on dispose and update even if the caller never aborts", async () => {
  for (const action of ["dispose", "update"]) {
    const h = harness();
    let delivered!: AbortSignal;
    const invoke = vi.fn(
      (_id: string, _input: unknown, _context: unknown, _hash: string, signal: AbortSignal) => {
        delivered = signal;
        return new Promise<never>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("HTTP cancelled")), {
            once: true,
          }),
        );
      },
    );
    const controller = createInstalledExtensionController({ ...h.options, invoke });
    try {
      await controller.refresh();
      const caller = new AbortController();
      const result = h
        .getHost()
        .invokeTool("test.installed/read", {}, context, caller.signal)
        .then(
          () => null,
          (error) => error,
        );
      if (action === "dispose") controller.dispose();
      else {
        h.setCatalog([{ ...installation, contentHash: "b".repeat(64) }]);
        await controller.refresh();
      }
      expect(caller.signal.aborted).toBe(false);
      expect(delivered.aborted).toBe(true);
      expect(await result).toMatchObject({ message: "HTTP cancelled" });
    } finally {
      controller.dispose();
      h.controller.dispose();
    }
  }
});

it("times out an async module and activates the next package without retaining a timer", async () => {
  vi.useFakeTimers();
  const h = harness();
  let started!: () => void;
  const loading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const other = {
    ...installation,
    id: "test.next",
    package: { ...installation.package, manifest: { ...manifest, id: "test.next" }, tools: [] },
  };
  h.setCatalog([installation, other]);
  h.options.load.mockImplementationOnce(() => {
    started();
    return new Promise(() => {});
  });
  h.options.load.mockResolvedValueOnce(() => ({
    manifest: { ...manifest, id: "test.next" },
    surfaces: [],
  }));
  const refresh = h.controller.refresh();
  try {
    await loading;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.snapshots.at(-1)?.loading).toBe(false);
    expect(h.snapshots.at(-1)?.error).toContain("timed out");
    expect(h.register).toHaveBeenCalledTimes(1);
    await refresh;
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    h.controller.dispose();
    vi.useRealTimers();
  }
});

it("binds public API identity to the installed package and rejects stale results after revocation", async () => {
  const h = harness();
  await h.controller.refresh();
  const request = {
    id: "t3.workspace/files",
    versionRange: "^1.0.0",
    method: "readText",
    input: { relativePath: "README.md" },
    context,
  };
  await h.getHost().invokeApi(request, new AbortController().signal);
  expect(h.options.invokeApi).toHaveBeenCalledWith(
    installation.id,
    installation.contentHash,
    request,
    expect.any(AbortSignal),
  );
  await expect(
    h.getHost().invokeApi(
      {
        ...request,
        context: { ...context, resource: { ...context.resource, projectId: "other" } },
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow("scope");
  let finish!: (value: { contents: string }) => void;
  h.options.invokeApi.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = h.getHost().invokeApi(request, new AbortController().signal);
  h.setCatalog([{ ...installation, enabled: false }]);
  await h.controller.refresh();
  finish({ contents: "stale" });
  await expect(pending).rejects.toThrow("expired");
  h.controller.dispose();
});

it("negotiates catalogue receipts only when the connected host explicitly advertises them", async () => {
  const h = harness();
  try {
    await h.controller.refresh();
    expect(h.snapshots.at(-1)?.supportsCatalogueChanges).toBe(false);
    h.options.list.mockImplementation(async () => ({
      installations: [installation],
      supportsCatalogueChanges: true,
    }));
    await h.controller.refresh();
    expect(h.snapshots.at(-1)?.supportsCatalogueChanges).toBe(true);
  } finally {
    h.controller.dispose();
  }
});

it("retains receipt negotiation after a transient list failure so the next receipt can recover", async () => {
  const h = harness();
  const receipts = createCatalogueRefreshQueue(() => h.controller.refresh());
  h.options.list.mockImplementation(async () => ({
    installations: [installation],
    supportsCatalogueChanges: true,
  }));
  try {
    await receipts.request();
    expect(h.snapshots.at(-1)?.supportsCatalogueChanges).toBe(true);
    h.options.list.mockRejectedValueOnce(new Error("Temporary HTTP failure"));
    await receipts.request();
    expect(h.snapshots.at(-1)?.error).toBe("Temporary HTTP failure");
    expect(h.snapshots.at(-1)?.supportsCatalogueChanges).toBe(true);
    await receipts.request();
    expect(h.snapshots.at(-1)?.error).toBeNull();
    expect(h.snapshots.at(-1)?.installations).toHaveLength(1);
    expect(h.snapshots.at(-1)?.supportsCatalogueChanges).toBe(true);
    expect(h.register).toHaveBeenCalledTimes(2);
    h.options.list.mockImplementation(async () => ({ installations: [installation] }));
    await receipts.request();
    expect(h.snapshots.at(-1)?.supportsCatalogueChanges).toBe(false);
  } finally {
    receipts.dispose();
    h.controller.dispose();
  }
});
