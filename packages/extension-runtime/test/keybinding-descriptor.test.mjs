import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { Ajv } from "ajv";
import { uiKeybindingsApi } from "@t3tools/extension-sdk/catalogue";

// The broker compiles API schemas with strict draft-7 Ajv; mirror that here.
const registerCommands = uiKeybindingsApi.definition.methods.find(
  (method) => method.name === "registerCommands",
);
const validate = new Ajv({ strict: true, addUsedSchema: false }).compile(
  registerCommands.inputSchema,
);
const accepts = (defaultKey) =>
  validate({
    commands: [
      {
        id: "zoomIn",
        title: "Zoom In",
        scope: "surface",
        ...(defaultKey === undefined ? {} : { defaultKey }),
      },
    ],
  });

NodeTest.test("command descriptors accept a single default key or a bounded list", () => {
  NodeAssert.equal(accepts(undefined), true);
  NodeAssert.equal(accepts("mod+="), true);
  NodeAssert.equal(accepts(["mod+=", "mod++"]), true);
  NodeAssert.equal(accepts([]), false);
  NodeAssert.equal(accepts(["mod+=", "mod+="]), false);
  NodeAssert.equal(accepts(["a", "b", "c", "d", "e"]), false);
  NodeAssert.equal(accepts(["mod+=", ""]), false);
  NodeAssert.equal(accepts(42), false);
});
