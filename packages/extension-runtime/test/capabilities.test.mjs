import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createExtensionRuntime } from "../dist/index.js";
import { FILE_PRESENTATION_API } from "@t3tools/extension-sdk/catalogue";

const grant = "t3.workspace/read-text";
const grants = { capabilities: [grant, "t3.file/open"], projectIds: ["project"] };
const context = {
  resource: { namespace: "test.resource", id: "file", environmentId: "env", projectId: "project" },
  client: "web",
};
const signal = () => new AbortController().signal;
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const definition = (id) => ({
  id: id + "/api",
  version: "1.0.0",
  methods: [
    {
      name: "value",
      inputSchema: { type: "object" },
      outputSchema: { type: "string" },
      effect: "read",
      requiredGrants: [grant],
    },
  ],
});
function metadata(
  id,
  { version = "1.0.0", provides = [definition(id)], requires = [], dependencies = [] } = {},
) {
  return {
    format: 2,
    manifest: { id, apiVersion: 1, version, surfaces: [] },
    serverEntry: "server.mjs",
    tools: [],
    provides,
    requires,
    dependencies,
  };
}
function implementation(pkg, expression = '"value"') {
  return (
    "export default {tools:[],apis:[" +
    pkg.provides
      .map(
        (api) =>
          "{id:" +
          JSON.stringify(api.id) +
          ",methods:[" +
          api.methods
            .map(
              (method) =>
                "{name:" +
                JSON.stringify(method.name) +
                ",invoke:async(input,session)=>{" +
                "return " +
                expression +
                ";}}",
            )
            .join(",") +
          "]}",
      )
      .join(",") +
    "]};"
  );
}
async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "t3-capability-runtime-"));
  const options = {
    rootDir: path.join(directory, "state"),
    environmentId: "env",
    services: [],
    authorize: () => true,
    timeoutMs: 3000,
    ...overrides,
  };
  let runtime = await createExtensionRuntime(options);
  t.after(async () => {
    await runtime.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  });
  let serial = 0;
  const source = async (pkg, code = implementation(pkg)) => {
    const dir = path.join(directory, "source-" + serial++);
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "t3-extension.json"), JSON.stringify(pkg));
    await fs.writeFile(path.join(dir, "server.mjs"), code);
    return dir;
  };
  const install = async (pkg, code, requested = grants) =>
    runtime.install(await source(pkg, code), requested);
  const invoke = (
    record,
    id = record.id + "/api",
    method = "value",
    input = {},
    abort = signal(),
    expectedGeneration,
  ) =>
    runtime.invokeApi(
      record.id,
      record.contentHash,
      {
        id,
        versionRange: "^1.0.0",
        method,
        input,
        context,
        ...(expectedGeneration === undefined ? {} : { expectedGeneration }),
      },
      abort,
    );
  return {
    directory,
    source,
    install,
    invoke,
    get runtime() {
      return runtime;
    },
    async restart() {
      await runtime.dispose();
      runtime = await createExtensionRuntime(options);
      return runtime;
    },
  };
}
test("independently installed consumer calls provider, restart preserves dependency and API identity", async (t) => {
  const f = await fixture(t);
  const provider = await f.install(metadata("test.provider"));
  const consumerPkg = metadata("test.consumer", {
    dependencies: [
      {
        pluginId: provider.id,
        versionRange: "^1",
        apis: [{ id: provider.id + "/api", versionRange: "^1" }],
      },
    ],
  });
  const consumer = await f.install(
    consumerPkg,
    implementation(
      consumerPkg,
      'session.invokeApi({id:"test.provider/api",versionRange:"^1",method:"value",input:{}})',
    ),
  );
  assert.equal(await f.invoke(consumer), "value");
  await f.restart();
  assert.equal(await f.invoke(consumer), "value");
  await f.runtime.disable(provider.id);
  await assert.rejects(f.invoke(consumer), /disabled|unavailable/i);
});
test("missing and incompatible dependencies expose no working API", async (t) => {
  const f = await fixture(t);
  const consumer = await f.install(
    metadata("test.consumer", {
      dependencies: [{ pluginId: "test.missing", versionRange: "^2", apis: [] }],
    }),
  );
  await assert.rejects(f.invoke(consumer), /missing|unavailable/i);
  await f.install(metadata("test.missing"));
  await assert.rejects(f.invoke(consumer), /incompatible|unavailable/i);
});
test("shared provider conflict requires durable selection and uses explicit fallback", async (t) => {
  const f = await fixture(t);
  const make = async (id) => {
    const pkg = metadata(id, { provides: [FILE_PRESENTATION_API] });
    return f.install(
      pkg,
      implementation(
        pkg,
        JSON.stringify({ surfaceId: id + "/files", placement: "side-panel", restoreState: {} }),
      ),
    );
  };
  const a = await make("test.first"),
    b = await make("test.second");
  const pkg = metadata("test.consumer", {
    requires: [{ id: FILE_PRESENTATION_API.id, versionRange: "^1" }],
  });
  const consumer = await f.install(pkg);
  await assert.rejects(
    f.invoke(consumer, FILE_PRESENTATION_API.id, "open", { relativePath: "README.md" }),
    /selection/i,
  );
  await f.runtime.selectApi({
    id: FILE_PRESENTATION_API.id,
    providerId: b.id,
    fallbackProviderIds: [a.id],
  });
  assert.equal(
    (await f.invoke(consumer, FILE_PRESENTATION_API.id, "open", { relativePath: "README.md" }))
      .surfaceId,
    b.id + "/files",
  );
  await f.restart();
  assert.equal(
    (await f.invoke(consumer, FILE_PRESENTATION_API.id, "open", { relativePath: "README.md" }))
      .surfaceId,
    b.id + "/files",
  );
  await f.runtime.disable(b.id);
  assert.equal(
    (await f.invoke(consumer, FILE_PRESENTATION_API.id, "open", { relativePath: "README.md" }))
      .surfaceId,
    a.id + "/files",
  );
});
test("provider output validation and crash do not break independent plugins", async (t) => {
  const f = await fixture(t);
  const badPkg = metadata("test.bad");
  const bad = await f.install(badPkg, implementation(badPkg, "42"));
  const good = await f.install(metadata("test.good"));
  await assert.rejects(f.invoke(bad), /output.*schema/i);
  assert.equal(await f.invoke(good), "value");
  const crashPkg = metadata("test.crash");
  const crash = await f.install(crashPkg, implementation(crashPkg, "process.exit(23)"));
  await assert.rejects(f.invoke(crash), /exit|failed|unavailable|configuration changed/i);
  assert.equal(await f.invoke(good), "value");
});
test("failed update handshake retains old version; rollback and restart preserve immutable snapshots", async (t) => {
  const f = await fixture(t);
  const record = await f.install(metadata("test.provider"));
  const nextPkg = metadata(record.id, { version: "2.0.0" });
  await assert.rejects(
    f.runtime.update(record.id, await f.source(nextPkg, "export default {tools:[],apis:[]};")),
    /APIs|handshake/i,
  );
  assert.equal(await f.invoke(record), "value");
  const updated = await f.runtime.update(
    record.id,
    await f.source(nextPkg, implementation(nextPkg, '"new"')),
  );
  assert.equal(await f.invoke(updated), "new");
  await assert.rejects(f.invoke(record), /content changed/i);
  await f.restart();
  const restored = await f.runtime.rollback(record.id);
  assert.equal(restored.contentHash, record.contentHash);
  assert.equal(await f.invoke(restored), "value");
});
test("authority revocation during delayed host service rejects stale result and aborts old generations", async (t) => {
  const entered = deferred(),
    finish = deferred();
  let authorized = true;
  const f = await fixture(t, {
    authorize: () => authorized,
    services: [
      {
        capability: grant,
        async invoke() {
          entered.resolve();
          await finish.promise;
          return "secret";
        },
      },
    ],
  });
  const pkg = metadata("test.provider");
  const provider = await f.install(
    pkg,
    implementation(pkg, 'session.invoke("t3.workspace/read-text",{})'),
  );
  const pending = f.invoke(provider);
  const rejected = assert.rejects(pending, /denied|changed|unavailable/i);
  await entered.promise;
  authorized = false;
  finish.resolve();
  await rejected;
  authorized = true;
  const discovery = await f.runtime.discoverApis(
    provider.id,
    provider.contentHash,
    context,
    signal(),
  );
  await f.runtime.selectApi({
    id: pkg.provides[0].id,
    providerId: provider.id,
    fallbackProviderIds: [],
  });
  await assert.rejects(
    f.invoke(provider, provider.id + "/api", "value", {}, signal(), discovery[0].generation),
    /stale/i,
  );
});

test("consumer cannot borrow provider grants through a grant-free entry API", async (t) => {
  const f = await fixture(t);
  await f.install(metadata("test.provider"));
  const pkg = metadata("test.consumer", {
    requires: [{ id: "test.provider/api", versionRange: "^1" }],
  });
  pkg.provides[0].methods[0].requiredGrants = [];
  const consumer = await f.install(
    pkg,
    implementation(
      pkg,
      'session.invokeApi({id:"test.provider/api",versionRange:"^1",method:"value",input:{}})',
    ),
    { capabilities: [], projectIds: ["project"] },
  );
  await assert.rejects(f.invoke(consumer), /denied/i);
});
test("explicit dependency API stays bound to its named provider despite a different global selection", async (t) => {
  const f = await fixture(t);
  const make = async (id) => {
    const pkg = metadata(id, { provides: [FILE_PRESENTATION_API] });
    return f.install(
      pkg,
      implementation(
        pkg,
        JSON.stringify({ surfaceId: id + "/files", placement: "side-panel", restoreState: {} }),
      ),
    );
  };
  const a = await make("test.first"),
    b = await make("test.second");
  const pkg = metadata("test.consumer", {
    dependencies: [
      {
        pluginId: a.id,
        versionRange: "^1",
        apis: [{ id: FILE_PRESENTATION_API.id, versionRange: "^1" }],
      },
    ],
  });
  const consumer = await f.install(pkg);
  await f.runtime.selectApi({
    id: FILE_PRESENTATION_API.id,
    providerId: b.id,
    fallbackProviderIds: [],
  });
  assert.equal(
    (await f.invoke(consumer, FILE_PRESENTATION_API.id, "open", { relativePath: "README.md" }))
      .surfaceId,
    a.id + "/files",
  );
});
test("caller version request cannot bypass the installed API requirement", async (t) => {
  const f = await fixture(t);
  const provider = await f.install(metadata("test.provider"));
  const pkg = metadata("test.consumer", {
    requires: [{ id: provider.id + "/api", versionRange: "^2" }],
  });
  const consumer = await f.install(pkg);
  await assert.rejects(
    f.runtime.invokeApi(
      consumer.id,
      consumer.contentHash,
      { id: provider.id + "/api", versionRange: "*", method: "value", input: {}, context },
      signal(),
    ),
    /incompatible|unavailable/i,
  );
});

test("a crashing provider does not cancel an unrelated in-flight API", async (t) => {
  const entered = deferred(),
    finish = deferred();
  const f = await fixture(t, {
    services: [
      {
        capability: grant,
        async invoke() {
          entered.resolve();
          await finish.promise;
          return "independent result";
        },
      },
    ],
  });
  const goodPkg = metadata("test.good");
  const good = await f.install(
    goodPkg,
    implementation(goodPkg, 'session.invoke("t3.workspace/read-text",{})'),
  );
  const badPkg = metadata("test.bad");
  const bad = await f.install(badPkg, implementation(badPkg, "process.exit(23)"));
  const pending = f.invoke(good);
  const completion = pending.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await entered.promise;
  await assert.rejects(f.invoke(bad), /exit|failed|unavailable|configuration changed/i);
  finish.resolve();
  assert.deepEqual(await completion, { value: "independent result" });
});

test("updating a dependency cancels its consumer's pending result before the new generation is callable", async (t) => {
  const entered = deferred(),
    finish = deferred();
  const f = await fixture(t, {
    services: [
      {
        capability: grant,
        async invoke() {
          entered.resolve();
          await finish.promise;
          return "old";
        },
      },
    ],
  });
  const providerPkg = metadata("test.provider");
  const provider = await f.install(
    providerPkg,
    implementation(providerPkg, 'session.invoke("t3.workspace/read-text",{})'),
  );
  const pkg = metadata("test.consumer", {
    dependencies: [
      {
        pluginId: provider.id,
        versionRange: "^1",
        apis: [{ id: provider.id + "/api", versionRange: "^1" }],
      },
    ],
  });
  const consumer = await f.install(
    pkg,
    implementation(
      pkg,
      'session.invokeApi({id:"test.provider/api",versionRange:"^1",method:"value",input:{}})',
    ),
  );
  const pending = f.invoke(consumer);
  const rejected = assert.rejects(pending, /changed|cancel|unavailable/i);
  await entered.promise;
  const next = metadata("test.provider", { version: "1.1.0" });
  await f.runtime.update(provider.id, await f.source(next, implementation(next, '"new"')));
  finish.resolve();
  await rejected;
  assert.equal(await f.invoke(consumer), "new");
});

test("changing selection cancels an implicit own-provider generic API call", async (t) => {
  const entered = deferred(),
    finish = deferred();
  const f = await fixture(t, {
    services: [
      {
        capability: "t3.file/open",
        async invoke() {
          entered.resolve();
          await finish.promise;
          return null;
        },
      },
    ],
  });
  const firstPkg = metadata("test.first", { provides: [FILE_PRESENTATION_API] });
  const first = await f.install(
    firstPkg,
    implementation(
      firstPkg,
      '(await session.invoke("t3.file/open",{}), {surfaceId:"test.first/files",placement:"side-panel",restoreState:{}})',
    ),
  );
  const secondPkg = metadata("test.second", { provides: [FILE_PRESENTATION_API] });
  const second = await f.install(
    secondPkg,
    implementation(
      secondPkg,
      '{surfaceId:"test.second/files",placement:"side-panel",restoreState:{}}',
    ),
  );
  await f.runtime.selectApi({
    id: FILE_PRESENTATION_API.id,
    providerId: first.id,
    fallbackProviderIds: [],
  });
  const pending = f.invoke(first, FILE_PRESENTATION_API.id, "open", { relativePath: "README.md" });
  const rejected = assert.rejects(pending, /changed|cancel|stale/i);
  await entered.promise;
  await f.runtime.selectApi({
    id: FILE_PRESENTATION_API.id,
    providerId: second.id,
    fallbackProviderIds: [],
  });
  finish.resolve();
  await rejected;
  assert.equal(
    (await f.invoke(first, FILE_PRESENTATION_API.id, "open", { relativePath: "README.md" }))
      .surfaceId,
    "test.second/files",
  );
});
test(
  "stale discovery startup failure cannot mark a replacement installation failed",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    const marker = path.join(f.directory, "staged"),
      enteredPath = path.join(f.directory, "entered");
    const pkg = metadata("test.provider");
    const delayed =
      'import fs from "node:fs/promises";\n' +
      "try { await fs.stat(" +
      JSON.stringify(marker) +
      "); await fs.writeFile(" +
      JSON.stringify(enteredPath) +
      ',"ready"); await new Promise(()=>{}); } ' +
      'catch (error) { if(error.code!=="ENOENT") throw error; await fs.writeFile(' +
      JSON.stringify(marker) +
      ',"staged"); }\n' +
      implementation(pkg);
    const installed = await f.install(pkg, delayed);
    const events = fs.watch(f.directory);
    const entered = (async () => {
      for await (const event of events) {
        if (event.filename === "entered") return;
      }
    })();
    const discovery = f.runtime.discoverApis(
      installed.id,
      installed.contentHash,
      context,
      signal(),
    );
    const rejected = assert.rejects(discovery, /stale|changed/i);
    await entered;
    const nextPkg = metadata(installed.id, { version: "1.1.0" });
    const next = await f.runtime.update(
      installed.id,
      await f.source(nextPkg, implementation(nextPkg, '"replacement"')),
    );
    await rejected;
    assert.equal(
      f.runtime.catalogue().pluginResolution.find((item) => item.id === next.id).status,
      "available",
    );
    assert.equal(await f.invoke(next), "replacement");
  },
);

test("read APIs and read-only model tools cannot upgrade to write API authority", async (t) => {
  let effects = 0;
  const mutationGrant = "test.host/write";
  const mutationApi = {
    id: "test.host/mutations",
    version: "1.0.0",
    methods: [
      {
        name: "write",
        inputSchema: { type: "object" },
        outputSchema: { type: "string" },
        effect: "write",
        requiredGrants: [mutationGrant],
      },
    ],
  };
  const f = await fixture(t, {
    apiProviders: [
      {
        providerId: "host.mutations",
        definition: mutationApi,
        invoke() {
          effects++;
          return "written";
        },
      },
    ],
  });
  const requested = { ...grants, capabilities: [...grants.capabilities, mutationGrant] };
  const requirement = [{ id: mutationApi.id, versionRange: "^1" }];
  const childCall =
    'session.invokeApi({id:"test.host/mutations",versionRange:"^1",method:"write",input:{},allowWrite:true})';
  const readPkg = metadata("test.reader", { requires: requirement });
  const read = await f.install(readPkg, implementation(readPkg, childCall), requested);
  await assert.rejects(f.invoke(read), /read.only.*write/i);
  assert.equal(effects, 0);
  const toolPkg = metadata("test.tool", { provides: [], requires: requirement });
  toolPkg.tools = [
    {
      id: "test.tool/run",
      title: "run",
      description: "Read-only model tool",
      readOnly: true,
      capabilities: [grant],
      inputSchema: { type: "object" },
    },
  ];
  const tool = await f.install(
    toolPkg,
    'export default {tools:[{id:"test.tool/run",invoke:async(input,session)=>' + childCall + "}]};",
    requested,
  );
  await assert.rejects(
    f.runtime.invoke("test.tool/run", {}, context, signal(), tool.contentHash),
    /read.only.*write/i,
  );
  assert.equal(effects, 0);
  const writePkg = metadata("test.writer", { requires: requirement });
  writePkg.provides[0].methods[0].effect = "write";
  const writer = await f.install(writePkg, implementation(writePkg, childCall), requested);
  assert.equal(await f.invoke(writer), "written");
  assert.equal(effects, 1);
});

test("API audit receipts identify authorized scope without recording request or result payloads", async (t) => {
  const audit = [];
  const f = await fixture(t, { auditApi: (event) => audit.push(event) });
  const provider = await f.install(metadata("test.audited"));
  assert.equal(
    await f.invoke(provider, "test.audited/api", "value", { secret: "DO_NOT_AUDIT_PAYLOAD" }),
    "value",
  );
  assert.equal(audit.length, 1);
  assert.equal(audit[0].environmentId, context.resource.environmentId);
  assert.equal(audit[0].projectId, context.resource.projectId);
  assert.equal(audit[0].callerId, provider.id);
  assert.equal(audit[0].outcome, "completed");
  assert.equal(JSON.stringify(audit).includes("DO_NOT_AUDIT_PAYLOAD"), false);
  assert.equal("input" in audit[0], false);
  assert.equal("result" in audit[0], false);
});

test("nested API audits preserve host-generated ancestry and root caller despite spoofed request fields", async (t) => {
  const audit = [];
  const hostApi = { ...definition("test.host"), id: "test.host/read" };
  const f = await fixture(t, {
    auditApi: (event) => audit.push(event),
    apiProviders: [{ providerId: "host.read", definition: hostApi, invoke: () => "nested result" }],
  });
  const providerPkg = metadata("test.provider", {
    requires: [{ id: hostApi.id, versionRange: "^1" }],
  });
  await f.install(
    providerPkg,
    implementation(
      providerPkg,
      'session.invokeApi({id:"test.host/read",versionRange:"^1",method:"value",input:{},callId:"forged-child",parentCallId:"forged-parent",rootCallerId:"forged-root"})',
    ),
  );
  const consumerPkg = metadata("test.consumer", {
    requires: [{ id: "test.provider/api", versionRange: "^1" }],
  });
  const consumer = await f.install(
    consumerPkg,
    implementation(
      consumerPkg,
      'session.invokeApi({id:"test.provider/api",versionRange:"^1",method:"value",input:{},requestId:"child-request"})',
    ),
  );
  assert.equal(
    await f.runtime.invokeApi(
      consumer.id,
      consumer.contentHash,
      {
        id: "test.consumer/api",
        versionRange: "^1",
        method: "value",
        input: {},
        context,
        requestId: "root-request",
        callId: "forged-call",
        parentCallId: "forged-parent",
        rootCallerId: "forged-root",
      },
      signal(),
    ),
    "nested result",
  );
  assert.equal(audit.length, 3);
  const outer = audit.find((event) => event.apiId === "test.consumer/api");
  const middle = audit.find((event) => event.apiId === "test.provider/api");
  const inner = audit.find((event) => event.apiId === hostApi.id);
  assert.equal(outer.parentCallId, undefined);
  assert.equal(middle.parentCallId, outer.callId);
  assert.equal(inner.parentCallId, middle.callId);
  assert.equal(inner.callerId, "test.provider");
  assert.equal(outer.callerId, consumer.id);
  assert.equal(new Set(audit.map((event) => event.callId)).size, 3);
  for (const event of audit) {
    assert.equal(event.rootCallerId, consumer.id);
    assert.match(
      event.callId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.equal(event.outcome, "completed");
  }
  assert.equal(outer.requestId, "root-request");
  assert.equal(middle.requestId, "child-request");
  assert.equal(JSON.stringify(audit).includes("forged-"), false);
});

test("durable grant replacement revokes pending work and rollback cannot restore old grants", async (t) => {
  const entered = deferred(),
    finish = deferred();
  const f = await fixture(t, {
    services: [
      {
        capability: grant,
        async invoke() {
          entered.resolve();
          await finish.promise;
          return "secret";
        },
      },
    ],
  });
  const pkg = metadata("test.permissions");
  const record = await f.install(
    pkg,
    implementation(pkg, 'session.invoke("t3.workspace/read-text",{})'),
  );
  const changed = metadata(record.id, { version: "1.0.1" });
  const current = await f.runtime.update(
    record.id,
    await f.source(changed, implementation(changed, 'session.invoke("t3.workspace/read-text",{})')),
  );
  const pending = f.invoke(current);
  const rejected = assert.rejects(pending, /changed|cancel|denied|unavailable|grants/i);
  await entered.promise;
  const empty = { capabilities: [], projectIds: [] };
  const revoked = await f.runtime.updateGrants(record.id, empty);
  assert.equal(revoked.contentHash, current.contentHash);
  assert.equal(revoked.enabled, true);
  finish.resolve();
  await rejected;
  await assert.rejects(f.invoke(current), /grants|denied/i);
  const rolled = await f.runtime.rollback(record.id);
  assert.deepEqual(rolled.grants, empty);
  assert.equal(rolled.package.manifest.version, "1.0.0");
  await f.restart();
  assert.deepEqual(f.runtime.list()[0].grants, empty);
  await assert.rejects(f.invoke(rolled), /grants|denied/i);
  await f.runtime.updateGrants(record.id, grants);
  assert.equal(await f.invoke(rolled), "secret");
  await assert.rejects(
    f.runtime.updateGrants(record.id, { capabilities: [""], projectIds: [] }),
    /grant|identity|id/i,
  );
  assert.deepEqual(f.runtime.list()[0].grants, grants);
});

test("provider generations survive unrelated installation changes but reject updates and revocation", async (t) => {
  const f = await fixture(t);
  let a = await f.install(metadata("test.alpha"));
  const discover = async () =>
    (await f.runtime.discoverApis(a.id, a.contentHash, context, signal())).find(
      (api) => api.id === "test.alpha/api" && api.providerId === a.id,
    ).generation;
  const initial = await discover();
  const b = await f.install(metadata("test.beta"));
  assert.equal(await f.invoke(a, "test.alpha/api", "value", {}, signal(), initial), "value");
  assert.equal(await discover(), initial);
  await f.runtime.disable(b.id);
  assert.equal(await discover(), initial);
  const next = metadata(a.id, { version: "1.0.1" });
  a = await f.runtime.update(a.id, await f.source(next));
  await assert.rejects(f.invoke(a, "test.alpha/api", "value", {}, signal(), initial), /stale/i);
  const updated = await discover();
  assert.ok(updated > initial);
  const beforeRevocation = await discover();
  a = await f.runtime.updateGrants(a.id, { ...grants, capabilities: [] });
  await assert.rejects(
    f.invoke(a, "test.alpha/api", "value", {}, signal(), beforeRevocation),
    /stale|denied/i,
  );
});

test("provider generation cannot be reused across runtime restart", async (t) => {
  const f = await fixture(t);
  const a = await f.install(metadata("test.restart"));
  const before = (await f.runtime.discoverApis(a.id, a.contentHash, context, signal()))[0]
    .generation;
  await f.runtime.update(a.id, await f.source(metadata(a.id, { version: "1.0.1" })));
  await f.restart();
  const current = f.runtime.list().find((record) => record.id === a.id);
  await assert.rejects(f.invoke(current, a.id + "/api", "value", {}, signal(), before), /stale/i);
  assert.equal(await f.invoke(f.runtime.list().find((record) => record.id === a.id)), "value");
});

test("selection cycles and restart never reuse a different provider generation", async (t) => {
  const f = await fixture(t);
  const make = async (id) => {
    const pkg = metadata(id, { provides: [FILE_PRESENTATION_API] });
    return f.install(
      pkg,
      implementation(
        pkg,
        JSON.stringify({ surfaceId: id + "/files", placement: "side-panel", restoreState: {} }),
      ),
    );
  };
  const a = await make("test.first"),
    b = await make("test.second");
  const select = (providerId) =>
    f.runtime.selectApi({ id: FILE_PRESENTATION_API.id, providerId, fallbackProviderIds: [] });
  const discover = async () =>
    (await f.runtime.discoverApis(a.id, a.contentHash, context, signal())).find(
      (api) => api.id === FILE_PRESENTATION_API.id && api.selected,
    ).generation;
  const invoke = (generation) =>
    f.invoke(
      a,
      FILE_PRESENTATION_API.id,
      "open",
      { relativePath: "README.md" },
      signal(),
      generation,
    );
  await select(a.id);
  const first = await discover();
  await select(b.id);
  await select(a.id);
  await assert.rejects(invoke(first), /stale/i);
  const second = await discover();
  await select(b.id);
  await f.restart();
  await assert.rejects(invoke(second), /stale/i);
  assert.equal((await invoke(await discover())).surfaceId, b.id + "/files");
});
