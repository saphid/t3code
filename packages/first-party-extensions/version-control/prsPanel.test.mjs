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

NodeTest.describe("rebase stack", () => {
  const rebaseHandlers = (overrides = {}) => {
    const detail = detailOf();
    return defaultHandlers({
      "t3.prs/read#detail": () => ({
        ...detail,
        viewerPermissions: { ...detail.viewerPermissions, stackRebase: true },
      }),
      "t3.prs/write#getCapabilities": () => ({
        ...defaultHandlers()["t3.prs/write#getCapabilities"](),
        actions: ["merge", "update-branch"],
      }),
      ...overrides,
    });
  };
  const rebaseButton = (view) =>
    view.byName("Rebase stack").find((node) => node.type === "button") ?? null;

  NodeTest.it("is offered only to a viewer allowed to rebase the stack", async () => {
    const without = mountPanel(defaultHandlers());
    await flush();
    NodeAssert.equal(rebaseButton(without), null);
    without.unmount();
    const view = mountPanel(rebaseHandlers());
    await flush();
    NodeAssert.equal(rebaseButton(view)?.props.disabled, false);
    view.unmount();
  });

  NodeTest.it(
    "confirms first, then rebases from the top layer with every head pinned",
    async () => {
      const view = mountPanel(rebaseHandlers());
      await flush();
      dispatch(rebaseButton(view), "onClick");
      await flush();
      const dialog = view.renderer.root.find(
        (node) => typeof node.type === "string" && node.props.role === "dialog",
      );
      NodeAssert.match(nodeName(dialog.find((node) => node.type === "strong")), /^Rebase 3 pull/);
      NodeAssert.deepEqual(view.writes(), []);
      dispatch(
        dialog
          .findAll((node) => node.type === "button")
          .find((node) => nodeName(node) === "Rebase stack"),
        "onClick",
      );
      await flush();
      NodeAssert.deepEqual(
        view.writes().map((call) => call.input),
        [
          {
            ...REF,
            number: 4,
            action: "update-branch",
            updateMethod: "rebase",
            stackNumber: 40,
            expectedStackHeads: [
              { number: 2, headSha: "sha2" },
              { number: 3, headSha: "sha3" },
              { number: 4, headSha: "sha4" },
            ],
          },
        ],
      );
      view.unmount();
    },
  );

  NodeTest.it("waits for a fresh stack read", async () => {
    const pending = deferred();
    const view = mountPanel(rebaseHandlers({ "t3.prs/read#stack": () => pending.promise }));
    await flush();
    NodeAssert.equal(rebaseButton(view), null);
    pending.resolve(stackOf([layer(2), layer(3), layer(4)]));
    await flush();
    NodeAssert.equal(rebaseButton(view)?.props.disabled, false);
    view.unmount();
  });
});

NodeTest.describe("stack merge uses native's merge-method preference", () => {
  const preferSquash = () => {
    const detail = detailOf();
    return defaultHandlers({
      "t3.prs/read#detail": () => ({
        ...detail,
        capabilities: { ...detail.capabilities, mergeMethods: ["merge", "squash"] },
        preferredMergeMethod: "squash",
      }),
    });
  };
  const confirmStackMerge = async (view) => {
    dispatch(mergeStackButton(view), "onClick");
    await flush();
    const dialog = view.renderer.root.find(
      (node) => typeof node.type === "string" && node.props.role === "dialog",
    );
    const description = nodeName(dialog.find((node) => node.type === "p"));
    dispatch(
      dialog
        .findAll((node) => node.type === "button")
        .find((node) => nodeName(node) === "Merge stack"),
      "onClick",
    );
    await flush();
    return description;
  };

  NodeTest.it("defaults to the project's method even when merge is listed first", async () => {
    const view = mountPanel(preferSquash());
    await flush();
    const description = await confirmStackMerge(view);
    NodeAssert.match(description, /using squash\./);
    NodeAssert.equal(view.writes()[0]?.input.mergeMethod, "squash");
    view.unmount();
  });

  NodeTest.it("offers a method chooser beside Merge stack", async () => {
    const view = mountPanel(preferSquash());
    await flush();
    const chooser = view.find("Merge stack method");
    NodeAssert.equal(chooser.props.value, "squash");
    dispatch(chooser, "onChange", { target: { value: "merge" } });
    await confirmStackMerge(view);
    NodeAssert.equal(view.writes()[0]?.input.mergeMethod, "merge");
    view.unmount();
  });
});

NodeTest.describe("PR outcomes report through toasts, inline without them", () => {
  const withToasts = (overrides = {}) => {
    const notices = [];
    const handlers = defaultHandlers({
      "t3.ui/notifications#getCapabilities": () => ({
        adapter: "web",
        operations: { notify: true, update: true, dismiss: true, awaitAction: false },
        clients: [],
      }),
      "t3.ui/notifications#notify": (input) => {
        notices.push({ op: "notify", ...input });
        return { notificationId: `n${notices.length}` };
      },
      "t3.ui/notifications#update": (input) => {
        notices.push({ op: "update", ...input });
        return { applied: true };
      },
      "t3.ui/notifications#dismiss": () => ({ dismissed: true }),
      ...overrides,
    });
    return { handlers, notices };
  };
  const checkOutHere = async (view) => {
    dispatch(view.find("Check out"), "onClick");
    await flush();
    const item = view.renderer.root
      .findAll((node) => node.type === "button" && node.props.role === "menuitem")
      .find((node) => nodeName(node).startsWith("In this repository"));
    dispatch(item, "onClick");
    await flush();
  };
  const prepared = { branch: "b3", worktreePath: null, isOnPullRequestHead: true };
  const mergeTheStack = async (view) => {
    dispatch(mergeStackButton(view), "onClick");
    await flush();
    const dialog = view.renderer.root.find(
      (node) => typeof node.type === "string" && node.props.role === "dialog",
    );
    dispatch(
      dialog
        .findAll((node) => node.type === "button")
        .find((node) => nodeName(node) === "Merge stack"),
      "onClick",
    );
    await flush();
  };

  NodeTest.it("checkout shows native's loading toast and settles it to the outcome", async () => {
    const { handlers, notices } = withToasts({
      "t3.vcs/actions#preparePullRequestThread": () => prepared,
    });
    const view = mountPanel(handlers);
    await flush();
    await checkOutHere(view);
    NodeAssert.deepEqual(
      notices.map((notice) => [notice.op, notice.severity, notice.title]),
      [
        ["notify", "loading", "Preparing the pull request checkout..."],
        ["update", "success", "Checked out here"],
      ],
    );
    NodeAssert.equal(view.text().includes("Checked out here"), false);
    view.unmount();
  });

  NodeTest.it("a failed checkout settles the loading toast to its error", async () => {
    const { handlers, notices } = withToasts({
      "t3.vcs/actions#preparePullRequestThread": () => {
        throw new Error("This repository has uncommitted changes.");
      },
    });
    const view = mountPanel(handlers);
    await flush();
    await checkOutHere(view);
    NodeAssert.deepEqual(notices.at(-1), {
      op: "update",
      notificationId: "n1",
      severity: "error",
      title: "Could not prepare the pull request checkout",
      body: "This repository has uncommitted changes.",
    });
    view.unmount();
  });

  NodeTest.it("a stack merge reports through a toast", async () => {
    const { handlers, notices } = withToasts();
    const view = mountPanel(handlers);
    await flush();
    await mergeTheStack(view);
    NodeAssert.deepEqual(notices.at(-1), {
      op: "update",
      notificationId: "n1",
      severity: "success",
      title: "Stack merge request completed",
      body: "GitHub merged the stack or added it to its merge queue.",
    });
    view.unmount();
  });

  NodeTest.it("without toasts the receipt stays inline after the stack goes away", async () => {
    let merged = false;
    const view = mountPanel(
      defaultHandlers({
        "t3.prs/read#stack": () => (merged ? null : stackOf([layer(2), layer(3)])),
        "t3.prs/write#runAction": () => {
          merged = true;
          return {};
        },
      }),
    );
    await flush();
    await mergeTheStack(view);
    NodeAssert.equal(view.byName("Stack").length, 0);
    NodeAssert.match(view.text(), /Stack merge request completed/);
    view.unmount();
  });

  NodeTest.it("a denied toast hands the receipt back inline", async () => {
    const { handlers } = withToasts({
      "t3.ui/notifications#notify": () => {
        throw new Error("grant denied");
      },
      "t3.vcs/actions#preparePullRequestThread": () => prepared,
    });
    const view = mountPanel(handlers);
    await flush();
    await checkOutHere(view);
    NodeAssert.match(view.text(), /Checked out here/);
    view.unmount();
  });
});

NodeTest.describe("checks control", () => {
  const entry = (overrides = {}) => ({
    provider: "github",
    host: "github.com",
    projectId: "p1",
    projectTitle: "Project",
    repository: "o/r",
    number: 7,
    title: "Row PR",
    url: "https://github.com/o/r/pull/7",
    author: null,
    headBranch: "feature",
    baseBranch: "main",
    state: "open",
    isDraft: false,
    mergeability: "mergeable",
    additions: 1,
    deletions: 0,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    viewerReviewRequested: false,
    labels: [],
    checksState: "failing",
    ...overrides,
  });
  const listOf = (entries) => () => ({
    viewers: {},
    providers: [],
    entries,
    errors: [],
    truncated: false,
    nextCursors: {},
  });
  const failingCheck = {
    name: "ci / test",
    status: "failure",
    description: null,
    url: "https://ci.example/run/1",
  };

  NodeTest.it("opens from a row without selecting it, reading checks only then", async () => {
    const selections = [];
    const details = [];
    const view = mount(
      (host, session) =>
        React.createElement(panel.PullRequestsPanel, {
          host,
          session,
          visible: true,
          selected: null,
          onSelect: (ref) => selections.push(ref),
        }),
      defaultHandlers({
        "t3.prs/read#list": listOf([entry()]),
        "t3.prs/read#detail": (input) => {
          details.push(input.number);
          return detailOf({ number: 7, checks: [failingCheck] });
        },
      }),
    );
    await flush();
    NodeAssert.deepEqual(details, []);
    const trigger = view.find("Checks: Some checks were not successful");
    const click = dispatch(trigger, "onClick");
    await flush();
    NodeAssert.equal(click.propagationStopped, true);
    NodeAssert.deepEqual(selections, []);
    NodeAssert.deepEqual(details, [7]);
    NodeAssert.match(view.text(), /ci \/ test/);
    NodeAssert.equal(view.has("Open check ci / test"), true);
    view.unmount();
  });

  NodeTest.it("is keyboard reachable and keeps Enter from selecting the row", async () => {
    const selections = [];
    const view = mount(
      (host, session) =>
        React.createElement(panel.PullRequestsPanel, {
          host,
          session,
          visible: true,
          selected: null,
          onSelect: (ref) => selections.push(ref),
        }),
      defaultHandlers({
        "t3.prs/read#list": listOf([entry()]),
        "t3.prs/read#detail": () => detailOf({ number: 7, checks: [failingCheck] }),
      }),
    );
    await flush();
    const trigger = view.find("Checks: Some checks were not successful");
    NodeAssert.equal(trigger.props.tabIndex, 0);
    const enter = dispatch(trigger, "onKeyDown", { key: "Enter" });
    await flush();
    NodeAssert.equal(enter.defaultPrevented, true);
    NodeAssert.equal(enter.propagationStopped, true);
    NodeAssert.deepEqual(selections, []);
    NodeAssert.equal(
      view.find("Checks: Some checks were not successful").props["aria-expanded"],
      true,
    );
    view.unmount();
  });

  NodeTest.it("the header shows a newer failing rollup over older passing detail", async () => {
    const view = mountPanel(
      defaultHandlers({
        "t3.prs/read#list": listOf([entry({ number: 3, checksState: "failing" })]),
        "t3.prs/read#detail": () =>
          detailOf({
            checks: [{ name: "ci", status: "success", description: null, url: null }],
          }),
      }),
    );
    await flush();
    const trigger = view.find("Checks: Some checks were not successful");
    dispatch(trigger, "onClick");
    await flush();
    NodeAssert.match(view.text(), /Check details are out of date/);
    NodeAssert.equal(view.has("Checks: All checks have passed"), false);
    view.unmount();
  });
});
