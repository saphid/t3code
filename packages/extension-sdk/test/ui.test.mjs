import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import React from "react";
import { resolveUiKit } from "../dist/ui.js";
import { uiThemeApi } from "../dist/catalogue.js";

const names = [
  "Button",
  "Input",
  "InputGroup",
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

  NodeTest.it("advertises rendering through the grant-gated theme API's optional output", () => {
    NodeAssert.equal(uiThemeApi.definition.version, "1.1.0");
    NodeAssert.ok(
      uiThemeApi.additions.some(
        (addition) => addition.method === "getTokens" && addition.output === "uiKitVersion",
      ),
    );
    const method = uiThemeApi.definition.methods.find((member) => member.name === "getTokens");
    NodeAssert.deepEqual(method.requiredGrants, ["t3.ui/theme.read"]);
    NodeAssert.equal(method.outputSchema.properties.uiKitVersion.type, "integer");
    NodeAssert.ok(!method.outputSchema.required.includes("uiKitVersion"));
  });
});
