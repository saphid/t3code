#!/usr/bin/env node
/**
 * Freshness gate for committed first-party and SDK example extension bundles.
 *
 * `t3-extension check` only proves a bundle matches its own receipt. The
 * bundles inline the SDK, @t3tools/shared and dependencies, so a change
 * outside a pack leaves its committed .t3-extension stale without touching
 * the pack. This rebuilds a temporary copy of the pack and byte-compares
 * every emitted file (bundles, manifest, assets, receipt) with the committed
 * directory. The build is deterministic across locations and link layouts,
 * so any difference is drift.
 *
 * Library: `staleBundleFiles(packageDir)` returns the differing files; each
 * pack's bundleFreshness test asserts it is empty, so CI's package test run
 * catches drift. Those tests use the SDK dist as it is on disk — they skip
 * the SDK compile below — so locally a stale dist can let a pack test pass
 * while this CLI fails. That is the fail-safe direction, and CI builds dist
 * fresh.
 *
 * CLI: `node packages/first-party-extensions/scripts/check-bundles.mjs`
 * compiles the SDK dist (packs bundle it, so a dist older than src would hide
 * SDK drift), then checks every git-tracked .t3-extension under
 * packages/first-party-extensions/<pack> and packages/extension-sdk/examples/
 * <example>. A tracked bundle without its receipt.json fails the gate rather
 * than being skipped. Exit 0 = all fresh. Fix a failure by rebuilding the
 * named package (`vp run build` in a pack; an SDK example builds with its
 * declared dependencies installed or linked) and committing .t3-extension.
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
const BUNDLE_ROOTS = ["packages/first-party-extensions", "packages/extension-sdk/examples"];
/** A pack build normally takes seconds; past this it is wedged, not slow. */
export const BUILD_TIMEOUT_MS = 5 * 60_000;

const listFiles = (root, dir = root) =>
  NodeFS.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = NodePath.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(root, path) : [NodePath.relative(root, path)];
  });

/**
 * SDK examples declare dependencies but are not workspace members, so nothing
 * is installed for them. Link each one — the SDK itself, the rest as the SDK
 * resolves them — the way an install would.
 */
function linkDeclaredDependencies(packageDir, modules) {
  const manifest = JSON.parse(
    NodeFS.readFileSync(NodePath.join(packageDir, "package.json"), "utf8"),
  );
  const fromSdk = NodeModule.createRequire(NodePath.join(sdk, "package.json"));
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    const target =
      name === "@t3tools/extension-sdk"
        ? sdk
        : NodePath.dirname(fromSdk.resolve(name + "/package.json"));
    const link = NodePath.join(modules, name);
    NodeFS.mkdirSync(NodePath.dirname(link), { recursive: true });
    NodeFS.symlinkSync(target, link);
  }
}

export function staleBundleFiles(packageDir, { timeoutMs = BUILD_TIMEOUT_MS } = {}) {
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
    const modules = NodePath.join(packageDir, "node_modules");
    if (NodeFS.existsSync(modules))
      NodeFS.symlinkSync(modules, NodePath.join(source, "node_modules"));
    else linkDeclaredDependencies(packageDir, NodePath.join(source, "node_modules"));
    const build = NodeChildProcess.spawnSync(process.execPath, [cli, "build", source], {
      encoding: "utf8",
      timeout: timeoutMs,
    });
    if (build.error?.code === "ETIMEDOUT")
      throw new Error(
        "t3-extension build timed out after " +
          timeoutMs +
          "ms — a wedged build, not drift; run `vp run build` in the package to see where it hangs.",
      );
    if (build.status !== 0)
      throw new Error("t3-extension build failed:\n" + (build.stderr || build.error?.message));
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

/**
 * Bundle packages from git-tracked paths under BUNDLE_ROOTS. Discovery keys
 * on any tracked .t3-extension file, so a bundle committed without its
 * receipt.json surfaces in `missingReceipt` instead of evading the gate.
 */
export function committedBundles(trackedFiles) {
  const packs = new Set();
  const receipts = new Set();
  for (const file of trackedFiles) {
    const marker = file.indexOf("/.t3-extension/");
    if (marker === -1) continue;
    const pack = file.slice(0, marker);
    packs.add(pack);
    if (file === pack + "/.t3-extension/receipt.json") receipts.add(pack);
  }
  const sorted = [...packs].sort();
  return {
    packs: sorted.filter((pack) => receipts.has(pack)),
    missingReceipt: sorted.filter((pack) => !receipts.has(pack)),
  };
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
  const { packs, missingReceipt } = committedBundles(
    NodeChildProcess.execFileSync(
      "git",
      ["ls-files", "-z", "--", ...BUNDLE_ROOTS.map((root) => root + "/*/.t3-extension/*")],
      { cwd: repo, encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean),
  );
  for (const pack of missingReceipt)
    console.log("NO RECEIPT " + pack + "\n  committed .t3-extension has no receipt.json");
  if (packs.length === 0) {
    console.error("No committed first-party bundles found; refusing to pass an empty gate.");
    process.exit(1);
  }
  let failed = missingReceipt.length;
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
      failed +
        " of " +
        (packs.length + missingReceipt.length) +
        " committed bundle(s) are stale or unreceipted; rebuild them and commit .t3-extension.",
    );
    process.exit(1);
  }
}

if (process.argv[1] && NodeURL.pathToFileURL(process.argv[1]).href === import.meta.url) main();
