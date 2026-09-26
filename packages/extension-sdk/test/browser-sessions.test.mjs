import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeCrypto from "node:crypto";
import {
  BROWSER_DEVTOOLS,
  BROWSER_OPERATE,
  BROWSER_SESSIONS,
  BROWSER_SESSIONS_API,
  BROWSER_SESSIONS_API_V1,
  BROWSER_SESSION_COMMANDS,
  GENERIC_API_CATALOGUE,
  HOST_CAPABILITY_GRANTS,
} from "../dist/catalogue.js";

const methodsOf = (definition) =>
  Object.fromEntries((definition.methods ?? []).map((m) => [m.name, m]));

NodeTest.test("t3.browser/sessions is 1.1.0 with the shipped 1.0.0 frozen alongside", () => {
  NodeAssert.equal(BROWSER_SESSIONS_API.version, "1.1.0");
  NodeAssert.equal(BROWSER_SESSIONS_API_V1.version, "1.0.0");
  NodeAssert.deepEqual(
    GENERIC_API_CATALOGUE.filter((d) => d.id === BROWSER_SESSIONS),
    [BROWSER_SESSIONS_API, BROWSER_SESSIONS_API_V1],
  );
  // Content-hash pin of the definition as published before 1.1.0.
  NodeAssert.equal(
    NodeCrypto.createHash("sha256").update(JSON.stringify(BROWSER_SESSIONS_API_V1)).digest("hex"),
    "0de05ead6937c3e46f9b6b010fa6479f5718d04201022945ab3789ce87ca61e6",
  );
  const added = Object.keys(methodsOf(BROWSER_SESSIONS_API)).filter(
    (name) => !(name in methodsOf(BROWSER_SESSIONS_API_V1)),
  );
  NodeAssert.deepEqual(added, ["setDevToolsOpen"]);
});

NodeTest.test("DevTools rides its own grant and nothing else accepts it", () => {
  NodeAssert.equal(BROWSER_DEVTOOLS, "t3.browser/devtools");
  const method = methodsOf(BROWSER_SESSIONS_API).setDevToolsOpen;
  NodeAssert.equal(method.effect, "write");
  NodeAssert.deepEqual(method.requiredGrants, [
    BROWSER_SESSIONS,
    BROWSER_OPERATE,
    BROWSER_DEVTOOLS,
  ]);
  NodeAssert.deepEqual(method.inputSchema.required, [
    "tabId",
    "serverEpoch",
    "expectedEngineGeneration",
    "open",
  ]);
  NodeAssert.deepEqual(method.inputSchema.properties.open, { type: "boolean" });
  NodeAssert.equal(method.inputSchema.additionalProperties, false);
  // No other brokered operation is authorized by the DevTools grant, and it is
  // not a host-local capability grant either.
  const holders = GENERIC_API_CATALOGUE.flatMap((api) =>
    [...(api.methods ?? []), ...(api.streams ?? [])]
      .filter((operation) => operation.requiredGrants.includes(BROWSER_DEVTOOLS))
      .map((operation) => `${api.id}@${api.version}:${operation.name}`),
  );
  NodeAssert.deepEqual(holders, ["t3.browser/sessions@1.1.0:setDevToolsOpen"]);
  NodeAssert.equal(HOST_CAPABILITY_GRANTS.includes(BROWSER_DEVTOOLS), false);
  NodeAssert.ok(BROWSER_SESSION_COMMANDS.includes("setDevToolsOpen"));
});

NodeTest.test("1.1.0 sessions carry devToolsOpen; the frozen 1.0.0 does not", () => {
  const session = (definition) => methodsOf(definition).list.outputSchema.properties.sessions.items;
  NodeAssert.ok(session(BROWSER_SESSIONS_API).required.includes("devToolsOpen"));
  NodeAssert.deepEqual(session(BROWSER_SESSIONS_API).properties.devToolsOpen, {
    type: ["boolean", "null"],
  });
  NodeAssert.equal("devToolsOpen" in session(BROWSER_SESSIONS_API_V1).properties, false);
  const commands = (definition) =>
    methodsOf(definition).getCapabilities.outputSchema.properties.commands.items.enum;
  NodeAssert.ok(commands(BROWSER_SESSIONS_API).includes("setDevToolsOpen"));
  NodeAssert.equal(commands(BROWSER_SESSIONS_API_V1).includes("setDevToolsOpen"), false);
});
