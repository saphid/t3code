import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import {
  GENERIC_API_CATALOGUE,
  UI_EXTERNAL_OPEN,
  UI_NAVIGATION_OPEN,
  UI_NAVIGATION_OPEN_SESSION,
  uiNavigationApi,
} from "../dist/catalogue.js";
import * as Catalogue from "../dist/catalogue.js";
import { CLIENT_PROVIDER_APIS } from "../dist/clientProviders.js";
import { ApiVersionError, bindApi } from "../dist/capabilities.js";

NodeTest.test("t3.ui/navigation is a shared catalogue contract behind its own grant", () => {
  NodeAssert.ok(GENERIC_API_CATALOGUE.includes(uiNavigationApi.definition));
  const methods = Object.fromEntries(
    uiNavigationApi.definition.methods.map((method) => [method.name, method]),
  );
  NodeAssert.deepEqual(Object.keys(methods).sort(), [
    "getCapabilities",
    "openAgentSession",
    "openFile",
    "openThread",
  ]);
  NodeAssert.deepEqual(methods.openThread.requiredGrants, [UI_NAVIGATION_OPEN]);
  NodeAssert.equal(methods.openThread.effect, "write");
  NodeAssert.deepEqual(methods.getCapabilities.requiredGrants, []);
  NodeAssert.ok(CLIENT_PROVIDER_APIS.has("t3.client/navigation"));
});

NodeTest.test("openThread takes a thread reference, not a URL or route", () => {
  const openThread = uiNavigationApi.definition.methods.find(
    (method) => method.name === "openThread",
  );
  NodeAssert.deepEqual(openThread.inputSchema.required, ["threadId"]);
  NodeAssert.equal(openThread.inputSchema.additionalProperties, false);
  NodeAssert.deepEqual(Object.keys(openThread.inputSchema.properties).sort(), [
    "surfaceId",
    "threadId",
  ]);
  const refused = openThread.outputSchema.oneOf.find(
    (branch) => branch.properties.status.const === "refused",
  );
  NodeAssert.deepEqual(refused.properties.reason.enum, [
    "unknown-thread",
    "out-of-scope",
    "surface-not-found",
  ]);
});

NodeTest.test("openAgentSession names an agent, never a URL, behind its own grant", () => {
  const method = uiNavigationApi.definition.methods.find(
    (candidate) => candidate.name === "openAgentSession",
  );
  NodeAssert.equal(method.effect, "write");
  // Distinct from in-app routing and from the any-URL external opener.
  NodeAssert.deepEqual(method.requiredGrants, [UI_NAVIGATION_OPEN_SESSION]);
  NodeAssert.notEqual(UI_NAVIGATION_OPEN_SESSION, UI_NAVIGATION_OPEN);
  NodeAssert.notEqual(UI_NAVIGATION_OPEN_SESSION, UI_EXTERNAL_OPEN);
  NodeAssert.equal(method.inputSchema.additionalProperties, false);
  NodeAssert.deepEqual(Object.keys(method.inputSchema.properties), ["agentId"]);
  const [opened, refused] = method.outputSchema.oneOf;
  NodeAssert.ok(!("url" in opened.properties));
  NodeAssert.deepEqual(refused.properties.reason.enum, [
    "unknown-thread",
    "unknown-agent",
    "no-session",
    "opener-refused",
  ]);
  const capabilities = uiNavigationApi.definition.methods.find(
    (candidate) => candidate.name === "getCapabilities",
  );
  NodeAssert.ok(
    JSON.stringify(capabilities.outputSchema).includes("openAgentSession"),
    "getCapabilities reports openAgentSession availability",
  );
});

NodeTest.test("openFile names a workspace path on the caller's own thread, never a surface", () => {
  const method = uiNavigationApi.definition.methods.find(
    (candidate) => candidate.name === "openFile",
  );
  NodeAssert.ok(method, "t3.ui/navigation exposes openFile");
  NodeAssert.equal(method.effect, "write");
  NodeAssert.deepEqual(method.requiredGrants, [UI_NAVIGATION_OPEN]);
  NodeAssert.equal(method.inputSchema.additionalProperties, false);
  NodeAssert.deepEqual(method.inputSchema.required, ["relativePath"]);
  // No thread, surface or provider id: the host opens the file where its
  // native links do, through the selected t3.file/presentation provider.
  NodeAssert.deepEqual(Object.keys(method.inputSchema.properties).sort(), ["line", "relativePath"]);
  const refused = method.outputSchema.oneOf.find(
    (branch) => branch.properties.status.const === "refused",
  );
  NodeAssert.deepEqual(refused.properties.reason.enum, [
    "unknown-thread",
    "out-of-scope",
    "invalid-path",
  ]);
  const client = CLIENT_PROVIDER_APIS.get("t3.client/navigation").methods.find(
    (candidate) => candidate.name === "openFile",
  );
  NodeAssert.ok(client, "t3.client/navigation backs openFile");
  NodeAssert.deepEqual(client.outputSchema, method.outputSchema);
  const capabilities = uiNavigationApi.definition.methods.find(
    (candidate) => candidate.name === "getCapabilities",
  );
  NodeAssert.ok(JSON.stringify(capabilities.outputSchema).includes("openFile"));
});

NodeTest.test(
  "openWorkspaceFile opens through t3.ui/navigation and refuses unsafe paths locally",
  async () => {
    NodeAssert.equal(typeof Catalogue.openWorkspaceFile, "function");
    const context = { client: "web", resource: { namespace: "ext", id: "ext.a" } };
    const requests = [];
    const client = {
      discoverApis: async () => [{ id: "t3.ui/navigation", version: "1.1.0" }],
      invokeApi: (request) => {
        requests.push(request);
        return Promise.resolve({ status: "opened", relativePath: request.input.relativePath });
      },
    };
    const signal = new AbortController().signal;
    for (const path of ["", "../x", "/etc/passwd", "a//b", "a\\b", "./a", "C:/x"])
      NodeAssert.deepEqual(await Catalogue.openWorkspaceFile(client, context, path, { signal }), {
        status: "refused",
        reason: "invalid-path",
      });
    NodeAssert.equal(requests.length, 0);
    NodeAssert.deepEqual(
      await Catalogue.openWorkspaceFile(client, context, "src/a.ts", { line: 3, signal }),
      { status: "opened", relativePath: "src/a.ts" },
    );
    NodeAssert.deepEqual(
      requests.map(({ id, versionRange, method, input }) => ({ id, versionRange, method, input })),
      [
        {
          id: "t3.ui/navigation",
          versionRange: "^1.1.0",
          method: "openFile",
          input: { relativePath: "src/a.ts", line: 3 },
        },
      ],
    );
    NodeAssert.equal(typeof Catalogue.describeOpenFileRefusal, "function");
    for (const reason of ["unknown-thread", "out-of-scope", "invalid-path"])
      NodeAssert.match(Catalogue.describeOpenFileRefusal(reason), /\S/);
  },
);

// Review finding (proof-host-6 P3): openFile shipped inside the immutable
// 1.0.0. It is a 1.1.0 addition: packs keep loading on a 1.0.0 host and
// probe before they call it.
NodeTest.test("openFile is a 1.1.0 addition over the 1.0.0 baseline", async () => {
  NodeAssert.equal(uiNavigationApi.definition.version, "1.1.0");
  NodeAssert.equal(uiNavigationApi.baseline, "1.0.0");
  NodeAssert.equal(CLIENT_PROVIDER_APIS.get("t3.client/navigation").version, "1.1.0");
  const requests = [];
  const client = {
    invokeApi: (request) => {
      requests.push(request);
      return Promise.resolve({ status: "opened", threadId: "t" });
    },
  };
  const context = { client: "web", resource: { namespace: "ext", id: "ext.a" } };
  const signal = new AbortController().signal;
  const baseline = bindApi(uiNavigationApi, client, context);
  await NodeAssert.rejects(
    baseline.invoke("openFile", { relativePath: "a.ts" }, signal),
    (error) => error instanceof ApiVersionError,
  );
  await baseline.invoke("openThread", { threadId: "t" }, signal);
  NodeAssert.deepEqual(
    requests.map(({ method, versionRange }) => ({ method, versionRange })),
    [{ method: "openThread", versionRange: "^1.0.0" }],
  );
});

NodeTest.test("openWorkspaceFile degrades on a host older than 1.1.0", async () => {
  NodeAssert.equal(typeof Catalogue.openWorkspaceFile, "function");
  const requests = [];
  const client = {
    discoverApis: async () => [{ id: "t3.ui/navigation", version: "1.0.0" }],
    invokeApi: (request) => {
      requests.push(request);
      return Promise.resolve({ status: "opened", relativePath: request.input.relativePath });
    },
  };
  const context = { client: "web", resource: { namespace: "ext", id: "ext.a" } };
  NodeAssert.deepEqual(
    await Catalogue.openWorkspaceFile(client, context, "src/a.ts", {
      signal: new AbortController().signal,
    }),
    { status: "refused", reason: "host-unsupported" },
  );
  NodeAssert.equal(requests.length, 0);
  NodeAssert.match(Catalogue.describeOpenFileRefusal("host-unsupported"), /\S/);
});

// Review finding (proof-host-6 P5): a file link's line reaches the selected
// presentation. `open.line` is a 1.1.0 addition; 1.0.0 providers keep matching.
NodeTest.test("t3.file/presentation 1.1.0 adds open.line and keeps 1.0.0 frozen", async () => {
  const { filePresentationApi } = Catalogue;
  NodeAssert.equal(filePresentationApi.definition.version, "1.1.0");
  NodeAssert.equal(filePresentationApi.baseline, "1.0.0");
  const frozen = GENERIC_API_CATALOGUE.find(
    (api) => api.id === "t3.file/presentation" && api.version === "1.0.0",
  );
  NodeAssert.ok(frozen, "the published 1.0.0 stays in the catalogue");
  NodeAssert.deepEqual(Object.keys(frozen.methods[0].inputSchema.properties), ["relativePath"]);
  NodeAssert.doesNotThrow(() => Catalogue.assertProvidedApiOwner("other.plugin", frozen));
  const context = { client: "web", resource: { namespace: "ext", id: "ext.a" } };
  const client = { invokeApi: () => Promise.resolve({}) };
  await NodeAssert.rejects(
    bindApi(filePresentationApi, client, context).invoke(
      "open",
      { relativePath: "a.ts", line: 2 },
      new AbortController().signal,
    ),
    (error) => error instanceof ApiVersionError,
  );
});
