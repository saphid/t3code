import type { Json, ViewContext, ViewRecord } from "@t3tools/extension-sdk/contracts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { satisfiesSemverRange } from "@t3tools/shared/semver";
import {
  presentationStateKey,
  restorePresentationState,
  savePresentationState,
} from "./presentationState";
import { installedSurfaceDescriptor, WorkspaceExtensionSurface } from "./workspaceRegistry";
import {
  installedApiSelectionRevision,
  resolveInstalledApiProvider,
  subscribeInstalledApiClients,
} from "./installedApiClients";

export interface PresentationRequest {
  readonly apiId: string;
  readonly method: string;
  readonly input: Json;
  /** Host-local explicit navigation identity; never forwarded as API input. */
  readonly navigationId?: string;
  /**
   * Sent instead of `input` when the selected provider is at `version` or a
   * later minor (a minor-release addition such as a file link's line). It is
   * part of the navigation, read when one starts: a change alone never
   * reopens the presentation, a new `navigationId` does.
   */
  readonly newerInput?: { readonly version: string; readonly input: Json };
}

/** Domain adapters supply requests; this component knows no panel kinds or plugin ids. */
export function SelectedApiPresentation(props: {
  request: PresentationRequest;
  context: ViewContext;
  visible: boolean;
  fallback: ReactNode;
}) {
  const getRevision = useCallback(
    () => installedApiSelectionRevision(props.context.resource.environmentId, props.request.apiId),
    [props.context.resource.environmentId, props.request.apiId],
  );
  const revision = useSyncExternalStore(subscribeInstalledApiClients, getRevision, getRevision);
  const { newerInput, ...identity } = props.request;
  const newerInputRef = useRef(newerInput);
  useLayoutEffect(() => {
    newerInputRef.current = newerInput;
  });
  const requestKey = JSON.stringify([identity, props.context]);
  const key = JSON.stringify([identity, props.context, revision]);
  const [state, setState] = useState<{
    key: string;
    record?: ViewRecord;
    storageKey?: string;
    error?: string;
    legacy?: boolean;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    const [request, context] = JSON.parse(key) as [PresentationRequest, ViewContext, string];
    void (async () => {
      try {
        const selected = await resolveInstalledApiProvider(
          request.apiId,
          context,
          controller.signal,
        );
        if (!selected) {
          setState({ key, legacy: true });
          return;
        }
        const newer = newerInputRef.current;
        const upgrade =
          newer !== undefined &&
          satisfiesSemverRange(selected.discovery.version, "^" + newer.version);
        const value = await selected.client.invokeApi(
          {
            id: request.apiId,
            versionRange: upgrade ? "^" + newer.version : "^1.0.0",
            method: request.method,
            input: upgrade ? newer.input : request.input,
            context,
            expectedGeneration: selected.discovery.generation,
          },
          controller.signal,
        );
        controller.signal.throwIfAborted();
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          !("surfaceId" in value) ||
          typeof value.surfaceId !== "string" ||
          !value.surfaceId.startsWith(selected.discovery.pluginId + "/") ||
          !("placement" in value) ||
          value.placement !== "side-panel" ||
          !("restoreState" in value) ||
          !value.restoreState ||
          typeof value.restoreState !== "object" ||
          Array.isArray(value.restoreState)
        )
          throw new Error("Selected API provider returned an incompatible presentation");
        const descriptor = installedSurfaceDescriptor(
          context.resource.environmentId,
          selected.discovery.pluginId!,
          value.surfaceId,
        );
        if (!descriptor || !descriptor.placements.includes(value.placement))
          throw new Error("Selected API provider surface or placement is unavailable");
        const record: ViewRecord = {
          version: 1,
          surfaceId: value.surfaceId,
          placement: "side-panel",
          stateVersion: descriptor.stateVersion,
          restoreState: value.restoreState,
          context,
          fallback: "Selected presentation unavailable",
        };
        const storageKey = presentationStateKey(JSON.stringify([request, context]), record);
        setState({ key, storageKey, record: restorePresentationState(storageKey, record) });
      } catch (error) {
        if (!controller.signal.aborted)
          setState({
            key,
            error: error instanceof Error ? error.message : "Selected presentation unavailable",
          });
      }
    })();
    return () => controller.abort();
  }, [key]);
  if (state?.key !== key) return <div role="status">Resolving presentation…</div>;
  if (state.error) return <div role="status">{state.error}</div>;
  if (state.legacy) return props.fallback;
  return state.record ? (
    <WorkspaceExtensionSurface
      record={state.record}
      visible={props.visible}
      onRecordChange={(record) => {
        const storageKey = state.storageKey ?? presentationStateKey(requestKey, record);
        try {
          savePresentationState(storageKey, record);
        } catch {
          setState({ key, error: "Could not save presentation state" });
          return;
        }
        setState({ key, storageKey, record });
      }}
    />
  ) : null;
}
