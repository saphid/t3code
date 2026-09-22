/**
 * Lease and ticket authority for `t3.browser/frames@1.0.0`.
 *
 * Tickets are the bearer credentials the `/api/browser-frames` proxy verifies
 * for extension viewers that cannot present a session credential. Input
 * leases are the only way a client reaches the hub's input socket — an input
 * connection is minted, never asserted.
 *
 * Records live in memory: the hub independently enforces lease expiry and
 * session-boundary cleanup, so a server restart simply forces re-minting.
 */
import { BROWSER_FRAME_TICKET_TTL_MS, type BrowserFrameSessionTuple } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SynchronizedRef from "effect/SynchronizedRef";

export interface BrowserFrameTicketRecord {
  readonly ticket: string;
  readonly kind: "stream" | "input";
  readonly leaseId?: string;
  readonly principal: string;
  readonly scopes: ReadonlyArray<string>;
  readonly session: BrowserFrameSessionTuple;
  readonly engineGeneration: string | null;
  readonly hostClientId: string | null;
  readonly expiresAt: number;
  readonly superseded: boolean;
}

export interface BrowserFrameInputLeaseState {
  readonly leaseId: string;
  readonly principal: string;
  readonly session: BrowserFrameSessionTuple;
  readonly engineGeneration: string | null;
  readonly hostClientId: string | null;
  readonly expiresAt: number;
  readonly revoked: boolean;
}

export interface IssueBrowserFrameTicketInput {
  readonly principal: string;
  readonly scopes: ReadonlyArray<string>;
  readonly session: BrowserFrameSessionTuple;
  readonly engineGeneration?: string | null;
  readonly hostClientId?: string | null;
}

export interface IssuedInputLease {
  readonly leaseId: string;
  readonly inputTicket: string;
  readonly expiresAt: number;
  /** Lease closed by this mint because a different principal claimed the session. */
  readonly supersededLeaseId: string | null;
}

interface LeasesState {
  readonly tickets: ReadonlyMap<string, BrowserFrameTicketRecord>;
  readonly leases: ReadonlyMap<string, BrowserFrameInputLeaseState>;
  /** sessionKey -> leaseId; at most one live input lease per session tuple. */
  readonly leaseBySession: ReadonlyMap<string, string>;
}

const sessionKey = (session: BrowserFrameSessionTuple): string =>
  JSON.stringify([session.environmentId, session.threadId, session.serverEpoch, session.tabId]);

const isLive = (expiresAt: number, now: number): boolean => expiresAt > now;

export class BrowserFrameLeases extends Context.Service<
  BrowserFrameLeases,
  {
    readonly issueStreamTicket: (
      input: IssueBrowserFrameTicketInput,
    ) => Effect.Effect<{ readonly ticket: string; readonly expiresAt: number }>;
    /**
     * Mint (or renew) the session's input lease. A second mint by the same
     * principal renews `expiresAt` and returns a fresh ticket bound to the
     * same lease; a mint by a different principal supersedes the live lease.
     */
    readonly issueInputLease: (
      input: IssueBrowserFrameTicketInput,
    ) => Effect.Effect<IssuedInputLease>;
    /** Verify a ticket: exists, unexpired, and its lease (if any) is live. */
    readonly verify: (ticket: string) => Effect.Effect<Option.Option<BrowserFrameTicketRecord>>;
    readonly resolveLease: (
      leaseId: string,
    ) => Effect.Effect<Option.Option<BrowserFrameInputLeaseState>>;
    /** Revoke a lease and every ticket bound to it. Returns whether it existed. */
    readonly revokeLease: (leaseId: string) => Effect.Effect<boolean>;
  }
>()("t3/browserFrames/BrowserFrameLeases") {}

const make = Effect.gen(function* () {
  const state = yield* SynchronizedRef.make<LeasesState>({
    tickets: new Map(),
    leases: new Map(),
    leaseBySession: new Map(),
  });
  const crypto = yield* Crypto.Crypto;
  const currentMillis = Clock.currentTimeMillis;
  const randomUUID = crypto.randomUUIDv4.pipe(Effect.orDie);

  const issueStreamTicket: BrowserFrameLeases["Service"]["issueStreamTicket"] = Effect.fn(
    "BrowserFrameLeases.issueStreamTicket",
  )(function* (input) {
    const now = yield* currentMillis;
    const expiresAt = now + BROWSER_FRAME_TICKET_TTL_MS;
    const ticket = `bfv1.st.${yield* randomUUID}`;
    yield* SynchronizedRef.update(state, (current) => {
      const tickets = new Map(current.tickets);
      tickets.set(ticket, {
        ticket,
        kind: "stream",
        principal: input.principal,
        scopes: input.scopes,
        session: input.session,
        engineGeneration: input.engineGeneration ?? null,
        hostClientId: input.hostClientId ?? null,
        expiresAt,
        superseded: false,
      });
      return { ...current, tickets };
    });
    return { ticket, expiresAt };
  });

  const issueInputLease: BrowserFrameLeases["Service"]["issueInputLease"] = Effect.fn(
    "BrowserFrameLeases.issueInputLease",
  )(function* (input) {
    const now = yield* currentMillis;
    const expiresAt = now + BROWSER_FRAME_TICKET_TTL_MS;
    const inputTicket = `bfv1.in.${yield* randomUUID}`;
    const newLeaseId = `bfli.${yield* randomUUID}`;
    const key = sessionKey(input.session);
    const minted = yield* SynchronizedRef.modify(state, (current) => {
      const previousLeaseId = current.leaseBySession.get(key);
      const previous = previousLeaseId ? current.leases.get(previousLeaseId) : undefined;
      const renew =
        previous !== undefined &&
        !previous.revoked &&
        isLive(previous.expiresAt, now) &&
        previous.principal === input.principal;
      const leaseId = renew ? previous.leaseId : newLeaseId;
      const leases = new Map(current.leases);
      const tickets = new Map(current.tickets);
      const leaseBySession = new Map(current.leaseBySession);
      let supersededLeaseId: string | null = null;
      if (!renew && previous && isLive(previous.expiresAt, now) && !previous.revoked) {
        // A different principal claims the session: the previous lease is
        // dead from this mint on, so its tickets stop verifying immediately
        // and the hub's own supersession closes the socket on the new bind.
        leases.set(previous.leaseId, { ...previous, revoked: true });
        for (const [ticket, record] of tickets) {
          if (record.leaseId === previous.leaseId) {
            tickets.set(ticket, { ...record, superseded: true });
          }
        }
        supersededLeaseId = previous.leaseId;
      }
      leases.set(leaseId, {
        leaseId,
        principal: input.principal,
        session: input.session,
        engineGeneration: input.engineGeneration ?? null,
        hostClientId: input.hostClientId ?? null,
        expiresAt,
        revoked: false,
      });
      leaseBySession.set(key, leaseId);
      tickets.set(inputTicket, {
        ticket: inputTicket,
        kind: "input",
        leaseId,
        principal: input.principal,
        scopes: input.scopes,
        session: input.session,
        engineGeneration: input.engineGeneration ?? null,
        hostClientId: input.hostClientId ?? null,
        expiresAt,
        superseded: false,
      });
      return [
        { leaseId, inputTicket, expiresAt, supersededLeaseId },
        { tickets, leases, leaseBySession },
      ] as const;
    });
    return minted;
  });

  const verify: BrowserFrameLeases["Service"]["verify"] = Effect.fn("BrowserFrameLeases.verify")(
    function* (ticket) {
      const now = yield* currentMillis;
      const result = yield* SynchronizedRef.modify(state, (current) => {
        const record = current.tickets.get(ticket);
        if (!record || record.superseded || !isLive(record.expiresAt, now)) {
          return [Option.none<BrowserFrameTicketRecord>(), current] as const;
        }
        if (record.leaseId !== undefined) {
          const lease = current.leases.get(record.leaseId);
          if (!lease || lease.revoked || !isLive(lease.expiresAt, now)) {
            return [Option.none<BrowserFrameTicketRecord>(), current] as const;
          }
        }
        return [Option.some(record), current] as const;
      });
      return result;
    },
  );

  const resolveLease: BrowserFrameLeases["Service"]["resolveLease"] = Effect.fn(
    "BrowserFrameLeases.resolveLease",
  )(function* (leaseId) {
    const now = yield* currentMillis;
    const current = yield* SynchronizedRef.get(state);
    const lease = current.leases.get(leaseId);
    if (!lease || lease.revoked || !isLive(lease.expiresAt, now)) {
      return Option.none();
    }
    return Option.some(lease);
  });

  const revokeLease: BrowserFrameLeases["Service"]["revokeLease"] = Effect.fn(
    "BrowserFrameLeases.revokeLease",
  )(function* (leaseId) {
    return yield* SynchronizedRef.modify(state, (current) => {
      const lease = current.leases.get(leaseId);
      if (!lease) return [false, current] as const;
      const leases = new Map(current.leases);
      leases.set(leaseId, { ...lease, revoked: true });
      const tickets = new Map(current.tickets);
      for (const [ticket, record] of tickets) {
        if (record.leaseId === leaseId) tickets.set(ticket, { ...record, superseded: true });
      }
      const leaseBySession = new Map(current.leaseBySession);
      if (leaseBySession.get(sessionKey(lease.session)) === leaseId) {
        leaseBySession.delete(sessionKey(lease.session));
      }
      return [true, { tickets, leases, leaseBySession }] as const;
    });
  });

  return BrowserFrameLeases.of({
    issueStreamTicket,
    issueInputLease,
    verify,
    resolveLease,
    revokeLease,
  });
}).pipe(Effect.withSpan("BrowserFrameLeases.make"));

export const layer = Layer.effect(BrowserFrameLeases, make);
