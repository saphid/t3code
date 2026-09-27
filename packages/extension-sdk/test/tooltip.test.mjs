import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { resolveTooltip } from "../dist/environment.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HostTooltip = () => null;

function renderTrigger(Tooltip, props) {
  let renderer;
  act(() => {
    renderer = create(createElement(Tooltip, props, createElement("button", { id: "go" }, "Go")));
  });
  return renderer;
}

NodeTest.describe("resolveTooltip", () => {
  NodeTest.it("returns a version 1 host member's component", () => {
    NodeAssert.equal(
      resolveTooltip({ tooltip: { version: 1, Tooltip: HostTooltip } }),
      HostTooltip,
    );
  });

  NodeTest.it("accepts later versions and memo/forwardRef component objects", () => {
    const Memo = { $$typeof: Symbol.for("react.memo") };
    NodeAssert.equal(
      resolveTooltip({ tooltip: { version: 2, Tooltip: HostTooltip } }),
      HostTooltip,
    );
    NodeAssert.equal(resolveTooltip({ tooltip: { version: 1, Tooltip: Memo } }), Memo);
  });

  NodeTest.it("falls back to one shared passthrough on absent or malformed members", () => {
    const fallback = resolveTooltip({});
    for (const tooltip of [
      undefined,
      null,
      "tooltip",
      { version: 0, Tooltip: HostTooltip },
      { version: "1", Tooltip: HostTooltip },
      { version: 1 },
      { version: 1, Tooltip: "span" },
      { version: 1, Tooltip: {} },
    ])
      NodeAssert.equal(resolveTooltip({ tooltip }), fallback, JSON.stringify(tooltip));
    NodeAssert.notEqual(fallback, HostTooltip);
  });

  NodeTest.it("the passthrough renders the trigger alone, labelled or not", () => {
    const Tooltip = resolveTooltip({});
    for (const label of ["Reload", "", null]) {
      const renderer = renderTrigger(Tooltip, { label, side: "bottom" });
      const tree = renderer.toJSON();
      NodeAssert.equal(tree.type, "button");
      NodeAssert.equal(tree.props.id, "go");
      NodeAssert.deepEqual(tree.children, ["Go"]);
      act(() => renderer.unmount());
    }
  });
});
