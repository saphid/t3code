import { describe, expect, it } from "vite-plus/test";
import { createNativeBridge, createPageBridge } from "./mobileExtensionBridge";

const request = {
  id: "t3.orchestration/status",
  versionRange: "^1.0.0",
  name: "subscribeAgents",
  input: {},
  context: { projectId: "project", threadId: "thread", workspaceRevision: "workspace" },
};

function fixture(
  options: { maxRequests?: number; invoke?: (signal: AbortSignal) => Promise<unknown> } = {},
) {
  let pulls = 0;
  let aborted = false;
  const outbound: string[] = [];
  const native = createNativeBridge({
    generation: "one",
    maxRequests: options.maxRequests,
    send: (message) => {
      outbound.push(message);
      page.receive(message);
    },
    invoke: (_operation, _payload, signal) =>
      options.invoke?.(signal) ?? Promise.resolve({ ok: true }),
    subscribe: (_payload, signal) => ({
      [Symbol.asyncIterator]() {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return {
          async next() {
            pulls += 1;
            return { done: false as const, value: { sequence: pulls, value: { count: pulls } } };
          },
          async return() {
            return { done: true as const, value: undefined };
          },
        };
      },
    }),
  });
  const page = createPageBridge({ generation: "one", send: (message) => native.receive(message) });
  return { native, page, outbound, state: () => ({ pulls, aborted }) };
}

describe("production mobile extension bridge", () => {
  it("does not reveal internal transport errors to the pack", async () => {
    const setup = fixture({
      invoke: async () => {
        throw new Error("Private transport details");
      },
    });
    await expect(
      setup.page.invoke("invoke", request, new AbortController().signal),
    ).rejects.toThrow("Connection unavailable. Reconnect or check installation grants.");
    expect(setup.outbound.join("")).not.toContain("Private transport details");
    setup.native.dispose();
    setup.page.dispose();
  });
  it("round-trips unary calls and rejects stale/malformed/oversized envelopes", async () => {
    const setup = fixture();
    expect(await setup.page.invoke("invoke", request, new AbortController().signal)).toEqual({
      ok: true,
    });
    expect(setup.native.receive('{"version":1,"generation":"old","kind":"cancel","id":1}')).toBe(
      false,
    );
    expect(setup.native.receive("not json")).toBe(false);
    expect(setup.native.receive("x".repeat(1_048_577))).toBe(false);
    expect(
      setup.native.receive('{"version":1,"generation":"one","kind":"ack","id":1,"sequence":-1}'),
    ).toBe(false);
    setup.native.dispose();
    setup.page.dispose();
  });
  it("pulls one unacknowledged frame, advancing only on the next consumption", async () => {
    const setup = fixture();
    const controller = new AbortController();
    const iterator = setup.page.subscribe(request, controller.signal)[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ sequence: 1 });
    await Promise.resolve();
    expect(setup.state().pulls).toBe(1);
    expect((await iterator.next()).value).toMatchObject({ sequence: 2 });
    expect(setup.state().pulls).toBe(2);
    controller.abort();
    await iterator.return?.(undefined);
    expect(setup.state().aborted).toBe(true);
    setup.native.dispose();
    setup.page.dispose();
  });
  it("bounds concurrent calls and cancels outstanding work on disposal", async () => {
    let cancelled = false;
    const setup = fixture({
      maxRequests: 1,
      invoke: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            cancelled = true;
            reject(new Error("cancelled"));
          });
        }),
    });
    const first = setup.page.invoke("invoke", request, new AbortController().signal);
    const firstFailure = expect(first).rejects.toThrow("disposed");
    await expect(
      setup.page.invoke("invoke", request, new AbortController().signal),
    ).rejects.toThrow("BridgeBusy");
    setup.page.dispose();
    setup.native.dispose();
    await firstFailure;
    expect(cancelled).toBe(true);
  });
  it("honors pre-abort and ignores future acknowledgements", async () => {
    const setup = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(setup.page.invoke("invoke", request, controller.signal)).rejects.toThrow(
      "cancelled",
    );
    expect(setup.outbound).toHaveLength(0);
    const streamController = new AbortController();
    const iterator = setup.page.subscribe(request, streamController.signal)[Symbol.asyncIterator]();
    await iterator.next();
    setup.native.receive(
      JSON.stringify({ version: 1, generation: "one", kind: "ack", id: 1, sequence: 999 }),
    );
    await Promise.resolve();
    expect(setup.state().pulls).toBe(1);
    streamController.abort();
    await iterator.return?.(undefined);
    setup.native.dispose();
    setup.page.dispose();
  });
});

it("bounds the page itself when the native receiver is unavailable", async () => {
  const page = createPageBridge({ generation: "one", send: () => {}, maxRequests: 1 });
  const controller = new AbortController();
  const pending = page.invoke("invoke", {}, controller.signal);
  const rejected = expect(pending).rejects.toThrow("cancelled");
  await expect(page.invoke("invoke", {}, controller.signal)).rejects.toThrow("BridgeBusy");
  controller.abort();
  await rejected;
  page.dispose();
});

it("settles outstanding page calls even when the WebView channel vanishes during disposal", async () => {
  let sending = true;
  const page = createPageBridge({
    generation: "one",
    send: () => {
      if (!sending) throw new Error("Evicted");
    },
  });
  const pending = page.invoke("invoke", {}, new AbortController().signal);
  const done = expect(pending).rejects.toThrow("disposed");
  sending = false;
  expect(() => page.dispose()).not.toThrow();
  await done;
});

it.each([1, 3])("rejects repeated or skipped bridge frame sequence %s", async (sequence) => {
  const sent: string[] = [];
  const page = createPageBridge({
    generation: "one",
    send: (message) => {
      sent.push(message);
    },
  });
  const frame = (value: number) =>
    JSON.stringify({
      version: 1,
      generation: "one",
      id: 1,
      kind: "frame",
      sequence: value,
      payload: value,
    });
  const iterator = page.subscribe({}, new AbortController().signal);
  const first = iterator.next();
  page.receive(frame(1));
  expect((await first).value).toBe(1);
  const second = iterator.next();
  const rejected = expect(second).rejects.toThrow("BridgeProtocolError");
  page.receive(frame(sequence));
  try {
    await rejected;
    expect(JSON.parse(sent.at(-1)!)).toMatchObject({ kind: "cancel", id: 1 });
  } finally {
    await iterator.return(undefined);
    page.dispose();
  }
});
