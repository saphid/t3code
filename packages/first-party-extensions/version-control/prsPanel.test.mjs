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
  dispatch,
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

NodeTest.describe("stack confirmation is a modal dialog", () => {
  const openConfirmation = async (handlers = defaultHandlers(), extendHost) => {
    const view = mount((host, session) => {
      extendHost?.(host);
      return React.createElement(panel.PullRequestsPanel, {
        host,
        session,
        visible: true,
        selected: REF,
        onSelect: () => {},
      });
    }, handlers);
    await flush();
    dispatch(mergeStackButton(view), "onClick");
    await flush();
    return view;
  };
  const dialog = (view) =>
    view.renderer.root.findAll(
      (node) => typeof node.type === "string" && node.props.role === "dialog",
    )[0] ?? null;
  const key = (view, init) => dispatch(dialog(view), "onKeyDown", init);

  NodeTest.it("opens without writing, labelled, described, and focused on Cancel", async () => {
    const view = await openConfirmation();
    const node = dialog(view);
    NodeAssert.notEqual(node, null);
    NodeAssert.equal(node.props["aria-modal"], true);
    const title = view.renderer.root.find(
      (candidate) => candidate.props.id === node.props["aria-labelledby"],
    );
    NodeAssert.equal(nodeName(title), "Merge 2 pull requests?");
    const description = view.renderer.root.find(
      (candidate) => candidate.props.id === node.props["aria-describedby"],
    );
    NodeAssert.match(nodeName(description), /^Merge #3 and its unmerged layers below/);
    NodeAssert.equal(view.focused(), "Cancel");
    NodeAssert.deepEqual(view.writes(), []);
    view.unmount();
  });

  NodeTest.it("keeps Tab and Shift-Tab inside the dialog", async () => {
    const view = await openConfirmation();
    NodeAssert.equal(key(view, { key: "Tab" }).defaultPrevented, true);
    NodeAssert.equal(view.focused(), "Merge stack");
    key(view, { key: "Tab" });
    NodeAssert.equal(view.focused(), "Cancel");
    key(view, { key: "Tab", shiftKey: true });
    NodeAssert.equal(view.focused(), "Merge stack");
    view.unmount();
  });

  NodeTest.it("makes the panel behind it inert until it closes", async () => {
    const view = await openConfirmation();
    const inert = () =>
      view.renderer.root.findAll((node) => node.type === "div" && node.props.inert === true);
    NodeAssert.equal(inert().length > 0, true);
    NodeAssert.equal(
      inert().some((node) => node.findAll((child) => child === dialog(view)).length > 0),
      false,
    );
    key(view, { key: "Escape" });
    NodeAssert.equal(inert().length, 0);
    view.unmount();
  });

  NodeTest.it("Escape and Cancel close it and return focus to the opener", async () => {
    const view = await openConfirmation();
    key(view, { key: "Escape" });
    NodeAssert.equal(dialog(view), null);
    NodeAssert.equal(view.focused(), "Merge stack");
    dispatch(mergeStackButton(view), "onClick");
    dispatch(view.find("Cancel"), "onClick");
    NodeAssert.equal(dialog(view), null);
    NodeAssert.equal(view.focused(), "Merge stack");
    NodeAssert.deepEqual(view.writes(), []);
    view.unmount();
  });

  NodeTest.it("cannot be dismissed while the merge is running", async () => {
    const running = deferred();
    const view = await openConfirmation(
      defaultHandlers({ "t3.prs/write#runAction": () => running.promise }),
    );
    const confirm = dialog(view)
      .findAll((node) => node.type === "button")
      .find((node) => nodeName(node) === "Merge stack");
    dispatch(confirm, "onClick");
    await flush();
    key(view, { key: "Escape" });
    NodeAssert.notEqual(dialog(view), null);
    NodeAssert.equal(view.writes().length, 1);
    running.resolve({});
    await flush();
    NodeAssert.equal(dialog(view), null);
    view.unmount();
  });

  NodeTest.it("renders through the host floating layer, anchored at its opener", async () => {
    const anchors = [];
    const view = await openConfirmation(defaultHandlers(), (host) => {
      host.floatingLayer = {
        version: 1,
        Popover: ({ anchor, elementRef: _elementRef, ...props }) => {
          anchors.push(anchor?.name ?? null);
          return React.createElement("div", { ...props, "data-floating": true });
        },
      };
    });
    NodeAssert.equal(dialog(view).props["data-floating"], true);
    NodeAssert.equal(anchors.at(-1), "Merge stack");
    view.unmount();
  });
});
