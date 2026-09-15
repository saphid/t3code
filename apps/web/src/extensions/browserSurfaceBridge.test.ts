import { describe, it, expect } from "vite-plus/test";
import { BROWSER_SESSIONS, BROWSER_SURFACE } from "@t3tools/extension-sdk/catalogue";

import type { BrowserSurfacePresentation } from "~/browser/browserSurfaceStore";

import {
  createBrowserSurfaceBridge,
  type BrowserSurfaceBridgeDeps,
  type BrowserSurfaceBinding,
} from "./browserSurfaceBridge";

const context = {
  client: "web",
  resource: {
    namespace: "test.plugin",
    id: "view",
    environmentId: "env-a",
    projectId: "project-a",
    threadId: "thread-a",
  },
};
const sessionRef = { tabId: "tab-1", serverEpoch: "epoch-1" };

interface NativeLease {
  presents: {
    rect: unknown;
    visible: boolean;
    cornerRadius: number | undefined;
    zIndex: number | undefined;
  }[];
  released: boolean;
  stolenFlag: boolean;
  present(rect: unknown, visible: boolean, cornerRadius?: number, zIndex?: number): boolean;
  release(): void;
  stolen(): void;
}

function harness({ composites = true }: { composites?: boolean } = {}) {
  let previewState = {
    serverEpoch: "epoch-1" as string | null,
    sessions: { "tab-1": {} } as Record<string, unknown>,
  };
  const sessionListeners = new Set<() => void>();
  const storeListeners = new Set<
    (state: { readonly byTabId: Readonly<Record<string, BrowserSurfacePresentation>> }) => void
  >();
  const scheduled = new Set<() => void>();
  const syncMounts: string[] = [];
  const syncUnmounts: string[] = [];
  const nativeLeases: NativeLease[] = [];
  const nativeOwner = Symbol("native-owner");

  const deps: BrowserSurfaceBridgeDeps = {
    composites: () => composites,
    schedule: (flush) => {
      scheduled.add(flush);
      return () => scheduled.delete(flush);
    },
    mountSessionSync: (threadRef) => {
      const key = `${threadRef.environmentId}/${threadRef.threadId}`;
      syncMounts.push(key);
      return () => syncUnmounts.push(key);
    },
    readSessions: () => previewState as never,
    subscribeSessions: (_threadRef, listener) => {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    acquireNative: (_runtimeTabId) => {
      const lease: NativeLease = {
        presents: [],
        released: false,
        stolenFlag: false,
        present(rect, visible, cornerRadius, zIndex) {
          if (lease.released || lease.stolenFlag) return false;
          lease.presents.push({ rect, visible, cornerRadius, zIndex });
          return true;
        },
        release() {
          lease.released = true;
        },
        stolen() {
          lease.stolenFlag = true;
          for (const listener of storeListeners)
            listener({
              byTabId: {
                anything: { owner: Symbol("other") } as unknown as BrowserSurfacePresentation,
              },
            });
        },
      };
      nativeLeases.push(lease);
      return lease;
    },
    ownerOf: () => nativeOwner,
    subscribeStore: (listener) => {
      storeListeners.add(listener);
      return () => storeListeners.delete(listener);
    },
  };
  const lifetime = new AbortController();
  const bind = createBrowserSurfaceBridge("env-a", deps);
  const host = (overrides: Partial<BrowserSurfaceBinding["grants"]> = {}) =>
    bind({
      grants: {
        capabilities: [BROWSER_SESSIONS, BROWSER_SURFACE],
        projectIds: ["project-a"],
        ...overrides,
      },
      lifetime: lifetime.signal,
    });
  return {
    host,
    lifetime,
    deps,
    scheduled,
    flush: () => {
      const pending = Array.from(scheduled);
      scheduled.clear();
      for (const flush of pending) flush();
    },
    fireSessions: () => {
      for (const listener of sessionListeners) listener();
    },
    setPreviewState: (next: typeof previewState) => {
      previewState = next;
    },
    getPreviewState: () => previewState,
    sessionListeners,
    storeListeners,
    nativeLeases,
    syncMounts,
    syncUnmounts,
  };
}

describe("browserSurfaceBridge", () => {
  it("denies by name when a required grant is missing", () => {
    const h = harness();
    const noSurface = h.host({ capabilities: [BROWSER_SESSIONS] });
    const denied = noSurface.acquire({ context, session: sessionRef });
    expect(denied.ok).toBe(false);
    if (denied.ok) throw new Error("expected denial");
    expect(denied.denial.reason).toBe("grant-denied");
    expect(denied.denial.grant).toBe(BROWSER_SURFACE);

    const noSessions = h.host({ capabilities: [BROWSER_SURFACE] });
    const denied2 = noSessions.acquire({ context, session: sessionRef });
    expect(denied2.ok).toBe(false);
    if (denied2.ok) throw new Error("expected denial");
    expect(denied2.denial.grant).toBe(BROWSER_SESSIONS);
  });

  it("denies scopes outside this environment, non-thread scopes, and ungranted projects", () => {
    const h = harness();
    const host = h.host();
    const wrongEnv = host.acquire({
      context: { ...context, resource: { ...context.resource, environmentId: "env-b" } },
      session: sessionRef,
    });
    expect(wrongEnv.ok).toBe(false);
    if (!wrongEnv.ok) expect(wrongEnv.denial.reason).toBe("scope-invalid");

    const { threadId: _dropped, ...resourceWithoutThread } = context.resource;
    const noThread = host.acquire({
      context: { ...context, resource: resourceWithoutThread },
      session: sessionRef,
    });
    expect(noThread.ok).toBe(false);
    if (!noThread.ok) expect(noThread.denial.reason).toBe("scope-invalid");

    const otherProject = h.host({ projectIds: ["project-b"] });
    const denied = otherProject.acquire({ context, session: sessionRef });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.denial.reason).toBe("scope-invalid");
  });

  it("denies malformed session identity and stale epochs by name", () => {
    const h = harness();
    const host = h.host();
    const malformed = host.acquire({ context, session: { tabId: "", serverEpoch: "e" } });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.denial.reason).toBe("session-invalid");

    h.setPreviewState({ serverEpoch: "epoch-2", sessions: {} });
    const stale = host.acquire({ context, session: sessionRef });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.denial.reason).toBe("epoch-changed");
  });

  it("coalesces present calls into one latest-wins native write per frame", () => {
    const h = harness();
    const host = h.host();
    const acquired = host.acquire({ context, session: sessionRef });
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    const lease = acquired.lease;
    expect(lease.state).toEqual({ kind: "active", presentation: { supported: true } });

    expect(lease.present({ x: 0, y: 0, width: 10, height: 10 }, true)).toBe("accepted");
    expect(lease.present({ x: 5, y: 5, width: 20, height: 20 }, false, 4, 7)).toBe("accepted");
    expect(h.nativeLeases[0]?.presents).toEqual([]);
    h.flush();
    expect(h.nativeLeases[0]?.presents).toEqual([
      { rect: { x: 5, y: 5, width: 20, height: 20 }, visible: false, cornerRadius: 4, zIndex: 7 },
    ]);
  });

  it("keeps preview sync mounted for the lease lifetime and releases on release()", () => {
    const h = harness();
    const acquired = h.host().acquire({ context, session: sessionRef });
    expect(h.syncMounts).toEqual(["env-a/thread-a"]);
    if (!acquired.ok) return;
    const states: string[] = [];
    acquired.lease.onDidChangeState((state) => states.push(state.kind));
    acquired.lease.release();
    acquired.lease.release();
    expect(acquired.lease.state).toEqual({ kind: "ended", reason: "released" });
    expect(states).toEqual(["ended"]);
    expect(h.nativeLeases[0]?.released).toBe(true);
    expect(h.syncUnmounts).toEqual(["env-a/thread-a"]);
    expect(acquired.lease.present({ x: 0, y: 0, width: 1, height: 1 }, true)).toBe("ended");
  });

  it("supersedes a prior plugin lease on the same session", () => {
    const h = harness();
    const first = h.host().acquire({ context, session: sessionRef });
    const second = h.host().acquire({ context, session: sessionRef });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.lease.state).toEqual({ kind: "ended", reason: "superseded" });
    expect(second.lease.state).toEqual({ kind: "active", presentation: { supported: true } });
    // The native lease stolen by the second acquire is also released.
    expect(h.nativeLeases[0]?.released).toBe(true);
  });

  it("ends the lease when the session disappears or the epoch moves", () => {
    const h = harness();
    const acquired = h.host().acquire({ context, session: sessionRef });
    if (!acquired.ok) throw new Error("expected lease");
    h.setPreviewState({ serverEpoch: "epoch-1", sessions: {} });
    h.fireSessions();
    expect(acquired.lease.state).toEqual({ kind: "ended", reason: "session-closed" });

    h.setPreviewState({ serverEpoch: "epoch-1", sessions: { "tab-1": {} } });
    const again = h.host().acquire({ context, session: sessionRef });
    if (!again.ok) throw new Error("expected lease");
    h.setPreviewState({ serverEpoch: "epoch-2", sessions: { "tab-1": {} } });
    h.fireSessions();
    expect(again.lease.state).toEqual({ kind: "ended", reason: "epoch-changed" });
  });

  it("ends the lease when the view signal aborts or the install lifetime ends", () => {
    const h = harness();
    const view = new AbortController();
    const acquired = h.host().acquire({ context, session: sessionRef, signal: view.signal });
    if (!acquired.ok) throw new Error("expected lease");
    view.abort();
    expect(acquired.lease.state).toEqual({ kind: "ended", reason: "scope-invalidated" });
    expect(h.nativeLeases[0]?.released).toBe(true);

    const second = h.host().acquire({ context, session: sessionRef });
    if (!second.ok) throw new Error("expected lease");
    h.lifetime.abort();
    expect(second.lease.state).toEqual({ kind: "ended", reason: "grant-revoked" });
    // And new acquires fail once the install lifetime is over.
    const third = h.host().acquire({ context, session: sessionRef });
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.denial.reason).toBe("host-unavailable");
  });

  it("ends the lease when the native owner is stolen outside the bridge", () => {
    const h = harness();
    const acquired = h.host().acquire({ context, session: sessionRef });
    if (!acquired.ok) throw new Error("expected lease");
    h.nativeLeases[0]?.stolen();
    expect(acquired.lease.state).toEqual({ kind: "ended", reason: "superseded" });
  });

  it("reports the named uncomposited state on non-compositing clients", () => {
    const h = harness({ composites: false });
    const host = h.host();
    expect(host.presentation).toEqual({ supported: false, reason: "desktop-required" });
    const acquired = host.acquire({ context, session: sessionRef });
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    expect(acquired.lease.state).toEqual({
      kind: "active",
      presentation: { supported: false, reason: "desktop-required" },
    });
    expect(acquired.lease.present({ x: 0, y: 0, width: 10, height: 10 }, true)).toBe(
      "uncomposited",
    );
    // Still mounts sync so the session stays alive; never touches the native store.
    expect(h.nativeLeases).toEqual([]);
    expect(h.syncMounts).toEqual(["env-a/thread-a"]);
  });
});
