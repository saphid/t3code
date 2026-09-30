import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeTest from "node:test";

import { BROWSER_PROFILES } from "@t3tools/extension-sdk/catalogue";

const manifestUrl = new URL("./.t3-extension/t3-extension.json", import.meta.url);

NodeTest.test(
  "the Browser pack declares the profiles API it consumes",
  { skip: NodeFS.existsSync(manifestUrl) ? false : "Browser bundle is absent from this split" },
  () => {
    const manifest = JSON.parse(NodeFS.readFileSync(manifestUrl, "utf8"));
    NodeAssert.ok(manifest.requires.some((requirement) => requirement.id === BROWSER_PROFILES));
  },
);
