import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import {
  GENERIC_API_CATALOGUE,
  UI_PREFERENCES,
  UI_PREFERENCES_API,
  UI_PREFERENCES_READ,
  UI_PREFERENCES_WRITE,
  assertProvidedApiOwner,
} from "../dist/catalogue.js";
import { validateApiDefinition } from "../dist/capabilities.js";
import { CLIENT_PREFERENCES_API, CLIENT_PROVIDER_APIS } from "../dist/clientProviders.js";

NodeTest.test("t3.ui/preferences is a canonical catalogue contract", () => {
  NodeAssert.equal(UI_PREFERENCES_API.id, UI_PREFERENCES);
  NodeAssert.equal(UI_PREFERENCES_API.version, "1.0.0");
  NodeAssert.ok(GENERIC_API_CATALOGUE.includes(UI_PREFERENCES_API));
  NodeAssert.deepEqual(validateApiDefinition(UI_PREFERENCES_API), UI_PREFERENCES_API);
  NodeAssert.doesNotThrow(() => assertProvidedApiOwner("other.plugin", UI_PREFERENCES_API));
  NodeAssert.equal(CLIENT_PROVIDER_APIS.get("t3.client/preferences"), CLIENT_PREFERENCES_API);
});

NodeTest.test("reads and the change stream need read; only the write needs write", () => {
  const grants = Object.fromEntries(
    [...UI_PREFERENCES_API.methods, ...UI_PREFERENCES_API.streams].map((operation) => [
      operation.name,
      { effect: operation.effect, grants: operation.requiredGrants },
    ]),
  );
  NodeAssert.deepEqual(grants, {
    getCapabilities: { effect: "read", grants: [] },
    getPreferences: { effect: "read", grants: [UI_PREFERENCES_READ] },
    setPreferences: { effect: "write", grants: [UI_PREFERENCES_WRITE] },
    subscribePreferences: { effect: undefined, grants: [UI_PREFERENCES_READ] },
  });
});

NodeTest.test("the public read and receipt share the client area's typed shape", () => {
  const publicMethods = Object.fromEntries(UI_PREFERENCES_API.methods.map((m) => [m.name, m]));
  const clientMethods = Object.fromEntries(CLIENT_PREFERENCES_API.methods.map((m) => [m.name, m]));
  NodeAssert.deepEqual(
    publicMethods.getPreferences.outputSchema,
    clientMethods.getPreferences.outputSchema,
  );
  NodeAssert.deepEqual(
    publicMethods.setPreferences.outputSchema,
    clientMethods.applyPreferences.outputSchema,
  );
  NodeAssert.deepEqual(
    publicMethods.setPreferences.inputSchema,
    clientMethods.applyPreferences.inputSchema.properties.patch,
  );
  // Closed shapes: unknown keys are not silently accepted as preferences.
  NodeAssert.equal(publicMethods.setPreferences.inputSchema.additionalProperties, false);
  NodeAssert.equal(publicMethods.getPreferences.outputSchema.additionalProperties, false);
});

NodeTest.test("renderBrowserFile is an optional boolean so older hosts stay valid", () => {
  const publicMethods = Object.fromEntries(UI_PREFERENCES_API.methods.map((m) => [m.name, m]));
  const read = publicMethods.getPreferences.outputSchema;
  NodeAssert.deepEqual(read.properties.renderBrowserFile, { type: "boolean" });
  // A host that predates the key still answers { wordWrap } alone.
  NodeAssert.deepEqual(read.required, ["wordWrap"]);
  NodeAssert.deepEqual(publicMethods.setPreferences.inputSchema.properties.renderBrowserFile, {
    type: "boolean",
  });
});
