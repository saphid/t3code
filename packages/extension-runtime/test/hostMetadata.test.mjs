import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createExtensionRuntime } from "../dist/index.js";

const context = {
  resource: { namespace: "test.resource", id: "file", environmentId: "env", projectId: "project" },
  client: "web",
};
const api = (id) => ({
  id,
  version: "1.0.0",
  methods: [
    {
      name: "inspect",
      inputSchema: { type: "object" },
      outputSchema: { type: "string" },
      effect: "read",
      requiredGrants: [],
    },
  ],
});

test("host metadata captures nested installation authority, rejects spoofing and is deeply immutable", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "t3-host-metadata-"));
  const captured = [],
    audits = [];
  const runtime = await createExtensionRuntime({
    rootDir: path.join(directory, "state"),
    environmentId: "env",
    services: [],
    authorize: () => true,
    auditApi: (event) => audits.push(event),
    apiProviders: [
      {
        providerId: "host.identity",
        definition: api("test.host/identity"),
        invoke(method, input, actualContext, signal, metadata) {
          assert.equal(method, "inspect");
          assert.deepEqual(actualContext, context);
          assert.equal(signal.aborted, false);
          assert.ok(Object.isFrozen(metadata));
          assert.ok(Object.isFrozen(metadata.callerGenerations));
          assert.ok(metadata.callerGenerations.every(Object.isFrozen));
          assert.throws(() => {
            metadata.callerId = "forged";
          }, TypeError);
          assert.throws(() => {
            metadata.callerGenerations[0].contentHash = "forged";
          }, TypeError);
          captured.push(metadata);
          return "ok";
        },
      },
    ],
  });
  t.after(async () => {
    await runtime.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  });
  async function install(id, target, version = "1.0.0", update = false) {
    const source = path.join(directory, id + version);
    await fs.mkdir(source);
    const pkg = {
      format: 2,
      manifest: { id, apiVersion: 1, version, surfaces: [] },
      serverEntry: "server.mjs",
      tools: [],
      provides: [api(id + "/api")],
      requires: [{ id: target, versionRange: "^1" }],
      dependencies: [],
    };
    await fs.writeFile(path.join(source, "t3-extension.json"), JSON.stringify(pkg));
    const request = {
      id: target,
      versionRange: "^1",
      method: "inspect",
      input: { callerId: "forged", callId: "forged", providerGeneration: -1 },
      callerId: "forged",
      rootCallerId: "forged",
      callId: "forged",
      parentCallId: "forged",
      callerGenerations: [],
    };
    await fs.writeFile(
      path.join(source, "server.mjs"),
      `export default {tools:[],apis:[{id:${JSON.stringify(id + "/api")},methods:[{name:"inspect",invoke:async(input,session)=>session.invokeApi(${JSON.stringify(request)})}]}]};`,
    );
    return update
      ? runtime.update(id, source)
      : runtime.install(source, { capabilities: [], projectIds: ["project"] });
  }
  const provider = await install("test.provider", "test.host/identity");
  const consumer = await install("test.consumer", "test.provider/api");
  const invoke = () =>
    runtime.invokeApi(
      consumer.id,
      consumer.contentHash,
      {
        id: "test.consumer/api",
        versionRange: "^1",
        method: "inspect",
        input: {},
        context,
        callId: "forged",
        rootCallerId: "forged",
        providerGeneration: -1,
      },
      new AbortController().signal,
    );
  assert.equal(await invoke(), "ok");
  assert.equal(await invoke(), "ok");
  const first = captured[0],
    second = captured[1];
  assert.equal(first.callerId, provider.id);
  assert.equal(first.rootCallerId, consumer.id);
  assert.equal(first.providerId, "host.identity");
  assert.ok(first.providerGeneration > 0);
  assert.match(first.callId, /^[0-9a-f-]{36}$/);
  assert.notEqual(first.callId, second.callId);
  const hostAudit = audits.find((event) => event.callId === first.callId);
  assert.equal(hostAudit.parentCallId, first.parentCallId);
  assert.equal(audits.find((event) => event.callId === first.parentCallId).callerId, consumer.id);
  assert.deepEqual(
    first.callerGenerations.map((item) => [item.pluginId, item.contentHash]),
    [
      [consumer.id, consumer.contentHash],
      [provider.id, provider.contentHash],
    ],
  );
  assert.deepEqual(first.callerGenerations, second.callerGenerations);
  const updated = await install("test.provider", "test.host/identity", "1.0.1", true);
  assert.equal(await invoke(), "ok");
  const third = captured[2];
  assert.equal(
    third.callerGenerations[0].installationGeneration,
    first.callerGenerations[0].installationGeneration,
  );
  assert.notEqual(
    third.callerGenerations[1].installationGeneration,
    first.callerGenerations[1].installationGeneration,
  );
  assert.equal(third.callerGenerations[1].contentHash, updated.contentHash);
  assert.equal(third.providerGeneration, first.providerGeneration);
  await runtime.updateGrants(provider.id, {
    capabilities: [],
    projectIds: ["project", "another-project"],
  });
  assert.equal(await invoke(), "ok");
  const fourth = captured[3];
  assert.equal(fourth.callerGenerations[1].contentHash, third.callerGenerations[1].contentHash);
  assert.notEqual(
    fourth.callerGenerations[1].installationGeneration,
    third.callerGenerations[1].installationGeneration,
  );
  assert.equal(fourth.providerGeneration, third.providerGeneration);
});
