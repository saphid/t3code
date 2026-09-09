import { copyEnvelope } from "./ipc.js";
import * as NodeURL from "node:url";
import {
  copyJson,
  validateContext,
  type Json,
  type ViewContext,
} from "@t3tools/extension-sdk/contracts";
import {
  validateServerExtension,
  type EnvironmentPackage,
  type ServerExtension,
} from "@t3tools/extension-sdk/environment";

let definition: ServerExtension | undefined;
const controllers = new Map<string, AbortController>();
const services = new Map<
  string,
  { callId: string; resolve(value: Json): void; reject(error: Error): void }
>();
let nextService = 0;
function send(value: unknown) {
  if (process.connected) process.send?.(copyEnvelope(value));
}
function fail(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1000) : "Extension failed";
}
process.on("message", (raw: unknown) => {
  void handle(raw).catch((error) => send({ type: "fatal", error: fail(error) }));
});
async function handle(raw: unknown) {
  const message = copyEnvelope(raw);
  if (message.type === "initialize") {
    if (definition) throw new Error("Already initialized");
    const loaded = await import(NodeURL.pathToFileURL(String(message.entry)).href);
    definition = validateServerExtension(
      message.package as unknown as EnvironmentPackage,
      loaded.default,
    );
    send({ type: "ready" });
    return;
  }
  if (message.type === "cancel") {
    const callId = String(message.callId);
    const controller = controllers.get(callId);
    controller?.abort();
    for (const [id, service] of services)
      if (service.callId === callId) {
        services.delete(id);
        service.reject(new Error("Invocation cancelled"));
      }
    if (!controller) send({ type: "settled", callId });
    return;
  }
  if (message.type === "service-result") {
    const pending = services.get(String(message.requestId));
    if (!pending) return;
    services.delete(String(message.requestId));
    if (typeof message.error === "string") pending.reject(new Error(message.error));
    else pending.resolve(copyJson(message.value ?? null));
    return;
  }
  if (message.type !== "invoke" || !definition) throw new Error("Worker is not ready");
  const callId = String(message.callId);
  const tool = definition.tools.find((item) => item.id === message.toolId);
  if (!tool || controllers.has(callId)) throw new Error("Invalid tool invocation");
  if (controllers.size >= 8) {
    send({ type: "result", callId, error: "Worker pending tool limit reached" });
    return;
  }
  const controller = new AbortController();
  controllers.set(callId, controller);
  try {
    const value = await tool.invoke(copyJson(message.input ?? null), {
      context: validateContext(message.context as unknown as ViewContext),
      signal: controller.signal,
      invoke(capability, input) {
        if (controller.signal.aborted || services.size >= 8)
          return Promise.reject(new Error("Service call unavailable"));
        const requestId = String(++nextService);
        return new Promise((resolve, reject) => {
          services.set(requestId, { callId, resolve, reject });
          try {
            send({ type: "service", callId, requestId, capability, input: copyJson(input) });
          } catch (error) {
            services.delete(requestId);
            reject(error);
          }
        });
      },
    });
    if (!controller.signal.aborted) send({ type: "result", callId, value: copyJson(value) });
  } catch (error) {
    if (!controller.signal.aborted) send({ type: "result", callId, error: fail(error) });
  } finally {
    controller.abort();
    controllers.delete(callId);
    send({ type: "settled", callId });
    for (const [id, service] of services)
      if (service.callId === callId) {
        services.delete(id);
        service.reject(new Error("Invocation ended"));
      }
  }
}
process.on("disconnect", () => {
  for (const controller of controllers.values()) controller.abort();
  process.exit(0);
});
