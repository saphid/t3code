import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  BROWSER_FRAME_TICKET_TTL_MS,
  EnvironmentId,
  PreviewTabId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { TestClock } from "effect/testing";
import { describe, expect } from "vite-plus/test";

import { layer as BrowserFrameLeasesLayer, BrowserFrameLeases } from "./BrowserFrameLeases.ts";

const session = {
  environmentId: EnvironmentId.make("env-a"),
  threadId: ThreadId.make("thread-a"),
  serverEpoch: "epoch-1",
  tabId: PreviewTabId.make("tab-1"),
};

const issue = (principal: string) => ({
  principal,
  scopes: ["orchestration.read", "orchestration.operate"],
  session,
  engineGeneration: "gen-1",
  hostClientId: null,
});

const TestLayer = Layer.provideMerge(BrowserFrameLeasesLayer, NodeServices.layer);

describe("BrowserFrameLeases", () => {
  it.effect("mints a stream ticket that verifies with its session tuple", () =>
    Effect.gen(function* () {
      const leases = yield* BrowserFrameLeases;
      const issued = yield* leases.issueStreamTicket(issue("principal-a"));
      expect(issued.ticket.startsWith("bfv1.st.")).toBe(true);
      const record = yield* leases.verify(issued.ticket);
      expect(Option.isSome(record)).toBe(true);
      if (Option.isSome(record)) {
        expect(record.value.kind).toBe("stream");
        expect(record.value.principal).toBe("principal-a");
        expect(record.value.session.tabId).toBe("tab-1");
        expect(record.value.engineGeneration).toBe("gen-1");
        expect(record.value.expiresAt).toBe(issued.expiresAt);
      }
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("mints an input lease whose ticket verifies with the lease binding", () =>
    Effect.gen(function* () {
      const leases = yield* BrowserFrameLeases;
      const issued = yield* leases.issueInputLease(issue("principal-a"));
      expect(issued.leaseId.startsWith("bfli.")).toBe(true);
      expect(issued.supersededLeaseId).toBeNull();
      const record = yield* leases.verify(issued.inputTicket);
      expect(Option.isSome(record)).toBe(true);
      if (Option.isSome(record)) {
        expect(record.value.kind).toBe("input");
        expect(record.value.leaseId).toBe(issued.leaseId);
      }
      const lease = yield* leases.resolveLease(issued.leaseId);
      expect(Option.isSome(lease)).toBe(true);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("renews an input lease for the same principal without superseding", () =>
    Effect.gen(function* () {
      const leases = yield* BrowserFrameLeases;
      const first = yield* leases.issueInputLease(issue("principal-a"));
      const second = yield* leases.issueInputLease(issue("principal-a"));
      expect(second.leaseId).toBe(first.leaseId);
      expect(second.supersededLeaseId).toBeNull();
      expect(second.inputTicket).not.toBe(first.inputTicket);
      // Both renewal tickets verify — the live socket on the first is not
      // yanked mid-renewal.
      expect(Option.isSome(yield* leases.verify(first.inputTicket))).toBe(true);
      expect(Option.isSome(yield* leases.verify(second.inputTicket))).toBe(true);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("a different principal supersedes the live lease and kills its tickets", () =>
    Effect.gen(function* () {
      const leases = yield* BrowserFrameLeases;
      const first = yield* leases.issueInputLease(issue("principal-a"));
      const second = yield* leases.issueInputLease(issue("principal-b"));
      expect(second.leaseId).not.toBe(first.leaseId);
      expect(second.supersededLeaseId).toBe(first.leaseId);
      expect(Option.isNone(yield* leases.verify(first.inputTicket))).toBe(true);
      expect(Option.isNone(yield* leases.resolveLease(first.leaseId))).toBe(true);
      expect(Option.isSome(yield* leases.verify(second.inputTicket))).toBe(true);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("revokeLease retires the lease and its tickets", () =>
    Effect.gen(function* () {
      const leases = yield* BrowserFrameLeases;
      const issued = yield* leases.issueInputLease(issue("principal-a"));
      expect(yield* leases.revokeLease(issued.leaseId)).toBe(true);
      expect(Option.isNone(yield* leases.verify(issued.inputTicket))).toBe(true);
      expect(Option.isNone(yield* leases.resolveLease(issued.leaseId))).toBe(true);
      expect(yield* leases.revokeLease(issued.leaseId)).toBe(true);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("expired tickets stop verifying at the TTL floor", () =>
    Effect.gen(function* () {
      const leases = yield* BrowserFrameLeases;
      const stream = yield* leases.issueStreamTicket(issue("principal-a"));
      const input = yield* leases.issueInputLease(issue("principal-a"));
      yield* TestClock.adjust(BROWSER_FRAME_TICKET_TTL_MS + 1);
      expect(Option.isNone(yield* leases.verify(stream.ticket))).toBe(true);
      expect(Option.isNone(yield* leases.verify(input.inputTicket))).toBe(true);
      expect(Option.isNone(yield* leases.resolveLease(input.leaseId))).toBe(true);
    }).pipe(Effect.provide(TestLayer)),
  );
});
