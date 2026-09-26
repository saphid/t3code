import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import { browserProfilesApi, GENERIC_API_CATALOGUE } from "../dist/catalogue.js";
import { bindApi } from "../dist/capabilities.js";

const context = {
  client: "web",
  resource: { namespace: "example.browser-profiles", id: "view", environmentId: "env" },
};

NodeTest.test("the install UI can offer each profile grant from the generic catalogue", () => {
  NodeAssert.ok(GENERIC_API_CATALOGUE.includes(browserProfilesApi.definition));
  const grants = new Set(
    browserProfilesApi.definition.methods.flatMap((method) => method.requiredGrants),
  );
  for (const grant of [
    "t3.browser/profiles",
    "t3.browser/clear-cookies",
    "t3.browser/clear-cache",
    "t3.browser/import-cookies",
  ]) {
    NodeAssert.ok(grants.has(grant), grant);
  }
});

NodeTest.test(
  "a clear through the typed facade names the profile and returns the host's outcome",
  async () => {
    const controller = new AbortController();
    const api = bindApi(
      browserProfilesApi,
      {
        async invokeApi(request, signal) {
          NodeAssert.equal(request.id, "t3.browser/profiles");
          NodeAssert.equal(request.versionRange, "^1.0.0");
          NodeAssert.equal(request.method, "clearCookies");
          NodeAssert.deepEqual(request.input, { profileId: "work" });
          NodeAssert.equal(signal, controller.signal);
          return { outcome: "cleared", profileId: "work" };
        },
      },
      context,
    );
    NodeAssert.deepEqual(
      await api.invoke("clearCookies", { profileId: "work" }, controller.signal),
      {
        outcome: "cleared",
        profileId: "work",
      },
    );
  },
);
