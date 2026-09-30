import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import React from "react";
import { resolveUiKit } from "../dist/ui.js";
import { uiThemeApi } from "../dist/catalogue.js";

const names = [
  "Button",
  "Input",
  "InputGroup",
  "InputGroupAddon",
  "Toolbar",
  "MenuRow",
  "MenuNote",
  "MenuGroup",
  "Menu",
  "MenuTrigger",
  "MenuPopup",
  "MenuSub",
  "MenuSubTrigger",
  "MenuSubPopup",
  "MenuItem",
  "MenuSeparator",
  "MenuGroupLabel",
  "MenuRadioGroup",
  "MenuRadioItem",
  "TreeRow",
  "Icon",
];
const component = () => null;
const kit = Object.fromEntries(names.map((name) => [name, component]));

NodeTest.describe("host UI kit negotiation", () => {
  NodeTest.it("accepts compatible components and rejects partial or malformed kits", () => {
    const valid = { version: 1, ...kit, Button: React.memo(component) };
    NodeAssert.equal(resolveUiKit({ uiKit: valid }), valid);
    for (const version of [0, 1.5, "1", Infinity])
      NodeAssert.equal(resolveUiKit({ uiKit: { ...valid, version } }), null);
    NodeAssert.equal(resolveUiKit({}), null);
    for (const name of names)
      NodeAssert.equal(resolveUiKit({ uiKit: { ...valid, [name]: "div" } }), null, name);
  });

  NodeTest.it("rejects hosts below the pack's requested kit version", () => {
    NodeAssert.equal(resolveUiKit({ uiKit: { version: 1, ...kit } }, 2), null);
    const future = { version: 2, ...kit };
    NodeAssert.equal(resolveUiKit({ uiKit: future }, 2), future);
  });

  NodeTest.it("keeps theme at 1.0.0 with no duplicate kit version advertisement", () => {
    NodeAssert.equal(uiThemeApi.definition.version, "1.0.0");
    NodeAssert.equal(uiThemeApi.additions, undefined);
    const method = uiThemeApi.definition.methods.find((member) => member.name === "getTokens");
    NodeAssert.deepEqual(method.requiredGrants, ["t3.ui/theme.read"]);
    NodeAssert.equal(method.outputSchema.properties.uiKitVersion, undefined);
  });
});
