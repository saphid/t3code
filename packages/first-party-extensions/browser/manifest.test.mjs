import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeTest from "node:test";

import {
  BROWSER_PROFILES,
  BROWSER_SURFACE_REQUIRED_GRANTS,
  BROWSER_RECORDING_REQUIRED_GRANTS,
  BROWSER_CAPTURE_ARTIFACT_ACTIONS,
  API_CALL_TIME_GRANTS,
  GENERIC_API_CATALOGUE,
} from "@t3tools/extension-sdk/catalogue";
import { EXTENSION_GRANT_CAPABILITIES_MAX } from "@t3tools/contracts";
import { satisfiesSemverRange } from "@t3tools/shared/semver";

const manifestUrl = new URL("./.t3-extension/t3-extension.json", import.meta.url);

NodeTest.test(
  "the Browser pack declares the profiles API it consumes",
  { skip: NodeFS.existsSync(manifestUrl) ? false : "Browser bundle is absent from this split" },
  () => {
    const manifest = JSON.parse(NodeFS.readFileSync(manifestUrl, "utf8"));
    NodeAssert.ok(manifest.requires.some((requirement) => requirement.id === BROWSER_PROFILES));
  },
);

NodeTest.test(
  "the Browser pack's full capability grant set fits the installation cap",
  (testContext) => {
    const manifest = JSON.parse(NodeFS.readFileSync(manifestUrl, "utf8"));
    const grants = new Set([
      ...BROWSER_SURFACE_REQUIRED_GRANTS,
      ...BROWSER_RECORDING_REQUIRED_GRANTS,
      BROWSER_CAPTURE_ARTIFACT_ACTIONS,
    ]);
    for (const requirement of manifest.requires) {
      for (const api of GENERIC_API_CATALOGUE.filter(
        (api) =>
          api.id === requirement.id && satisfiesSemverRange(api.version, requirement.versionRange),
      )) {
        for (const member of [...(api.methods ?? []), ...(api.streams ?? [])]) {
          for (const grant of member.requiredGrants) grants.add(grant);
        }
      }
      for (const grant of API_CALL_TIME_GRANTS[requirement.id] ?? []) grants.add(grant);
    }
    NodeAssert.ok(grants.size <= EXTENSION_GRANT_CAPABILITIES_MAX);
    testContext.diagnostic(
      `${grants.size} Browser grants / ${EXTENSION_GRANT_CAPABILITIES_MAX} maximum`,
    );
  },
);
