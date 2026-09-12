import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import {
  GENERIC_API_CATALOGUE,
  RESOURCES_LEASE,
  RESOURCES_LEASE_API,
  RESOURCE_LEASE_KIND_GRANTS,
  RESOURCE_LEASE_SUPPORTED_KINDS,
  WORKSPACE_RESOURCES,
  resourcesLeaseApi,
} from "../dist/catalogue.js";
import { validateApiDefinition } from "../dist/capabilities.js";

const methodsOf = (definition) =>
  Object.fromEntries((definition.methods ?? []).map((m) => [m.name, m]));

NodeTest.test("t3.resources/lease is a frozen catalogue entry at 1.0.0", () => {
  NodeAssert.equal(RESOURCES_LEASE_API.id, RESOURCES_LEASE);
  NodeAssert.equal(RESOURCES_LEASE_API.version, "1.0.0");
  NodeAssert.equal(resourcesLeaseApi.definition, RESOURCES_LEASE_API);
  NodeAssert.deepEqual(
    GENERIC_API_CATALOGUE.filter((d) => d.id === RESOURCES_LEASE),
    [RESOURCES_LEASE_API],
  );
  // The registered definition validates as a catalogue entry (validator copies).
  NodeAssert.deepEqual(validateApiDefinition(RESOURCES_LEASE_API), RESOURCES_LEASE_API);
});

NodeTest.test("methods are closed-schema reads with no method-level grant list", () => {
  const methods = methodsOf(RESOURCES_LEASE_API);
  NodeAssert.deepEqual(Object.keys(methods).sort(), ["createPresentationUrl", "getCapabilities"]);
  for (const [name, method] of Object.entries(methods)) {
    NodeAssert.equal(method.effect, "read", name);
    NodeAssert.equal(method.inputSchema.additionalProperties, false, name);
    // Per-kind grants cannot live on the method — the host adapter enforces
    // RESOURCE_LEASE_KIND_GRANTS at mint time for every caller.
    NodeAssert.deepEqual(method.requiredGrants, [], name);
    NodeAssert.equal(method.outputSchema.additionalProperties, false, name);
  }
});

NodeTest.test(
  "the resource union mirrors AssetResource without advertising unmintable kinds",
  () => {
    const input = methodsOf(RESOURCES_LEASE_API).createPresentationUrl.inputSchema;
    NodeAssert.deepEqual(input.required, ["resource"]);
    const tags = input.properties.resource.oneOf.map((v) => v.properties._tag.const);
    NodeAssert.deepEqual(tags.sort(), ["attachment", "project-favicon", "workspace-file"]);
    for (const variant of input.properties.resource.oneOf) {
      NodeAssert.equal(variant.additionalProperties, false, variant.properties._tag.const);
    }
    // No ws-stream or arbitrary-path kinds leak into the contract.
    for (const banned of [
      "media-file",
      "native-app-icon",
      "browser-surface",
      "device-stream",
      "ws-stream",
    ]) {
      NodeAssert.ok(!tags.includes(banned), banned);
    }
  },
);

NodeTest.test("the lease result carries url, expiresAt and the honest claim kind", () => {
  const output = methodsOf(RESOURCES_LEASE_API).createPresentationUrl.outputSchema;
  NodeAssert.deepEqual([...output.required].sort(), ["expiresAt", "kind", "url"]);
  NodeAssert.deepEqual(output.properties.kind.enum.sort(), [
    "project-favicon",
    "project-favicon-external",
    "workspace-file",
    "workspace-file-exact",
  ]);
});

NodeTest.test("the per-kind grant map and capabilities agree", () => {
  NodeAssert.equal(WORKSPACE_RESOURCES, "t3.workspace/resources");
  NodeAssert.equal(RESOURCE_LEASE_KIND_GRANTS["workspace-file"], WORKSPACE_RESOURCES);
  NodeAssert.equal(RESOURCE_LEASE_KIND_GRANTS["project-favicon"], WORKSPACE_RESOURCES);
  // attachment stays in the union but is unmintable until a grant exists.
  NodeAssert.equal(RESOURCE_LEASE_KIND_GRANTS["attachment"], null);
  NodeAssert.deepEqual([...RESOURCE_LEASE_SUPPORTED_KINDS].sort(), [
    "project-favicon",
    "workspace-file",
  ]);
  const output = methodsOf(RESOURCES_LEASE_API).getCapabilities.outputSchema;
  NodeAssert.deepEqual(output.required, ["supportedKinds"]);
  NodeAssert.deepEqual(output.properties.supportedKinds.items.enum.sort(), [
    "attachment",
    "project-favicon",
    "workspace-file",
  ]);
});
