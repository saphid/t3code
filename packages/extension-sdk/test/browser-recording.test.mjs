import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import * as catalogue from "../dist/catalogue.js";

NodeTest.test("recording and artifact actions have independent installable grants", () => {
  for (const grant of ["t3.browser/recording", "t3.browser/artifact-actions"])
    NodeAssert.ok(catalogue.HOST_CAPABILITY_GRANTS.includes(grant));
  NodeAssert.deepEqual(catalogue.BROWSER_RECORDING_REQUIRED_GRANTS, [
    "t3.browser/sessions",
    "t3.browser/capture",
    "t3.browser/recording",
  ]);
});

NodeTest.test("recording uses ApiAddition metadata and refuses older or incomplete hosts", () => {
  NodeAssert.ok(
    catalogue.BROWSER_CAPTURE_ADDITIONS.some(
      (addition) => addition.method === "startRecording" && addition.version === "1.2.0",
    ),
  );
  const capture = {
    version: "1.2.0",
    startRecording() {},
    stopRecording() {},
    subscribeRecording() {},
    recordingSupport: { supported: true },
  };
  NodeAssert.equal(catalogue.resolveBrowserRecording(capture), capture);
  for (const version of ["1.1.0", "2.0.0", "invalid"])
    NodeAssert.equal(catalogue.resolveBrowserRecording({ ...capture, version }), null);
  NodeAssert.equal(
    catalogue.resolveBrowserRecording({ ...capture, stopRecording: undefined }),
    null,
  );
  NodeAssert.equal(catalogue.resolveBrowserRecording(undefined), null);
});
