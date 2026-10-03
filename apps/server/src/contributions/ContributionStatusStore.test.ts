import { assert, describe, it } from "@effect/vitest";
import {
  type ContributionStatusSource,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ContributionStatusStore from "./ContributionStatusStore.ts";

const THREAD_A = ThreadId.make("thread-a");
const THREAD_B = ThreadId.make("thread-b");

const source = (session: string): ContributionStatusSource => ({
  kind: "provider-session",
  providerSessionId: ProviderSessionId.make(session),
  providerInstanceId: ProviderInstanceId.make("pi"),
  driver: ProviderDriverKind.make("pi"),
});

/** Opens a handle in its own scope so a test can end that producer on demand. */
const openHandle = Effect.fn("openHandle")(function* (
  store: ContributionStatusStore.ContributionStatusStoreShape,
  session: string,
  threadId: ThreadId | null,
) {
  const scope = yield* Scope.make();
  const handle = yield* store.openSource(source(session)).pipe(Scope.provide(scope));
  yield* handle.bindThread(threadId);
  return { handle, close: Scope.close(scope, Exit.void) };
});

const itemsByThread = (store: ContributionStatusStore.ContributionStatusStoreShape) =>
  Effect.map(store.snapshot, (snapshot) =>
    Object.fromEntries(
      snapshot.threads.map((thread) => [
        thread.threadId,
        thread.items.map((item) => `${item.key}=${item.text}`),
      ]),
    ),
  );

describe("ContributionStatusStore", () => {
  it.effect("sets, replaces, and clears statuses as plain single-line text", () =>
    Effect.gen(function* () {
      const store = yield* ContributionStatusStore.make();
      const { handle } = yield* openHandle(store, "session-1", THREAD_A);

      yield* handle.set({ key: "mode", text: "\u001b[32m● plan\u001b[39m\nmode" });
      yield* handle.set({ key: "branch", text: "main" });
      assert.deepStrictEqual(yield* itemsByThread(store), {
        [THREAD_A]: ["branch=main", "mode=● plan mode"],
      });

      yield* handle.set({ key: "mode", text: "build" });
      yield* handle.clear("branch");
      assert.deepStrictEqual(yield* itemsByThread(store), { [THREAD_A]: ["mode=build"] });

      yield* handle.set({ key: "mode", text: " \t " });
      assert.deepStrictEqual(yield* itemsByThread(store), {});
    }),
  );

  it.effect("bounds keys, text, and items per source", () =>
    Effect.gen(function* () {
      const store = yield* ContributionStatusStore.make();
      const { handle } = yield* openHandle(store, "session-1", THREAD_A);

      for (let index = 0; index < 9; index += 1) {
        yield* handle.set({ key: `k${index}`, text: "on" });
      }
      yield* handle.set({ key: "k0", text: `${"a".repeat(78)}😀tail` });
      yield* handle.set({ key: "x".repeat(70), text: "ignored at the cap" });

      const [thread] = (yield* store.snapshot).threads;
      assert.strictEqual(thread?.items.length, 8);
      assert.isFalse(thread?.items.some((item) => item.key === "k8"));
      // The emoji would straddle the limit, so it is dropped rather than split.
      assert.strictEqual(thread?.items[0]?.text, `${"a".repeat(78)}…`);
    }),
  );

  it.effect("clears a producer's statuses when its scope closes and ignores it afterwards", () =>
    Effect.gen(function* () {
      const store = yield* ContributionStatusStore.make();
      const { handle, close } = yield* openHandle(store, "session-1", THREAD_A);
      yield* handle.set({ key: "mode", text: "plan" });

      yield* close;
      yield* handle.set({ key: "mode", text: "late" });
      yield* handle.bindThread(THREAD_B);

      assert.deepStrictEqual(yield* itemsByThread(store), {});
    }),
  );

  it.effect("moves a producer between threads and keeps items when rebinding its own thread", () =>
    Effect.gen(function* () {
      const store = yield* ContributionStatusStore.make();
      const { handle } = yield* openHandle(store, "session-1", THREAD_A);
      yield* handle.set({ key: "mode", text: "plan" });

      yield* handle.bindThread(THREAD_A);
      assert.deepStrictEqual(yield* itemsByThread(store), { [THREAD_A]: ["mode=plan"] });

      yield* handle.bindThread(THREAD_B);
      yield* handle.set({ key: "mode", text: "fork" });
      assert.deepStrictEqual(yield* itemsByThread(store), { [THREAD_B]: ["mode=fork"] });
    }),
  );

  it.effect("rejects a replaced producer so late updates cannot touch the replacement", () =>
    Effect.gen(function* () {
      const store = yield* ContributionStatusStore.make();
      const old = yield* openHandle(store, "session-old", THREAD_A);
      yield* old.handle.set({ key: "mode", text: "old" });

      const replacement = yield* openHandle(store, "session-new", THREAD_A);
      assert.deepStrictEqual(yield* itemsByThread(store), {});
      yield* replacement.handle.set({ key: "mode", text: "new" });

      yield* old.handle.set({ key: "mode", text: "stale" });
      yield* old.handle.clear("mode");
      yield* old.handle.clearAll;
      yield* old.close;

      const snapshot = yield* store.snapshot;
      assert.deepStrictEqual(yield* itemsByThread(store), { [THREAD_A]: ["mode=new"] });
      assert.strictEqual(
        snapshot.threads[0]?.source.providerSessionId,
        ProviderSessionId.make("session-new"),
      );
    }),
  );

  it.effect("gives each subscriber the current state, then only the latest change", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* ContributionStatusStore.make();
        const { handle } = yield* openHandle(store, "session-1", THREAD_A);
        yield* handle.set({ key: "mode", text: "plan" });

        const subscription = yield* store.subscribe;
        assert.deepStrictEqual(
          subscription.latest.threads.map((thread) => thread.threadId),
          [THREAD_A],
        );

        yield* handle.set({ key: "mode", text: "build" });
        yield* handle.set({ key: "mode", text: "review" });
        yield* handle.set({ key: "turn", text: "3" });
        const next = yield* Stream.runHead(subscription.changes);
        assert.deepStrictEqual(
          next._tag === "Some" ? next.value.threads[0]?.items.map((item) => item.text) : [],
          ["review", "3"],
        );

        // A reconnect is a fresh subscription; its first frame is the current state.
        const reconnect = yield* store.subscribe;
        assert.deepStrictEqual(reconnect.latest, yield* store.snapshot);
      }),
    ),
  );

  it.effect("caps how many threads carry statuses", () =>
    Effect.gen(function* () {
      const store = yield* ContributionStatusStore.make();
      for (
        let index = 0;
        index <= ContributionStatusStore.CONTRIBUTION_STATUS_MAX_THREADS;
        index += 1
      ) {
        const { handle } = yield* openHandle(
          store,
          `session-${index}`,
          ThreadId.make(`t-${index}`),
        );
        yield* handle.set({ key: "mode", text: "on" });
      }
      assert.strictEqual(
        (yield* store.snapshot).threads.length,
        ContributionStatusStore.CONTRIBUTION_STATUS_MAX_THREADS,
      );
    }),
  );
});
