import { afterEach, describe, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import {
  EnvironmentRegistry,
  EnvironmentSupervisor,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "@t3tools/client-runtime/connection";
import { remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AtomRegistry } from "effect/unstable/reactivity";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobileExtensionTransport } from "./mobileExtensionTransport";

// The runtime boundary is mocked; the HTTP transport, schemas and prepared
// connection lookup remain real. No mobile storage or socket is opened.
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("effect/unstable/reactivity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("effect/unstable/reactivity")>();
  return { ...actual, AtomRegistry: { ...actual.AtomRegistry, getResult: vi.fn() } };
});
afterEach(() => vi.restoreAllMocks());

const fixture = Effect.fnUntraced(function* (fetcher: typeof fetch) {
  const target = new PrimaryConnectionTarget({
    environmentId: EnvironmentId.make("e"),
    label: "Fixture",
    httpBaseUrl: "https://fixture.example",
    wsBaseUrl: "wss://fixture.example/ws",
  });
  const connection: PreparedConnection = {
    environmentId: target.environmentId,
    label: target.label,
    httpBaseUrl: target.httpBaseUrl,
    socketUrl: target.wsBaseUrl,
    httpAuthorization: null,
    target,
  };
  const prepared = yield* SubscriptionRef.make(Option.some(connection));
  const supervisor = { prepared } as EnvironmentSupervisor["Service"];
  const registry = {
    run: (id, effect) => {
      expect(id).toBe(target.environmentId);
      return Effect.provideService(effect, EnvironmentSupervisor, supervisor);
    },
  } satisfies Pick<EnvironmentRegistry["Service"], "run">;
  const http = yield* Layer.build(remoteHttpClientLayer(fetcher));
  const context = Context.merge(
    http,
    Context.make(EnvironmentRegistry, registry as EnvironmentRegistry["Service"]),
  );
  const release = vi.fn();
  vi.spyOn(appAtomRegistry, "mount").mockReturnValue(release);
  vi.mocked(AtomRegistry.getResult).mockReturnValue(Effect.succeed(context));
  const owner = new AbortController();
  let hash = "a".repeat(64);
  const transport = yield* Effect.promise(() =>
    mobileExtensionTransport("e", "t3.pack", () => hash, owner.signal),
  );
  yield* Effect.addFinalizer(() => Effect.sync(() => owner.abort()));
  return { transport, owner, release, prepared, setHash: (value: string) => (hash = value) };
});

describe("mobile transport borrowing the environment supervisor", () => {
  it.effect("reads the current prepared connection and installation hash on every invocation", () =>
    Effect.gen(function* () {
      const calls: { url: string; body: unknown }[] = [];
      const f = yield* fixture(async (url, init) => {
        calls.push({ url: String(url), body: await new Request(String(url), init).json() });
        return Response.json({ result: null });
      });
      const request = {
        id: "t3.orchestration/status",
        versionRange: "^1.0.0",
        method: "getCapabilities",
        input: {},
        context: {
          resource: { namespace: "t3.thread", id: "t", environmentId: "e" },
          client: "mobile",
        },
      };
      const signal = new AbortController().signal;
      yield* Effect.promise(() => f.transport.invokeApi(request, signal));
      yield* SubscriptionRef.update(
        f.prepared,
        Option.map((value) => ({ ...value, httpBaseUrl: "https://replacement.example" })),
      );
      f.setHash("b".repeat(64));
      yield* Effect.promise(() => f.transport.invokeApi(request, signal));
      expect(calls).toEqual([
        {
          url: "https://fixture.example/api/extensions/api/invoke",
          body: { installationId: "t3.pack", expectedContentHash: "a".repeat(64), request },
        },
        {
          url: "https://replacement.example/api/extensions/api/invoke",
          body: { installationId: "t3.pack", expectedContentHash: "b".repeat(64), request },
        },
      ]);
      f.owner.abort();
      expect(f.release).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("interrupts in-flight HTTP when the surface owner is disposed", () =>
    Effect.gen(function* () {
      let started!: () => void;
      const fetched = new Promise<void>((resolve) => (started = resolve));
      let finish!: (response: Response) => void;
      const response = new Promise<Response>((resolve) => (finish = resolve));
      let fetchSignal: AbortSignal | null | undefined;
      const f = yield* fixture((_url, init) => {
        fetchSignal = init?.signal;
        started();
        return response;
      });
      const pending = f.transport.list(new AbortController().signal);
      // Settle either branch before inspecting cancellation, without a timeout.
      const result = pending.then(
        () => "completed",
        () => "cancelled",
      );
      yield* Effect.promise(() => fetched);
      f.owner.abort();
      finish(Response.json({ installations: [] }));
      expect(yield* Effect.promise(() => result)).toBe("cancelled");
      expect(fetchSignal?.aborted).toBe(true);
      expect(f.release).toHaveBeenCalledTimes(1);
      yield* Effect.promise(() =>
        expect(f.transport.list(new AbortController().signal)).rejects.toThrow(),
      );
    }),
  );
});
