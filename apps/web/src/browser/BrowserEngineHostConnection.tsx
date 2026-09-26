"use client";

import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { previewBridge } from "~/components/preview/previewBridge";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";

import { createEngineHostEventHandler, useBrowserEngineHostStore } from "./browserEngineHost";

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
      get.addFinalizer(() =>
        useBrowserEngineHostStore.getState().setHostConnectionId(environmentId, null),
      );
      get.subscribe(
        registrationAtom,
        createEngineHostEventHandler({
          environmentId,
          bridge: previewBridge,
          sendResult: (input) => commandResult({ environmentId, input }),
        }),
        { immediate: true },
      );
    }).pipe(Atom.setIdleTTL(0), Atom.withLabel(`preview:engine-host:${environmentId}`));
  }, [commandResult, environmentId]);
  useAtomValue(consumerAtom);
  return null;
}
