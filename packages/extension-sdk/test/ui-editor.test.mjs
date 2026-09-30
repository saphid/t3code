import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import { GENERIC_API_CATALOGUE, UI_EDITOR_OPEN, uiEditorApi } from "../dist/catalogue.js";
import { CLIENT_PROVIDER_APIS } from "../dist/clientProviders.js";

NodeTest.test("t3.ui/editor is a shared catalogue contract behind its own grant", () => {
  NodeAssert.ok(GENERIC_API_CATALOGUE.includes(uiEditorApi.definition));
  NodeAssert.equal(uiEditorApi.definition.version, "1.0.0");
  const methods = Object.fromEntries(
    uiEditorApi.definition.methods.map((method) => [method.name, method]),
  );
  NodeAssert.deepEqual(methods.openPath.requiredGrants, [UI_EDITOR_OPEN]);
  NodeAssert.equal(methods.openPath.effect, "write");
  NodeAssert.deepEqual(methods.getCapabilities.requiredGrants, []);
  NodeAssert.ok(CLIENT_PROVIDER_APIS.has("t3.client/editor"));
});
