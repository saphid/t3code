import type { PreviewListResult, ScopedThreadRef } from "@t3tools/contracts";
import {
  BROWSER_SESSIONS,
  BROWSER_SURFACE,
  type BrowserSurfaceLease,
} from "@t3tools/extension-sdk/catalogue";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { createBrowserSurfaceBridge } from "~/extensions/browserSurfaceBridge";
import { readThreadPreviewState } from "~/previewStateStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";

// The preview transport is the only substituted seam: the sync atom, the
// preview state store and the surface bridge all run their real code. List
// atoms are writable so the test can replay the exact AsyncResult sequence a
// real query emits — a `waiting` copy of the previous Success while the
// request is in flight, then the completed response.
type ListAtom = Atom.Writable<
  AsyncResult.AsyncResult<PreviewListResult, never>,
  AsyncResult.AsyncResult<PreviewListResult, never>
>;

const previewHarness = vi.hoisted(() => ({
  lists: new Map<
    string,
    { box: { current: AsyncResult.AsyncResult<PreviewListResult, never> }; atom: ListAtom }
  >(),
}));

vi.mock("~/state/preview", async () => {
  const effectReactivity = await import("effect/unstable/reactivity");
  const list = (target: { environmentId: string; input: { threadId: string } }) => {
    const threadId = target.input.threadId;
    let entry = previewHarness.lists.get(threadId);
    if (entry === undefined) {
      const box = {
        current: effectReactivity.AsyncResult.initial<PreviewListResult, never>(),
      };
      const atom = effectReactivity.Atom.writable(
        () => box.current,
        (
          ctx: { setSelf: (value: AsyncResult.AsyncResult<PreviewListResult, never>) => void },
          value: AsyncResult.AsyncResult<PreviewListResult, never>,
        ) => ctx.setSelf(value),
      );
      entry = { box, atom };
      previewHarness.lists.set(threadId, entry);
    }
    return entry.atom;
  };
  const events = () => effectReactivity.Atom.make(effectReactivity.AsyncResult.initial());
  return { previewEnvironment: { list, events } };
});

const { previewEnvironment } = await import("~/state/preview");

const threadRef = {
  environmentId: "env-sync",
  threadId: "thread-sync",
} as unknown as ScopedThreadRef;

const listAtom = (): ListAtom =>
  previewEnvironment.list({
    environmentId: "env-sync",
    input: { threadId: "thread-sync" },
  } as never) as ListAtom;

const listResult = (revision: number, tabIds: string[]): PreviewListResult => ({
  serverEpoch: "epoch-1",
  revision,
  sessions: tabIds.map(
    (tabId) =>
      ({
        threadId: "thread-sync",
        tabId,
        navStatus: { _tag: "Idle" },
        canGoBack: false,
        canGoForward: false,
        updatedAt: "2026-09-16T00:00:00.000Z",
      }) as PreviewListResult["sessions"][number],
  ),
});

function bridgeHost() {
  const lifetime = new AbortController();
  const bind = createBrowserSurfaceBridge("env-sync", {
    composites: () => true,
    schedule: (flush) => {
      flush();
      return () => {};
    },
    acquireNative: () => ({
      present: () => true,
      release: () => {},
    }),
    ownerOf: () => null,
    subscribeStore: () => () => {},
    resolveThreadScope: () => ({ projectId: "project-a", authoritative: true }),
    subscribeThread: () => () => {},
    // mountSessionSync / readSessions / subscribeSessions / refreshSessions
    // stay at production defaults: the real sync atom + real store.
  });
  const host = bind({
    grants: {
      capabilities: [BROWSER_SESSIONS, BROWSER_SURFACE],
      projectIds: ["project-a"],
    },
    lifetime: lifetime.signal,
  });
  const acquire = () =>
    host.acquire({
      context: {
        client: "web",
        resource: {
          namespace: "test.plugin",
          id: "view",
          environmentId: "env-sync",
          projectId: "project-a",
          threadId: "thread-sync",
        },
      },
      session: { tabId: "tab-new", serverEpoch: "epoch-1" },
    });
  return { acquire, lifetime };
}

describe("previewSessionSync arbitration", () => {
  it("does not treat a refresh's waiting replay as a completed list", async () => {
    // Warm-synced state: a completed authoritative list already applied and
    // the requested tab is absent from it.
    appAtomRegistry.set(listAtom(), AsyncResult.success(listResult(1, []), { timestamp: 1 }));
    const { acquire } = bridgeHost();
    const acquired = acquire();
    if (!acquired.ok) throw new Error("expected lease");
    const lease: BrowserSurfaceLease = acquired.lease;
    const baseline = readThreadPreviewState(threadRef).listSeq;
    expect(baseline).toBe(1);
    expect(lease.state.kind).toBe("active");
    await Promise.resolve();

    // The bridge's forced refresh replays the previous Success with
    // waiting:true while the request is in flight — replayed data is not
    // authority for absence, so the lease must survive.
    appAtomRegistry.set(
      listAtom(),
      AsyncResult.success(listResult(1, []), { waiting: true, timestamp: 1 }),
    );
    expect(readThreadPreviewState(threadRef).listSeq).toBe(1);
    expect(lease.state.kind).toBe("active");

    // The completed response is the arbitrating answer: absent → closed.
    appAtomRegistry.set(listAtom(), AsyncResult.success(listResult(2, []), { timestamp: 2 }));
    expect(readThreadPreviewState(threadRef).listSeq).toBe(2);
    expect(lease.state).toEqual({ kind: "ended", reason: "session-closed" });
  });

  it("keeps the lease when the arbitrating list contains the tab", async () => {
    appAtomRegistry.set(listAtom(), AsyncResult.success(listResult(3, []), { timestamp: 3 }));
    const { acquire } = bridgeHost();
    const acquired = acquire();
    if (!acquired.ok) throw new Error("expected lease");
    const lease = acquired.lease;
    await Promise.resolve();

    appAtomRegistry.set(
      listAtom(),
      AsyncResult.success(listResult(3, []), { waiting: true, timestamp: 3 }),
    );
    expect(lease.state.kind).toBe("active");
    appAtomRegistry.set(
      listAtom(),
      AsyncResult.success(listResult(4, ["tab-new"]), { timestamp: 4 }),
    );
    expect(lease.state.kind).toBe("active");
    expect(readThreadPreviewState(threadRef).sessions["tab-new"]).toBeDefined();
    lease.release();
  });
});
