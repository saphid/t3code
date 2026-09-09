import * as NodeCrypto from "node:crypto";
import { Ajv } from "ajv";
import { satisfies, validRange } from "semver";
import {
  assertId,
  copyJson,
  validateContext,
  type Json,
  type ViewContext,
} from "@t3tools/extension-sdk/contracts";
import {
  validateApiDefinition,
  type ApiDefinition,
  type ApiDiscovery,
  type ApiInvocation,
  type ApiStreamInvocation,
  type ApiStreamFrame,
  type ApiStreamEvent,
  type ApiSelection,
} from "@t3tools/extension-sdk/capabilities";
import { resolveCapabilities } from "./resolution.js";
import type { Installation } from "./index.js";

export interface HostApiInvocationMetadata {
  readonly callId: string;
  readonly parentCallId?: string;
  readonly rootCallerId: string;
  readonly callerId: string;
  readonly providerId: string;
  readonly providerGeneration: number;
  readonly callerGenerations: readonly {
    readonly pluginId: string;
    readonly contentHash: string;
    readonly installationGeneration: number;
  }[];
}

export interface HostApiProvider {
  readonly providerId: string;
  readonly definition: ApiDefinition;
  subscribe?(
    name: string,
    input: Json,
    context: ViewContext,
    signal: AbortSignal,
    metadata: HostApiInvocationMetadata,
    resumeCursor?: string,
  ): AsyncIterable<ApiStreamEvent>;
  invoke(
    method: string,
    input: Json,
    context: ViewContext,
    signal: AbortSignal,
    metadata: HostApiInvocationMetadata,
  ): Promise<Json> | Json;
}
export interface ApiAuthority {
  readonly parentCallId?: string;
  readonly allowWrite: boolean;
  readonly callers: readonly Installation[];
  readonly calls: readonly string[];
}
export interface ApiAudit {
  readonly callId: string;
  readonly parentCallId?: string;
  readonly rootCallerId: string;
  readonly environmentId: string;
  readonly projectId?: string;
  readonly threadId?: string;
  readonly requestId?: string;
  readonly callerId: string;
  readonly apiId: string;
  readonly method: string;
  readonly providerId?: string;
  readonly generation: number;
  readonly outcome: "completed" | "denied" | "failed";
  readonly operation?: "stream-open" | "stream-close";
}
export function createApiBroker(options: {
  installations(): readonly Installation[];
  providers: readonly HostApiProvider[];
  selections(): readonly ApiSelection[];
  validateScope?(context: ViewContext): boolean | Promise<boolean>;
  health?(id: string): "ready" | "starting" | "failed" | "unavailable";
  authorize(record: Installation, grant: string, context: ViewContext): boolean | Promise<boolean>;
  environmentId: string;
  timeoutMs: number;
  subscribeWorker?(
    record: Installation,
    request: ApiStreamInvocation,
    signal: AbortSignal,
    authority: ApiAuthority,
  ): AsyncIterable<ApiStreamEvent>;
  invokeWorker(
    record: Installation,
    request: ApiInvocation,
    signal: AbortSignal,
    authority: ApiAuthority,
  ): Promise<Json>;
  audit?(event: ApiAudit): void;
}) {
  const ajv = new Ajv({ strict: true, addUsedSchema: false });
  const hosts = options.providers.map((provider) => ({
    ...provider,
    definition: validateApiDefinition(provider.definition),
  }));
  const validators = new Map<
    string,
    {
      input: ReturnType<typeof ajv.compile>;
      output: ReturnType<typeof ajv.compile>;
      event?: ReturnType<typeof ajv.compile>;
    }
  >();
  let nextProviderGeneration = NodeCrypto.randomInt(1, 2 ** 48);
  const providerGenerations = new Map<
    string,
    { generation: number; signature: string; pluginId: string | undefined }
  >();
  let nextInstallationGeneration = 0;
  const installationGenerations = new WeakMap<Installation, number>();
  const captureCaller = (record: Installation) => {
    let installationGeneration = installationGenerations.get(record);
    if (installationGeneration === undefined) {
      installationGeneration = ++nextInstallationGeneration;
      installationGenerations.set(record, installationGeneration);
    }
    return Object.freeze({
      pluginId: record.id,
      contentHash: record.contentHash,
      installationGeneration,
    });
  };
  const pending = new Map<AbortController, Set<string>>();
  const streamCounts = new Map<string, number>();
  let streamCount = 0;
  const resolution = () =>
    resolveCapabilities({
      installations: options.installations(),
      providers: hosts,
      selections: options.selections(),
      pluginHealth: Object.fromEntries(
        options
          .installations()
          .map((record) => [record.id, options.health?.(record.id) ?? "starting"]),
      ),
    });
  const providers = () => [
    ...hosts.map((item) => ({ ...item, pluginId: undefined as string | undefined })),
    ...options.installations().flatMap((record) =>
      (record.package.provides ?? []).map((definition) => ({
        providerId: record.id,
        pluginId: record.id,
        definition,
        invoke: undefined,
        subscribe: undefined,
      })),
    ),
  ];
  function providerGeneration(provider: ReturnType<typeof providers>[number]) {
    const owner = provider.pluginId
      ? options.installations().find((record) => record.id === provider.pluginId)
      : undefined;
    const signature = JSON.stringify([
      provider.definition,
      owner ? captureCaller(owner).installationGeneration : null,
      options.selections().find((selection) => selection.id === provider.definition.id) ?? null,
      resolution().apis.find((api) => api.id === provider.definition.id) ?? null,
    ]);
    const key = JSON.stringify([provider.definition.id, provider.providerId]);
    let entry = providerGenerations.get(key);
    if (!entry || entry.signature !== signature) {
      if (nextProviderGeneration >= Number.MAX_SAFE_INTEGER)
        throw new Error("API generation exhausted; restart required");
      entry = { generation: ++nextProviderGeneration, signature, pluginId: provider.pluginId };
      providerGenerations.set(key, entry);
    }
    return entry.generation;
  }
  function eligible(record: Installation) {
    const live = options.installations().find((item) => item.id === record.id);
    if (!live || live.contentHash !== record.contentHash || live !== record)
      throw new Error("Installation changed");
    const state = resolution().plugins.find((item) => item.id === record.id);
    if (state?.status !== "available") throw new Error(state?.reason?.code ?? "Plugin unavailable");
  }
  async function scope(record: Installation, context: ViewContext) {
    eligible(record);
    if (
      context.resource.environmentId !== options.environmentId ||
      !context.resource.projectId ||
      !record.grants.projectIds.includes(context.resource.projectId)
    )
      throw new Error("Resource is outside installation grants");
    if (options.validateScope && !(await options.validateScope(context)))
      throw new Error("Resource scope changed");
    eligible(record);
  }
  function declared(record: Installation, request: ApiInvocation, providerVersion: string) {
    const requirements = [
      ...(record.package.requires ?? []),
      ...(record.package.dependencies ?? []).flatMap((item) => item.apis),
    ].filter((item) => item.id === request.id);
    const own = record.package.provides?.some(
      (api) => api.id === request.id && satisfies(api.version, request.versionRange),
    );
    if (!own && !requirements.length) throw new Error("API requirement is not declared");
    if (requirements.some((item) => !satisfies(providerVersion, item.versionRange)))
      throw new Error("Declared API version is incompatible");
  }
  function compile(definition: ApiDefinition) {
    for (const method of definition.methods ?? []) {
      const key = JSON.stringify([definition, method.name]);
      if (!validators.has(key))
        validators.set(key, {
          input: ajv.compile(method.inputSchema),
          output: ajv.compile(method.outputSchema),
        });
    }
    for (const stream of definition.streams ?? []) {
      const key = JSON.stringify([definition, "stream", stream.name]);
      if (!validators.has(key))
        validators.set(key, {
          input: ajv.compile(stream.inputSchema),
          output: ajv.compile(stream.eventSchema),
          event: ajv.compile(stream.eventSchema),
        });
    }
  }
  function validatePackage(record: Installation) {
    for (const definition of record.package.provides ?? []) compile(definition);
    resolveCapabilities({
      installations: [...options.installations().filter((item) => item.id !== record.id), record],
      providers: hosts,
      selections: options.selections(),
    });
  }
  hosts.forEach((item) => compile(item.definition));
  async function invoke(
    record: Installation,
    unsafe: ApiInvocation,
    signal: AbortSignal,
    inherited?: ApiAuthority,
  ): Promise<Json> {
    if (pending.size >= 64) throw new Error("API concurrency limit reached");
    const request = copyJson(unsafe);
    assertId(request.id);
    if (typeof request.method !== "string" || !/^[a-z][a-zA-Z0-9]{0,79}$/.test(request.method))
      throw new Error("Invalid API method");
    if (
      request.requestId !== undefined &&
      (typeof request.requestId !== "string" ||
        !request.requestId ||
        request.requestId.length > 160)
    )
      throw new Error("Invalid API request identity");
    const context = validateContext(request.context);
    if (!validRange(request.versionRange) || request.versionRange.length > 200)
      throw new Error("Invalid API version range");
    let stamp = 0;
    const authority = inherited ?? { callers: [record], calls: [], allowWrite: true };
    const callId = NodeCrypto.randomUUID();
    const callerGenerations = Object.freeze(authority.callers.map(captureCaller));
    if (authority.callers.at(-1) !== record) throw new Error("Invalid API caller");
    const key = JSON.stringify([record.id, request.id, request.method]);
    if (authority.calls.includes(key) || authority.calls.length >= 8)
      throw new Error("API call cycle or depth limit");
    const controller = new AbortController();
    const abort = () => controller.abort(new Error("API invocation cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(
      () => controller.abort(new Error("API deadline exceeded")),
      options.timeoutMs,
    );
    const affected = new Set(authority.callers.map((item) => item.id));
    pending.set(controller, affected);
    let providerId: string | undefined;
    let outcome: ApiAudit["outcome"] = "denied";
    const active = () => {
      if (controller.signal.aborted) throw controller.signal.reason;
    };
    let rejectCancelled!: (error: unknown) => void;
    const cancelled = new Promise<never>((_, reject) => {
      rejectCancelled = reject;
    });
    const onCancel = () => rejectCancelled(controller.signal.reason);
    controller.signal.addEventListener("abort", onCancel, { once: true });
    if (controller.signal.aborted) onCancel();
    try {
      return await Promise.race([
        cancelled,
        (async () => {
          active();
          await scope(record, context);
          const resolved = resolution().apis.find((api) => api.id === request.id);
          const bindings = (record.package.dependencies ?? []).filter((item) =>
            item.apis.some((api) => api.id === request.id),
          );
          if (bindings.length > 1) throw new Error("Ambiguous dependency API binding");
          providerId = bindings[0]?.pluginId ?? resolved?.providerId;
          if (!providerId) throw new Error(resolved?.reason?.code ?? "API unavailable");
          const provider = providers().find(
            (item) => item.providerId === providerId && item.definition.id === request.id,
          )!;
          if (!provider) throw new Error("Dependency API unavailable");
          stamp = providerGeneration(provider);
          if (request.expectedGeneration !== undefined && request.expectedGeneration !== stamp)
            throw new Error("Stale API generation");
          declared(record, request, provider.definition.version);
          if (!satisfies(provider.definition.version, request.versionRange))
            throw new Error("Incompatible API version");
          const method = provider.definition.methods?.find((item) => item.name === request.method);
          if (!method) throw new Error("API method unavailable");
          if (method.effect === "write" && !authority.allowWrite)
            throw new Error("Read-only API authority cannot invoke writes");
          compile(provider.definition);
          const validator = validators.get(JSON.stringify([provider.definition, method.name]))!;
          const input = copyJson(request.input);
          if (!validator.input(input)) throw new Error("API input does not match schema");
          const callers = [...authority.callers];
          const owner = provider.pluginId
            ? options.installations().find((item) => item.id === provider.pluginId)!
            : undefined;
          if (owner) affected.add(owner.id);
          if (owner && callers.at(-1) !== owner) callers.push(owner);
          const check = async () => {
            for (const caller of callers) {
              await scope(caller, context);
              for (const grant of method.requiredGrants) {
                if (
                  !caller.grants.capabilities.includes(grant) ||
                  !(await options.authorize(caller, grant, context))
                )
                  throw new Error("API capability denied");
              }
            }
            active();
          };
          await check();
          outcome = "failed";
          const result = copyJson(
            owner
              ? await options.invokeWorker(
                  owner,
                  { ...request, input, context },
                  controller.signal,
                  {
                    callers,
                    calls: [...authority.calls, key],
                    allowWrite: authority.allowWrite && method.effect === "write",
                    parentCallId: callId,
                  },
                )
              : await provider.invoke!(
                  method.name,
                  input,
                  context,
                  controller.signal,
                  Object.freeze({
                    callId,
                    ...(authority.parentCallId ? { parentCallId: authority.parentCallId } : {}),
                    rootCallerId: authority.callers[0]!.id,
                    callerId: record.id,
                    providerId: provider.providerId,
                    providerGeneration: stamp,
                    callerGenerations,
                  }),
                ),
          );
          await check();
          if (!validator.output(result)) throw new Error("API output does not match schema");
          outcome = "completed";
          return result;
        })(),
      ]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", onCancel);
      pending.delete(controller);
      controller.abort();
      try {
        options.audit?.({
          callId,
          ...(authority.parentCallId ? { parentCallId: authority.parentCallId } : {}),
          rootCallerId: authority.callers[0]!.id,
          environmentId: context.resource.environmentId,
          ...(context.resource.projectId ? { projectId: context.resource.projectId } : {}),
          ...(context.resource.threadId ? { threadId: context.resource.threadId } : {}),
          ...(request.requestId ? { requestId: request.requestId } : {}),
          callerId: record.id,
          apiId: request.id,
          method: request.method,
          ...(providerId ? { providerId } : {}),
          generation: stamp,
          outcome,
        });
      } catch {
        /* Audit sinks cannot change a completed result. */
      }
    }
  }
  return {
    subscribe(
      record: Installation,
      unsafe: ApiStreamInvocation,
      signal: AbortSignal,
      inherited?: ApiAuthority,
    ): AsyncIterable<ApiStreamFrame> {
      const request = copyJson(unsafe);
      return {
        [Symbol.asyncIterator]() {
          const controller = new AbortController();
          const affected = new Set<string>();
          const authority: ApiAuthority = {
            ...(inherited ?? { callers: [record], calls: [] }),
            allowWrite: false,
          };
          const callId = NodeCrypto.randomUUID();
          let source: AsyncIterator<ApiStreamEvent> | undefined;
          let started = false;
          let admitted = false;
          let closed = false;
          let wasCancelled = false;
          let pulling = false;
          let sequence = 0;
          let context: ViewContext | undefined;
          let providerId: string | undefined;
          let generation = 0;
          let outcome: ApiAudit["outcome"] = "denied";
          let deadline: ReturnType<typeof setTimeout> | undefined;
          let cleanup: Promise<void> | undefined;
          let validate: (() => Promise<void>) | undefined;
          let eventValid: ReturnType<typeof ajv.compile> | undefined;
          let rejectCancelled!: (error: unknown) => void;
          const cancelled = new Promise<never>((_, reject) => {
            rejectCancelled = reject;
          });
          void cancelled.catch(() => {});
          const audit = (operation: "stream-open" | "stream-close") => {
            if (!context) return;
            try {
              options.audit?.({
                callId,
                ...(authority.parentCallId ? { parentCallId: authority.parentCallId } : {}),
                rootCallerId: authority.callers[0]!.id,
                callerId: record.id,
                environmentId: context.resource.environmentId,
                ...(context.resource.projectId ? { projectId: context.resource.projectId } : {}),
                ...(context.resource.threadId ? { threadId: context.resource.threadId } : {}),
                apiId: request.id,
                method: request.name,
                ...(providerId ? { providerId } : {}),
                generation,
                outcome,
                operation,
              });
            } catch {
              /* Audit sinks cannot change stream lifetime. */
            }
          };
          const finish = () => {
            if (cleanup) return cleanup;
            closed = true;
            signal.removeEventListener("abort", abort);
            controller.signal.removeEventListener("abort", onCancel);
            clearTimeout(deadline);
            if (admitted) {
              pending.delete(controller);
              streamCount--;
              for (const id of affected) {
                const count = (streamCounts.get(id) ?? 1) - 1;
                if (count) streamCounts.set(id, count);
                else streamCounts.delete(id);
              }
              admitted = false;
              audit("stream-close");
            }
            controller.abort(new Error("API stream closed"));
            rejectCancelled(controller.signal.reason);
            // Worker cancellation has its own grace/termination policy. Host providers must
            // cooperate with AbortSignal; waiting on their cleanup cannot retain admission.
            const returned = Promise.resolve()
              .then(() => source?.return?.())
              .then(() => {});
            cleanup = new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, Math.min(options.timeoutMs, 250));
              returned.then(
                () => {
                  clearTimeout(timer);
                  resolve();
                },
                () => {
                  clearTimeout(timer);
                  resolve();
                },
              );
            });
            return cleanup;
          };
          const onCancel = () => {
            wasCancelled = true;
            rejectCancelled(controller.signal.reason ?? new Error("API stream cancelled"));
            void finish();
          };
          const abort = () => controller.abort(new Error("API stream cancelled"));
          signal.addEventListener("abort", abort, { once: true });
          controller.signal.addEventListener("abort", onCancel, { once: true });
          const active = () => {
            if (closed || controller.signal.aborted)
              throw controller.signal.reason ?? new Error("API stream closed");
          };
          const own = (id: string) => {
            if (affected.has(id)) return;
            if ((streamCounts.get(id) ?? 0) >= 8) throw new Error("Plugin stream limit reached");
            affected.add(id);
            streamCounts.set(id, (streamCounts.get(id) ?? 0) + 1);
          };
          const initialize = async () => {
            active();
            assertId(request.id);
            if (typeof request.name !== "string" || !/^[a-z][a-zA-Z0-9]{0,79}$/.test(request.name))
              throw new Error("Invalid API stream");
            if (!validRange(request.versionRange) || request.versionRange.length > 200)
              throw new Error("Invalid API version range");
            if (
              request.cursor !== undefined &&
              (typeof request.cursor !== "string" || request.cursor.length > 1024)
            )
              throw new Error("Invalid stream cursor");
            if (
              request.expectedGeneration !== undefined &&
              (!Number.isSafeInteger(request.expectedGeneration) || request.expectedGeneration < 1)
            )
              throw new Error("Invalid API generation");
            context = validateContext(request.context);
            const captured = context;
            if (authority.callers.at(-1) !== record) throw new Error("Invalid API caller");
            const key = JSON.stringify([record.id, request.id, "stream", request.name]);
            if (authority.calls.includes(key) || authority.calls.length >= 8)
              throw new Error("API call cycle or depth limit");
            if (streamCount >= 64) throw new Error("Environment stream limit reached");
            admitted = true;
            streamCount++;
            pending.set(controller, affected);
            for (const caller of authority.callers) own(caller.id);
            deadline = setTimeout(
              () => controller.abort(new Error("API stream admission deadline exceeded")),
              options.timeoutMs,
            );
            await scope(record, captured);
            active();
            const resolved = resolution().apis.find((api) => api.id === request.id);
            const bindings = (record.package.dependencies ?? []).filter((item) =>
              item.apis.some((api) => api.id === request.id),
            );
            if (bindings.length > 1) throw new Error("Ambiguous dependency API binding");
            providerId = bindings[0]?.pluginId ?? resolved?.providerId;
            if (!providerId) throw new Error(resolved?.reason?.code ?? "API unavailable");
            const provider = providers().find(
              (item) => item.providerId === providerId && item.definition.id === request.id,
            );
            if (!provider) throw new Error("Dependency API unavailable");
            generation = providerGeneration(provider);
            if (
              request.expectedGeneration !== undefined &&
              request.expectedGeneration !== generation
            )
              throw new Error("Stale API generation");
            declared(record, { ...request, method: request.name }, provider.definition.version);
            if (!satisfies(provider.definition.version, request.versionRange))
              throw new Error("Incompatible API version");
            const stream = provider.definition.streams?.find((item) => item.name === request.name);
            if (!stream) throw new Error("API stream unavailable");
            compile(provider.definition);
            const validator = validators.get(
              JSON.stringify([provider.definition, "stream", stream.name]),
            )!;
            eventValid = validator.event;
            const input = copyJson(request.input);
            if (!validator.input(input)) throw new Error("API stream input does not match schema");
            const callers = [...authority.callers];
            const owner = provider.pluginId
              ? options.installations().find((item) => item.id === provider.pluginId)
              : undefined;
            if (owner) {
              own(owner.id);
              if (callers.at(-1) !== owner) callers.push(owner);
            }
            validate = async () => {
              active();
              for (const caller of callers) {
                await scope(caller, captured);
                for (const grant of stream.requiredGrants) {
                  if (
                    !caller.grants.capabilities.includes(grant) ||
                    !(await options.authorize(caller, grant, captured))
                  )
                    throw new Error("API capability denied");
                }
              }
              active();
              if (providerGeneration(provider) !== generation)
                throw new Error("Stale API generation");
            };
            await validate();
            active();
            const iterable =
              owner && options.subscribeWorker
                ? options.subscribeWorker(
                    owner,
                    { ...request, input, context: captured },
                    controller.signal,
                    {
                      callers,
                      calls: [...authority.calls, key],
                      allowWrite: false,
                      parentCallId: callId,
                    },
                  )
                : provider.subscribe?.(
                    request.name,
                    input,
                    captured,
                    controller.signal,
                    Object.freeze({
                      callId,
                      ...(authority.parentCallId ? { parentCallId: authority.parentCallId } : {}),
                      rootCallerId: authority.callers[0]!.id,
                      callerId: record.id,
                      providerId: provider.providerId,
                      providerGeneration: generation,
                      callerGenerations: Object.freeze(authority.callers.map(captureCaller)),
                    }),
                    request.cursor,
                  );
            if (!iterable) throw new Error("API stream provider unavailable");
            source = iterable[Symbol.asyncIterator]();
            clearTimeout(deadline);
            outcome = "failed";
            outcome = "completed";
            audit("stream-open");
          };
          if (signal.aborted) abort();
          return {
            async next(): Promise<IteratorResult<ApiStreamFrame>> {
              if (closed) {
                if (wasCancelled) throw controller.signal.reason;
                return { done: true, value: undefined };
              }
              if (pulling) throw new Error("Concurrent API stream pull");
              pulling = true;
              try {
                if (!started) {
                  started = true;
                  await Promise.race([initialize(), cancelled]);
                }
                active();
                await Promise.race([validate!(), cancelled]);
                const result = await Promise.race([source!.next(), cancelled]);
                active();
                await Promise.race([validate!(), cancelled]);
                if (result.done) {
                  outcome = "completed";
                  await finish();
                  return { done: true, value: undefined };
                }
                const event = copyJson(result.value);
                if (
                  !event ||
                  typeof event !== "object" ||
                  Array.isArray(event) ||
                  !["snapshot", "data", "reset", "closed"].includes(event.type) ||
                  !eventValid?.(event.value)
                )
                  throw new Error("API stream event does not match schema");
                if (
                  event.cursor !== undefined &&
                  (typeof event.cursor !== "string" || event.cursor.length > 1024)
                )
                  throw new Error("Invalid stream cursor");
                if (sequence >= Number.MAX_SAFE_INTEGER)
                  throw new Error("API stream sequence exhausted");
                const frame = copyJson({
                  streamId: callId,
                  sequence: ++sequence,
                  type: event.type,
                  value: event.value,
                  ...(event.cursor === undefined ? {} : { cursor: event.cursor }),
                }) as ApiStreamFrame;
                if (Buffer.byteLength(JSON.stringify(frame)) > 64 * 1024)
                  throw new Error("API stream frame exceeds byte limit");
                if (frame.type === "closed") {
                  outcome = "completed";
                  await finish();
                }
                return { done: false, value: frame };
              } catch (error) {
                await finish();
                throw error;
              } finally {
                pulling = false;
              }
            },
            async return(): Promise<IteratorResult<ApiStreamFrame>> {
              if (!closed) outcome = "completed";
              await finish();
              return { done: true, value: undefined };
            },
            async throw(error: unknown): Promise<IteratorResult<ApiStreamFrame>> {
              await finish();
              throw error;
            },
          };
        },
      };
    },
    invoke,
    validatePackage,
    resolution,
    invalidate(affectedPluginIds?: readonly string[]) {
      const liveKeys = new Set(
        providers().map((provider) =>
          JSON.stringify([provider.definition.id, provider.providerId]),
        ),
      );
      for (const [key, entry] of providerGenerations) {
        if (
          !liveKeys.has(key) ||
          !affectedPluginIds ||
          (entry.pluginId && affectedPluginIds.includes(entry.pluginId))
        )
          providerGenerations.delete(key);
      }
      for (const provider of providers()) {
        if (providerGenerations.has(JSON.stringify([provider.definition.id, provider.providerId])))
          providerGeneration(provider);
      }
      validators.clear();
      for (const [controller, affected] of pending)
        if (!affectedPluginIds || affectedPluginIds.some((id) => affected.has(id)))
          controller.abort(new Error("API configuration changed"));
    },
    async discover(
      record: Installation,
      context: ViewContext,
      signal: AbortSignal,
    ): Promise<readonly ApiDiscovery[]> {
      await scope(record, validateContext(context));
      if (signal.aborted) throw new Error("Discovery cancelled or stale");
      const resolved = resolution();
      return providers().map((provider) => {
        const state = resolved.apis.find((api) => api.id === provider.definition.id);
        const available =
          !provider.pluginId ||
          resolved.plugins.find((item) => item.id === provider.pluginId)?.status === "available";
        return {
          id: provider.definition.id,
          version: provider.definition.version,
          providerId: provider.providerId,
          ...(provider.pluginId ? { pluginId: provider.pluginId } : {}),
          generation: providerGeneration(provider),
          health: available
            ? provider.pluginId
              ? (options.health?.(provider.pluginId) ?? ("starting" as const))
              : ("ready" as const)
            : ("unavailable" as const),
          selected: state?.providerId === provider.providerId,
          ...(state?.reason ? { reason: state.reason } : {}),
        };
      });
    },
  };
}
