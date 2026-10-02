// @effect-diagnostics nodeBuiltinImport:off - disposable package files exercise the real extension broker.
import { afterEach, expect, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { createExtensionRuntime } from "@t3tools/extension-runtime";
import { ORCHESTRATION_CONTROL_API } from "@t3tools/extension-sdk/catalogue";
import type { Json } from "@t3tools/extension-sdk/contracts";
import { context, createFixture } from "./v1.fixture.ts";

const approveRequests = "t3.orchestration/approve-requests";
const operate = "t3.orchestration/operate";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});
const fixture = async () => {
  const f = await createFixture();
  cleanups.push(f.dispose);
  f.setState({
    ...f.state,
    thread: { ...f.state.thread, runtimeMode: "approval-required", interactionMode: "plan" },
  });
  return f;
};
const principal = {
  kind: "environment-session" as const,
  id: "session",
  environmentId: "env",
  scopes: ["orchestration:read", "orchestration:operate"],
};
const directInvoke = (f: Awaited<ReturnType<typeof fixture>>, input: Json) =>
  f.control.invoke("turn.start", input, context, new AbortController().signal, {
    callId: "call",
    rootCallerId: "root",
    callerId: "caller",
    providerId: f.control.providerId,
    providerGeneration: 1,
    callerGenerations: [],
    principal,
  });

async function installConsumer(f: Awaited<ReturnType<typeof fixture>>, capabilities = [operate]) {
  const tmp = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-approval-boundary-"));
  cleanups.push(() => NodeFSP.rm(tmp, { recursive: true, force: true }));
  const source = NodePath.join(tmp, "package");
  await NodeFSP.mkdir(source);
  const versionRange = `^${ORCHESTRATION_CONTROL_API.version}`;
  await NodeFSP.writeFile(
    NodePath.join(source, "t3-extension.json"),
    JSON.stringify({
      format: 2,
      manifest: { id: "test.approval-boundary", apiVersion: 1, version: "1.0.0", surfaces: [] },
      serverEntry: "server.mjs",
      tools: [],
      provides: [],
      requires: [{ id: ORCHESTRATION_CONTROL_API.id, versionRange }],
      dependencies: [],
    }),
  );
  await NodeFSP.writeFile(
    NodePath.join(source, "server.mjs"),
    "export default {tools:[],apis:[]};",
  );
  const runtime = await createExtensionRuntime({
    rootDir: NodePath.join(tmp, "state"),
    environmentId: "env",
    services: [],
    apiProviders: f.providers,
    authorize: (installation, grant, scoped) =>
      installation.grants.capabilities.includes(grant) &&
      installation.grants.projectIds.includes(scoped.resource.projectId ?? ""),
  });
  cleanups.push(() => runtime.dispose());
  const installed = await runtime.install(source, { capabilities, projectIds: ["project"] });
  const invoke = (method: string, input: Json) =>
    runtime.invokeApi(
      installed.id,
      installed.contentHash,
      { id: ORCHESTRATION_CONTROL_API.id, versionRange, method, input, context },
      new AbortController().signal,
      { principal, allowWrite: true, revalidate: () => {} },
    );
  return { runtime, installed, invoke };
}

it.each([{ runtimeMode: "full-access" }, { interactionMode: "default" }])(
  "rejects extension turn mode overrides at the adapter boundary: %j",
  async (overrides) => {
    const f = await fixture();
    expect(await directInvoke(f, { text: "hello", ...overrides })).toMatchObject({
      status: "rejected",
      error: "OrchestrationInvalidInput",
    });
    expect(f.calls).toHaveLength(0);
  },
);

it.each([{ runtimeMode: "full-access" }, { interactionMode: "default" }])(
  "rejects extension turn mode overrides through the installed-pack broker: %j",
  async (overrides) => {
    const f = await fixture();
    const { invoke } = await installConsumer(f);
    await expect(invoke("turn.start", { text: "hello", ...overrides })).rejects.toThrow(
      "API input does not match schema",
    );
    expect(f.calls).toHaveLength(0);
  },
);

it("starts normal extension turns with the thread's runtime and interaction modes", async () => {
  const f = await fixture();
  const { invoke } = await installConsumer(f);
  expect(await invoke("turn.start", { text: "hello" })).toMatchObject({ status: "accepted" });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]).toMatchObject({
    type: "thread.turn.start",
    runtimeMode: "approval-required",
    interactionMode: "plan",
    message: { text: "hello" },
  });
});

it("an operate-only pack cannot answer approvals; the explicit approval grant is revocable", async () => {
  const f = await fixture();
  const { runtime, installed, invoke } = await installConsumer(f);
  const response = { requestId: "request", decision: "accept" };
  await expect(invoke("approval.respond", response)).rejects.toThrow(
    `API capability denied: ${approveRequests}`,
  );
  expect(f.calls).toHaveLength(0);
  await runtime.updateGrants(installed.id, {
    capabilities: [operate, approveRequests],
    projectIds: ["project"],
  });
  expect(await invoke("approval.respond", response)).toMatchObject({ status: "accepted" });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]).toMatchObject({ type: "thread.approval.respond", ...response });
  await runtime.updateGrants(installed.id, { capabilities: [operate], projectIds: ["project"] });
  await expect(invoke("approval.respond", response)).rejects.toThrow(
    `API capability denied: ${approveRequests}`,
  );
  expect(f.calls).toHaveLength(1);
});

it("the approval grant alone cannot operate the thread", async () => {
  const f = await fixture();
  const { invoke } = await installConsumer(f, [approveRequests]);
  await expect(
    invoke("approval.respond", { requestId: "request", decision: "accept" }),
  ).rejects.toThrow(`API capability denied: ${operate}`);
  expect(f.calls).toHaveLength(0);
});
