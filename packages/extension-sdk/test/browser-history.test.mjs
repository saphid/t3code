import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import {
  BROWSER_HISTORY_MAX_ENTRIES,
  BROWSER_READ_HISTORY,
  BROWSER_RECORD_HISTORY,
  GENERIC_API_CATALOGUE,
  browserHistoryApi,
} from "../dist/catalogue.js";
import { CLIENT_PROVIDER_APIS } from "../dist/clientProviders.js";

NodeTest.test("t3.browser/history reads and writes behind separate grants", () => {
  NodeAssert.ok(GENERIC_API_CATALOGUE.includes(browserHistoryApi.definition));
  const methods = Object.fromEntries(
    browserHistoryApi.definition.methods.map((method) => [method.name, method]),
  );
  NodeAssert.deepEqual(Object.keys(methods).sort(), ["list", "record", "remove", "setTitle"]);
  NodeAssert.deepEqual(methods.list.requiredGrants, [BROWSER_READ_HISTORY]);
  NodeAssert.equal(methods.list.effect, "read");
  for (const name of ["record", "setTitle", "remove"]) {
    NodeAssert.deepEqual(
      methods[name].requiredGrants,
      [BROWSER_READ_HISTORY, BROWSER_RECORD_HISTORY],
      name,
    );
    NodeAssert.equal(methods[name].effect, "write", name);
  }
  // No op names a project or thread: scope comes only from the view context.
  for (const method of browserHistoryApi.definition.methods)
    for (const key of Object.keys(method.inputSchema.properties ?? {}))
      NodeAssert.ok(!/project|thread/i.test(key), `${method.name}.${key}`);
  NodeAssert.equal(
    methods.list.outputSchema.properties.entries.maxItems,
    BROWSER_HISTORY_MAX_ENTRIES,
  );
  NodeAssert.ok(CLIENT_PROVIDER_APIS.has("t3.client/browser-history"));
});
