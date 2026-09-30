import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import React from "react";
import TestRenderer from "react-test-renderer";
import { useExternalEditor } from "./editorBridge.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, create } = TestRenderer;
const session = {
  context: {
    resource: {
      namespace: "files",
      id: "view",
      environmentId: "env",
      projectId: "project",
      threadId: "thread",
    },
    client: "web",
  },
  signal: new AbortController().signal,
};

NodeTest.test(
  "Files probes capabilities, opens the scoped path through 1.1.0, and names refusals",
  async () => {
    let latest;
    let outcome = {
      status: "opened",
      path: "/remote/repo/src/a.ts",
      editor: "vscode",
      url: "vscode://vscode-remote/ssh-remote+dev/remote/repo/src/a.ts",
    };
    const calls = [];
    const host = {
      invokeApi: async (request) => {
        calls.push(request);
        if (outcome instanceof Error) throw outcome;
        return request.method === "getCapabilities"
          ? { adapter: "host.ui.editor", operations: { openPath: true }, clients: [] }
          : outcome;
      },
    };
    function Probe() {
      const current = useExternalEditor(host, session);
      React.useEffect(() => {
        latest = current;
      });
      return null;
    }
    let root;
    try {
      await act(async () => {
        root = create(React.createElement(Probe));
      });
      NodeAssert.equal(latest.blockReason, null);
      await act(async () => {
        latest.openInEditor("src/a.ts");
      });
      NodeAssert.deepEqual(calls.at(-1).input, { path: "src/a.ts", workspace: true });
      NodeAssert.equal(calls.at(-1).versionRange, "^1.1.0");
      NodeAssert.equal(calls.at(-1).id, "t3.ui/editor");
      NodeAssert.deepEqual(latest.state, { kind: "opened", path: "src/a.ts" });
      outcome = {
        status: "refused",
        reason: "open-failed",
        message: "Remote editor URL was refused.",
      };
      await act(async () => {
        latest.openInEditor("src/b.ts");
      });
      NodeAssert.deepEqual(latest.state, {
        kind: "failed",
        path: "src/b.ts",
        message: outcome.message,
      });
      outcome = new Error("API capability denied: t3.ui/editor.open");
      await act(async () => {
        latest.openInEditor("src/c.ts");
      });
      NodeAssert.deepEqual(latest.state, {
        kind: "failed",
        path: "src/c.ts",
        message: outcome.message,
      });
    } finally {
      if (root) await act(async () => root.unmount());
    }
  },
);

NodeTest.test("a denied or unavailable editor probe never launches", async () => {
  for (const reply of [
    new Error("client disconnected"),
    { adapter: "host.ui.editor", operations: { openPath: false }, clients: [] },
  ]) {
    let latest;
    const calls = [];
    const host = {
      invokeApi: async (request) => {
        calls.push(request);
        if (reply instanceof Error) throw reply;
        return reply;
      },
    };
    function Probe() {
      const current = useExternalEditor(host, session);
      React.useEffect(() => {
        latest = current;
      });
      return null;
    }
    let root;
    try {
      await act(async () => {
        root = create(React.createElement(Probe));
      });
      NodeAssert.ok(latest.blockReason);
      await act(async () => latest.openInEditor("src/a.ts"));
      NodeAssert.deepEqual(
        calls.map(({ method }) => method),
        ["getCapabilities"],
      );
    } finally {
      if (root) await act(async () => root.unmount());
    }
  }
});

NodeTest.test(
  "switching hosts aborts an in-flight editor open and ignores its late receipt",
  async () => {
    let latest;
    let settle;
    let openSignal;
    const capabilities = { adapter: "host.ui.editor", operations: { openPath: true }, clients: [] };
    const first = {
      invokeApi: async (request, signal) => {
        if (request.method === "getCapabilities") return capabilities;
        openSignal = signal;
        return new Promise((resolve) => {
          settle = resolve;
        });
      },
    };
    const second = {
      invokeApi: async () => ({ ...capabilities, operations: { openPath: false } }),
    };
    function Probe({ host }) {
      const current = useExternalEditor(host, session);
      React.useEffect(() => {
        latest = current;
      });
      return null;
    }
    let root;
    try {
      await act(async () => {
        root = create(React.createElement(Probe, { host: first }));
      });
      await act(async () => {
        latest.openInEditor("src/a.ts");
      });
      NodeAssert.equal(latest.state.kind, "opening");
      await act(async () => {
        root.update(React.createElement(Probe, { host: second }));
      });
      NodeAssert.equal(openSignal.aborted, true);
      NodeAssert.equal(latest.state.kind, "idle");
      NodeAssert.ok(latest.blockReason);
      await act(async () => {
        settle({ status: "refused", reason: "open-failed", message: "late failure" });
      });
      NodeAssert.equal(latest.state.kind, "idle");
    } finally {
      if (root) await act(async () => root.unmount());
    }
  },
);
