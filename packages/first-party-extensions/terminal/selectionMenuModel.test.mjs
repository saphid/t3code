import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import {
  TerminalSelectionMenuFlow,
  clampMenuToViewport,
  resolveSelectionActionPosition,
  terminalContextMenuItems,
  terminalSelectionMenuItems,
} from "./selectionMenuModel.ts";

const at = { x: 40, y: 50 };

function makeFlow() {
  const changes = [];
  const flow = new TerminalSelectionMenuFlow((menu) => changes.push(menu));
  return { flow, changes };
}

NodeTest.describe("menu items (native parity, canAddToChat=false)", () => {
  NodeTest.it("selection popup offers Copy only", () => {
    NodeAssert.deepEqual(terminalSelectionMenuItems({ canAddToChat: false }), [
      { id: "copy", label: "Copy" },
    ]);
  });

  NodeTest.it("right-click with a selection: Copy enabled, Paste enabled", () => {
    NodeAssert.deepEqual(terminalContextMenuItems({ hasSelection: true, canAddToChat: false }), [
      { id: "copy", label: "Copy", disabled: false },
      { id: "paste", label: "Paste" },
    ]);
  });

  NodeTest.it("right-click without a selection: Copy disabled, Paste still offered", () => {
    NodeAssert.deepEqual(terminalContextMenuItems({ hasSelection: false, canAddToChat: false }), [
      { id: "copy", label: "Copy", disabled: true },
      { id: "paste", label: "Paste" },
    ]);
  });

  NodeTest.it("keeps native's default of offering Add to chat when allowed", () => {
    NodeAssert.deepEqual(
      terminalContextMenuItems({ hasSelection: false }).map((item) => item.id),
      ["add-to-chat", "copy", "paste"],
    );
  });

  NodeTest.it("the flow never offers Add to chat", () => {
    const { flow } = makeFlow();
    const popup = flow.openSelectionPopup({ selectionText: "hello", position: at });
    NodeAssert.deepEqual(
      popup.items.map((item) => item.id),
      ["copy"],
    );
    const context = flow.openContextMenu({ selectionText: "hello", position: at });
    NodeAssert.deepEqual(
      context.items.map((item) => item.id),
      ["copy", "paste"],
    );
    NodeAssert.equal(flow.choose(context.requestId, "add-to-chat"), null);
  });
});

NodeTest.describe("TerminalSelectionMenuFlow supersession", () => {
  NodeTest.it("a right-click during the popup cancels the popup", () => {
    const { flow, changes } = makeFlow();
    const popup = flow.openSelectionPopup({ selectionText: "hello-menu", position: at });
    const context = flow.openContextMenu({ selectionText: "hello-menu", position: at });
    NodeAssert.equal(flow.menu, context);
    NodeAssert.equal(flow.isCurrent(popup.requestId), false);
    NodeAssert.equal(flow.choose(popup.requestId, "copy"), null, "stale popup click is a no-op");
    NodeAssert.equal(flow.menu, context, "the stale click leaves the newer menu open");
    NodeAssert.deepEqual(
      changes.map((menu) => menu?.kind ?? null),
      ["selection", "context"],
    );
  });

  NodeTest.it("a stale completion is silent once a newer flow starts", () => {
    const { flow } = makeFlow();
    const context = flow.openContextMenu({ selectionText: null, position: at });
    const choice = flow.choose(context.requestId, "paste");
    NodeAssert.deepEqual(choice, {
      action: "paste",
      requestId: context.requestId,
      clipboardText: null,
    });
    NodeAssert.equal(flow.menu, null);
    // The action is still in flight: it may report and refocus...
    NodeAssert.equal(flow.isCurrent(choice.requestId), true);
    // ...until a new flow supersedes it.
    flow.openSelectionPopup({ selectionText: "next", position: at });
    NodeAssert.equal(flow.isCurrent(choice.requestId), false);
  });

  NodeTest.it("passive dismissal after a choice does not cancel the in-flight action", () => {
    const { flow } = makeFlow();
    const popup = flow.openSelectionPopup({ selectionText: "hello", position: at });
    const choice = flow.choose(popup.requestId, "copy");
    NodeAssert.equal(choice.clipboardText, "hello");
    flow.dismiss(); // e.g. a blur while the clipboard write is pending
    NodeAssert.equal(flow.isCurrent(choice.requestId), true);
  });

  NodeTest.it("passive dismissal of an open menu invalidates it", () => {
    const { flow, changes } = makeFlow();
    const popup = flow.openSelectionPopup({ selectionText: "hello", position: at });
    flow.dismiss();
    NodeAssert.equal(flow.menu, null);
    NodeAssert.equal(flow.isCurrent(popup.requestId), false);
    NodeAssert.equal(flow.choose(popup.requestId, "copy"), null);
    NodeAssert.deepEqual(changes.at(-1), null);
  });

  NodeTest.it("a disabled Copy resolves to nothing", () => {
    const { flow } = makeFlow();
    const context = flow.openContextMenu({ selectionText: "", position: at });
    NodeAssert.equal(context.items[0].disabled, true);
    NodeAssert.equal(flow.choose(context.requestId, "copy"), null);
    NodeAssert.equal(flow.menu, null);
  });

  NodeTest.it("Copy writes the selection captured when the menu opened", () => {
    const { flow } = makeFlow();
    const context = flow.openContextMenu({ selectionText: "line one\r\n", position: at });
    NodeAssert.deepEqual(flow.choose(context.requestId, "copy"), {
      action: "copy",
      requestId: context.requestId,
      clipboardText: "line one\r\n",
    });
  });

  NodeTest.it("whitespace-only newline selections count as empty", () => {
    const { flow } = makeFlow();
    NodeAssert.equal(flow.openSelectionPopup({ selectionText: "\n\n", position: at }), null);
    const context = flow.openContextMenu({ selectionText: "\r\n", position: at });
    NodeAssert.equal(context.items[0].disabled, true);
  });

  NodeTest.it("a repeated selection end keeps the open popup", () => {
    const { flow } = makeFlow();
    const first = flow.openSelectionPopup({ selectionText: "hello", position: at });
    const second = flow.openSelectionPopup({ selectionText: "hello", position: { x: 1, y: 1 } });
    NodeAssert.equal(second, first);
    NodeAssert.equal(flow.isCurrent(first.requestId), true);
  });

  NodeTest.it("an empty selection end supersedes an in-flight action", () => {
    const { flow } = makeFlow();
    const context = flow.openContextMenu({ selectionText: null, position: at });
    const choice = flow.choose(context.requestId, "paste");
    NodeAssert.equal(flow.openSelectionPopup({ selectionText: null, position: at }), null);
    NodeAssert.equal(flow.isCurrent(choice.requestId), false);
  });

  NodeTest.it("an emptied selection clears only a current popup or a pending one", () => {
    const { flow } = makeFlow();
    NodeAssert.equal(flow.shouldClearOnEmptySelection(false), false);
    NodeAssert.equal(flow.shouldClearOnEmptySelection(true), true, "pending popup timer");
    flow.openSelectionPopup({ selectionText: "hello", position: at });
    NodeAssert.equal(flow.shouldClearOnEmptySelection(false), true);
    flow.openContextMenu({ selectionText: "hello", position: at });
    NodeAssert.equal(
      flow.shouldClearOnEmptySelection(false),
      false,
      "a right-click menu keeps the text it captured",
    );
  });
});

NodeTest.describe("positioning", () => {
  const bounds = { left: 100, top: 200, width: 400, height: 300 };
  const viewport = { width: 1000, height: 800 };

  NodeTest.it("anchors the popup at the release pointer inside the pane", () => {
    NodeAssert.deepEqual(
      resolveSelectionActionPosition({
        bounds,
        selectionRect: { right: 150, bottom: 220 },
        pointer: { x: 700, y: 10 },
        viewport,
      }),
      { x: 500, y: 200 },
    );
  });

  NodeTest.it("falls back to just below the selection end", () => {
    NodeAssert.deepEqual(
      resolveSelectionActionPosition({
        bounds,
        selectionRect: { right: 150, bottom: 220 },
        pointer: null,
        viewport,
      }),
      { x: 150, y: 224 },
    );
  });

  NodeTest.it("clamps a menu that would overflow the right and bottom edges", () => {
    NodeAssert.deepEqual(
      clampMenuToViewport({
        point: { x: 980, y: 790 },
        size: { width: 120, height: 60 },
        viewport,
      }),
      { x: 876, y: 736 },
    );
  });

  NodeTest.it("keeps a margin at the top-left edges", () => {
    NodeAssert.deepEqual(
      clampMenuToViewport({ point: { x: -5, y: 0 }, size: { width: 120, height: 60 }, viewport }),
      { x: 4, y: 4 },
    );
  });

  NodeTest.it("pins to the margin when the menu is larger than the viewport", () => {
    NodeAssert.deepEqual(
      clampMenuToViewport({
        point: { x: 50, y: 50 },
        size: { width: 2000, height: 2000 },
        viewport,
      }),
      { x: 4, y: 4 },
    );
  });
});
