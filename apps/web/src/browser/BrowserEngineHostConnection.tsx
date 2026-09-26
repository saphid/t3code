"use client";

import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { previewBridge } from "~/components/preview/previewBridge";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";

import { executeEngineCommand, useBrowserEngineHostStore } from "./browserEngineHost";
import { previewRuntimeTabId } from "./previewRuntimeTabId";

/** Command ids already executed; a resubscribed stream must never replay one. */
const HANDLED_COMMANDS_LIMIT = 256;

/**
 * Registers this desktop window as the engine host of the desktop's own
 * environment. Only that environment's server accepts the registration: it
 * is the one reached through the desktop bootstrap session. Remote
 * environments are never asked, so they keep `desktop-required`.
 */
export function BrowserEngineHostConnection() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  if (!previewBridge || environmentId === null) return null;
  return <BrowserEngineHostConnectionInner key={environmentId} environmentId={environmentId} />;
}

function BrowserEngineHostConnectionInner(props: { readonly environmentId: EnvironmentId }) {
  const { environmentId } = props;
  const commandResult = useAtomCommand(previewEnvironment.engineHostCommandResult, {
    reportFailure: false,
  });
  const consumerAtom = useMemo(() => {
    const registrationAtom = previewEnvironment.engineHostRegistration({
      environmentId,
      input: {},
    });
    return Atom.make((get) => {
      const { setHostConnectionId } = useBrowserEngineHostStore.getState();
      const handled = new Set<string>();
      get.addFinalizer(() => setHostConnectionId(environmentId, null));
      get.subscribe(
        registrationAtom,
        (result) => {
          if (AsyncResult.isFailure(result)) {
            setHostConnectionId(environmentId, null);
            return;
          }
          if (!AsyncResult.isSuccess(result)) return;
          const event = result.value;
          if (event.type === "registered") {
            setHostConnectionId(environmentId, event.hostConnectionId);
            return;
          }
          const hostConnectionId =
            useBrowserEngineHostStore.getState().hostConnectionIdByEnvironment[environmentId];
          if (!previewBridge || hostConnectionId === undefined || handled.has(event.commandId)) {
            return;
          }
          handled.add(event.commandId);
          if (handled.size > HANDLED_COMMANDS_LIMIT) {
            handled.delete(handled.values().next().value!);
          }
          const runtimeTabId = previewRuntimeTabId(
            { environmentId, threadId: event.target.threadId },
            event.target.serverEpoch,
            event.target.tabId,
          );
          void executeEngineCommand(
            previewBridge,
            runtimeTabId,
            event.engineGeneration,
            event.command,
          ).then((outcome) =>
            commandResult({
              environmentId,
              input: { hostConnectionId, commandId: event.commandId, result: outcome },
            }),
          );
        },
        { immediate: true },
      );
    }).pipe(Atom.setIdleTTL(0), Atom.withLabel(`preview:engine-host:${environmentId}`));
  }, [commandResult, environmentId]);
  useAtomValue(consumerAtom);
  return null;
}
