#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultManifestPath = path.join(
  repositoryRoot,
  "config/t3code-typed-swiftui/project-isolation.json",
);

const expected = {
  schemaVersion: 1,
  repository: "saphid/t3code-typed-swiftui",
  canonicalRoot: "/Users/saphid/Projects/T3 Code/t3code-typed-swiftui",
  worktreeRoot: "/Users/saphid/.t3/worktrees/t3code-typed-swiftui",
  namespace: "t3code-typed-swiftui",
  branchPrefixes: ["typed-swiftui/", "sync/upstream-"],
  environmentPrefix: "T3_TYPED_SWIFTUI_",
  launchdPrefix: "com.alxs.t3code-typed-swiftui",
  stateRoot: "/Users/saphid/Library/Application Support/T3CodeTypedSwiftUI",
  identities: {
    releaseBundleId: "com.alxs.t3code.typed-swiftui",
    debugBundleId: "com.alxs.t3code.typed-swiftui.dev",
    releaseAppGroup: "group.com.alxs.t3code.typed-swiftui",
    debugAppGroup: "group.com.alxs.t3code.typed-swiftui.dev",
    releaseUrlScheme: "t3code-typed-swiftui",
    debugUrlScheme: "t3code-typed-swiftui-dev",
    desktopBundleId: "com.alxs.t3code.typed-swiftui.desktop",
  },
};

const forbiddenValues = [
  "/Users/saphid/Projects/T3 Code/t3code-personal",
  "/Users/saphid/.t3/worktrees/t3code-personal",
  "/Applications/T3 Code (Nightly).app",
  "/Users/saphid/.t3/userdata",
  "com.alxs.t3code.personal",
  "com.t3tools.t3code",
  "com.t3tools.t3code.swiftui",
  "com.t3tools.t3code.swiftui.dev",
  "com.alxs.t3-swift-dev-sync",
  "com.alxs.t3-swift-approved-sync",
  "t3-build-console",
  "personal/",
  "agent/swiftui-",
  "theo/",
  "t3code/",
];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stable(nested)]),
    );
  }
  return value;
}

function collectStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(collectStrings);
  }
  return [];
}

export function validateManifest(manifest) {
  const errors = [];

  if (JSON.stringify(stable(manifest)) !== JSON.stringify(stable(expected))) {
    errors.push("project-isolation manifest differs from the approved identity contract");
  }

  for (const value of collectStrings(manifest)) {
    if (forbiddenValues.includes(value)) {
      errors.push(`forbidden existing-project identity: ${value}`);
    }
  }

  return errors;
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function validateLiveRepository() {
  const errors = [];
  const manifest = JSON.parse(readFileSync(defaultManifestPath, "utf8"));
  const topLevel = realpathSync(git("rev-parse", "--show-toplevel"));
  const canonicalRoot = realpathSync(manifest.canonicalRoot);
  const commonDirectory = realpathSync(
    path.resolve(topLevel, git("rev-parse", "--git-common-dir")),
  );

  if (topLevel !== canonicalRoot) {
    errors.push(`checkout root ${topLevel} is not canonical root ${canonicalRoot}`);
  }
  if (commonDirectory !== path.join(canonicalRoot, ".git")) {
    errors.push(`Git common directory is not isolated: ${commonDirectory}`);
  }
  if (existsSync(path.join(commonDirectory, "objects/info/alternates"))) {
    errors.push("Git object alternates are forbidden");
  }

  const remotes = new Map(
    git("remote")
      .split("\n")
      .filter(Boolean)
      .map((remote) => [
        remote,
        {
          fetch: git("remote", "get-url", remote),
          push: git("remote", "get-url", "--push", remote),
        },
      ]),
  );
  const allowedOriginUrls = new Set([
    "https://github.com/saphid/t3code-typed-swiftui.git",
    "git@github.com:saphid/t3code-typed-swiftui.git",
  ]);

  if (remotes.size !== 3 || !["origin", "upstream", "contrib"].every((name) => remotes.has(name))) {
    errors.push("exactly origin, upstream, and contrib remotes are required");
  } else {
    if (!allowedOriginUrls.has(remotes.get("origin").fetch)) {
      errors.push(`unexpected origin fetch URL: ${remotes.get("origin").fetch}`);
    }
    if (!allowedOriginUrls.has(remotes.get("origin").push)) {
      errors.push(`unexpected origin push URL: ${remotes.get("origin").push}`);
    }
    if (remotes.get("upstream").fetch !== "https://github.com/pingdotgg/t3code.git") {
      errors.push(`unexpected upstream fetch URL: ${remotes.get("upstream").fetch}`);
    }
    if (remotes.get("contrib").fetch !== "https://github.com/saphid/t3code.git") {
      errors.push(`unexpected contrib fetch URL: ${remotes.get("contrib").fetch}`);
    }
    for (const remote of ["upstream", "contrib"]) {
      if (remotes.get(remote).push !== "DISABLED") {
        errors.push(`${remote} push URL must be DISABLED`);
      }
    }
  }

  return errors;
}

function validateReceipt(receiptPath) {
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const errors = [];
  const shaPattern = /^[0-9a-f]{40}$/;

  if (receipt.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (receipt.upstreamRepository !== "pingdotgg/t3code") {
    errors.push("upstreamRepository must be pingdotgg/t3code");
  }
  if (receipt.upstreamRef !== "refs/heads/main") {
    errors.push("upstreamRef must be refs/heads/main");
  }
  if (!shaPattern.test(receipt.upstreamCommit ?? "")) {
    errors.push("upstreamCommit must be a full lowercase Git SHA");
  }
  if (!shaPattern.test(receipt.productBaseCommit ?? "")) {
    errors.push("productBaseCommit must be a full lowercase Git SHA");
  }
  if (!Number.isFinite(Date.parse(receipt.createdAt ?? ""))) {
    errors.push("createdAt must be an ISO-8601 timestamp");
  }
  if (!["baseline", "merge"].includes(receipt.mode)) {
    errors.push("mode must be baseline or merge");
  }

  if (errors.length === 0) {
    try {
      git("cat-file", "-e", `${receipt.upstreamCommit}^{commit}`);
      git("cat-file", "-e", `${receipt.productBaseCommit}^{commit}`);
    } catch {
      errors.push("upstreamCommit and productBaseCommit must identify local commits");
    }
  }

  if (receipt.mode === "merge") {
    if (!shaPattern.test(receipt.mergeCommit ?? "")) {
      errors.push("merge receipts require mergeCommit");
    } else {
      try {
        const parents = git("show", "-s", "--format=%P", receipt.mergeCommit).split(" ");
        if (!parents.includes(receipt.upstreamCommit) || !parents.includes(receipt.productBaseCommit)) {
          errors.push("mergeCommit parents must include the exact product base and upstream commits");
        }
      } catch {
        errors.push("mergeCommit must identify a local commit");
      }
    }
  } else {
    if (receipt.mergeCommit !== null) {
      errors.push("baseline receipts require mergeCommit: null");
    }
    try {
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", receipt.upstreamCommit, receipt.productBaseCommit],
        { cwd: repositoryRoot, stdio: "ignore" },
      );
    } catch {
      errors.push("baseline upstreamCommit must be an ancestor of productBaseCommit");
    }
  }

  return errors.map((error) => `${path.relative(repositoryRoot, receiptPath)}: ${error}`);
}

function validateReceipts() {
  const receiptDirectory = path.join(repositoryRoot, "docs/upstream-sync/receipts");
  if (!existsSync(receiptDirectory)) return [];
  return readdirSync(receiptDirectory)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => validateReceipt(path.join(receiptDirectory, name)));
}

function run() {
  const argumentsSet = new Set(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(defaultManifestPath, "utf8"));
  const errors = [
    ...validateManifest(manifest),
    ...(argumentsSet.has("--live") ? validateLiveRepository() : []),
    ...(argumentsSet.has("--receipts") ? validateReceipts() : []),
  ];

  if (errors.length > 0) {
    for (const error of errors) console.error(`project isolation error: ${error}`);
    process.exitCode = 1;
    return;
  }

  const checks = ["static identity contract"];
  if (argumentsSet.has("--live")) checks.push("live Git/remotes");
  if (argumentsSet.has("--receipts")) checks.push("upstream receipts");
  console.log(`Project isolation verified: ${checks.join(", ")}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) run();
