import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import { BROWSER_SESSIONS_API, GENERIC_API_CATALOGUE } from "../dist/catalogue.js";

NodeTest.test(
  "browser sessions retain the integration contract without per-action observations",
  () => {
    NodeAssert.equal(BROWSER_SESSIONS_API.version, "1.2.0");
    NodeAssert.deepEqual(
      GENERIC_API_CATALOGUE.filter((definition) => definition.id === BROWSER_SESSIONS_API.id).map(
        (definition) => definition.version,
      ),
      ["1.2.0", "1.1.0", "1.0.0"],
    );
    const methods = Object.fromEntries(
      BROWSER_SESSIONS_API.methods.map((method) => [method.name, method]),
    );
    const session = methods.list.outputSchema.properties.sessions.items.properties;
    NodeAssert.equal("controller" in session, false);
    NodeAssert.equal("remoteLive" in session, false);
  },
);
