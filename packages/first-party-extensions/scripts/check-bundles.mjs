#!/usr/bin/env node
/**
 * Freshness gate for committed first-party extension bundles.
 *
 * `t3-extension check` only proves a bundle matches its own receipt. The
 * bundles inline the SDK, @t3tools/shared and dependencies, so a change
 * outside a pack leaves its committed .t3-extension stale without touching
 * the pack. This rebuilds a temporary copy of the pack and byte-compares
 * every emitted file (bundles, manifest, assets, receipt) with the committed
 * directory. The build is deterministic across locations, so any difference
 * is drift.
 *
 * Library: `staleBundleFiles(packageDir)` returns the differing files; each
 * pack's bundleFreshness test asserts it is empty, so CI's package test run
 * catches drift.
 *
 * CLI: `node packages/first-party-extensions/scripts/check-bundles.mjs`
 * compiles the SDK dist (packs bundle it, so a dist older than src would hide
 * SDK drift), then checks every git-tracked
 * packages/first-party-extensions/<pack>/.t3-extension. Exit 0 = all fresh.
 * Fix a failure with `vp run build` in the named pack and commit
 * .t3-extension.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const repo = NodePath.resolve(NodeURL.fileURLToPath(new URL("../../..", import.meta.url)));
const sdk = NodePath.join(repo, "packages/extension-sdk");
const cli = NodePath.join(sdk, "bin/t3-extension.mjs");

const listFiles = (root, dir = root) =>
  NodeFS.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = NodePath.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(root, path) : [NodePath.relative(root, path)];
  });

export function staleBundleFiles(packageDir) {
  const committed = NodePath.join(packageDir, ".t3-extension");
  const temp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-bundle-fresh-"));
  try {
    const source = NodePath.join(temp, NodePath.basename(packageDir));
    NodeFS.cpSync(packageDir, source, {
      recursive: true,
      filter: (path) => {
        const name = NodePath.basename(path);
        return (
          name !== "node_modules" &&
          name !== ".t3-extension" &&
          !name.startsWith(".t3-extension-build-")
        );
      },
    });
    NodeFS.symlinkSync(
      NodePath.join(packageDir, "node_modules"),
      NodePath.join(source, "node_modules"),
    );
    const build = NodeChildProcess.spawnSync(process.execPath, [cli, "build", source], {
      encoding: "utf8",
    });
    if (build.status !== 0) throw new Error("t3-extension build failed:\n" + build.stderr);
    const built = NodePath.join(source, ".t3-extension");
    const expected = new Set(listFiles(built));
    const stale = [];
    for (const file of listFiles(committed).sort()) {
      if (!expected.delete(file)) stale.push(file + " (no longer built)");
      else if (
        !NodeFS.readFileSync(NodePath.join(built, file)).equals(
          NodeFS.readFileSync(NodePath.join(committed, file)),
        )
      )
        stale.push(file + " (differs from a fresh build)");
    }
    for (const file of [...expected].sort()) stale.push(file + " (missing)");
    return stale;
  } finally {
    NodeFS.rmSync(temp, { recursive: true, force: true });
  }
}

function main() {
  const tsc = NodePath.join(
    NodePath.dirname(
      NodeModule.createRequire(NodePath.join(sdk, "package.json")).resolve(
        "typescript/package.json",
      ),
    ),
    "bin/tsc",
  );
  const sdkBuild = NodeChildProcess.spawnSync(process.execPath, [tsc, "-p", "tsconfig.json"], {
    cwd: sdk,
    encoding: "utf8",
  });
  if (sdkBuild.status !== 0) {
    console.error("extension-sdk build failed:\n" + sdkBuild.stdout + sdkBuild.stderr);
    process.exit(1);
  }
  const packs = NodeChildProcess.execFileSync(
    "git",
    ["ls-files", "-z", "--", "packages/first-party-extensions/*/.t3-extension/receipt.json"],
    { cwd: repo, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .map((receipt) => NodePath.dirname(NodePath.dirname(receipt)));
  if (packs.length === 0) {
    console.error("No committed first-party bundles found; refusing to pass an empty gate.");
    process.exit(1);
  }
  let failed = 0;
  for (const pack of packs) {
    let stale;
    try {
      stale = staleBundleFiles(NodePath.join(repo, pack));
    } catch (error) {
      stale = [error.message];
    }
    if (stale.length) failed += 1;
    console.log((stale.length ? "STALE " : "fresh ") + pack);
    for (const line of stale) console.log("  " + line.split("\n").join("\n  "));
  }
  if (failed) {
    console.error(
      failed + " of " + packs.length + " committed bundle(s) are stale; run `vp run build` there.",
    );
    process.exit(1);
  }
}

if (process.argv[1] && NodeURL.pathToFileURL(process.argv[1]).href === import.meta.url) main();
