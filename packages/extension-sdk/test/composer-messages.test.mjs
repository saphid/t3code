import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import {
  COMPOSER_CONTEXT,
  COMPOSER_CONTEXT_API,
  COMPOSER_WRITE,
  GENERIC_API_CATALOGUE,
  MESSAGES_ENRICHMENT,
  MESSAGES_ENRICHMENT_API,
  MESSAGES_WRITE,
  assertProvidedApiOwner,
  composerContextApi,
  messagesEnrichmentApi,
} from "../dist/catalogue.js";
import { validateApiDefinition } from "../dist/capabilities.js";

const methodsOf = (definition) =>
  Object.fromEntries((definition.methods ?? []).map((m) => [m.name, m]));

NodeTest.test("both contracts are registered at 1.0.0 with stable ids", () => {
  NodeAssert.equal(COMPOSER_CONTEXT_API.id, "t3.composer/context");
  NodeAssert.equal(COMPOSER_CONTEXT_API.id, COMPOSER_CONTEXT);
  NodeAssert.equal(COMPOSER_CONTEXT_API.version, "1.0.0");
  NodeAssert.equal(composerContextApi.definition, COMPOSER_CONTEXT_API);
  NodeAssert.equal(MESSAGES_ENRICHMENT_API.id, "t3.messages/enrichment");
  NodeAssert.equal(MESSAGES_ENRICHMENT_API.id, MESSAGES_ENRICHMENT);
  NodeAssert.equal(MESSAGES_ENRICHMENT_API.version, "1.0.0");
  NodeAssert.equal(messagesEnrichmentApi.definition, MESSAGES_ENRICHMENT_API);
  NodeAssert.ok(GENERIC_API_CATALOGUE.includes(COMPOSER_CONTEXT_API));
  NodeAssert.ok(GENERIC_API_CATALOGUE.includes(MESSAGES_ENRICHMENT_API));
  for (const definition of [COMPOSER_CONTEXT_API, MESSAGES_ENRICHMENT_API]) {
    NodeAssert.deepEqual(validateApiDefinition(definition), definition);
    // The catalogue definitions are canonical — the same api may be provided
    // by the host (or a plugin that re-declares it canonically).
    NodeAssert.doesNotThrow(() => assertProvidedApiOwner("other.plugin", definition));
  }
});

NodeTest.test("grants split write authority across the two contracts", () => {
  const composer = methodsOf(COMPOSER_CONTEXT_API);
  NodeAssert.deepEqual(Object.keys(composer).sort(), [
    "getCapabilities",
    "getDraftState",
    "insertContext",
  ]);
  NodeAssert.deepEqual(composer.getCapabilities.requiredGrants, []);
  NodeAssert.equal(composer.getCapabilities.effect, "read");
  NodeAssert.deepEqual(composer.insertContext.requiredGrants, [COMPOSER_WRITE]);
  NodeAssert.equal(composer.insertContext.effect, "write");
  NodeAssert.deepEqual(composer.getDraftState.requiredGrants, [COMPOSER_WRITE]);
  NodeAssert.equal(composer.getDraftState.effect, "read");

  const enrichment = methodsOf(MESSAGES_ENRICHMENT_API);
  NodeAssert.deepEqual(Object.keys(enrichment).sort(), ["attachAnnotation", "getCapabilities"]);
  NodeAssert.deepEqual(enrichment.getCapabilities.requiredGrants, []);
  NodeAssert.deepEqual(enrichment.attachAnnotation.requiredGrants, [MESSAGES_WRITE]);
  NodeAssert.equal(enrichment.attachAnnotation.effect, "write");
  // No free-form send exists anywhere on either contract.
  for (const definition of [COMPOSER_CONTEXT_API, MESSAGES_ENRICHMENT_API]) {
    for (const method of definition.methods ?? []) {
      NodeAssert.ok(!/send|prompt/i.test(method.name), method.name);
    }
  }
});

NodeTest.test("insertContext input is closed and bounded", () => {
  const input = methodsOf(COMPOSER_CONTEXT_API).insertContext.inputSchema;
  NodeAssert.equal(input.additionalProperties, false);
  NodeAssert.deepEqual(input.required, ["refs"]);
  NodeAssert.equal(input.properties.refs.maxItems, 8);
  NodeAssert.equal(input.properties.refs.minItems, 1);
  const ref = input.properties.refs.items;
  NodeAssert.equal(ref.additionalProperties, false);
  NodeAssert.deepEqual(ref.required, ["path"]);
  NodeAssert.equal(ref.properties.path.maxLength, 512);
  NodeAssert.equal(ref.properties.excerpt.maxLength, 8192);
  NodeAssert.equal(input.properties.threadId.maxLength, 128);
});

NodeTest.test("attachAnnotation input is closed and bounded", () => {
  const input = methodsOf(MESSAGES_ENRICHMENT_API).attachAnnotation.inputSchema;
  NodeAssert.equal(input.additionalProperties, false);
  NodeAssert.deepEqual(input.required, ["annotation"]);
  const annotation = input.properties.annotation;
  NodeAssert.equal(annotation.additionalProperties, false);
  NodeAssert.deepEqual(annotation.required, ["filePath", "startLine", "endLine", "body"]);
  NodeAssert.equal(annotation.properties.filePath.maxLength, 512);
  NodeAssert.equal(annotation.properties.body.maxLength, 8192);
  NodeAssert.equal(annotation.properties.excerpt.maxLength, 32768);
});

NodeTest.test("capability honesty output names per-op support and transport", () => {
  for (const [definition, ops] of [
    [COMPOSER_CONTEXT_API, ["insertContext", "getDraftState"]],
    [MESSAGES_ENRICHMENT_API, ["attachAnnotation"]],
  ]) {
    const output = methodsOf(definition).getCapabilities.outputSchema;
    NodeAssert.equal(output.additionalProperties, false);
    NodeAssert.deepEqual(output.required, ["adapter", "transport", "detail", "operations"]);
    NodeAssert.deepEqual(output.properties.transport.enum, ["server", "client", "unavailable"]);
    NodeAssert.deepEqual(output.properties.operations.required, ops);
    NodeAssert.equal(output.properties.operations.additionalProperties, false);
  }
});
