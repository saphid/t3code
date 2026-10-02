import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { useMemo } from "react";
import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, AtomRegistry } from "effect/unstable/reactivity";
import * as Effect from "effect/Effect";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobileExtensionInstallations } from "../../state/extension-installations";
import { useThreadSelection } from "../../state/use-thread-selection";
import { useEnvironmentPresentation } from "../../state/presentation";
import { mobileAgentsContext, selectMobileAgentsEntry } from "./mobileAgentsEntry";
import type { MobileExtensionTransport } from "./mobileExtensionHost";

export function useMobileAgentsEntry(environmentId: string) {
  const { selectedThread, selectedThreadProject, selectedThreadRef, selectedThreadDetailState } =
    useThreadSelection();
  const environment = useEnvironmentPresentation(EnvironmentId.make(environmentId));
  const connected = environment.presentation?.connection.phase === "connected";
  const atom = mobileExtensionInstallations(EnvironmentId.make(environmentId));
  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);
  const context = useMemo(
    () => mobileAgentsContext(selectedThread, selectedThreadProject),
    [selectedThread, selectedThreadProject],
  );
  const entry = selectMobileAgentsEntry(
    Option.getOrNull(AsyncResult.value(result)),
    context,
    connected,
    {
      catalogueError: result._tag === "Failure" ? Cause.squash(result.cause) : null,
      threadPending:
        selectedThreadRef !== null &&
        (selectedThreadDetailState.status === "empty" ||
          selectedThreadDetailState.status === "synchronizing") &&
        Option.isNone(selectedThreadDetailState.error),
    },
  );
  const catalogue = useMemo<Pick<MobileExtensionTransport, "list" | "watch">>(
    () => ({
      list: (signal) =>
        Effect.runPromise(AtomRegistry.getResult(appAtomRegistry, atom), { signal }),
      watch: (changed, signal) => {
        const release = appAtomRegistry.subscribe(atom, changed);
        const stop = () => {
          release();
          signal.removeEventListener("abort", stop);
        };
        signal.addEventListener("abort", stop, { once: true });
        if (signal.aborted) stop();
        return stop;
      },
    }),
    [atom],
  );
  return { entry, context, catalogue, refresh, environment };
}
