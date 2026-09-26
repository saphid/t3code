import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import {
  GENERIC_API_CATALOGUE,
  UI_EXTERNAL_OPEN,
  UI_NAVIGATION_OPEN,
  UI_NAVIGATION_OPEN_SESSION,
  uiNavigationApi,
} from "../dist/catalogue.js";
import { CLIENT_PROVIDER_APIS } from "../dist/clientProviders.js";

NodeTest.test("t3.ui/navigation is a shared catalogue contract behind its own grant", () => {
  NodeAssert.ok(GENERIC_API_CATALOGUE.includes(uiNavigationApi.definition));
  const methods = Object.fromEntries(
    uiNavigationApi.definition.methods.map((method) => [method.name, method]),
  );
  NodeAssert.deepEqual(Object.keys(methods).sort(), [
    "getCapabilities",
    "openAgentSession",
    "openThread",
  ]);
  NodeAssert.deepEqual(methods.openThread.requiredGrants, [UI_NAVIGATION_OPEN]);
  NodeAssert.equal(methods.openThread.effect, "write");
  NodeAssert.deepEqual(methods.getCapabilities.requiredGrants, []);
  NodeAssert.ok(CLIENT_PROVIDER_APIS.has("t3.client/navigation"));
});

NodeTest.test("openThread takes a thread reference, not a URL or route", () => {
  const openThread = uiNavigationApi.definition.methods.find(
    (method) => method.name === "openThread",
  );
  NodeAssert.deepEqual(openThread.inputSchema.required, ["threadId"]);
  NodeAssert.equal(openThread.inputSchema.additionalProperties, false);
  NodeAssert.deepEqual(Object.keys(openThread.inputSchema.properties).sort(), [
    "surfaceId",
    "threadId",
  ]);
  const refused = openThread.outputSchema.oneOf.find(
    (branch) => branch.properties.status.const === "refused",
  );
  NodeAssert.deepEqual(refused.properties.reason.enum, [
    "unknown-thread",
    "out-of-scope",
    "surface-not-found",
  ]);
});

NodeTest.test("openAgentSession names an agent, never a URL, behind its own grant", () => {
  const method = uiNavigationApi.definition.methods.find(
    (candidate) => candidate.name === "openAgentSession",
  );
  NodeAssert.equal(method.effect, "write");
  // Distinct from in-app routing and from the any-URL external opener.
  NodeAssert.deepEqual(method.requiredGrants, [UI_NAVIGATION_OPEN_SESSION]);
  NodeAssert.notEqual(UI_NAVIGATION_OPEN_SESSION, UI_NAVIGATION_OPEN);
  NodeAssert.notEqual(UI_NAVIGATION_OPEN_SESSION, UI_EXTERNAL_OPEN);
  NodeAssert.equal(method.inputSchema.additionalProperties, false);
  NodeAssert.deepEqual(Object.keys(method.inputSchema.properties), ["agentId"]);
  const [opened, refused] = method.outputSchema.oneOf;
  NodeAssert.ok(!("url" in opened.properties));
  NodeAssert.deepEqual(refused.properties.reason.enum, [
    "unknown-thread",
    "unknown-agent",
    "no-session",
    "opener-refused",
  ]);
  const capabilities = uiNavigationApi.definition.methods.find(
    (candidate) => candidate.name === "getCapabilities",
  );
  NodeAssert.ok(
    JSON.stringify(capabilities.outputSchema).includes("openAgentSession"),
    "getCapabilities reports openAgentSession availability",
  );
});
