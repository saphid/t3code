import { useCallback, useSyncExternalStore } from "react";
import { validateManifest, type ViewRecord } from "@t3tools/extension-sdk/contracts";
import { createExtensionHost, type Extension } from "@t3tools/extension-sdk/host";
import type { SurfaceRenderer } from "@t3tools/extension-sdk/react";
import { createNativeSurfaceBridge } from "./nativeBridge";

type WorkspaceBridge = ReturnType<typeof createNativeSurfaceBridge<null>>;
const contributions = new Map<string, WorkspaceBridge>();
const extensionIds = new Set<string>();
const listeners = new Set<() => void>();
let titles: ReadonlyMap<string, string> = new Map();
const getTitles = () => titles;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function notify() {
  const nextTitles = new Map<string, string>();
  for (const [id, bridge] of contributions) {
    const surface = bridge.extension.manifest.surfaces.find((candidate) => candidate.id === id);
    if (surface) nextTitles.set(id, surface.title);
  }
  titles = nextTitles;
  for (const listener of listeners) listener();
}

/** Trusted application bootstrap registration; installation/isolation are separate host concerns. */
export function registerWorkspaceExtension(extension: Extension<SurfaceRenderer>) {
  extension = {
    ...extension,
    manifest: validateManifest(extension.manifest),
    surfaces: extension.surfaces.map((surface) => ({ ...surface })),
  };
  const validator = createExtensionHost<SurfaceRenderer>({ authorize: () => false });
  validator.register(extension);
  validator.dispose();
  if (extensionIds.has(extension.manifest.id)) throw new Error("Extension already registered");
  const bridge = createNativeSurfaceBridge<null>(() => extension);
  const ids = extension.manifest.surfaces.map((surface) => surface.id);
  if (ids.some((id) => contributions.has(id))) throw new Error("Surface already registered");
  extensionIds.add(extension.manifest.id);
  for (const id of ids) contributions.set(id, bridge);
  notify();
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    extensionIds.delete(extension.manifest.id);
    for (const id of ids) contributions.delete(id);
    notify();
  };
}

export function useWorkspaceSurfaceTitles() {
  return useSyncExternalStore(subscribe, getTitles, getTitles);
}

export function workspaceSurfaceTitle(surfaceId: string, fallback: string) {
  return (
    contributions
      .get(surfaceId)
      ?.extension.manifest.surfaces.find((surface) => surface.id === surfaceId)?.title ?? fallback
  );
}

export function WorkspaceExtensionSurface(props: {
  readonly record: ViewRecord;
  readonly visible: boolean;
  readonly onRecordChange?: (record: ViewRecord) => void;
}) {
  const getBridge = useCallback(
    () => contributions.get(props.record.surfaceId) ?? null,
    [props.record.surfaceId],
  );
  const bridge = useSyncExternalStore(subscribe, getBridge, getBridge);
  return bridge ? (
    <bridge.Surface
      record={props.record}
      visible={props.visible}
      bindings={null}
      {...(props.onRecordChange ? { onRecordChange: props.onRecordChange } : {})}
      retainHiddenPresentation
    />
  ) : (
    <div role="status">{props.record.fallback}</div>
  );
}
