import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import {
  checkExternalUrl,
  GENERIC_API_CATALOGUE,
  UI_EXTERNAL_OPEN,
  uiExternalApi,
} from "../dist/catalogue.js";
import { CLIENT_PROVIDER_APIS } from "../dist/clientProviders.js";

NodeTest.test("t3.ui/external is a shared catalogue contract behind its own grant", () => {
  NodeAssert.ok(GENERIC_API_CATALOGUE.includes(uiExternalApi.definition));
  const methods = Object.fromEntries(
    uiExternalApi.definition.methods.map((method) => [method.name, method]),
  );
  NodeAssert.deepEqual(methods.open.requiredGrants, [UI_EXTERNAL_OPEN]);
  NodeAssert.equal(methods.open.effect, "write");
  NodeAssert.deepEqual(methods.getCapabilities.requiredGrants, []);
  NodeAssert.ok(CLIENT_PROVIDER_APIS.has("t3.client/external"));
});

NodeTest.test("checkExternalUrl admits absolute http(s) and normalizes to href", () => {
  NodeAssert.deepEqual(checkExternalUrl("https://Example.com"), {
    ok: true,
    url: "https://example.com/",
  });
  NodeAssert.deepEqual(checkExternalUrl("http://localhost:5173/a?b=1#c"), {
    ok: true,
    url: "http://localhost:5173/a?b=1#c",
  });
});

NodeTest.test("checkExternalUrl refuses relative input and every other scheme", () => {
  for (const value of ["", "example.com", "/path", "//example.com", "http://"])
    NodeAssert.deepEqual(checkExternalUrl(value), { ok: false, reason: "invalid-url" }, value);
  for (const value of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<p>x</p>",
    "mailto:a@example.com",
    "vscode://vscode-remote/ssh-remote+host/path",
    "ftp://example.com",
  ])
    NodeAssert.deepEqual(
      checkExternalUrl(value),
      { ok: false, reason: "scheme-not-allowed" },
      value,
    );
});
