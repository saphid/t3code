import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import React from "react";
import TestRenderer from "react-test-renderer";
import { createExtensionHost } from "../../dist/host.js";
import clientFactory from "./.t3-extension/client.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The built client factory only reads host.React; the API bridges are unused.
const clientHost = {
  React,
  invokeApi: () => Promise.reject(new Error("no APIs in this example")),
  subscribeApi: () => {
    throw new Error("no APIs in this example");
  },
  discoverApis: () => Promise.resolve([]),
  invokeTool: () => Promise.reject(new Error("no tools in this example")),
};
const extension = clientFactory(clientHost);
const record = (restoreState = null) => ({
  version: 1,
  surfaceId: "example.persisted-state/view",
  context: {
    resource: {
      namespace: "example.persisted-state",
      id: "resource",
      environmentId: "env",
      projectId: "project",
      threadId: "thread",
    },
    client: "web",
  },
  placement: "side-panel",
  stateVersion: 1,
  restoreState,
  fallback: "Counter unavailable",
});
const mount = async (host, id) => {
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      React.createElement(host.renderer(id), { snapshot: host.snapshot(id) }),
    );
  });
  return renderer;
};
const countText = (renderer) =>
  renderer.root.findByProps({ "aria-label": "Count" }).children.join("");

NodeTest.test("built client saves state and a reopened view restores it", async () => {
  const host = createExtensionHost({ authorize: () => true });
  host.register(extension);
  const first = await host.open(record());
  NodeAssert.equal(host.snapshot(first).status, "ready");
  const view = await mount(host, first);
  NodeAssert.equal(countText(view), "0");
  await TestRenderer.act(async () => {
    view.root.findByType("button").props.onClick();
  });
  NodeAssert.equal(countText(view), "1");
  const saved = host.snapshot(first).record;
  NodeAssert.deepEqual(saved.restoreState, { count: 1, label: "saved" });
  host.close(first);

  const second = await host.restore(saved);
  const reopened = await mount(host, second);
  NodeAssert.equal(countText(reopened), "1");
  host.dispose();
  NodeAssert.equal(host.diagnostics().views, 0);
});

NodeTest.test("schema-violating restore is unavailable with an actionable reason", async () => {
  const host = createExtensionHost({ authorize: () => true });
  host.register(extension);
  for (const [restoreState, pattern] of [
    [
      { count: "one" },
      /expected field "count" to be number, received string.*stateSchema.*stateVersion/s,
    ],
    [{ label: "x" }, /missing required field "count" \(number\).*received/s],
    [
      42,
      /expected null \(nothing saved yet\) or an object matching \{count: number, label\?: string\}; received 42/s,
    ],
  ]) {
    const id = await host.restore(record(restoreState));
    NodeAssert.equal(host.snapshot(id).status, "unavailable");
    NodeAssert.match(host.snapshot(id).reason, pattern);
    NodeAssert.match(host.snapshot(id).reason, /example\.persisted-state\/view/);
  }
  const mismatched = await host.restore({ ...record({ count: 1 }), stateVersion: 2 });
  NodeAssert.equal(host.snapshot(mismatched).status, "unavailable");
  NodeAssert.match(host.snapshot(mismatched).reason, /version is incompatible/);
  host.dispose();
});

NodeTest.test(
  "session.save rejects out-of-schema values with the same actionable error",
  async () => {
    const host = createExtensionHost({ authorize: () => true });
    let session;
    host.register({
      manifest: extension.manifest,
      surfaces: extension.surfaces.map((surface) => ({
        ...surface,
        createView(current) {
          session = current;
          return { renderer: () => null };
        },
      })),
    });
    await host.open(record());
    NodeAssert.throws(
      () => session.save({ count: "many" }),
      /Invalid restore state for "example\.persisted-state\/view" \(stateVersion 1\): expected field "count" to be number, received string.*Fix the value passed to session\.save/s,
    );
    host.dispose();
  },
);
