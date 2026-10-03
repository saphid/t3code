import { EnvironmentRegistry, EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import { subscribeDynamicWithSession, type RpcSession } from "@t3tools/client-runtime/rpc";
import type { PluginViewsView } from "@t3tools/client-runtime/state/pluginViews";
import { type EnvironmentId, type PluginView, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { type AsyncResult, Atom } from "effect/unstable/reactivity";

/**
 * An environment's plugin views as the host may act on them. `views` is the
 * latest snapshot that `session` produced, and null until it has produced
 * one. Every session change resets `views` first, so availability from an
 * earlier session never authorizes a mount or a launcher row in a later one.
 */
export interface SessionPluginViews {
  readonly session: RpcSession | null;
  readonly views: PluginViewsView | null;
}

export const NO_SESSION_VIEWS: SessionPluginViews = { session: null, views: null };

const UNSUPPORTED: PluginViewsView = { _tag: "unsupported" };

/** One session's views, starting empty; a server without views gets no request. */
const viewsOfSession = (session: RpcSession) =>
  Stream.succeed<SessionPluginViews>({ session, views: null }).pipe(
    Stream.concat(
      Stream.unwrap(
        session.initialConfig.pipe(
          Effect.map((config) =>
            config.environment.capabilities?.pluginViews === true
              ? subscribeDynamicWithSession(WS_METHODS.pluginViewsSubscribe, () =>
                  Effect.succeed({}),
                ).pipe(
                  // The subscription follows sessions itself; keep only this session's snapshots.
                  Stream.filter(([from]) => from === session),
                  Stream.map(([, snapshot]): SessionPluginViews => ({
                    session,
                    views: {
                      _tag: "available",
                      views: snapshot.views,
                      problems: snapshot.problems,
                    },
                  })),
                )
              : Stream.succeed<SessionPluginViews>({ session, views: UNSUPPORTED }),
          ),
          // A session that never delivered its config stays empty.
          Effect.orElseSucceed(() => Stream.empty),
        ),
      ),
    ),
  );

const viewsOfSessions = Stream.unwrap(
  EnvironmentSupervisor.EnvironmentSupervisor.pipe(
    Effect.map((supervisor) =>
      SubscriptionRef.changes(supervisor.session).pipe(
        Stream.switchMap(
          Option.match({
            onNone: () => Stream.succeed(NO_SESSION_VIEWS),
            onSome: viewsOfSession,
          }),
        ),
      ),
    ),
  ),
);

/** Follows the environment's registration too: a removed environment has no session. */
const viewsOfEnvironment = (environmentId: EnvironmentId) =>
  Stream.unwrap(
    EnvironmentRegistry.EnvironmentRegistry.pipe(
      Effect.map((registry) =>
        Stream.concat(
          Stream.fromEffect(SubscriptionRef.get(registry.entries)),
          SubscriptionRef.changes(registry.entries),
        ).pipe(
          Stream.map((entries) => entries.has(environmentId)),
          Stream.changes,
          Stream.switchMap((registered) =>
            Stream.succeed(NO_SESSION_VIEWS).pipe(
              Stream.concat(
                registered ? registry.followStream(environmentId, viewsOfSessions) : Stream.empty,
              ),
            ),
          ),
        ),
      ),
    ),
  );

export function createSessionPluginViewsAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  return Atom.family((environmentId: EnvironmentId) =>
    runtime
      .atom(viewsOfEnvironment(environmentId), { initialValue: NO_SESSION_VIEWS })
      .pipe(
        Atom.setIdleTTL(5 * 60_000),
        Atom.withLabel(`environment-data:plugin-views:session-views:${environmentId}`),
      ),
  );
}

/** A failed subscription withholds views too; an earlier success is never reused. */
export function currentSessionPluginViews(
  result: AsyncResult.AsyncResult<SessionPluginViews, unknown>,
): SessionPluginViews {
  return result._tag === "Success" ? result.value : NO_SESSION_VIEWS;
}

const NO_VIEWS: ReadonlyArray<PluginView> = [];

/** The views this client can place in the right panel; other placements are skipped. */
export function sidePanelPluginViews(views: PluginViewsView | null): ReadonlyArray<PluginView> {
  if (views?._tag !== "available") return NO_VIEWS;
  const placed = views.views.filter((view) => view.placement === "side-panel");
  return placed.length === views.views.length ? views.views : placed;
}
