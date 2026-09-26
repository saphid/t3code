import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import React from "react";
import TestRenderer from "react-test-renderer";

import { ReadOnlyFileBody } from "./codeView.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, create } = TestRenderer;
const e = React.createElement;

function codeViewHost() {
  const received = [];
  const File = (props) => {
    received.push(props);
    return e("div", { "data-host-file": true });
  };
  return { host: { codeView: { version: 1, Diff: () => null, File } }, received };
}

async function render(props) {
  const calls = [];
  let root;
  await act(async () => {
    root = create(
      e(ReadOnlyFileBody, {
        path: "big.log",
        contents: "line 1\nline 2\n",
        wordWrap: null,
        reveal: null,
        renderFallback: () => {
          calls.push("fallback");
          return e("pre", { "data-own-pre": true });
        },
        ...props,
      }),
    );
  });
  return { root, calls };
}

NodeTest.describe("ReadOnlyFileBody", () => {
  NodeTest.it("keeps the own <pre> on hosts without the member", async () => {
    const { root, calls } = await render({ host: {} });
    NodeAssert.deepEqual(calls, ["fallback"]);
    NodeAssert.equal(root.root.findAll((node) => node.props["data-own-pre"]).length, 1);
  });

  NodeTest.it("keeps the own <pre> when the member is malformed", async () => {
    const { calls } = await render({ host: { codeView: { version: 1, File: () => null } } });
    NodeAssert.deepEqual(calls, ["fallback"]);
  });

  NodeTest.it("renders the host File when the member is present", async () => {
    const { host, received } = codeViewHost();
    const { root, calls } = await render({ host });
    NodeAssert.deepEqual(calls, []);
    NodeAssert.equal(root.root.findAll((node) => node.props["data-own-pre"]).length, 0);
    // No preference available: the host's own wrap setting applies.
    NodeAssert.deepEqual(received.at(-1), { path: "big.log", contents: "line 1\nline 2\n" });
  });

  NodeTest.it("forwards the panel's wrap preference and a pending reveal", async () => {
    const { host, received } = codeViewHost();
    await render({ host, wordWrap: false, reveal: { line: 2, requestId: 7 } });
    NodeAssert.deepEqual(received.at(-1), {
      path: "big.log",
      contents: "line 1\nline 2\n",
      wordWrap: false,
      reveal: { line: 2, requestId: 7 },
    });
  });
});
