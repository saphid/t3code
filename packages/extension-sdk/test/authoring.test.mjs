import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import React from "react";
import TestRenderer from "react-test-renderer";
import { defineExtension, requireApi, useApiRead } from "../dist/authoring.js";
import { workspaceFilesApi } from "../dist/catalogue.js";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
NodeTest.test(
  "generated source uses existing package contracts and keeps the server separate",
  () => {
    const p = defineExtension({
      id: "test.reader",
      version: "1.0.0",
      requires: [requireApi(workspaceFilesApi)],
      surfaces: [
        {
          name: "view",
          title: "Reader",
          scope: "project",
          createView() {
            return { renderer: () => null };
          },
        },
      ],
      serverEntry: "server.ts",
    });
    NodeAssert.equal(p.package.format, 2);
    NodeAssert.deepEqual(p.package.tools, []);
    NodeAssert.equal(p.package.serverEntry, "server.mjs");
    NodeAssert.equal(p.serverEntry, "server.ts");
    const client = p.client({ React });
    NodeAssert.deepEqual(client.manifest, p.package.manifest);
    NodeAssert.equal(client.surfaces[0].id, "test.reader/view");
    NodeAssert.equal(client.surfaces[0].validateRestore({ unexpected: true }), false);
    NodeAssert.throws(() =>
      defineExtension({
        id: "test.reader",
        version: "1.0.0",
        surfaces: [{ name: "../escape", title: "Bad", scope: "project", createView() {} }],
      }),
    );
  },
);
NodeTest.test("declared assets select format 4 and reject unverifiable declarations", () => {
  const authored = defineExtension({
    id: "test.assets",
    version: "1.0.0",
    assets: [{ path: "assets/value.wasm", mediaType: "application/wasm" }],
    serverEntry: "server.ts",
  });
  NodeAssert.equal(authored.package.format, 4);
  NodeAssert.deepEqual(authored.package.assets, []);
  NodeAssert.deepEqual(authored.assets, [
    { path: "assets/value.wasm", mediaType: "application/wasm" },
  ]);
  NodeAssert.throws(
    () =>
      defineExtension({
        id: "test.assets",
        version: "1.0.0",
        assets: [{ path: "../escape.wasm", mediaType: "application/wasm" }],
        serverEntry: "server.ts",
      }),
    /Asset path/,
  );
  NodeAssert.throws(
    () =>
      defineExtension({
        id: "test.assets",
        version: "1.0.0",
        assets: [{ path: "assets/x.png", mediaType: "image/png" }],
        serverEntry: "server.ts",
      }),
    /media type/,
  );
});
NodeTest.test(
  "read helper suppresses old input, hidden and disposed results and resumes on show",
  async () => {
    const pending = [],
      listeners = new Set(),
      lifetime = new AbortController();
    const session = {
      context: {
        client: "test",
        resource: { namespace: "test.reader", id: "view", environmentId: "env" },
      },
      signal: lifetime.signal,
      visible: true,
      onVisibility(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
    const host = {
      React,
      invokeApi(request, signal) {
        return new Promise((resolve) => pending.push({ request, signal, resolve }));
      },
    };
    let latest, renderer;
    function View({ relativePath }) {
      const value = useApiRead(host, session, workspaceFilesApi, "readText", { relativePath });
      React.useEffect(() => {
        latest = value;
      }, [value]);
      return null;
    }
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(React.createElement(View, { relativePath: "old.txt" }));
    });
    NodeAssert.equal(pending.length, 1);
    await TestRenderer.act(async () => {
      renderer.update(React.createElement(View, { relativePath: "new.txt" }));
    });
    NodeAssert.equal(pending[0].signal.aborted, true);
    await TestRenderer.act(async () => {
      pending[0].resolve({ contents: "OLD" });
      pending[1].resolve({ contents: "NEW" });
    });
    NodeAssert.equal(latest.value.contents, "NEW");
    await TestRenderer.act(async () => {
      for (const fn of listeners) fn(false);
    });
    NodeAssert.equal(latest.status, "loading");
    NodeAssert.equal(pending[1].signal.aborted, true);
    await TestRenderer.act(async () => {
      for (const fn of listeners) fn(true);
    });
    NodeAssert.equal(pending.length, 3);
    await TestRenderer.act(async () => {
      renderer.unmount();
    });
    NodeAssert.equal(pending[2].signal.aborted, true);
    NodeAssert.equal(listeners.size, 0);
    pending[2].resolve({ contents: "LATE" });
  },
);
NodeTest.test("read helper reports denial without pretending success", async () => {
  const session = {
    context: {
      client: "test",
      resource: { namespace: "test.reader", id: "view", environmentId: "env" },
    },
    signal: new AbortController().signal,
    visible: true,
    onVisibility() {
      return () => {};
    },
  };
  const host = {
    React,
    async invokeApi() {
      throw new Error("Missing project grant");
    },
  };
  let result, renderer;
  function View() {
    const value = useApiRead(host, session, workspaceFilesApi, "readText", {
      relativePath: "README.md",
    });
    React.useEffect(() => {
      result = value;
    }, [value]);
    return null;
  }
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(View));
  });
  NodeAssert.deepEqual(result, { status: "unavailable", error: "Missing project grant" });
  await TestRenderer.act(async () => renderer.unmount());
});
