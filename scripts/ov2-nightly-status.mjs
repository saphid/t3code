#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

const defaultRepo = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);
const defaultApp = NodePath.join(
  NodeOS.homedir(),
  ".local/share/t3-v2-desktop/T3 Code (Alpha).app",
);
const manifestPath = ".github/downstream-nightly.json";

function git(repo, args) {
  return NodeChildProcess.execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

// Stream the diff history so large rebases do not need to fit in a JS string.
async function patchIds(repo, args) {
  const log = NodeChildProcess.spawn("git", ["-C", repo, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ids = NodeChildProcess.spawn("git", ["patch-id", "--stable"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  ids.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk));
  for (const child of [log, ids]) {
    child.stderr.setEncoding("utf8").on("data", (chunk) => (errors += chunk));
  }
  const completed = [log, ids].map(
    (child) =>
      new Promise((accept, reject) => {
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) accept();
          else reject(new Error(`Cannot compare patch history: ${errors.trim()}`));
        });
      }),
  );
  ids.stdin.on("error", () => {}); // The child's exit status reports a broken pipe.
  log.stdout.pipe(ids.stdin);
  await Promise.all(completed);
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(/\s+/));
}

export async function comparePatches(repo, targetRef, nightlyRef) {
  const target = git(repo, ["rev-parse", "--verify", `${targetRef}^{commit}`]);
  const nightly = git(repo, ["rev-parse", "--verify", `${nightlyRef}^{commit}`]);
  const manifest = JSON.parse(git(repo, ["show", `${nightly}:${manifestPath}`]));
  if (!Array.isArray(manifest.patches)) throw new Error("Nightly manifest has no patches array.");
  const patches = manifest.patches.map((patch) => {
    // A PR head alone cannot prove that its entire commit series was replayed.
    if (patch.type !== "commit" && patch.type !== "ref") {
      throw new Error(
        `Unsupported patch type '${patch.type}': resolve its full commit series first.`,
      );
    }
    const sha = patch.sha ?? patch.expectedSha;
    if (!/^[0-9a-f]{40}$/.test(sha ?? ""))
      throw new Error("Nightly patch needs a full commit SHA.");
    try {
      git(repo, ["cat-file", "-e", `${sha}^{commit}`]);
    } catch {
      throw new Error(
        `Missing Nightly source commit ${sha}. Fetch it from ${patch.repository} first.`,
      );
    }
    return { sha, name: patch.name ?? git(repo, ["show", "-s", "--format=%s", sha]) };
  });
  const ancestors = new Set(git(repo, ["rev-list", target]).split("\n"));
  const candidates = patches.filter((patch) => !ancestors.has(patch.sha));
  const sourceIds = new Map();
  const targetIds = new Map();
  if (candidates.length > 0) {
    const pins = candidates.map((patch) => patch.sha);
    const base = git(repo, ["merge-base", "--octopus", target, ...pins]);
    const diffOptions = [
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--no-merges",
      "--format=medium",
      "-p",
    ];
    const [source, destination] = await Promise.all([
      patchIds(repo, ["show", ...diffOptions, ...pins]),
      patchIds(repo, ["log", ...diffOptions, `${base}..${target}`]),
    ]);
    for (const [id, sha] of source) sourceIds.set(sha, id);
    for (const [id, sha] of destination) targetIds.set(id, sha);
  }
  return {
    target,
    nightly,
    nightlyDate: git(repo, ["show", "-s", "--format=%cI", nightly]),
    manifestPath,
    patches: patches.map((patch) => {
      const match = ancestors.has(patch.sha) ? patch.sha : targetIds.get(sourceIds.get(patch.sha));
      return {
        ...patch,
        status: match ? "detected" : "not_detected",
        evidence: match
          ? match === patch.sha
            ? "original commit"
            : "equivalent rebased patch"
          : "no commit or patch match",
        targetCommit: match ?? null,
      };
    }),
  };
}

export function formatReport(report) {
  const detected = report.patches.filter((patch) => patch.status === "detected");
  const missing = report.patches.filter((patch) => patch.status === "not_detected");
  const lines = [
    "Nightly features in OV2",
    `Build: ${report.version ?? "explicit Git target"} at ${report.target.slice(0, 12)}`,
    ...(report.app ? [`App: ${report.app}`] : []),
    `Nightly manifest: ${report.nightly.slice(0, 12)} from ${report.nightlyDate}`,
    `Detected: ${detected.length}/${report.patches.length}. Not detected: ${missing.length}.`,
    "",
  ];
  for (const [title, patches] of [
    ["Detected in build history", detected],
    ["Not detected, port or review needed", missing],
  ]) {
    lines.push(title);
    if (patches.length === 0) lines.push("  None.");
    for (const patch of patches) {
      lines.push(`  ${patch.sha.slice(0, 12)}  ${patch.name}`);
      if (patch.targetCommit)
        lines.push(`                ${patch.evidence}: ${patch.targetCommit.slice(0, 12)}`);
    }
    lines.push("");
  }
  lines.push(
    "Counts are manifest patches, including fixes and build changes, not distinct features.",
    "Detection checks Git ancestry and stable patch IDs. Rewritten or squashed ports may",
    "be missed; detected patches may have changed or been reverted later. This is a",
    "replay report, not a runtime feature test. Uncommitted changes are excluded.",
    "The manifest is a local Git snapshot. Use --refresh to fetch current fork main.",
  );
  return `${lines.join("\n")}\n`;
}

async function main() {
  const { values } = NodeUtil.parseArgs({
    options: {
      repo: { type: "string", default: defaultRepo },
      app: { type: "string" },
      target: { type: "string" },
      "nightly-ref": { type: "string", default: "origin/main" },
      refresh: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(`Usage: node scripts/ov2-nightly-status.mjs [options]

Compare the installed OV2 preview's source with the fork Nightly patch manifest.

  --app PATH          Packaged .app to inspect. Default: ${defaultApp}
  --target REF        Compare a Git commit/branch instead of an installed app
  --nightly-ref REF   Manifest revision. Default: origin/main
  --repo PATH         Git repository. Default: this script's repository
  --refresh           Fetch origin/main before reading the manifest
  --json              Print structured output
  --help              Show this help

Requires Node and Git. App detection uses the repo's @electron/asar dependency.
Without --refresh this runs offline. It never checks out or replays patches.`);
    return;
  }
  if (values.app && values.target) throw new Error("Choose --app or --target, not both.");
  if (values.refresh)
    git(values.repo, ["fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
  let target = values.target;
  let version;
  let app;
  if (!target) {
    app = NodePath.resolve(values.app ?? defaultApp);
    const require = NodeModule.createRequire(import.meta.url);
    const { extractFile } = require("@electron/asar");
    const metadata = JSON.parse(
      extractFile(NodePath.join(app, "Contents/Resources/app.asar"), "package.json").toString(),
    );
    target = metadata.t3codeCommitHash;
    version = metadata.buildVersion ?? metadata.version;
    if (!target)
      throw new Error("App has no t3codeCommitHash. Supply --target with its build source SHA.");
  }
  const report = {
    ...(await comparePatches(values.repo, target, values["nightly-ref"])),
    app,
    version,
  };
  process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
}

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`OV2 report failed: ${error.message}`);
    process.exitCode = 1;
  });
}
