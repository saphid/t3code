import {
  environmentExtensionApiStream,
  environmentResumableExtensionApiStream,
} from "@t3tools/client-runtime/state/extensions";
import type { EnvironmentId, ExtensionApiSubscribeInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/unstable/reactivity";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { withClientConnectionIdFrames } from "./clientProviderConnection";

/**
 * A pull-driven iterator retains only the stream's bounded window: the RPC
 * delivery window, plus one frame queued at the session switch on the
 * resumable path.
 */
export async function* authenticatedApiFrames(
  stream:
    | ReturnType<typeof environmentExtensionApiStream>
    | ReturnType<typeof environmentResumableExtensionApiStream>,
  signal: AbortSignal,
) {
  const context = await Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, connectionAtomRuntime),
    { signal },
  );
  const iterable = Stream.toAsyncIterableWith(stream, context);
  const iterator = iterable[Symbol.asyncIterator]();
  const cancel = () => {
    void iterator.return?.().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) throw new Error("Extension stream cancelled");
    while (!signal.aborted) {
      const next = await iterator.next();
      if (signal.aborted) throw new Error("Extension stream cancelled");
      if (next.done) return;
      const { cursor, ...frame } = next.value;
      yield {
        ...frame,
        ...(cursor === undefined ? {} : { cursor }),
      };
    }
    throw new Error("Extension stream cancelled");
  } finally {
    signal.removeEventListener("abort", cancel);
    await iterator.return?.();
  }
}

/**
 * `ClientHost.resumableStreams` transport. The allowlisted streams are
 * server-provided, so the payload carries no client connection hint: an
 * environment-keyed hint read at resubscription could belong to an earlier
 * transport session. A client-routed stream needs a registration receipt
 * matched to each new session before it can be allowlisted here.
 */
export function resumableApiFrames(
  environmentId: EnvironmentId,
  payload: ExtensionApiSubscribeInput,
  signal: AbortSignal,
) {
  return withClientConnectionIdFrames(environmentId, signal, () =>
    authenticatedApiFrames(
      environmentResumableExtensionApiStream(environmentId, () => payload),
      signal,
    ),
  );
}
