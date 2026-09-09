import { copyEnvelope } from "./ipc.js";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import { Ajv, type ValidateFunction } from "ajv";
import {
  assertId,
  copyJson,
  validateContext,
  type Json,
  type ViewContext,
} from "@t3tools/extension-sdk/contracts";
import {
  validateEnvironmentPackage,
  type EnvironmentPackage,
  type ToolDescriptor,
} from "@t3tools/extension-sdk/environment";
import {
  atomicJson,
  checkSyntax,
  readPackage,
  storePackage,
  prunePackages,
  type PackageSnapshot,
} from "./storage.js";

export interface InstallationGrants {
  readonly capabilities: readonly string[];
  readonly projectIds: readonly string[];
}
export interface Installation {
  readonly id: string;
  readonly contentHash: string;
  readonly package: EnvironmentPackage;
  readonly enabled: boolean;
  readonly grants: InstallationGrants;
}
export interface HostService {
  readonly capability: string;
  invoke(input: Json, context: ViewContext, signal: AbortSignal): Json | Promise<Json>;
}
export interface RuntimeOptions {
  readonly rootDir: string;
  readonly environmentId: string;
  readonly services: readonly HostService[];
  authorize(
    installation: Installation,
    capability: string,
    context: ViewContext,
  ): boolean | Promise<boolean>;
  readonly timeoutMs?: number;
  readonly workerUrl?: URL;
}
export interface ExtensionRuntime {
  install(sourceDir: string, grants?: Partial<InstallationGrants>): Promise<Installation>;
  list(): readonly Installation[];
  enable(id: string): Promise<Installation>;
  disable(id: string): Promise<Installation>;
  remove(id: string): Promise<void>;
  update(id: string, sourceDir: string): Promise<Installation>;
  readClient(id: string): Promise<{ code: string; contentHash: string }>;
  invoke(
    toolId: string,
    input: Json,
    context: ViewContext,
    signal: AbortSignal,
    expectedContentHash?: string,
  ): Promise<Json>;
  dispose(): Promise<void>;
}
interface Pending {
  readonly context: ViewContext;
  readonly tool: ToolDescriptor;
  readonly controller: AbortController;
  resolve(value: Json): void;
  reject(error: Error): void;
  cleanup(): void;
}
interface Worker {
  readonly child: NodeChildProcess.ChildProcess;
  readonly installation: Installation;
  readonly calls: Map<string, Pending>;
  readonly cancelled: Map<string, ReturnType<typeof setTimeout>>;
  services: number;
  readonly ready: Promise<void>;
  readyResolve(): void;
  readyReject(error: Error): void;
  readonly exited: Promise<void>;
  readonly startupTimer: ReturnType<typeof setTimeout>;
}
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message.slice(0, 1000) : "Extension failed";
const clone = <T>(value: T): T => copyEnvelope(value, 4 * 1024 * 1024) as T;

/** Trusted bundled code, one environment and one process owner per runtime root. Not a sandbox. */
export async function createExtensionRuntime(options: RuntimeOptions): Promise<ExtensionRuntime> {
  const root = NodePath.resolve(options.rootDir);
  const environmentId = options.environmentId;
  if (!environmentId || environmentId.length > 160) throw new Error("Invalid environment identity");
  const timeout = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000)
    throw new Error("Invalid deadline");
  const services = new Map<string, HostService>();
  for (const service of options.services) {
    assertId(service.capability);
    if (services.has(service.capability)) throw new Error("Duplicate host service");
    services.set(service.capability, { ...service });
  }
  const authorize = options.authorize;
  const workerUrl = options.workerUrl
    ? new URL(options.workerUrl.href)
    : new URL("./worker.js", import.meta.url);
  await NodeFSP.mkdir(root, { recursive: true, mode: 0o700 });
  if ((await NodeFSP.realpath(root)) !== root)
    throw new Error("Runtime root cannot contain symlinks");
  const installations = new Map<string, Installation>();
  const validators = new Map<string, Map<string, ValidateFunction>>();
  const workers = new Map<string, Worker>();
  const draining = new Set<Promise<void>>();
  let disposed = false;
  let mutations = Promise.resolve();
  const ajv = new Ajv({ strict: true, allErrors: false, addUsedSchema: false });
  function compile(pkg: EnvironmentPackage): Map<string, ValidateFunction> {
    return new Map(pkg.tools.map((tool) => [tool.id, ajv.compile(tool.inputSchema)]));
  }
  function grants(value: Partial<InstallationGrants> = {}): InstallationGrants {
    const result = clone({
      capabilities: value.capabilities ?? [],
      projectIds: value.projectIds ?? [],
    });
    if (
      !Array.isArray(result.capabilities) ||
      result.capabilities.length > 16 ||
      !Array.isArray(result.projectIds) ||
      result.projectIds.length > 64 ||
      new Set(result.capabilities).size !== result.capabilities.length ||
      new Set(result.projectIds).size !== result.projectIds.length
    )
      throw new Error("Invalid installation grants");
    for (const capability of result.capabilities) assertId(capability);
    for (const id of result.projectIds)
      if (typeof id !== "string" || !id || id.length > 160)
        throw new Error("Invalid project grant");
    return result;
  }
  const recordsPath = NodePath.join(root, "installations.json");
  try {
    const stat = await NodeFSP.lstat(recordsPath);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024)
      throw new Error("Invalid installation records");
    const stored = JSON.parse(await NodeFSP.readFile(recordsPath, "utf8")) as {
      version: unknown;
      environmentId: unknown;
      installations: unknown;
    };
    if (
      stored.version !== 1 ||
      stored.environmentId !== environmentId ||
      !Array.isArray(stored.installations) ||
      stored.installations.length > 32
    )
      throw new Error("Invalid installation records");
    for (const value of stored.installations) {
      const record = clone(value) as Installation;
      const pkg = validateEnvironmentPackage(record.package);
      if (
        record.id !== pkg.manifest.id ||
        installations.has(record.id) ||
        !/^[a-f0-9]{64}$/.test(record.contentHash) ||
        typeof record.enabled !== "boolean"
      )
        throw new Error("Invalid installation identity");
      const installed = { ...record, package: pkg, grants: grants(record.grants) };
      installations.set(record.id, installed);
      validators.set(record.id, compile(pkg));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  function live() {
    if (disposed) throw new Error("Runtime disposed");
  }
  function required(id: string) {
    live();
    const record = installations.get(id);
    if (!record) throw new Error("Extension is not installed");
    return record;
  }
  function current(record: Installation) {
    live();
    if (installations.get(record.id) !== record || !record.enabled)
      throw new Error("Installation changed or disabled");
  }
  function mutate<T>(action: () => Promise<T>): Promise<T> {
    const next = mutations.then(() => {
      live();
      return action();
    });
    mutations = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  async function persist(next: Map<string, Installation>) {
    await atomicJson(root, { version: 1, environmentId, installations: [...next.values()] });
  }
  async function verify(record: Installation): Promise<PackageSnapshot> {
    const snapshot = await readPackage(NodePath.join(root, "packages", record.contentHash));
    if (
      snapshot.contentHash !== record.contentHash ||
      JSON.stringify(snapshot.package) !== JSON.stringify(record.package)
    )
      throw new Error("Installed package digest mismatch");
    return snapshot;
  }
  async function allowed(record: Installation, capability: string, context: ViewContext) {
    current(record);
    if (
      context.resource.environmentId !== environmentId ||
      !context.resource.projectId ||
      !record.grants.projectIds.includes(context.resource.projectId)
    )
      throw new Error("Resource is outside installation grants");
    if (
      !record.grants.capabilities.includes(capability) ||
      !services.has(capability) ||
      !(await authorize(clone(record), capability, copyJson(context)))
    )
      throw new Error("Capability denied");
    current(record);
  }
  async function permitted(record: Installation, tool: ToolDescriptor, context: ViewContext) {
    current(record);
    if (
      context.resource.environmentId !== environmentId ||
      !context.resource.projectId ||
      !record.grants.projectIds.includes(context.resource.projectId)
    )
      throw new Error("Resource is outside installation grants");
    for (const capability of tool.capabilities) await allowed(record, capability, context);
    current(record);
  }
  function stop(worker: Worker, reason: Error) {
    if (workers.get(worker.installation.id) === worker) workers.delete(worker.installation.id);
    clearTimeout(worker.startupTimer);
    worker.readyReject(reason);
    for (const pending of worker.calls.values()) {
      pending.controller.abort(reason);
      pending.cleanup();
      pending.reject(reason);
    }
    worker.calls.clear();
    for (const timer of worker.cancelled.values()) clearTimeout(timer);
    worker.cancelled.clear();
    if (worker.child.exitCode === null && worker.child.signalCode === null)
      worker.child.kill("SIGKILL");
  }
  function send(worker: Worker, message: unknown) {
    if (!worker.child.connected) throw new Error("Worker disconnected");
    worker.child.send(copyEnvelope(message), (error) => {
      if (error) stop(worker, error);
    });
  }
  async function receive(worker: Worker, raw: unknown): Promise<void> {
    if (workers.get(worker.installation.id) !== worker) return;
    const message = copyEnvelope(raw);
    if (message.type === "ready") {
      clearTimeout(worker.startupTimer);
      worker.readyResolve();
      return;
    }
    if (message.type === "fatal") {
      stop(worker, new Error(String(message.error ?? "Worker failed")));
      return;
    }
    const id = String(message.callId);
    if (message.type === "settled") {
      const timer = worker.cancelled.get(id);
      if (timer) clearTimeout(timer);
      worker.cancelled.delete(id);
      return;
    }
    const pending = worker.calls.get(id);
    if (!pending) return;
    if (message.type === "service") {
      if (worker.services >= 8) {
        stop(worker, new Error("Worker service limit reached"));
        return;
      }
      worker.services++;
      try {
        const capability = String(message.capability);
        if (!pending.tool.capabilities.includes(capability))
          throw new Error("Tool capability is not declared");
        await allowed(worker.installation, capability, pending.context);
        if (pending.controller.signal.aborted) throw new Error("Invocation cancelled");
        const value = copyJson(
          await services
            .get(capability)!
            .invoke(
              copyJson(message.input ?? null),
              copyJson(pending.context),
              pending.controller.signal,
            ),
        );
        await allowed(worker.installation, capability, pending.context);
        if (worker.calls.get(id) !== pending || pending.controller.signal.aborted) return;
        send(worker, { type: "service-result", requestId: message.requestId, value });
      } catch (error) {
        if (worker.calls.get(id) === pending && !pending.controller.signal.aborted)
          send(worker, {
            type: "service-result",
            requestId: message.requestId,
            error: errorMessage(error),
          });
      } finally {
        worker.services--;
      }
      return;
    }
    if (message.type !== "result") {
      stop(worker, new Error("Invalid worker response"));
      return;
    }
    try {
      await permitted(worker.installation, pending.tool, pending.context);
      if (worker.calls.get(id) !== pending || pending.controller.signal.aborted) return;
      if (typeof message.error === "string") throw new Error(message.error);
      const value = copyJson(message.value ?? null);
      worker.calls.delete(id);
      pending.cleanup();
      pending.controller.abort();
      pending.resolve(value);
    } catch (error) {
      if (worker.calls.get(id) !== pending) return;
      worker.calls.delete(id);
      pending.cleanup();
      pending.controller.abort();
      pending.reject(new Error(errorMessage(error)));
    }
  }
  function start(record: Installation): Worker {
    const existing = workers.get(record.id);
    if (existing) return existing;
    if (!record.package.serverEntry) throw new Error("Package has no server entry");
    const child = NodeChildProcess.fork(workerUrl, [], {
      cwd: NodePath.join(root, "packages", record.contentHash),
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      execArgv: ["--max-old-space-size=96"],
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" },
    });
    let readyResolve!: () => void, readyReject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
    draining.add(exited);
    void exited.then(() => draining.delete(exited));
    const worker: Worker = {
      child,
      installation: record,
      calls: new Map(),
      cancelled: new Map(),
      services: 0,
      ready,
      readyResolve,
      readyReject,
      exited,
      startupTimer: setTimeout(
        () => stop(worker, new Error("Worker startup deadline exceeded")),
        timeout,
      ),
    };
    workers.set(record.id, worker);
    child.on("error", (error) => stop(worker, error));
    child.on("exit", () => stop(worker, new Error("Extension worker exited")));
    child.on("message", (raw) => {
      void receive(worker, raw).catch((error) => stop(worker, new Error(errorMessage(error))));
    });
    send(worker, {
      type: "initialize",
      package: record.package,
      entry: NodePath.join(root, "packages", record.contentHash, record.package.serverEntry),
    });
    return worker;
  }
  async function replace(
    record: Installation,
    nextRecord: Installation | null,
    compiled?: Map<string, ValidateFunction>,
  ): Promise<void> {
    const next = new Map(installations);
    if (nextRecord) next.set(record.id, nextRecord);
    else next.delete(record.id);
    await persist(next);
    const worker = workers.get(record.id);
    if (worker) stop(worker, new Error("Installation changed"));
    if (nextRecord) installations.set(record.id, nextRecord);
    else installations.delete(record.id);
    if (compiled) validators.set(record.id, compiled);
    if (worker) await worker.exited;
  }
  return {
    install(sourceDir, requested = {}) {
      return mutate(async () => {
        const snapshot = await readPackage(sourceDir);
        const id = snapshot.package.manifest.id;
        if (installations.has(id)) throw new Error("Extension already installed; use update");
        if (installations.size >= 32) throw new Error("Installation limit reached");
        const compiled = compile(snapshot.package);
        const record: Installation = {
          id,
          package: snapshot.package,
          contentHash: snapshot.contentHash,
          enabled: true,
          grants: grants(requested),
        };
        await checkSyntax(snapshot);
        await prunePackages(
          root,
          new Set([...installations.values()].map((item) => item.contentHash)),
        );
        await storePackage(root, snapshot);
        await persist(new Map(installations).set(id, record));
        installations.set(id, record);
        validators.set(id, compiled);
        return clone(record);
      });
    },
    list() {
      live();
      return [...installations.values()].map(clone);
    },
    enable(id) {
      return mutate(async () => {
        const record = required(id);
        await verify(record);
        const next = { ...record, enabled: true };
        await replace(record, next);
        return clone(next);
      });
    },
    disable(id) {
      return mutate(async () => {
        const record = required(id);
        const next = { ...record, enabled: false };
        await replace(record, next);
        return clone(next);
      });
    },
    remove(id) {
      return mutate(async () => {
        const record = required(id);
        await prunePackages(
          root,
          new Set([...installations.values()].map((item) => item.contentHash)),
        );
        await replace(record, null);
        validators.delete(id);
      });
    },
    update(id, sourceDir) {
      return mutate(async () => {
        const record = required(id);
        const snapshot = await readPackage(sourceDir);
        if (snapshot.package.manifest.id !== id)
          throw new Error("Update cannot replace installation identity");
        const compiled = compile(snapshot.package);
        await checkSyntax(snapshot);
        await prunePackages(
          root,
          new Set([...installations.values()].map((item) => item.contentHash)),
        );
        await storePackage(root, snapshot);
        const next = { ...record, package: snapshot.package, contentHash: snapshot.contentHash };
        await replace(record, next, compiled);
        return clone(next);
      });
    },
    async readClient(id) {
      const record = required(id);
      current(record);
      const snapshot = await verify(record);
      current(record);
      if (!record.package.clientEntry) throw new Error("Package has no client entry");
      return {
        code: snapshot.files.get(record.package.clientEntry)!.toString("utf8"),
        contentHash: record.contentHash,
      };
    },
    async invoke(toolId, input, unsafeContext, signal, expectedContentHash) {
      live();
      let worker: Worker | undefined;
      let callId: string | undefined;
      const controller = new AbortController();
      const cancel = (reason: Error, hard = false) => {
        controller.abort(reason);
        if (!worker) return;
        if (hard) {
          stop(worker, reason);
          return;
        }
        if (!callId) return;
        const owned = worker;
        const pending = owned.calls.get(callId);
        if (!pending) return;
        owned.calls.delete(callId);
        pending.controller.abort(reason);
        pending.reject(reason);
        owned.cancelled.set(
          callId,
          setTimeout(
            () => stop(owned, new Error("Cancelled tool did not settle before deadline")),
            timeout,
          ),
        );
        try {
          send(owned, { type: "cancel", callId });
        } catch (error) {
          stop(owned, new Error(errorMessage(error)));
        }
      };
      const abort = () => cancel(new Error("Invocation cancelled"));
      const timer = setTimeout(
        () => cancel(new Error("Invocation deadline exceeded"), true),
        timeout,
      );
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      const active = () => {
        if (controller.signal.aborted) throw controller.signal.reason;
      };
      let rejectCancelled!: (reason: Error) => void;
      const cancelled = new Promise<never>((_, reject) => {
        rejectCancelled = reject;
      });
      const onCancel = () => rejectCancelled(controller.signal.reason as Error);
      controller.signal.addEventListener("abort", onCancel, { once: true });
      if (controller.signal.aborted) onCancel();
      const run = async (): Promise<Json> => {
        active();
        const context = validateContext(unsafeContext);
        const record = [...installations.values()].find((value) =>
          value.package.tools.some((tool) => tool.id === toolId),
        );
        if (!record) throw new Error("Tool is not installed");
        if (expectedContentHash !== undefined && record.contentHash !== expectedContentHash)
          throw new Error("Installed content changed");
        const tool = record.package.tools.find((value) => value.id === toolId)!;
        const value = copyJson(input);
        if (!validators.get(record.id)!.get(toolId)!(value))
          throw new Error("Tool input does not match schema");
        await permitted(record, tool, context);
        active();
        await verify(record);
        active();
        current(record);
        worker = start(record);
        await worker.ready;
        active();
        current(record);
        if (worker.calls.size >= 8) throw new Error("Pending tool limit reached");
        const owned = worker;
        return new Promise<Json>((resolve, reject) => {
          callId = NodeCrypto.randomUUID();
          owned.calls.set(callId, {
            context,
            tool,
            controller: new AbortController(),
            resolve,
            reject,
            cleanup() {},
          });
          try {
            send(owned, { type: "invoke", callId, toolId, input: value, context });
          } catch (error) {
            stop(owned, new Error(errorMessage(error)));
          }
        });
      };
      try {
        return await Promise.race([run(), cancelled]);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        controller.signal.removeEventListener("abort", onCancel);
      }
    },
    async dispose() {
      if (disposed) return;
      await mutations;
      disposed = true;
      for (const worker of workers.values()) stop(worker, new Error("Runtime disposed"));
      await Promise.all(draining);
    },
  };
}
