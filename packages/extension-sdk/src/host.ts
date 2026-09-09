import { assertId, copyJson, resourceKey, validateContext, validateManifest } from "./contracts.js";
import type {
  ExtensionManifest,
  Json,
  Placement,
  SurfaceDescriptor,
  ViewContext,
  ViewRecord,
} from "./contracts.js";

export interface ViewSession {
  readonly context: ViewContext;
  readonly signal: AbortSignal;
  readonly restoring: boolean;
  readonly visible: boolean;
  onVisibility(listener: (visible: boolean) => void): () => void;
  readonly restoreState: Json;
  /** Monotonic within this session; old/hidden/disposed publications return false. */
  publish(sequence: number, state: Json): boolean;
  save(state: Json): boolean;
  invoke(capability: string, input: Json): Promise<Json>;
  onDispose(cleanup: () => void): void;
}
export interface ViewController<Renderer> {
  readonly renderer: Renderer;
  dispose?(): void;
}
export interface SurfaceContribution<Renderer> {
  readonly id: string;
  validateRestore(state: Json): boolean;
  createView(session: ViewSession): ViewController<Renderer> | Promise<ViewController<Renderer>>;
}
export interface Extension<Renderer> {
  readonly manifest: ExtensionManifest;
  readonly surfaces: readonly SurfaceContribution<Renderer>[];
}
export interface ServiceCall {
  readonly extensionId: string;
  readonly surfaceId: string;
  readonly context: ViewContext;
  readonly signal: AbortSignal;
  readonly input: Json;
}
export interface HostService {
  readonly capability: string;
  /** Must enforce authenticated domain ownership; descriptor scope is not authentication. */
  invoke(call: ServiceCall): Json | Promise<Json>;
}
export interface HostOptions {
  readonly services?: readonly HostService[];
  /** Host-owned grant check, repeated on every service invocation. */
  authorize(extensionId: string, capability: string, context: ViewContext): boolean;
  readonly timeoutMs?: number;
  readonly maxViews?: number;
  readonly maxPendingCalls?: number;
}
export interface ViewSnapshot {
  readonly id: string;
  readonly record: ViewRecord;
  readonly status: "loading" | "ready" | "hidden" | "unavailable" | "error";
  readonly reason: string | null;
  readonly state: Json;
  readonly generation: number;
}
interface Registration<R> {
  manifest: ExtensionManifest;
  contributions: Map<string, SurfaceContribution<R>>;
  enabled: boolean;
}
interface Entry<R> {
  snapshot: ViewSnapshot;
  registration: Registration<R> | undefined;
  descriptor: SurfaceDescriptor | undefined;
  controller: ViewController<R> | undefined;
  abort: AbortController;
  activity: AbortController;
  visibility: Set<(visible: boolean) => void>;
  cleanup: Set<() => void>;
  sequence: number;
  pending: number;
}
const failure = (error: unknown) =>
  error instanceof Error ? error.message.slice(0, 500) : "Extension failed";

/** Trusted, in-process view host. No domain resource creation/destruction or layout ownership. */
export function createExtensionHost<Renderer>(options: HostOptions) {
  const registrations = new Map<string, Registration<Renderer>>();
  const entries = new Map<string, Entry<Renderer>>();
  const listeners = new Set<(view: ViewSnapshot | null, id: string) => void>();
  const services = new Map<string, HostService>();
  const timeout = options.timeoutMs ?? 10_000;
  const maxViews = options.maxViews ?? 64;
  const maxCalls = options.maxPendingCalls ?? 8;
  for (const n of [timeout, maxViews, maxCalls])
    if (!Number.isSafeInteger(n) || n < 1) throw new Error("Invalid host limit");
  for (const service of options.services ?? []) {
    assertId(service.capability);
    if (services.has(service.capability)) throw new Error("Duplicate host service");
    services.set(service.capability, service);
  }
  const snapshots = new WeakMap<ViewSnapshot, ViewSnapshot>();
  function getSnapshot(id: string): ViewSnapshot | null {
    const source = entries.get(id)?.snapshot;
    if (!source) return null;
    let cached = snapshots.get(source);
    if (!cached) {
      cached = copyJson(source);
      function freeze(value: unknown): void {
        if (value && typeof value === "object") {
          Object.values(value).forEach(freeze);
          Object.freeze(value);
        }
      }
      freeze(cached);
      snapshots.set(source, cached);
    }
    return cached;
  }
  let nextId = 0;
  let disposed = false;
  function emit(entry: Entry<Renderer> | null, id: string) {
    for (const listener of listeners) {
      try {
        listener(entry ? copyJson(entry.snapshot) : null, id);
      } catch {
        /* A failing observer cannot break another view. */
      }
    }
  }
  function stop(entry: Entry<Renderer>) {
    entry.abort.abort();
    entry.activity.abort();
    entry.visibility.clear();
    const controller = entry.controller;
    entry.controller = undefined;
    try {
      controller?.dispose?.();
    } catch {
      /* Continue releasing all owned subscriptions. */
    }
    for (const cleanup of entry.cleanup) {
      try {
        cleanup();
      } catch {
        /* Independent cleanup. */
      }
    }
    entry.cleanup.clear();
  }
  function setStatus(
    entry: Entry<Renderer>,
    status: ViewSnapshot["status"],
    reason: string | null = null,
  ) {
    entry.snapshot = { ...entry.snapshot, status, reason };
    emit(entry, entry.snapshot.id);
  }
  function deadline<T>(run: () => T | Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("View cancelled"));
        return;
      }
      const abort = () => finish(new Error("View cancelled"));
      const timer = setTimeout(() => finish(new Error("Extension operation timed out")), timeout);
      let settled = false;
      function finish(error: Error | null, value?: T) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(value as T);
      }
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve()
        .then(run)
        .then(
          (value) => finish(null, value),
          (error) => finish(new Error(failure(error))),
        );
    });
  }
  function resolve(record: ViewRecord) {
    const owner = record.surfaceId.split("/")[0]!;
    const registration = registrations.get(owner);
    const descriptor = registration?.manifest.surfaces.find(
      (surface) => surface.id === record.surfaceId,
    );
    let reason: string | null = null;
    if (!registration || !descriptor) reason = "Extension or contribution is unavailable";
    else if (!registration.enabled) reason = "Extension is disabled";
    else if (descriptor.stateVersion !== record.stateVersion)
      reason = "Saved state version is incompatible";
    else if (
      !descriptor.placements.includes(record.placement) ||
      !descriptor.clients.includes(record.context.client)
    )
      reason = "Presentation is unsupported on this client";
    else if (
      (descriptor.scope !== "environment" && !record.context.resource.projectId) ||
      (descriptor.scope === "thread" && !record.context.resource.threadId)
    )
      reason = "Required resource scope is missing";
    else {
      try {
        if (
          descriptor.capabilities.some(
            (cap) => !services.has(cap) || !options.authorize(owner, cap, copyJson(record.context)),
          )
        )
          reason = "Required capability is unavailable";
        else if (
          !registration.contributions
            .get(record.surfaceId)!
            .validateRestore(copyJson(record.restoreState))
        )
          reason = "Saved state is invalid";
      } catch (error) {
        reason = failure(error);
      }
    }
    return { registration, descriptor, reason };
  }
  async function start(entry: Entry<Renderer>, restoring: boolean) {
    stop(entry);
    entry.abort = new AbortController();
    entry.activity = new AbortController();
    entry.sequence = -1;
    const generation = entry.snapshot.generation + 1;
    entry.snapshot = { ...entry.snapshot, generation, state: null };
    const resolved = resolve(entry.snapshot.record);
    entry.registration = resolved.registration;
    entry.descriptor = resolved.descriptor;
    if (resolved.reason) {
      setStatus(entry, "unavailable", resolved.reason);
      return;
    }
    const registration = resolved.registration!;
    const contribution = registration.contributions.get(entry.snapshot.record.surfaceId)!;
    const signal = entry.abort.signal;
    const context = copyJson(entry.snapshot.record.context);
    const live = () =>
      !signal.aborted &&
      entries.get(entry.snapshot.id) === entry &&
      entry.snapshot.generation === generation;
    setStatus(entry, "loading");
    let queued = false;
    function notifyCurrent() {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (live()) emit(entry, entry.snapshot.id);
      });
    }
    const session: ViewSession = {
      context: copyJson(context),
      signal,
      restoring,
      get visible() {
        return live() && entry.snapshot.status !== "hidden";
      },
      onVisibility(listener) {
        if (live()) entry.visibility.add(listener);
        return () => {
          entry.visibility.delete(listener);
        };
      },
      restoreState: copyJson(entry.snapshot.record.restoreState),
      publish(sequence, state) {
        if (
          !live() ||
          entry.snapshot.status === "hidden" ||
          !Number.isSafeInteger(sequence) ||
          sequence <= entry.sequence
        )
          return false;
        const copied = copyJson(state);
        entry.sequence = sequence;
        entry.snapshot = { ...entry.snapshot, state: copied };
        // Presentation and saved records share one bounded microtask notification.
        notifyCurrent();
        return true;
      },
      save(state) {
        if (!live()) return false;
        const copied = copyJson(state);
        if (!contribution.validateRestore(copyJson(copied)))
          throw new Error("Invalid restore state");
        entry.snapshot = {
          ...entry.snapshot,
          record: { ...entry.snapshot.record, restoreState: copied },
        };
        notifyCurrent();
        return true;
      },
      async invoke(capability, input) {
        if (!live() || entry.snapshot.status === "hidden") throw new Error("View is inactive");
        if (
          !entry.descriptor!.capabilities.includes(capability) ||
          !options.authorize(registration.manifest.id, capability, copyJson(context))
        )
          throw new Error("Capability denied");
        const service = services.get(capability);
        if (!service) throw new Error("Capability unavailable");
        if (entry.pending >= maxCalls) throw new Error("Too many pending view calls");
        const callInput = copyJson(input);
        entry.pending++;
        const callAbort = new AbortController();
        const cancel = () => callAbort.abort();
        const activitySignal = entry.activity.signal;
        activitySignal.addEventListener("abort", cancel, { once: true });
        try {
          const output = await deadline(() => {
            if (!live() || callAbort.signal.aborted) throw new Error("View cancelled");
            return service.invoke({
              extensionId: registration.manifest.id,
              surfaceId: contribution.id,
              context: copyJson(context),
              signal: callAbort.signal,
              input: callInput,
            });
          }, callAbort.signal);
          if (!live()) throw new Error("Stale view response");
          return copyJson(output);
        } finally {
          callAbort.abort();
          activitySignal.removeEventListener("abort", cancel);
          entry.pending--;
        }
      },
      onDispose(cleanup) {
        if (live()) entry.cleanup.add(cleanup);
        else {
          try {
            cleanup();
          } catch {
            /* Late cleanup still runs. */
          }
        }
      },
    };
    try {
      const controller = await deadline(async () => {
        if (!live()) throw new Error("View cancelled");
        const result = await contribution.createView(session);
        if (!live()) {
          try {
            result.dispose?.();
          } catch {
            /* Late factory result. */
          }
          throw new Error("View cancelled");
        }
        return result;
      }, signal);
      if (!live()) {
        try {
          controller.dispose?.();
        } catch {
          /* Race with close. */
        }
        return;
      }
      entry.controller = controller;
      if (entry.snapshot.status !== "hidden") setStatus(entry, "ready");
    } catch (error) {
      if (live()) {
        stop(entry);
        setStatus(entry, "error", failure(error));
      }
    }
  }
  function required(id: string) {
    const entry = entries.get(id);
    if (!entry) throw new Error("Unknown view");
    return entry;
  }
  function validateRecord(record: ViewRecord): ViewRecord {
    const copied = copyJson(record);
    assertId(copied.surfaceId);
    if (
      !copied.surfaceId.includes("/") ||
      copied.version !== 1 ||
      !Number.isSafeInteger(copied.stateVersion) ||
      copied.stateVersion < 1 ||
      typeof copied.fallback !== "string" ||
      copied.fallback.length > 2000 ||
      !["side-panel", "bottom-dock", "full-page", "compact-detail"].includes(copied.placement)
    )
      throw new Error("Invalid view record");
    validateContext(copied.context);
    return copied;
  }
  async function open(record: ViewRecord, restoring = false) {
    if (disposed) throw new Error("Host disposed");
    const copied = validateRecord(record);
    if (entries.size >= maxViews) throw new Error("View limit reached");
    const id = `view-${++nextId}`;
    const entry: Entry<Renderer> = {
      snapshot: { id, record: copied, status: "loading", reason: null, state: null, generation: 0 },
      registration: undefined,
      descriptor: undefined,
      controller: undefined,
      abort: new AbortController(),
      activity: new AbortController(),
      visibility: new Set(),
      cleanup: new Set(),
      sequence: -1,
      pending: 0,
    };
    entries.set(id, entry);
    await start(entry, restoring);
    return id;
  }
  function close(id: string) {
    const entry = entries.get(id);
    if (!entry) return;
    entries.delete(id);
    stop(entry);
    emit(null, id);
  }
  function disable(extensionId: string) {
    const registration = registrations.get(extensionId);
    if (!registration) return;
    registration.enabled = false;
    for (const entry of entries.values())
      if (entry.snapshot.record.surfaceId.startsWith(extensionId + "/")) {
        stop(entry);
        setStatus(entry, "unavailable", "Extension is disabled");
      }
  }
  function fail(id: string, error: unknown) {
    const entry = required(id);
    stop(entry);
    setStatus(entry, "error", failure(error));
  }
  return {
    register(extension: Extension<Renderer>) {
      if (disposed) throw new Error("Host disposed");
      const manifest = validateManifest(extension.manifest);
      if (registrations.has(manifest.id)) throw new Error("Duplicate extension");
      const contributions = new Map<string, SurfaceContribution<Renderer>>();
      for (const surface of extension.surfaces) {
        if (
          contributions.has(surface.id) ||
          !manifest.surfaces.some((item) => item.id === surface.id) ||
          typeof surface.createView !== "function" ||
          typeof surface.validateRestore !== "function"
        )
          throw new Error("Invalid contribution implementation");
        contributions.set(surface.id, { ...surface });
      }
      if (contributions.size !== manifest.surfaces.length)
        throw new Error("Missing contribution implementation");
      const registration = { manifest, contributions, enabled: true };
      registrations.set(manifest.id, registration);
      return () => {
        if (registrations.get(manifest.id) !== registration) return;
        disable(manifest.id);
        registrations.delete(manifest.id);
      };
    },
    descriptors() {
      return [...registrations.values()]
        .filter((r) => r.enabled)
        .flatMap((r) => copyJson(r.manifest.surfaces));
    },
    open,
    restore(record: ViewRecord) {
      return open(record, true);
    },
    getSnapshot,
    snapshot(id: string) {
      return copyJson(required(id).snapshot);
    },
    records() {
      return [...entries.values()].map((entry) => copyJson(entry.snapshot.record));
    },
    renderer(id: string): Renderer | undefined {
      return required(id).controller?.renderer;
    },
    subscribe(listener: (view: ViewSnapshot | null, id: string) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async updateContext(id: string, context: ViewContext) {
      const entry = required(id);
      const copied = validateContext(context);
      // A context switch starts a new view session, never retargets an existing service call.
      const changedResource =
        resourceKey(copied.resource) !== resourceKey(entry.snapshot.record.context.resource);
      entry.snapshot = {
        ...entry.snapshot,
        record: {
          ...entry.snapshot.record,
          context: copied,
          restoreState: changedResource ? null : entry.snapshot.record.restoreState,
        },
      };
      if (entry.snapshot.status === "hidden") {
        stop(entry);
        entry.snapshot = {
          ...entry.snapshot,
          generation: entry.snapshot.generation + 1,
          state: null,
        };
        emit(entry, id);
      } else await start(entry, !changedResource);
    },
    hide(id: string) {
      const entry = required(id);
      if (entry.snapshot.status === "hidden") return;
      entry.activity.abort();
      setStatus(entry, "hidden");
      for (const listener of entry.visibility) {
        try {
          listener(false);
        } catch (error) {
          fail(id, error);
          break;
        }
      }
    },
    async show(id: string) {
      const entry = required(id);
      if (entry.snapshot.status === "hidden" && !entry.abort.signal.aborted) {
        entry.activity = new AbortController();
        setStatus(entry, entry.controller ? "ready" : "loading");
        for (const listener of entry.visibility) {
          try {
            listener(true);
          } catch (error) {
            fail(id, error);
            break;
          }
        }
      } else if (entry.snapshot.status !== "ready" && entry.snapshot.status !== "loading")
        await start(entry, true);
    },
    move(id: string, placement: Placement) {
      const entry = required(id);
      if (!entry.descriptor?.placements.includes(placement))
        throw new Error("Unsupported placement");
      entry.snapshot = { ...entry.snapshot, record: { ...entry.snapshot.record, placement } };
      emit(entry, id);
    },
    close,
    disable,
    enable(extensionId: string) {
      const registration = registrations.get(extensionId);
      if (!registration) throw new Error("Unknown extension");
      registration.enabled = true;
    },
    /** React error boundaries and equivalent native adapters report render failures here. */
    fail,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const id of entries.keys()) close(id);
      registrations.clear();
      listeners.clear();
    },
    diagnostics() {
      return {
        views: entries.size,
        registrations: registrations.size,
        listeners: listeners.size,
        pendingCalls: [...entries.values()].reduce((sum, e) => sum + e.pending, 0),
      };
    },
  };
}
export type ExtensionHost<R> = ReturnType<typeof createExtensionHost<R>>;
