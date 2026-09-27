import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { defineApi } from "../dist/capabilities.js";
import { requireApi } from "../dist/authoring.js";
import * as Catalogue from "../dist/catalogue.js";

/**
 * Every catalogue API whose default range sits above its major's x.0.0. Every
 * pack that calls `requireApi(api)` or `bindApi(api, …)` without a range gets
 * this floor, so a minor bump that moves it stops loading those packs on older
 * hosts. Add `baseline` when the new members are optional; change this table
 * only when every default consumer really needs the new floor.
 */
const RAISED_DEFAULT_FLOORS = {
  browserHistoryApi: "^1.1.0",
  browserSessionsApi: "^1.2.0",
  browserSessionsApiV1_1: "^1.1.0",
  composerContextApi: "^1.2.0",
  messagesEnrichmentApi: "^1.1.0",
  orchestrationControlApi: "^1.1.0",
  resourcesLeaseApi: "^1.1.0",
  terminalSessionsApi: "^1.1.0",
  textEditsApi: "^1.1.0",
  uiKeybindingsApi: "^1.1.0",
  vcsChangesApi: "^1.1.0",
  vcsDiffApi: "^1.1.0",
  vcsRepositoryApi: "^1.2.0",
  vcsRepositoryApiV1_1: "^1.1.0",
};

NodeTest.test("a catalogue minor bump never silently raises default requirements", () => {
  const raised = Object.fromEntries(
    Object.entries(Catalogue)
      .filter(([, value]) => typeof value?.definition?.id === "string")
      .map(([name, api]) => [name, requireApi(api).versionRange])
      .filter(([, range]) => !/^\^\d+\.0\.0$/.test(range)),
  );
  NodeAssert.deepEqual(raised, RAISED_DEFAULT_FLOORS);
});

NodeTest.test("notifications 1.1 keeps default consumers on ^1.0.0", () => {
  NodeAssert.equal(Catalogue.uiNotificationsApi.definition.version, "1.1.0");
  NodeAssert.deepEqual(requireApi(Catalogue.uiNotificationsApi), {
    id: "t3.ui/notifications",
    versionRange: "^1.0.0",
  });
});

NodeTest.test("a baseline must be an earlier version of the same major", () => {
  const definition = { ...Catalogue.uiPanelsApi.definition, version: "1.2.3" };
  const range = (baseline) => requireApi(defineApi(definition, { baseline })).versionRange;
  NodeAssert.equal(range("1.0.0"), "^1.0.0");
  NodeAssert.equal(range("1.2.3"), "^1.2.3");
  for (const baseline of ["1.3.0", "1.2.4", "0.9.0", "2.0.0", "^1.0.0", "1.0"])
    NodeAssert.throws(() => defineApi(definition, { baseline }), /baseline/, baseline);
});
