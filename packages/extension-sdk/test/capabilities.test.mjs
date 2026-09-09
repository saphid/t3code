import assert from "node:assert/strict";
import test from "node:test";
import { bindApi, validateApiDefinition } from "../dist/capabilities.js";
import { workspaceFilesApi, FILE_PRESENTATION_API } from "../dist/catalogue.js";
import { validateEnvironmentPackage, validateServerExtension } from "../dist/environment.js";
const manifest = { id: "example.files", apiVersion: 1, version: "1.0.0", surfaces: [] };
const pkg = {
  format: 2,
  manifest,
  serverEntry: "server.mjs",
  tools: [],
  dependencies: [],
  provides: [FILE_PRESENTATION_API],
  requires: [],
};
test("format2 shared providers preserve exact contracts and executable method handshake", () => {
  assert.equal(validateEnvironmentPackage(pkg).format, 2);
  assert.throws(
    () =>
      validateEnvironmentPackage({
        ...pkg,
        provides: [
          {
            ...FILE_PRESENTATION_API,
            methods: [{ ...FILE_PRESENTATION_API.methods[0], requiredGrants: [] }],
          },
        ],
      }),
    /contract/,
  );
  assert.throws(() => validateServerExtension(pkg, { tools: [] }), /APIs/);
  assert.throws(
    () =>
      validateServerExtension(pkg, {
        tools: [],
        apis: [{ id: FILE_PRESENTATION_API.id, methods: [{ name: "wrong", invoke() {} }] }],
      }),
    /methods/,
  );
  assert.equal(
    validateServerExtension(pkg, {
      tools: [],
      apis: [
        {
          id: FILE_PRESENTATION_API.id,
          methods: [
            {
              name: "open",
              invoke() {
                return null;
              },
            },
          ],
        },
      ],
    }).apis.length,
    1,
  );
  assert.equal(
    validateEnvironmentPackage({ format: 1, manifest, serverEntry: "server.mjs", tools: [] })
      .format,
    1,
  );
});
test("malformed API descriptors and external schema refs fail before registration", () => {
  for (const bad of [
    null,
    {},
    { id: "example.files/api", version: "1.0.0" },
    { ...FILE_PRESENTATION_API, methods: [null] },
    {
      ...FILE_PRESENTATION_API,
      methods: [
        { ...FILE_PRESENTATION_API.methods[0], inputSchema: { $ref: "https://example.com" } },
      ],
    },
  ])
    assert.throws(() => validateApiDefinition(bad));
});
test("typed binding delivers public invocation and result without private host imports", async () => {
  const context = {
    resource: { namespace: "example.files", id: "root", environmentId: "env" },
    client: "web",
  };
  let received;
  const client = {
    async invokeApi(request, signal) {
      received = request;
      assert.equal(signal.aborted, false);
      return { entries: [], nextCursor: null };
    },
  };
  const result = await bindApi(workspaceFilesApi, client, context).invoke(
    "listEntries",
    { relativePath: "" },
    new AbortController().signal,
  );
  assert.deepEqual(result, { entries: [], nextCursor: null });
  assert.equal(received.id, "t3.workspace/files");
  assert.equal(received.context, context);
});

test("package versions preserve semver build metadata", () => {
  assert.equal(
    validateEnvironmentPackage({ ...pkg, manifest: { ...manifest, version: "1.0.0+build.1" } })
      .manifest.version,
    "1.0.0+build.1",
  );
});
