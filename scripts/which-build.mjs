#!/usr/bin/env node
// Prints the version and source commit of every installed T3 Code desktop app
// it can find, in a form meant to be pasted into a bug report.
//
// Usage: node scripts/which-build.mjs
//
// The packaged apps embed their version and the exact source commit in
// package.json inside Contents/Resources/app.asar (buildVersion, t3codeCommitHash).

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeOs from "node:os";

const candidateApps = [
  // The OV2 / V2 Preview desktop install.
  NodePath.join(NodeOs.homedir(), ".local/share/t3-v2-desktop/T3 Code (Alpha).app"),
  "/Applications/T3 Code (Alpha).app",
  "/Applications/T3 Code.app",
  NodePath.join(NodeOs.homedir(), "Applications/T3 Code.app"),
];

function readAppMetadata(app) {
  let extractFile;
  try {
    const require = NodeModule.createRequire(import.meta.url);
    ({ extractFile } = require("@electron/asar"));
  } catch {
    throw new Error(
      "@electron/asar is not installed here. Run this script from a T3 Code checkout with dependencies installed (vp i), or run: pnpm add -w @electron/asar",
    );
  }
  const raw = extractFile(NodePath.join(app, "Contents/Resources/app.asar"), "package.json");
  return JSON.parse(raw.toString());
}

function describeApp(app) {
  const metadata = readAppMetadata(app);
  const version = metadata.buildVersion ?? metadata.version ?? "unknown";
  const commit = metadata.t3codeCommitHash ?? "unknown commit";
  const isV2 =
    app.includes("t3-v2-desktop") ||
    (typeof metadata.version === "string" && metadata.version.includes("-preview."));
  const build = isV2 ? "OV2 (V2 Preview)" : "Desktop (nightly or stable channel)";
  return `${build}: ${version} at ${String(commit).slice(0, 12)}\n  App: ${app}`;
}

const found = candidateApps.filter((app) => existsSync(app));
if (found.length === 0) {
  console.log(
    "No installed T3 Code desktop apps found. If you are on the web client, report the version shown in Settings.",
  );
  process.exit(0);
}

for (const app of found) {
  try {
    console.log(describeApp(app));
  } catch (error) {
    console.log(`Unreadable app at ${app}: ${error.message}`);
  }
}
console.log(
  "\nPaste the lines above into bug reports. 'OV2' builds come from the fork's V2 branch; 'Desktop' builds come from the nightly or stable release channel.",
);
