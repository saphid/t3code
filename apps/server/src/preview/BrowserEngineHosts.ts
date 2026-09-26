/**
 * Authenticated browser engine host registry (P08-ENGINE-ATTACH).
 *
 * The desktop renderer owns Chromium guests; it registers here over its own
 * WebSocket and receives ordinary page commands on the registration stream.
 * Registration is accepted only from a session exchanged from the
 * desktop-bootstrap grant, whose seed reaches the server over the desktop's
 * trusted launch channel. The gate reads the grant method from the session
 * row, not the subject: `t3 auth session issue --subject` can mint any
 * subject, but never a grant method. Web, mobile, relay, tunnel and
 * CLI-issued sockets never become hosts, so on those connections engine
 * commands stay named-unsupported.
 *
 * This registry owns sockets, command queues and pending acknowledgements.
 * Which host owns which guest, and under which generation, lives in
 * PreviewManager session state so ownership, close and epoch share one lock.
 */
import {
  BrowserEngineHostError,
  type BrowserEngineCommand,
  type BrowserEngineCommandRejection,
  type BrowserEngineHostClaimInput,
  type BrowserEngineHostCommandResultInput,
  type BrowserEngineHostReleaseInput,
  type BrowserEngineHostReportInput,
  type BrowserEngineHostStreamEvent,
  type BrowserEngineProfileAnswer,
  type BrowserEngineProfileCommand,
  type BrowserEngineSessionTarget,
  type ServerAuthBootstrapMethod,
} from "@t3tools/contracts";
import type * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as PreviewManager from "./Manager.ts";

/**
 * Bounded wait for a host acknowledgement: long enough for a busy renderer's
 * IPC round-trip, short enough that a receipt never hangs. Silence becomes
 * `unknown`, never success.
 */
const COMMAND_ACK_TIMEOUT_MS = 10_000;

/**
 * Cookie import waits on the user: the host asks for confirmation and the OS
 * may prompt for keychain access. Bounded all the same; silence is `unknown`.
 */
export const IMPORT_ACK_TIMEOUT_MS = 5 * 60_000;

/** The authenticated socket a host call arrived on. Derived by the WS layer, never the payload. */
export interface BrowserEngineHostSocket {
  readonly socketId: string;
  /** The session row's bootstrap grant method; absent for directly issued sessions. */
  readonly grantMethod: ServerAuthBootstrapMethod | undefined;
}

const isDesktopSession = (socket: BrowserEngineHostSocket) =>
  socket.grantMethod === "desktop-bootstrap";

export type BrowserEngineDispatchOutcome =
  | { readonly outcome: "applied" }
  | { readonly outcome: "rejected"; readonly reason: BrowserEngineCommandRejection }
  | { readonly outcome: "unknown" };

export interface BrowserEngineDispatchInput {
  readonly hostConnectionId: string;
  readonly target: BrowserEngineSessionTarget;
  readonly engineGeneration: string;
  readonly command: BrowserEngineCommand;
}

export type BrowserEngineProfileDispatchOutcome =
  | BrowserEngineProfileAnswer
  | { readonly outcome: "applied" }
  | { readonly outcome: "rejected"; readonly reason: BrowserEngineCommandRejection }
  | { readonly outcome: "unknown" }
  /** No desktop engine host is registered in this environment. */
  | { readonly outcome: "no-host" };

type HostAnswer = BrowserEngineHostCommandResultInput["result"] | { readonly outcome: "unknown" };

interface HostConnection {
  readonly hostConnectionId: string;
  readonly socketId: string;
  readonly queue: Queue.Queue<BrowserEngineHostStreamEvent, Cause.Done>;
  readonly pending: Map<string, Deferred.Deferred<HostAnswer>>;
}

export class BrowserEngineHosts extends Context.Service<
  BrowserEngineHosts,
  {
    readonly register: (
      socket: BrowserEngineHostSocket,
    ) => Effect.Effect<Stream.Stream<BrowserEngineHostStreamEvent>, BrowserEngineHostError>;
    readonly claim: (
      socket: BrowserEngineHostSocket,
      input: BrowserEngineHostClaimInput,
    ) => Effect.Effect<void, BrowserEngineHostError>;
    readonly release: (
      socket: BrowserEngineHostSocket,
      input: BrowserEngineHostReleaseInput,
    ) => Effect.Effect<void, BrowserEngineHostError>;
    readonly report: (
      socket: BrowserEngineHostSocket,
      input: BrowserEngineHostReportInput,
    ) => Effect.Effect<void, BrowserEngineHostError>;
    readonly commandResult: (
      socket: BrowserEngineHostSocket,
      input: BrowserEngineHostCommandResultInput,
    ) => Effect.Effect<void, BrowserEngineHostError>;
    /** Sends a command to the owning host and waits for its bounded acknowledgement. */
    readonly dispatch: (
      input: BrowserEngineDispatchInput,
    ) => Effect.Effect<BrowserEngineDispatchOutcome>;
    /**
     * Sends an environment-level profile command to a registered host. Every
     * desktop window shares one Electron session store, so any host answers
     * for the environment; the earliest registered one is asked.
     */
    readonly dispatchProfile: (
      command: BrowserEngineProfileCommand,
    ) => Effect.Effect<BrowserEngineProfileDispatchOutcome>;
    /** Whether any engine host is registered in this environment right now. */
    readonly hasHost: Effect.Effect<boolean>;
  }
>()("t3/preview/BrowserEngineHosts") {}

const make = Effect.gen(function* () {
  const preview = yield* PreviewManager.PreviewManager;
  const crypto = yield* Crypto.Crypto;
  const hosts = yield* Ref.make(new Map<string, HostConnection>());
  const randomId = crypto.randomUUIDv4.pipe(Effect.orDie);

  const desktopRequired = new BrowserEngineHostError({
    reason: "desktop-required",
    message: "Only the desktop app's own session can host browser engines.",
  });

  /** A host id is only honored on the socket that registered it. */
  const authorizeHost = (socket: BrowserEngineHostSocket, hostConnectionId: string) =>
    Effect.flatMap(Ref.get(hosts), (current) => {
      const host = current.get(hostConnectionId);
      if (!isDesktopSession(socket)) return Effect.fail(desktopRequired);
      return host !== undefined && host.socketId === socket.socketId
        ? Effect.succeed(host)
        : Effect.fail(
            new BrowserEngineHostError({
              reason: "host-not-registered",
              message: "The engine host is not registered on this connection.",
            }),
          );
    });

  const disconnect = (host: HostConnection) =>
    Effect.gen(function* () {
      yield* Ref.update(hosts, (current) => {
        const next = new Map(current);
        if (next.get(host.hostConnectionId) === host) next.delete(host.hostConnectionId);
        return next;
      });
      // In-flight commands cannot be proven either way once the host is gone.
      for (const deferred of host.pending.values()) {
        yield* Deferred.succeed(deferred, { outcome: "unknown" });
      }
      host.pending.clear();
      yield* preview.releaseEngineHost(host.hostConnectionId);
      yield* Queue.shutdown(host.queue);
    });

  const register: BrowserEngineHosts["Service"]["register"] = (socket) =>
    !isDesktopSession(socket)
      ? Effect.fail(desktopRequired)
      : Effect.succeed(
          Stream.unwrap(
            Effect.acquireRelease(
              Effect.gen(function* () {
                const hostConnectionId = yield* randomId;
                const queue = yield* Queue.unbounded<BrowserEngineHostStreamEvent, Cause.Done>();
                const host: HostConnection = {
                  hostConnectionId,
                  socketId: socket.socketId,
                  queue,
                  pending: new Map(),
                };
                yield* Queue.offer(queue, { type: "registered", hostConnectionId });
                yield* Ref.update(hosts, (current) => new Map(current).set(hostConnectionId, host));
                return host;
              }),
              disconnect,
            ).pipe(Effect.map((host) => Stream.fromQueue(host.queue))),
          ),
        );

  const claim: BrowserEngineHosts["Service"]["claim"] = (socket, input) =>
    Effect.andThen(authorizeHost(socket, input.hostConnectionId), preview.claimEngine(input));

  const release: BrowserEngineHosts["Service"]["release"] = (socket, input) =>
    Effect.andThen(authorizeHost(socket, input.hostConnectionId), preview.releaseEngine(input));

  const report: BrowserEngineHosts["Service"]["report"] = (socket, input) =>
    Effect.andThen(
      authorizeHost(socket, input.hostConnectionId),
      preview.reportEngineStatus(input),
    );

  const commandResult: BrowserEngineHosts["Service"]["commandResult"] = (socket, input) =>
    Effect.flatMap(authorizeHost(socket, input.hostConnectionId), (host) => {
      const deferred = host.pending.get(input.commandId);
      // A late answer after the bounded wait has nothing left to settle.
      if (deferred === undefined) return Effect.void;
      host.pending.delete(input.commandId);
      return Deferred.succeed(deferred, input.result).pipe(Effect.asVoid);
    });

  /** Offers one frame and waits for its bounded answer; silence or disconnect is `unknown`. */
  const send = (
    host: HostConnection,
    frame: (commandId: string) => BrowserEngineHostStreamEvent,
    timeoutMs: number,
  ) =>
    Effect.gen(function* () {
      const commandId = yield* randomId;
      const deferred = yield* Deferred.make<HostAnswer>();
      host.pending.set(commandId, deferred);
      const offered = yield* Queue.offer(host.queue, frame(commandId));
      // The host disconnected between lookup and offer; nothing was sent.
      if (!offered) {
        host.pending.delete(commandId);
        return { outcome: "unknown" } as HostAnswer;
      }
      const outcome = yield* Deferred.await(deferred).pipe(
        Effect.timeoutOption(timeoutMs),
        Effect.ensuring(Effect.sync(() => host.pending.delete(commandId))),
      );
      return Option.getOrElse(outcome, (): HostAnswer => ({ outcome: "unknown" }));
    });

  const dispatch: BrowserEngineHosts["Service"]["dispatch"] = (input) =>
    Effect.gen(function* () {
      const host = (yield* Ref.get(hosts)).get(input.hostConnectionId);
      if (host === undefined) return { outcome: "unknown" } as const;
      const answer = yield* send(
        host,
        (commandId) => ({
          type: "command",
          commandId,
          target: input.target,
          engineGeneration: input.engineGeneration,
          command: input.command,
        }),
        COMMAND_ACK_TIMEOUT_MS,
      );
      switch (answer.outcome) {
        case "applied":
        case "rejected":
        case "unknown":
          return answer;
        default:
          // A profile answer to a page command is a confused host, not success.
          return { outcome: "rejected", reason: "failed" } as const;
      }
    });

  const dispatchProfile: BrowserEngineHosts["Service"]["dispatchProfile"] = (command) =>
    Effect.gen(function* () {
      const host = (yield* Ref.get(hosts)).values().next().value;
      if (host === undefined) return { outcome: "no-host" } as const;
      return yield* send(
        host,
        (commandId) => ({ type: "profile-command", commandId, command }),
        command._tag === "importCookies" ? IMPORT_ACK_TIMEOUT_MS : COMMAND_ACK_TIMEOUT_MS,
      );
    });

  return BrowserEngineHosts.of({
    register,
    claim,
    release,
    report,
    commandResult,
    dispatch,
    dispatchProfile,
    hasHost: Effect.map(Ref.get(hosts), (current) => current.size > 0),
  });
}).pipe(Effect.withSpan("BrowserEngineHosts.make"));

export const layer = Layer.effect(BrowserEngineHosts, make);
