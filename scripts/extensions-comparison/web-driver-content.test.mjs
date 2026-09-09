import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import { observedNodes } from "./web-driver-content.mjs";
import {
  contentFixture,
  completeCycles,
  reusablePage,
  terminalChunks,
} from "./web-driver-observations.mjs";
import { encodedMarkerCommand } from "./web-driver-readiness.mjs";

const node = (id, attributes, children = []) => ({
  nodeType: 1,
  nodeName: "DIV",
  backendNodeId: id,
  attributes,
  children,
});
const text = (value) => ({ nodeType: 3, nodeName: "#text", nodeValue: value });
NodeTest.test(
  "content oracle excludes chat echoes, hidden content and script text while inspecting closed shadow trees",
  () => {
    const tree = node(
      1,
      [],
      [
        node(2, [], [text("fixture")]),
        node(
          3,
          ["data-right-panel-surface-content", ""],
          [
            node(4, ["aria-hidden", "true"], [text("fixture")]),
            { ...node(5, [], [text("fixture")]), nodeName: "SCRIPT" },
            {
              ...node(6, []),
              shadowRoots: [
                {
                  nodeType: 11,
                  nodeName: "#document-fragment",
                  children: [node(7, [], [text("fixture")])],
                },
              ],
            },
          ],
        ),
      ],
    );
    NodeAssert.deepEqual(
      observedNodes(tree, { text: "fixture" }).map((x) => x.backendNodeId),
      [7],
    );
    NodeAssert.deepEqual(observedNodes(node(1, [], [text("fixture")]), { text: "fixture" }), []);
  },
);
NodeTest.test("tree item readiness requires both actual path and role inside the panel", () => {
  const tree = node(
    1,
    ["data-right-panel-surface-content", ""],
    [
      node(2, ["data-item-path", "new.txt"], []),
      node(3, ["data-item-path", "new.txt", "role", "treeitem"], []),
    ],
  );
  NodeAssert.deepEqual(
    observedNodes(tree, { itemPath: "new.txt" }).map((x) => x.backendNodeId),
    [3],
  );
});
NodeTest.test("shell-only and unowned terminal fixtures cannot opt into content proof", () => {
  NodeAssert.throws(() => contentFixture({ target: {} }, "files"));
  NodeAssert.throws(() =>
    contentFixture(
      { target: { content: { diff: { file: "a", before: "", after: "b" } } } },
      "diff",
    ),
  );
  const target = {
    webUrl: "http://localhost:8179/env/a",
    content: { terminal: { threadId: "a", terminalId: "term-1", allowInput: true } },
  };
  NodeAssert.equal(contentFixture({ target }, "terminal").terminalId, "term-1");
  NodeAssert.throws(() =>
    contentFixture({ target: { ...target, webUrl: "http://localhost:8179/env/b" } }, "terminal"),
  );
  NodeAssert.throws(() =>
    contentFixture(
      { target: { ...target, content: { terminal: { threadId: "a", terminalId: "term-1" } } } },
      "terminal",
    ),
  );
});
NodeTest.test(
  "raw completion rejects omitted, duplicated, invalid, unproven and page-error samples",
  () => {
    const sample = { cycle: 0, openMs: 1, hideMs: 2, content: { matched: true } };
    const raw = JSON.stringify(sample) + "\n";
    NodeAssert.equal(completeCycles(raw, 1, []).length, 1);
    for (const [value, count, errors] of [
      ["", 1, []],
      [raw, 2, []],
      [raw + raw, 2, []],
      [raw, 1, ["Error"]],
      [JSON.stringify({ ...sample, content: null }), 1, []],
      [JSON.stringify({ ...sample, openMs: null }), 1, []],
    ])
      NodeAssert.throws(() => completeCycles(value, count, errors));
  },
);
NodeTest.test(
  "borrowed page selection requires exact unique fixture URL and cannot silently navigate",
  () => {
    const a = { url: () => "http://localhost:8179/env/a" },
      b = { url: () => "http://localhost:8179/env/b" };
    NodeAssert.equal(reusablePage([a, b], a.url()), a);
    NodeAssert.throws(() => reusablePage([b], a.url()));
    NodeAssert.throws(() => reusablePage([a, a], a.url()));
    NodeAssert.throws(() => reusablePage([{ url: () => a.url() + "?token=x" }], a.url()));
  },
);
NodeTest.test(
  "terminal output oracle excludes echo request payloads and other resource output",
  () => {
    const fixture = { threadId: "a", terminalId: "term-1" };
    const matching = { type: "output", ...fixture, data: "real" };
    NodeAssert.deepEqual(terminalChunks({ envelope: matching }, fixture), ["real"]);
    NodeAssert.deepEqual(terminalChunks({ ...matching, threadId: "b" }, fixture), []);
    NodeAssert.deepEqual(terminalChunks({ ...matching, terminalId: "term-2" }, fixture), []);
    NodeAssert.deepEqual(terminalChunks({ ...matching, type: "request" }, fixture), []);
    const marker = "T3PTY-owned-選択-🌈";
    NodeAssert.equal(encodedMarkerCommand(marker).includes(marker), false);
    NodeAssert.match(encodedMarkerCommand(marker), /^printf /);
  },
);

NodeTest.test(
  "encoded fixture printf produces the Unicode marker without literal echo",
  async () => {
    const { execFileSync } = await import("node:child_process");
    const marker = "T3PTY-fixture-選択-🌈";
    const output = execFileSync("/bin/sh", ["-c", encodedMarkerCommand(marker)], {
      encoding: "utf8",
    });
    NodeAssert.equal(output, "\u001b[2J\u001b[H" + marker + "\n");
  },
);
