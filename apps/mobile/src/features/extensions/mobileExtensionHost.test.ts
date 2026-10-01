import { describe, expect, it, vi } from "vite-plus/test";
import { createMobileExtensionHost, MobileExtensionCache } from "./mobileExtensionHost";
import { sha256 } from "@noble/hashes/sha2";
import { createNativeBridge, createPageBridge } from "./mobileExtensionBridge";
import type { MobileExtensionTransport } from "./mobileExtensionHost";
const context = {
  resource: { namespace: "t3.thread", id: "t", environmentId: "e", projectId: "p", threadId: "t" },
  client: "mobile",
};
const installation = (hash = "a".repeat(64)) => ({
  id: "t3.pack",
  enabled: true,
  contentHash: hash,
  grants: { capabilities: ["t3.test/read"], projectIds: ["p"] },
  package: {
    format: 4,
    clientEntry: "client.mjs",
    manifest: {
      id: "t3.pack",
      apiVersion: 1,
      version: "1.0.0",
      surfaces: [
        {
          id: "t3.pack/view",
          title: "Pack",
          scope: "thread",
          placements: ["side-panel"],
          clients: ["mobile"],
          stateVersion: 1,
          capabilities: ["t3.test/read"],
        },
      ],
    },
    tools: [],
    dependencies: [],
    provides: [],
    requires: [],
    assets: [] as { path: string; byteLength: number; sha256: string; mediaType: string }[],
  },
});
function fixture() {
  let item = installation();
  let changed = () => {};
  const transport: MobileExtensionTransport = {
    list: async () => [item],
    client: vi.fn(async () => ({ code: "installed code" })),
    asset: vi.fn(async () => new Uint8Array()),
    invokeApi: vi.fn(async () => null),
    subscribeApi: async function* () {
      yield { type: "snapshot", streamId: "s", sequence: 1, value: null };
    },
    discoverApis: async () => [],
    invokeTool: vi.fn(async () => null),
    watch: (callback) => {
      changed = callback;
      return () => {
        changed = () => {};
      };
    },
  };
  let notified = () => {};
  const host = createMobileExtensionHost({
    environmentId: "e",
    installationId: "t3.pack",
    surfaceId: "t3.pack/view",
    context,
    cache: new MobileExtensionCache(),
    transport,
    onChange: () => {
      if (host.snapshot().phase !== "loading") notified();
    },
  });
  const wait = () =>
    new Promise<void>((resolve) => {
      notified = resolve;
    });
  return {
    host,
    transport,
    set: (value: typeof item) => {
      item = value;
    },
    change: () => changed(),
    wait,
  };
}
describe("production mobile installation lifecycle", () => {
  it("loads installed code and reuses it after WebView eviction", async () => {
    const f = fixture();
    await f.host.refresh();
    const first = f.host.snapshot();
    await f.host.recover();
    expect(f.transport.client).toHaveBeenCalledTimes(1);
    expect(f.host.snapshot().generation).not.toBe(first.generation);
    f.host.dispose();
  });
  it("fences calls synchronously on revocation and closes the old lifetime", async () => {
    const f = fixture();
    await f.host.refresh();
    const old = f.host.snapshot();
    f.set({ ...installation(), enabled: false });
    const done = f.wait();
    f.change();
    expect(old.signal?.aborted).toBe(true);
    await done;
    expect(f.host.snapshot().phase).toBe("unavailable");
    await expect(f.host.invoke("discover", {}, new AbortController().signal)).rejects.toThrow();
    f.host.dispose();
  });
  it("fetches the changed hash without reusing old code or grants", async () => {
    const f = fixture();
    await f.host.refresh();
    const old = f.host.snapshot();
    f.set(installation("b".repeat(64)));
    await f.host.refresh();
    expect(old.signal?.aborted).toBe(true);
    expect(f.transport.client).toHaveBeenCalledTimes(2);
    expect(f.host.snapshot().installation?.contentHash).toBe("b".repeat(64));
    f.host.dispose();
  });
  it("background suspension drops work, foreground validates before restoring cached code", async () => {
    const f = fixture();
    await f.host.refresh();
    const old = f.host.snapshot();
    f.host.setActive(false);
    expect(old.signal?.aborted).toBe(true);
    expect(f.host.snapshot().phase).toBe("suspended");
    const done = f.wait();
    f.host.setActive(true);
    await done;
    expect(f.host.snapshot().phase).toBe("ready");
    expect(f.transport.client).toHaveBeenCalledTimes(1);
    f.host.dispose();
  });
  it("refuses missing project grants and prevents disposal races from publishing", async () => {
    const f = fixture();
    f.set({ ...installation(), grants: { capabilities: ["t3.test/read"], projectIds: [] } });
    await f.host.refresh();
    expect(f.host.snapshot().phase).toBe("unavailable");
    f.host.dispose();
    await f.host.refresh();
    expect(f.host.snapshot().phase).toBe("disposed");
  });
  it("cache separates environments/installations/hashes, evicts to a byte bound", () => {
    const cache = new MobileExtensionCache(8);
    cache.set(["e", "a", "h", "code"], "1234", 8);
    cache.set(["e", "b", "h", "code"], "56", 4);
    expect(cache.get(["e", "a", "h", "code"])).toBeUndefined();
    expect(cache.get(["e", "b", "h", "code"])).toBe("56");
    expect(cache.get(["x", "b", "h", "code"])).toBeUndefined();
    cache.invalidate("e", "b");
    expect(cache.get(["e", "b", "h", "code"])).toBeUndefined();
  });
});

it("chunks and verifies declared assets once per hash, rejects undeclared or corrupt bytes", async () => {
  const f = fixture();
  const bytes = new Uint8Array(65536).fill(97);
  const item = installation();
  const digest = Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  item.package.assets = [
    {
      path: "asset.bin",
      byteLength: bytes.length,
      sha256: digest,
      mediaType: "application/octet-stream",
    },
  ];
  f.set(item);
  f.transport.asset = vi.fn(async () => bytes);
  await f.host.refresh();
  expect(f.host.snapshot().phase).toBe("ready");
  const signal = new AbortController().signal;
  const a = (await f.host.invoke("asset", { path: "asset.bin", offset: 0 }, signal)) as {
    bytes: number[];
  };
  const b = (await f.host.invoke("asset", { path: "asset.bin", offset: 32768 }, signal)) as {
    bytes: number[];
  };
  expect(a.bytes).toHaveLength(32768);
  expect(b.bytes).toHaveLength(32768);
  expect(f.transport.asset).toHaveBeenCalledTimes(1);
  await expect(f.host.invoke("asset", { path: "other", offset: 0 }, signal)).rejects.toThrow();
  const changed = { ...item, contentHash: "b".repeat(64) };
  f.set(changed);
  f.transport.asset = vi.fn(async () => bytes.subarray(1));
  await f.host.refresh();
  await expect(f.host.invoke("asset", { path: "asset.bin", offset: 0 }, signal)).rejects.toThrow(
    "verification",
  );
  f.host.dispose();
});
it("revoking a surface capability removes the running surface", async () => {
  const f = fixture();
  await f.host.refresh();
  const old = f.host.snapshot();
  f.set({ ...installation(), grants: { capabilities: [], projectIds: ["p"] } });
  await f.host.refresh();
  expect(old.signal?.aborted).toBe(true);
  expect(f.host.snapshot().phase).toBe("unavailable");
  f.host.dispose();
});
it("does not commit a stale bundle response after replacement or disposal", async () => {
  const f = fixture();
  let resolve: (value: { code: string }) => void = () => {};
  f.transport.client = () =>
    new Promise((done) => {
      resolve = done;
    });
  const first = f.host.refresh();
  await Promise.resolve();
  f.set(installation("b".repeat(64)));
  f.transport.client = async () => ({ code: "new code" });
  await f.host.refresh();
  resolve({ code: "stale code" });
  await first;
  expect(f.host.snapshot().code).toBe("new code");
  f.host.dispose();
});
it("holds a slow consumer to one frame and resumes with a new snapshot through the host", async () => {
  const f = fixture();
  let pulls = 0;
  f.transport.subscribeResumableApi = async function* () {
    pulls++;
    yield { type: "snapshot", streamId: "first", sequence: 1, value: null };
    pulls++;
    yield null;
    pulls++;
    yield { type: "snapshot", streamId: "second", sequence: 1, value: null };
  };
  await f.host.refresh();
  const native = createNativeBridge({
    generation: "test",
    send: (message) => {
      page.receive(message);
    },
    invoke: f.host.invoke,
    subscribe: f.host.subscribe,
  });
  const page = createPageBridge({
    generation: "test",
    send: (message) => {
      native.receive(message);
    },
  });
  const signal = new AbortController();
  const request = {
    id: "t3.terminal/sessions",
    versionRange: "^1.0.0",
    name: "list",
    input: {},
    context,
  };
  const iterator = page.subscribe({ request, resumable: true }, signal.signal);
  expect((await iterator.next()).value).toMatchObject({ streamId: "first", sequence: 1 });
  expect(pulls).toBe(1);
  expect((await iterator.next()).value).toBeNull();
  expect(pulls).toBe(2);
  expect((await iterator.next()).value).toMatchObject({ streamId: "second", sequence: 1 });
  expect(pulls).toBe(3);
  signal.abort();
  await iterator.return(undefined);
  page.dispose();
  native.dispose();
  f.host.dispose();
});

it("fences a failed page and revalidates before reopening cached code", async () => {
  const f = fixture();
  await f.host.refresh();
  const old = f.host.snapshot();
  f.host.fail();
  expect(old.signal?.aborted).toBe(true);
  expect(f.host.snapshot().phase).toBe("offline");
  await f.host.recover();
  expect(f.host.snapshot().phase).toBe("ready");
  expect(f.transport.client).toHaveBeenCalledTimes(1);
  f.host.dispose();
});
