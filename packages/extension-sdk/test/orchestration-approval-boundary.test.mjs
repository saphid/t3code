import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { orchestrationControlApi } from "../dist/catalogue.js";

NodeTest.test("extension turn.start has no runtime or interaction mode input", () => {
  const start = orchestrationControlApi.definition.methods.find(
    (method) => method.name === "turn.start",
  );
  NodeAssert.equal(start.inputSchema.additionalProperties, false);
  NodeAssert.equal(Object.hasOwn(start.inputSchema.properties, "runtimeMode"), false);
  NodeAssert.equal(Object.hasOwn(start.inputSchema.properties, "interactionMode"), false);
});

NodeTest.test(
  "responding to agent approvals requires an explicit grant in addition to operate",
  () => {
    const respond = orchestrationControlApi.definition.methods.find(
      (method) => method.name === "approval.respond",
    );
    NodeAssert.deepEqual(respond.requiredGrants, [
      "t3.orchestration/operate",
      "t3.orchestration/approve-requests",
    ]);
    const start = orchestrationControlApi.definition.methods.find(
      (method) => method.name === "turn.start",
    );
    NodeAssert.deepEqual(start.requiredGrants, ["t3.orchestration/operate"]);
  },
);
