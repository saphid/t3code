import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { resolveCodeEditor } from "../dist/environment.js";
import { uiEditorApi } from "../dist/catalogue.js";
import { bindApi } from "../dist/capabilities.js";

NodeTest.test("editable code view requires a compatible host without breaking read-only v1", () => {
  const File = () => null;
  const Diff = () => null;
  const Editor = () => null;
  NodeAssert.equal(resolveCodeEditor({}), null);
  NodeAssert.equal(resolveCodeEditor({ codeView: { version: 1, File, Diff, Editor } }), null);
  NodeAssert.equal(resolveCodeEditor({ codeView: { version: 2, File, Diff } }), null);
  NodeAssert.equal(resolveCodeEditor({ codeView: { version: 2, File, Diff, Editor } }), Editor);
});

NodeTest.test("editor capability probe is an additive, grant-free 1.1 method", async () => {
  NodeAssert.equal(uiEditorApi.definition.version, "1.1.0");
  NodeAssert.equal(uiEditorApi.baseline, "1.0.0");
  NodeAssert.deepEqual(uiEditorApi.additions, [
    { version: "1.1.0", method: "getCodeViewCapabilities" },
  ]);
  const method = uiEditorApi.definition.methods.find(
    ({ name }) => name === "getCodeViewCapabilities",
  );
  NodeAssert.deepEqual(method.requiredGrants, []);
  const host = {
    async discoverApis() {
      return [{ id: uiEditorApi.definition.id, version: "1.0.0" }];
    },
    async invokeApi() {
      throw new Error("must not send to old hosts");
    },
  };
  await NodeAssert.rejects(bindApi(uiEditorApi, host, {}).invoke("getCodeViewCapabilities", {}));
});
