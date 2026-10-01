import type {
  ApiClient,
  ApiInvocation,
  ApiStreamInvocation,
  ApiStreamFrame,
} from "@t3tools/extension-sdk/capabilities";
import { RESUMABLE_API_STREAMS } from "@t3tools/extension-sdk/capabilities";
import { validateEnvironmentPackage } from "@t3tools/extension-sdk/environment";
import type { Json, ViewContext } from "@t3tools/extension-sdk/contracts";
import { sha256 } from "@noble/hashes/sha2";
import { boundMobileRequest, isMobileApiSupported } from "./mobileHostProtocol";
import type { BridgeOperation } from "./mobileExtensionBridge";

export interface MobileInstallation {
  id: string;
  contentHash: string;
  enabled: boolean;
  grants: { capabilities: readonly string[]; projectIds: readonly string[] };
  package: unknown;
}
export interface MobileExtensionTransport extends ApiClient {
  list(signal: AbortSignal): Promise<readonly MobileInstallation[]>;
  client(id: string, hash: string, signal: AbortSignal): Promise<{ code: string }>;
  asset(id: string, hash: string, path: string, signal: AbortSignal): Promise<Uint8Array>;
  invokeTool(
    toolId: string,
    input: Json,
    context: ViewContext,
    hash: string,
    signal: AbortSignal,
  ): Promise<Json>;
  watch(changed: () => void, signal: AbortSignal): () => void;
  subscribeResumableApi?(
    request: ApiStreamInvocation,
    signal: AbortSignal,
  ): AsyncIterable<ApiStreamFrame | null>;
}
type CacheKey = readonly [environment: string, installation: string, hash: string, path: string];
export class MobileExtensionCache {
  private entries = new Map<string, { key: CacheKey; value: string | Uint8Array; bytes: number }>();
  private bytes = 0;
  constructor(private readonly maxBytes = 16 * 1024 * 1024) {}
  get(key: CacheKey) {
    const encoded = JSON.stringify(key);
    const entry = this.entries.get(encoded);
    if (entry) {
      this.entries.delete(encoded);
      this.entries.set(encoded, entry);
    }
    return entry?.value;
  }
  set(key: CacheKey, value: string | Uint8Array, bytes: number) {
    const encoded = JSON.stringify(key);
    const old = this.entries.get(encoded);
    if (old) {
      this.bytes -= old.bytes;
      this.entries.delete(encoded);
    }
    if (bytes > this.maxBytes) return;
    this.entries.set(encoded, { key, value, bytes });
    this.bytes += bytes;
    for (const [id, entry] of this.entries) {
      if (this.bytes <= this.maxBytes) break;
      this.entries.delete(id);
      this.bytes -= entry.bytes;
    }
  }
  invalidate(environment: string, installation: string, keepHash?: string) {
    for (const [id, entry] of this.entries) {
      if (
        entry.key[0] === environment &&
        entry.key[1] === installation &&
        entry.key[2] !== keepHash
      ) {
        this.entries.delete(id);
        this.bytes -= entry.bytes;
      }
    }
  }
}
export const mobileExtensionCache = new MobileExtensionCache();
export type MobileHostSnapshot = {
  phase: "loading" | "ready" | "unavailable" | "offline" | "suspended" | "disposed";
  generation: string;
  code?: string;
  installation?: MobileInstallation;
  signal?: AbortSignal;
};
export function createMobileExtensionHost(options: {
  environmentId: string;
  installationId: string;
  surfaceId: string;
  context: ViewContext;
  transport: MobileExtensionTransport;
  cache: MobileExtensionCache;
  onChange: () => void;
}) {
  if (
    options.context.resource.environmentId !== options.environmentId ||
    options.context.client !== "mobile"
  )
    throw new Error("MobileContextDenied");
  let generation = 0;
  let active = true;
  let disposed = false;
  let lifetime = new AbortController();
  const watchLifetime = new AbortController();
  let state: MobileHostSnapshot = { phase: "loading", generation: "0" };
  const publish = (value: MobileHostSnapshot) => {
    state = value;
    options.onChange();
  };
  const fence = (phase: MobileHostSnapshot["phase"]) => {
    lifetime.abort();
    lifetime = new AbortController();
    generation += 1;
    publish({ phase, generation: String(generation) });
  };
  const refresh = async () => {
    if (disposed || !active) return;
    fence("loading");
    const own = lifetime;
    const current = generation;
    try {
      const installations = await options.transport.list(own.signal);
      if (own.signal.aborted) return;
      const item = installations.find((entry) => entry.id === options.installationId);
      if (
        !item?.enabled ||
        !item.grants.projectIds.includes(options.context.resource.projectId ?? "")
      ) {
        options.cache.invalidate(options.environmentId, options.installationId);
        publish({ phase: "unavailable", generation: String(current) });
        return;
      }
      const pkg = validateEnvironmentPackage(item.package);
      const surface = pkg.manifest.surfaces.find((entry) => entry.id === options.surfaceId);
      if (
        !surface?.clients.includes("mobile") ||
        surface.capabilities.some((capability) => !item.grants.capabilities.includes(capability))
      ) {
        publish({ phase: "unavailable", generation: String(current) });
        return;
      }
      options.cache.invalidate(options.environmentId, item.id, item.contentHash);
      const key: CacheKey = [options.environmentId, item.id, item.contentHash, "code"];
      let code = options.cache.get(key);
      if (typeof code !== "string") {
        code = (await options.transport.client(item.id, item.contentHash, own.signal)).code;
        if (own.signal.aborted) return;
        if (code.length > 4 * 1024 * 1024) throw new Error("Installed code too large");
        options.cache.set(key, code, code.length * 2);
      }
      if (!own.signal.aborted)
        publish({
          phase: "ready",
          generation: String(current),
          code,
          installation: item,
          signal: own.signal,
        });
    } catch {
      if (!own.signal.aborted) publish({ phase: "offline", generation: String(current) });
    }
  };
  const stopWatching = options.transport.watch(() => {
    void refresh();
  }, watchLifetime.signal);
  const ready = (signal: AbortSignal) => {
    if (
      disposed ||
      !active ||
      state.phase !== "ready" ||
      !state.installation ||
      signal.aborted ||
      lifetime.signal.aborted
    )
      throw new Error("Installation unavailable");
    return { item: state.installation, signal: AbortSignal.any([signal, lifetime.signal]) };
  };
  const request = <T extends ApiInvocation | ApiStreamInvocation>(value: T) => {
    const bound = boundMobileRequest(value, options.context);
    if (!isMobileApiSupported(bound.id))
      throw new Error("UnsupportedOnMobile: this capability is unavailable");
    return bound;
  };
  return {
    snapshot: () => state,
    refresh,
    recover: refresh,
    fail() {
      if (!disposed && active) fence("offline");
    },
    setActive(value: boolean) {
      if (disposed || active === value) return;
      active = value;
      if (value) void refresh();
      else fence("suspended");
    },
    async invoke(
      operation: BridgeOperation,
      payload: unknown,
      callerSignal: AbortSignal,
    ): Promise<unknown> {
      const { item, signal } = ready(callerSignal);
      let result: unknown;
      if (operation === "discover")
        result = (await options.transport.discoverApis(options.context, signal)).filter((api) =>
          isMobileApiSupported(api.id),
        );
      else if (operation === "invoke")
        result = await options.transport.invokeApi(request(payload as ApiInvocation), signal);
      else if (operation === "tool") {
        const value = payload as { toolId: string; input: Json; context: ViewContext };
        boundMobileRequest(value, options.context);
        result = await options.transport.invokeTool(
          value.toolId,
          value.input,
          options.context,
          item.contentHash,
          signal,
        );
      } else {
        const value = payload as { path: string; offset: number };
        if (!Number.isSafeInteger(value.offset) || value.offset < 0)
          throw new Error("Invalid asset offset");
        const pkg = validateEnvironmentPackage(item.package);
        const asset =
          pkg.format === 4 ? pkg.assets.find((entry) => entry.path === value.path) : undefined;
        if (!asset || asset.byteLength > 8 * 1024 * 1024 || value.offset > asset.byteLength)
          throw new Error("UnsupportedOnMobile: asset unavailable");
        const key: CacheKey = [
          options.environmentId,
          item.id,
          item.contentHash,
          `asset:${value.path}`,
        ];
        let bytes = options.cache.get(key);
        if (!(bytes instanceof Uint8Array)) {
          bytes = await options.transport.asset(item.id, item.contentHash, value.path, signal);
          if (signal.aborted) throw new Error("Installation expired");
          const digest = Array.from(sha256(bytes), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join("");
          if (bytes.length !== asset.byteLength || digest !== asset.sha256)
            throw new Error("Asset verification failed");
          options.cache.set(key, bytes, bytes.length);
        }
        result = {
          bytes: Array.from(bytes.subarray(value.offset, value.offset + 32 * 1024)),
          byteLength: bytes.length,
          sha256: asset.sha256,
          mediaType: asset.mediaType,
        };
      }
      if (signal.aborted) throw new Error("Installation expired");
      return result;
    },
    async *subscribe(payload: unknown, callerSignal: AbortSignal) {
      const { signal } = ready(callerSignal);
      const value = payload as { request: ApiStreamInvocation; resumable?: boolean };
      const bound = request(value.request);
      if (
        value.resumable &&
        (!RESUMABLE_API_STREAMS[`${bound.id}#${bound.name}`] ||
          !options.transport.subscribeResumableApi)
      )
        throw new Error("UnsupportedOnMobile: stream cannot resume");
      const stream = value.resumable
        ? options.transport.subscribeResumableApi!(bound, signal)
        : options.transport.subscribeApi(bound, signal);
      for await (const frame of stream) {
        if (signal.aborted) return;
        yield frame;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      lifetime.abort();
      watchLifetime.abort();
      stopWatching();
      publish({ phase: "disposed", generation: String(++generation) });
    },
  };
}
