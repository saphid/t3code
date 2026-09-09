import type {
  MessageCard,
  MessageContext,
  TextContributionDescriptor,
} from "@t3tools/extension-sdk/context";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import { useCallback, useSyncExternalStore } from "react";
import { validateManifest, type ViewRecord } from "@t3tools/extension-sdk/contracts";
import { createExtensionHost, type Extension, type HostOptions } from "@t3tools/extension-sdk/host";
import type { SurfaceRenderer } from "@t3tools/extension-sdk/react";
import { createNativeSurfaceBridge } from "./nativeBridge";

type WorkspaceBridge = ReturnType<typeof createNativeSurfaceBridge<null>>;
const contributions = new Map<string, WorkspaceBridge>();
const extensionIds = new Set<string>();
const textHosts = new Map<string, ReturnType<typeof createExtensionHost<SurfaceRenderer>>>();
let textRevision = 0;
let contextDescriptors: readonly TextContributionDescriptor[] = [];
const getTextRevision = () => textRevision;
const getContextDescriptors = () => contextDescriptors;
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
  textRevision += 1;
  contextDescriptors = [
    ...new Map(
      [...textHosts.values()]
        .flatMap((host) => [
          ...host.contextDescriptors("web"),
          ...host.contextDescriptors("desktop"),
        ])
        .map((item) => [item.id, item]),
    ).values(),
  ];
  const nextTitles = new Map<string, string>();
  for (const [id, bridge] of contributions) {
    const surface = bridge.extension.manifest.surfaces.find((candidate) => candidate.id === id);
    if (surface) nextTitles.set(id, surface.title);
  }
  titles = nextTitles;
  for (const listener of listeners) listener();
}

/** Trusted application bootstrap registration; installation/isolation are separate host concerns. */
export function registerWorkspaceExtension(
  extension: Extension<SurfaceRenderer>,
  hostOptions: HostOptions = { authorize: () => false },
) {
  extension = {
    ...extension,
    manifest: validateManifest(extension.manifest),
    surfaces: extension.surfaces.map((surface) => ({ ...surface })),
  };
  if (extensionIds.has(extension.manifest.id)) throw new Error("Extension already registered");
  if (extensionIds.size >= 64) throw new Error("Workspace extension limit reached");
  const validator = createExtensionHost<SurfaceRenderer>(hostOptions);
  validator.register(extension);
  const bridge = createNativeSurfaceBridge<null>(() => extension, hostOptions);
  const ids = extension.manifest.surfaces.map((surface) => surface.id);
  if (ids.some((id) => contributions.has(id))) throw new Error("Surface already registered");
  extensionIds.add(extension.manifest.id);
  textHosts.set(extension.manifest.id, validator);
  for (const id of ids) contributions.set(id, bridge);
  notify();
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    extensionIds.delete(extension.manifest.id);
    textHosts.delete(extension.manifest.id);
    validator.dispose();
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

export function useWorkspaceContextDescriptors() {
  return useSyncExternalStore(subscribe, getContextDescriptors, getContextDescriptors);
}

export function captureWorkspaceContext(id: string, context: ViewContext) {
  const host = [...textHosts.values()].find((candidate) =>
    candidate.contextDescriptors(context.client).some((item) => item.id === id),
  );
  if (!host) throw new Error("Context contribution unavailable");
  return host.captureContext(id, context);
}

export function useWorkspaceTextRevision() {
  return useSyncExternalStore(subscribe, getTextRevision, getTextRevision);
}

export function decorateWorkspaceMessage(
  message: MessageContext,
  client: string,
  revision: number,
) {
  if (revision !== textRevision) return [];
  const cards: MessageCard[] = [];
  let remaining = 16;
  for (const host of textHosts.values()) {
    if (cards.length >= 4 || remaining <= 0) break;
    const compatibleCount = host.messageDecorationCount(client);
    if (compatibleCount === 0) continue;
    cards.push(
      ...host.decorateMessage(message, client, {
        maxCards: 4 - cards.length,
        maxContributions: remaining,
      }),
    );
    remaining -= Math.min(remaining, compatibleCount);
  }
  return cards;
}

export function workspaceHasMessageDecorations() {
  return [...textHosts.values()].some((host) => host.messageDecorationCount() > 0);
}
