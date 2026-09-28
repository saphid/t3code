import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import React from "react";
import TestRenderer from "react-test-renderer";

import { useWorkspaceChanges } from "./mutationRefresh.ts";
import { TREE_DISCONNECTED_STATUS, useWorkspaceTree } from "./workspaceTree.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, create } = TestRenderer;
const e = React.createElement;

const session = {
  context: {
    resource: {
      namespace: "t3.extensions",
      id: "t3.files",
      environmentId: "env",
      projectId: "project",
      threadId: "thread",
    },
    client: "web",
    workspaceRevision: "rev",
  },
  signal: new AbortController().signal,
  restoring: false,
  visible: true,
  onVisibility: () => () => {},
  restoreState: null,
  publish: () => true,
  save: () => true,
  invoke: () => Promise.reject(new Error("no capabilities")),
  onDispose: () => {},
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A web-like host: the tree is a plain finite stream and the changes stream
 * is host-resumed, so the test drives the connection through the changes
 * stream's `onSuspended` and its resumed snapshot, as a transport drop does.
 */
function makeHost() {
  const treeSubscribes = [];
  let entries = [{ path: "a.ts", kind: "file" }];
  let changes = null;
  const host = {
    subscribeApi(request, signal) {
      NodeAssert.equal(request.id, "t3.workspace/tree");
      treeSubscribes.push(request);
      const snapshot = entries;
      return (async function* () {
        if (signal.aborted) return;
        yield { value: { kind: "chunk", entries: snapshot, truncated: false } };
        yield { value: { kind: "complete", entryCount: snapshot.length, truncated: false } };
      })();
    },
    resumableStreams: {
      version: 3,
      subscribeApi(request, signal, options) {
        NodeAssert.equal(`${request.id}#${request.name}`, "t3.workspace/changes#subscribeChanges");
        const queue = [];
        let wake = null;
        changes = {
          push(value) {
            queue.push(value);
            wake?.();
          },
          suspend: () => options.onSuspended(),
        };
        return (async function* () {
          while (!signal.aborted) {
            if (queue.length === 0)
              await new Promise((resolve) => {
                wake = resolve;
                signal.addEventListener("abort", resolve, { once: true });
              });
            while (queue.length > 0) yield { value: queue.shift() };
          }
        })();
      },
    },
  };
  return {
    host,
    treeSubscribes,
    setEntries: (next) => (entries = next),
    changes: () => changes,
  };
}

NodeTest.describe("useWorkspaceTree while the environment is disconnected", () => {
  NodeTest.it(
    "shows the disconnected line instead of loading, keeps the last tree and reloads on reconnect",
    async () => {
      const harness = makeHost();
      let tree = null;
      function Probe() {
        const changes = useWorkspaceChanges(harness.host, session, true);
        tree = useWorkspaceTree(harness.host, session, true, changes);
        return null;
      }
      let root;
      try {
        await act(async () => {
          root = create(e(Probe, {}));
          await sleep(10);
        });
        await act(async () => {
          harness.changes().push({ kind: "snapshot", mutationSeq: 0 });
          await sleep(10);
        });
        NodeAssert.equal(tree.status, "Files ready");
        NodeAssert.equal(harness.treeSubscribes.length, 1);

        // The transport drops: the host suspends the changes stream.
        await act(async () => {
          harness.changes().suspend();
          await sleep(10);
        });
        NodeAssert.equal(tree.status, TREE_DISCONNECTED_STATUS);
        NodeAssert.equal(tree.pending, false);
        NodeAssert.deepEqual(
          tree.entries.map((entry) => entry.path),
          ["a.ts"],
        );
        // Refresh while disconnected asks nothing and never shows loading.
        await act(async () => {
          tree.refresh();
          await sleep(10);
        });
        NodeAssert.equal(harness.treeSubscribes.length, 1);
        NodeAssert.equal(tree.status, TREE_DISCONNECTED_STATUS);

        // The connection returns with a fresh snapshot: the tree reloads.
        harness.setEntries([
          { path: "a.ts", kind: "file" },
          { path: "b.ts", kind: "file" },
        ]);
        await act(async () => {
          harness.changes().push({ kind: "snapshot", mutationSeq: 0 });
          await sleep(10);
        });
        NodeAssert.equal(harness.treeSubscribes.length, 2);
        NodeAssert.equal(tree.status, "Files ready");
        NodeAssert.deepEqual(
          tree.entries.map((entry) => entry.path),
          ["a.ts", "b.ts"],
        );
      } finally {
        if (root) await act(async () => root.unmount());
      }
    },
  );
});
