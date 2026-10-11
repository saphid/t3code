import { type EnvironmentId, type TerminalSummary, WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/reactivity";

import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
  createEnvironmentSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { subscribe, type EnvironmentRpcInput } from "../rpc/client.ts";
import {
  applyTerminalAttachStreamEvent,
  applyTerminalMetadataStreamEvent,
  nextTerminalAttachSeedState,
} from "./terminalSession.ts";

export function createTerminalEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const lifecycleScheduler = createAtomCommandScheduler();
  const resizeScheduler = createAtomCommandScheduler();
  const terminalThreadKey = ({
    environmentId,
    input,
  }: {
    readonly environmentId: string;
    readonly input: { readonly threadId: string; readonly terminalId?: string | undefined };
  }) => JSON.stringify([environmentId, input.threadId]);
  const terminalSessionKey = ({
    environmentId,
    input,
  }: {
    readonly environmentId: string;
    readonly input: { readonly threadId: string; readonly terminalId?: string | undefined };
  }) => JSON.stringify([environmentId, input.threadId, input.terminalId ?? null]);
  const lifecycleConcurrency = { mode: "serial" as const, key: terminalThreadKey };
  const metadata = createEnvironmentSubscriptionAtomFamily(runtime, {
    label: "environment-data:terminal:metadata",
    subscribe: (_input: null) =>
      subscribe(WS_METHODS.subscribeTerminalMetadata, {}).pipe(
        Stream.scan((): ReadonlyArray<TerminalSummary> => [], applyTerminalMetadataStreamEvent),
      ),
  });
  const sessionPresent = Atom.family((environmentId: EnvironmentId) =>
    Atom.family((threadId: string) =>
      Atom.family((terminalId: string) =>
        Atom.make((get) => {
          const result = get(metadata({ environmentId, input: null }));
          return (
            AsyncResult.isSuccess(result) &&
            result.value.some(
              (terminal) => terminal.threadId === threadId && terminal.terminalId === terminalId,
            )
          );
        }),
      ),
    ),
  );
  // Metadata also sees sessions reopened by other devices or server-owned setup scripts.
  const resumeWhen = ({
    environmentId,
    input,
  }: {
    readonly environmentId: EnvironmentId;
    readonly input: EnvironmentRpcInput<typeof WS_METHODS.terminalObserve>;
  }) => sessionPresent(environmentId)(input.threadId)(input.terminalId);
  return {
    observe: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "environment-data:terminal:observe",
      completeWhen: (state) => state.version > 0 && state.status === "closed",
      resumeWhen,
      subscribe: (input: EnvironmentRpcInput<typeof WS_METHODS.terminalObserve>) =>
        Stream.suspend(() =>
          subscribe(WS_METHODS.terminalObserve, input).pipe(
            Stream.scan(nextTerminalAttachSeedState, applyTerminalAttachStreamEvent),
          ),
        ),
    }),
    attach: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "environment-data:terminal:attach",
      // The seed is also "closed". Only a close event ends reconnects; live sessions stay warm.
      completeWhen: (state) => state.version > 0 && state.status === "closed",
      resumeWhen,
      subscribe: (input: EnvironmentRpcInput<typeof WS_METHODS.terminalAttach>) =>
        Stream.suspend(() =>
          subscribe(WS_METHODS.terminalAttach, input).pipe(
            Stream.scan(nextTerminalAttachSeedState, applyTerminalAttachStreamEvent),
          ),
        ),
    }),
    events: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:terminal:events",
      tag: WS_METHODS.subscribeTerminalEvents,
    }),
    metadata,
    open: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:terminal:open",
      tag: WS_METHODS.terminalOpen,
      scheduler: lifecycleScheduler,
      concurrency: lifecycleConcurrency,
    }),
    write: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:terminal:write",
      tag: WS_METHODS.terminalWrite,
    }),
    resize: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:terminal:resize",
      tag: WS_METHODS.terminalResize,
      scheduler: resizeScheduler,
      concurrency: { mode: "latest", key: terminalSessionKey },
    }),
    clear: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:terminal:clear",
      tag: WS_METHODS.terminalClear,
      scheduler: lifecycleScheduler,
      concurrency: lifecycleConcurrency,
    }),
    restart: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:terminal:restart",
      tag: WS_METHODS.terminalRestart,
      scheduler: lifecycleScheduler,
      concurrency: lifecycleConcurrency,
    }),
    close: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:terminal:close",
      tag: WS_METHODS.terminalClose,
      scheduler: lifecycleScheduler,
      concurrency: lifecycleConcurrency,
    }),
  };
}

export * from "./terminalSession.ts";
