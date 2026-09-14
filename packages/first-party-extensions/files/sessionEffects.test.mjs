import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import React from "react";
import TestRenderer from "react-test-renderer";

import { useFileEditor } from "./editorSession.ts";
import { useMutationRefresh, useWorkspaceChanges } from "./mutationRefresh.ts";

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

NodeTest.describe("useFileEditor", () => {
  // Regression for the review reproduction (M1): a mutation-triggered refresh
  // reruns the editor effect and aborts that run's read signal; the retained
  // coordinator must still save afterwards — its persist signal is the
  // session's, not the dead refresh-read one.
  NodeTest.it("saves cleanly after a refresh superseded the open read", async () => {
    const reads = [];
    const saves = [];
    const host = {
      invokeApi(request, signal) {
        if (request.method === "readSnapshot") {
          reads.push(signal);
          return Promise.resolve({
            kind: "editable",
            contents: `remote-${reads.length}`,
            revision: `rev-${reads.length}`,
          });
        }
        if (request.method === "save") {
          signal.throwIfAborted();
          saves.push({ input: request.input, aborted: signal.aborted });
          return Promise.resolve({ kind: "saved", revision: `rev-save-${saves.length}` });
        }
        return Promise.reject(new Error(`unexpected ${request.method}`));
      },
    };
    let editor;
    function Probe(props) {
      const current = useFileEditor(
        host,
        session,
        props.selected,
        "text",
        props.refreshRevision,
        true,
      );
      React.useEffect(() => {
        editor = current;
      });
      return null;
    }
    let root;
    try {
      await act(async () => {
        root = create(e(Probe, { selected: "a.txt", refreshRevision: 0 }));
      });
      NodeAssert.equal(reads.length, 1);
      NodeAssert.equal(reads[0].aborted, false);
      NodeAssert.equal(editor.surface.contents, "remote-1");

      // A mutation bump refreshes: the first read's signal is aborted and the
      // snapshot is re-read — while the coordinator is retained for the path.
      await act(async () => {
        root.update(e(Probe, { selected: "a.txt", refreshRevision: 1 }));
      });
      NodeAssert.equal(reads.length, 2);
      NodeAssert.equal(reads[0].aborted, true);
      NodeAssert.equal(reads[1].aborted, false);
      NodeAssert.equal(editor.surface.contents, "remote-2");

      await act(async () => {
        editor.change("local edit");
        editor.retry();
      });
      NodeAssert.equal(saves.length, 1);
      NodeAssert.equal(saves[0].aborted, false);
      NodeAssert.equal(editor.surface.saveState.kind, "saved");
    } finally {
      if (root) await act(async () => root.unmount());
    }
  });
});

NodeTest.describe("useMutationRefresh", () => {
  let calls;
  function Probe(props) {
    useMutationRefresh({
      mutationSeq: props.seq,
      enabled: props.enabled,
      refresh: () => calls.push(props.seq),
    });
    return null;
  }

  // M2: no baseline suppression — the first observed nonzero seq must refresh
  // because it may fold mutations that landed during the view's initial reads.
  NodeTest.it("refreshes once on the first observed nonzero seq, never on seq 0", async () => {
    calls = [];
    let root;
    try {
      await act(async () => {
        root = create(e(Probe, { seq: 0, enabled: true }));
      });
      NodeAssert.equal(calls.length, 0);
      await act(async () => {
        root.update(e(Probe, { seq: 1, enabled: true }));
      });
      NodeAssert.deepEqual(calls, [1]);
    } finally {
      if (root) await act(async () => root.unmount());
    }
  });

  NodeTest.it("fires once per seq and catches up when the latch opens", async () => {
    calls = [];
    let root;
    try {
      await act(async () => {
        root = create(e(Probe, { seq: 1, enabled: true }));
      });
      NodeAssert.equal(calls.length, 1);
      // Same seq does not refire.
      await act(async () => {
        root.update(e(Probe, { seq: 1, enabled: true }));
      });
      NodeAssert.equal(calls.length, 1);
      // Latched: a bump while disabled stays pending.
      await act(async () => {
        root.update(e(Probe, { seq: 2, enabled: false }));
      });
      NodeAssert.equal(calls.length, 1);
      await act(async () => {
        root.update(e(Probe, { seq: 2, enabled: true }));
      });
      NodeAssert.equal(calls.length, 2);
    } finally {
      if (root) await act(async () => root.unmount());
    }
  });
});

NodeTest.describe("useWorkspaceChanges", () => {
  function openStream(signal, frames) {
    return (async function* () {
      for (const frame of frames) {
        if (signal.aborted) return;
        yield { value: frame };
      }
      // Stay open until aborted — a real stream does not end silently.
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    })();
  }

  NodeTest.it("delivers the subscription snapshot to the mutation gate", async () => {
    const subscribes = [];
    const refreshes = [];
    const host = {
      subscribeApi(request, signal) {
        subscribes.push(request);
        return openStream(signal, [{ kind: "snapshot", mutationSeq: 1 }]);
      },
    };
    let probeStatus = "idle";
    function Probe() {
      const changes = useWorkspaceChanges(host, session, true, { retryMs: 5, errorRetryMs: 5 });
      useMutationRefresh({
        mutationSeq: changes.mutationSeq,
        enabled: true,
        refresh: () => refreshes.push(changes.mutationSeq),
      });
      React.useEffect(() => {
        probeStatus = changes.status;
      });
      return null;
    }
    let root;
    try {
      await act(async () => {
        root = create(e(Probe, {}));
        await sleep(20);
      });
      NodeAssert.equal(probeStatus, "live");
      // The snapshot's seq=1 — folded before this view subscribed — still
      // fires one refresh: a mutation between the initial reads and stream
      // setup is not swallowed as a baseline.
      NodeAssert.deepEqual(refreshes, [1]);
    } finally {
      if (root) await act(async () => root.unmount());
    }
  });

  NodeTest.it(
    "reports degraded while retries fail and recovers when the stream returns",
    async () => {
      const subscribes = [];
      let fail = true;
      const host = {
        subscribeApi(request, signal) {
          subscribes.push(request);
          if (fail) throw new Error("capability denied");
          return openStream(signal, [{ kind: "snapshot", mutationSeq: 4 }]);
        },
      };
      let probeStatus = "idle";
      function Probe() {
        const changes = useWorkspaceChanges(host, session, true, { retryMs: 5, errorRetryMs: 5 });
        React.useEffect(() => {
          probeStatus = changes.status;
        });
        return null;
      }
      // The detached retry loop's continuations are pumped across act
      // boundaries — each act lets pending timers resolve one step, so retry
      // progress is observed by driving acts, not by a single sleep window.
      let root;
      try {
        await act(async () => {
          root = create(e(Probe, {}));
          await sleep(10);
        });
        NodeAssert.equal(probeStatus, "degraded");
        fail = false;
        for (let i = 0; i < 10; i += 1) {
          if (probeStatus === "live") break;
          await act(async () => {
            await sleep(10);
          });
        }
        NodeAssert.ok(subscribes.length >= 2, "a failed attempt is retried");
        NodeAssert.equal(probeStatus, "live");
        NodeAssert.deepEqual(
          subscribes.at(-1).input,
          { threadId: "thread" },
          "retries resubscribe the same thread",
        );
      } finally {
        if (root) await act(async () => root.unmount());
      }
    },
  );
});
