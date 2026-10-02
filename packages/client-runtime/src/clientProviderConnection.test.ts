import { describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  type ClientProviderEmitEvent,
  type ClientProviderServerFrame,
} from "@t3tools/contracts";
import {
  ClientProviderOpError,
  createClientProviderConnectionHint,
  createClientProviderSession,
  stampClientProviderRequest,
  type ClientLocalProvider,
} from "./clientProviderConnection.js";

function deferred<A>() {
  let resolve!: (value: A) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<A>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const signal = () => new AbortController().signal;
const caller = { installationId: "pack", contentHash: "a".repeat(64), installationGeneration: 1 };
const context = {
  client: "mobile",
  resource: { namespace: "t3.thread", id: "t", environmentId: EnvironmentId.make("e") },
};
const registered = {
  type: "registered",
  connectionId: "own-socket",
  accepted: [{ id: "t3.client/theme", version: "1.0.0" }],
  rejected: [],
} as const;
const invoke: ClientProviderServerFrame = {
  type: "invoke",
  requestId: "r",
  apiId: "t3.client/theme",
  method: "getState",
  input: {},
  caller,
  context,
  deadlineMs: 10_000,
};
const open: ClientProviderServerFrame = {
  type: "subscriptionOpen",
  subscriptionId: "s",
  apiId: "t3.client/theme",
  name: "watchState",
  input: {},
  caller,
  context,
};
function fixture(provider?: ClientLocalProvider) {
  const respond = vi.fn();
  const emit = vi.fn();
  const disposed = vi.fn();
  const session = createClientProviderSession({
    providers: new Map(provider ? [["t3.client/theme", provider]] : []),
    respond,
    emit,
    disposed,
  });
  return { session, respond, emit, disposed };
}

describe("registration receipts and outbound hints", () => {
  it("sends unstamped immediately without a registration attempt", async () => {
    const hint = createClientProviderConnectionHint(() => ({ connecting: false }));
    await expect(hint.connectionId(signal())).resolves.toBeUndefined();
    expect(
      stampClientProviderRequest(
        { clientConnectionId: "page-supplied", input: { value: 1 } },
        undefined,
      ),
    ).toEqual({ input: { value: 1 } });
  });

  it("waits for its own registration and replaces the page hint without modifying the request", async () => {
    const state = { connecting: true, connectionId: undefined as string | undefined };
    const hint = createClientProviderConnectionHint(() => state);
    const request = { clientConnectionId: "foreign", method: "write" };
    const stamped = hint.stamp(request, signal());
    state.connectionId = "own-socket";
    hint.changed();
    await expect(stamped).resolves.toEqual({ method: "write", clientConnectionId: "own-socket" });
    expect(request.clientConnectionId).toBe("foreign");
  });

  it("ignores an unrelated session's receipt", async () => {
    const ids = new Map<object, string>();
    const own = {};
    const foreign = {};
    const hint = createClientProviderConnectionHint<object>((key) => ({
      connecting: true,
      connectionId: key ? ids.get(key) : undefined,
    }));
    const waiting = hint.connectionId(signal(), 10_000, own);
    ids.set(foreign, "foreign");
    hint.changed();
    ids.set(own, "owned");
    hint.changed();
    await expect(waiting).resolves.toBe("owned");
  });

  it("releases held calls after connect ends and leaves later calls unstamped", async () => {
    let connecting = true;
    const hint = createClientProviderConnectionHint(() => ({ connecting }));
    const waiting = hint.connectionId(signal());
    connecting = false;
    hint.changed();
    await expect(waiting).resolves.toBeUndefined();
    await expect(hint.connectionId(signal())).resolves.toBeUndefined();
  });

  it("sends unstamped after one bound without replaying a call", async () => {
    vi.useFakeTimers();
    try {
      const hint = createClientProviderConnectionHint(() => ({ connecting: true }));
      const waiting = hint.stamp({ clientConnectionId: "foreign", method: "read" }, signal());
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(waiting).resolves.toEqual({ method: "read" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([false, true])(
    "rejects abort rather than sending a call (already aborted: %s)",
    async (already) => {
      const hint = createClientProviderConnectionHint(() => ({ connecting: true }));
      const controller = new AbortController();
      if (already) controller.abort();
      const waiting = hint.connectionId(controller.signal);
      controller.abort();
      await expect(waiting).rejects.toThrow("cancelled");
    },
  );
});

describe("one session's invoke and stream envelopes", () => {
  it("responds once, preserves the authorized caller, and cancels pending work", async () => {
    const finish = deferred<null>();
    let observed!: AbortSignal;
    const f = fixture({
      invoke: (call) => {
        expect(call.caller).toEqual(caller);
        expect(call.context).toEqual(context);
        observed = call.signal;
        return finish.promise;
      },
    });
    const running = f.session.receive(invoke);
    await f.session.receive({ type: "cancel", requestId: "r" });
    expect(observed.aborted).toBe(true);
    finish.resolve(null);
    await running;
    expect(f.respond).not.toHaveBeenCalled();
    f.session.dispose();
  });

  it("preserves successful values and normal stream events", async () => {
    const close = vi.fn();
    const f = fixture({
      invoke: () => ({ state: "ready" }),
      openStream: (call) => {
        call.emit({ type: "snapshot", value: { state: "ready" } });
        return close;
      },
    });
    await f.session.receive(invoke);
    expect(f.respond).toHaveBeenCalledExactlyOnceWith({
      requestId: "r",
      ok: true,
      value: { state: "ready" },
    });
    await f.session.receive(open);
    expect(f.emit).toHaveBeenCalledWith("s", { type: "snapshot", value: { state: "ready" } });
    await f.session.receive({ type: "subscriptionClose", subscriptionId: "s" });
    expect(close).toHaveBeenCalledOnce();
    f.session.dispose();
  });

  it.each(["success", "failure"])("suppresses late invoke %s after disposal", async (outcome) => {
    const finish = deferred<null>();
    const f = fixture({ invoke: () => finish.promise });
    const running = f.session.receive(invoke);
    f.session.dispose();
    if (outcome === "success") finish.resolve(null);
    else finish.reject(new Error("private bridge error"));
    await running;
    expect(f.respond).not.toHaveBeenCalled();
  });

  it.each(["close", "dispose", "replace"])(
    "cleans a late stream open after %s and suppresses its events",
    async (action) => {
      const finish = deferred<() => void>();
      const close = vi.fn();
      let emit!: (event: ClientProviderEmitEvent) => void;
      const f = fixture({
        invoke: () => null,
        openStream: (call) => {
          emit = call.emit;
          return finish.promise;
        },
      });
      const opening = f.session.receive(open);
      const oldEmit = emit;
      if (action === "dispose") f.session.dispose();
      else if (action === "close")
        await f.session.receive({ type: "subscriptionClose", subscriptionId: "s" });
      else {
        const replacement = f.session.receive(open);
        finish.resolve(close);
        await replacement;
      }
      oldEmit({ type: "data", value: "late" });
      finish.resolve(close);
      await opening;
      expect(close).toHaveBeenCalledOnce();
      expect(f.emit).not.toHaveBeenCalled();
      f.session.dispose();
    },
  );

  it.each(["ordinary", "named"])(
    "names stream errors and only forwards %s error text under the provider rule",
    async (kind) => {
      const error =
        kind === "named"
          ? new ClientProviderOpError("client-target-denied", "Missing grant")
          : new Error("private bridge details");
      const f = fixture({
        invoke: () => {
          throw error;
        },
        openStream: () => {
          throw error;
        },
      });
      await f.session.receive(invoke);
      expect(f.respond).toHaveBeenCalledWith({
        requestId: "r",
        ok: false,
        error:
          kind === "named"
            ? { code: "client-target-denied", message: "Missing grant" }
            : { code: "provider-rejected", message: "Provider failed" },
      });
      await f.session.receive(open);
      expect(f.emit).toHaveBeenCalledWith("s", {
        type: "closed",
        value: null,
        error:
          kind === "named"
            ? { code: "client-target-denied", message: "Missing grant" }
            : { code: "client-provider-unavailable", message: "Provider stream is unavailable" },
      });
      f.session.dispose();
    },
  );

  it.each([undefined, { invoke: () => null }])(
    "names unavailable stream opens",
    async (provider) => {
      const f = fixture(provider);
      await f.session.receive(open);
      expect(f.emit).toHaveBeenCalledWith("s", {
        type: "closed",
        value: null,
        error: { code: "client-provider-unavailable", message: "Provider stream is unavailable" },
      });
      f.session.dispose();
    },
  );

  it("bounds deliberate provider error messages", async () => {
    const f = fixture({
      invoke: () => {
        throw new ClientProviderOpError("provider-rejected", "x".repeat(2100));
      },
    });
    await f.session.receive(invoke);
    expect(f.respond.mock.calls[0]?.[0].error.message).toBe("x".repeat(2000));
    f.session.dispose();
  });

  it("releases registration waiters, aborts calls and closes all watchers even when one throws", async () => {
    const close = vi.fn(() => {
      throw new Error("watcher cleanup");
    });
    const f = fixture({ invoke: () => null, openStream: () => close });
    const waiting = f.session.connectionId(signal());
    await f.session.receive({ ...open, subscriptionId: "a" });
    await f.session.receive({ ...open, subscriptionId: "b" });
    f.session.dispose();
    f.session.dispose();
    await expect(waiting).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(2);
    expect(f.disposed).toHaveBeenCalledOnce();
    await f.session.receive(registered);
    await expect(f.session.connectionId(signal())).resolves.toBeUndefined();
  });
});
