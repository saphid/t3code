/**
 * Behavior of the REAL pull-request panel against a scripted host: which
 * writes it offers, when, and what reaches `t3.prs/write`.
 */
import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import {
  React,
  REF,
  defaultHandlers,
  deferred,
  detailOf,
  flush,
  layer,
  loadPrsPanel,
  mount,
  nodeName,
  stackOf,
} from "./prsPanelHarness.mjs";

let panel;
NodeTest.before(async () => {
  panel = await loadPrsPanel();
});

function mountPanel(handlers) {
  return mount(
    (host, session) =>
      React.createElement(panel.PullRequestsPanel, {
        host,
        session,
        visible: true,
        selected: REF,
        onSelect: () => {},
      }),
    handlers,
  );
}

/** The buttons in the pull request's action bar, by name. */
function actionBar(view) {
  const [bar] = view.renderer.root.findAll(
    (node) => node.type === "section" && node.props["aria-label"] === "Pull request actions",
  );
  if (bar === undefined) return [];
  return bar.findAll((node) => node.type === "button").map(nodeName);
}

const mergeStackButton = (view) =>
  view.byName("Merge stack").find((node) => node.type === "button") ?? null;

NodeTest.describe("stack freshness gates stack writes", () => {
  NodeTest.it("disables Merge stack while a refreshed stack read is still pending", async () => {
    let stackRead = null;
    const handlers = defaultHandlers({
      "t3.prs/read#stack": () =>
        stackRead === null ? stackOf([layer(2), layer(3)]) : stackRead.promise,
    });
    const view = mountPanel(handlers);
    await flush();
    NodeAssert.equal(mergeStackButton(view)?.props.disabled, false);

    // A host refresh: detail and activity answer at once, the stack does not.
    stackRead = deferred();
    await view.refresh();
    NodeAssert.equal(view.byName("Layer 3").length > 0, true);
    NodeAssert.equal(mergeStackButton(view)?.props.disabled ?? true, true);

    stackRead.resolve(stackOf([layer(2), layer(3)]));
    await flush();
    NodeAssert.equal(mergeStackButton(view)?.props.disabled, false);
    view.unmount();
  });
});

NodeTest.describe("single-PR merge waits for stack discovery", () => {
  const singleMergeOffers = (names) =>
    names.filter((name) => name === "Merge" || name.startsWith("Auto-merge"));

  NodeTest.it("offers no single merge or auto-merge on a stack layer", async () => {
    const view = mountPanel(defaultHandlers());
    await flush();
    NodeAssert.deepEqual(singleMergeOffers(actionBar(view)), []);
    NodeAssert.equal(mergeStackButton(view) !== null, true);
    view.unmount();
  });

  NodeTest.it("offers none while the stack lookup is pending or failed", async () => {
    const pending = deferred();
    const view = mountPanel(defaultHandlers({ "t3.prs/read#stack": () => pending.promise }));
    await flush();
    NodeAssert.deepEqual(singleMergeOffers(actionBar(view)), []);
    pending.reject(new Error("stack lookup failed"));
    await flush();
    NodeAssert.deepEqual(singleMergeOffers(actionBar(view)), []);
    view.unmount();
  });

  NodeTest.it("offers both once the lookup says the PR is in no stack", async () => {
    const view = mountPanel(defaultHandlers({ "t3.prs/read#stack": () => null }));
    await flush();
    NodeAssert.deepEqual(singleMergeOffers(actionBar(view)), ["Merge", "Auto-merge (merge)"]);
    view.unmount();
  });

  NodeTest.it("keeps single merge on hosts without stack actions", async () => {
    const detail = detailOf();
    const view = mountPanel(
      defaultHandlers({
        "t3.prs/read#detail": () => ({
          ...detail,
          capabilities: { ...detail.capabilities, stackActions: false },
        }),
      }),
    );
    await flush();
    NodeAssert.deepEqual(singleMergeOffers(actionBar(view)), ["Merge", "Auto-merge (merge)"]);
    view.unmount();
  });
});
