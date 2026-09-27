import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import * as React from "react";
import { act, create } from "react-test-renderer";
import { Tooltip } from "../dist/authoring.js";
import { resolveTooltip } from "../dist/environment.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HostTooltip = () => null;

NodeTest.describe("resolveTooltip", () => {
  NodeTest.it("is null on hosts without the member", () => {
    NodeAssert.equal(resolveTooltip({}), null);
    NodeAssert.equal(resolveTooltip({ tooltip: undefined }), null);
  });

  NodeTest.it("returns a version 1 member unchanged", () => {
    const tooltip = { version: 1, Tooltip: HostTooltip };
    NodeAssert.equal(resolveTooltip({ tooltip }), tooltip);
  });

  NodeTest.it("accepts later versions and memo/forwardRef component objects", () => {
    const later = { version: 2, Tooltip: HostTooltip, rich: true };
    NodeAssert.equal(resolveTooltip({ tooltip: later }), later);
    const memo = { version: 1, Tooltip: { $$typeof: Symbol.for("react.memo") } };
    NodeAssert.equal(resolveTooltip({ tooltip: memo }), memo);
  });

  NodeTest.it("rejects malformed members instead of rendering them", () => {
    for (const tooltip of [
      null,
      "tooltip",
      { version: 0, Tooltip: HostTooltip },
      { version: "1", Tooltip: HostTooltip },
      { version: 1 },
      { version: 1, Tooltip: "span" },
      { version: 1, Tooltip: {} },
    ])
      NodeAssert.equal(resolveTooltip({ tooltip }), null, JSON.stringify(tooltip));
  });
});

NodeTest.describe("Tooltip", () => {
  const render = (host, label) => {
    let renderer;
    act(() => {
      renderer = create(
        React.createElement(
          Tooltip,
          { host, label, side: "bottom" },
          React.createElement("button", { id: "go", disabled: true }, "Go"),
        ),
      );
    });
    const tree = renderer.toJSON();
    act(() => renderer.unmount());
    return tree;
  };

  NodeTest.it("hands the trigger and placement to the host's tooltip", () => {
    const seen = [];
    const tooltip = {
      version: 1,
      Tooltip: (props) => {
        seen.push(props);
        return React.createElement("span", { "data-tip": props.label }, props.children);
      },
    };
    const tree = render({ React, tooltip }, "Open a page first");
    NodeAssert.equal(tree.type, "span");
    NodeAssert.equal(tree.props["data-tip"], "Open a page first");
    NodeAssert.equal(tree.children[0].type, "button");
    NodeAssert.equal(seen.length, 1);
    NodeAssert.equal(seen[0].side, "bottom");
    NodeAssert.equal("host" in seen[0], false);
  });

  NodeTest.it("renders the trigger alone on hosts without a tooltip", () => {
    for (const host of [{ React }, { React, tooltip: { version: 0, Tooltip: HostTooltip } }]) {
      const tree = render(host, "Reload");
      NodeAssert.equal(tree.type, "button");
      NodeAssert.equal(tree.props.id, "go");
      NodeAssert.deepEqual(tree.children, ["Go"]);
    }
  });
});
