#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

const repositoryRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);
const defaultManifestPath = NodePath.join(
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
    desktopDebugBundleId: "com.alxs.t3code.typed-swiftui.desktop.dev",
    desktopReleaseUrlScheme: "t3code-typed-swiftui-desktop",
    desktopDebugUrlScheme: "t3code-typed-swiftui-desktop-dev",
  },
};

const forbiddenValues = new Set([
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
]);

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
    if (forbiddenValues.has(value)) {
      errors.push(`forbidden existing-project identity: ${value}`);
    }
  }

  return errors;
}

export function normalizePathCase(value, platform) {
  return platform === "darwin" ? value.toLowerCase() : value;
}

function comparableRealpath(value) {
  return normalizePathCase(NodeFS.realpathSync(value), NodeProcess.platform);
}

function git(...args) {
  return NodeChildProcess.execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function validateLiveRepository() {
  const errors = [];
  const manifest = JSON.parse(NodeFS.readFileSync(defaultManifestPath, "utf8"));
  const topLevelDisplay = NodeFS.realpathSync(git("rev-parse", "--show-toplevel"));
  const canonicalRootDisplay = NodeFS.realpathSync(manifest.canonicalRoot);
  const commonDirectoryDisplay = NodeFS.realpathSync(
    NodePath.resolve(topLevelDisplay, git("rev-parse", "--git-common-dir")),
  );
  const topLevel = normalizePathCase(topLevelDisplay, NodeProcess.platform);
  const canonicalRoot = normalizePathCase(canonicalRootDisplay, NodeProcess.platform);
  const commonDirectory = normalizePathCase(commonDirectoryDisplay, NodeProcess.platform);
  const expectedCommonDirectory = comparableRealpath(NodePath.join(manifest.canonicalRoot, ".git"));

  if (topLevel !== canonicalRoot) {
    errors.push(`checkout root ${topLevelDisplay} is not canonical root ${canonicalRootDisplay}`);
  }
  if (commonDirectory !== expectedCommonDirectory) {
    errors.push(`Git common directory is not isolated: ${commonDirectoryDisplay}`);
  }
  if (NodeFS.existsSync(NodePath.join(commonDirectoryDisplay, "objects/info/alternates"))) {
    errors.push("Git object alternates are forbidden");
  }
  if (git("config", "--get", "core.hooksPath") !== ".githooks") {
    errors.push("core.hooksPath must be .githooks in the canonical clone");
  }
  if (!NodeFS.existsSync(NodePath.join(repositoryRoot, ".githooks/pre-push"))) {
    errors.push("canonical-clone protected-main pre-push hook is missing");
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
  const receipt = JSON.parse(NodeFS.readFileSync(receiptPath, "utf8"));
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
        if (
          !parents.includes(receipt.upstreamCommit) ||
          !parents.includes(receipt.productBaseCommit)
        ) {
          errors.push(
            "mergeCommit parents must include the exact product base and upstream commits",
          );
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
      NodeChildProcess.execFileSync(
        "git",
        ["merge-base", "--is-ancestor", receipt.upstreamCommit, receipt.productBaseCommit],
        { cwd: repositoryRoot, stdio: "ignore" },
      );
    } catch {
      errors.push("baseline upstreamCommit must be an ancestor of productBaseCommit");
    }
  }

  return errors.map((error) => `${NodePath.relative(repositoryRoot, receiptPath)}: ${error}`);
}

function validateReceipts() {
  const receiptDirectory = NodePath.join(repositoryRoot, "docs/upstream-sync/receipts");
  if (!NodeFS.existsSync(receiptDirectory)) return [];
  return NodeFS.readdirSync(receiptDirectory)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => validateReceipt(NodePath.join(receiptDirectory, name)));
}

function collectFiles(root) {
  if (!NodeFS.existsSync(root)) return [];
  if (NodeFS.statSync(root).isFile()) return [root];
  return NodeFS.readdirSync(root).flatMap((name) => collectFiles(NodePath.join(root, name)));
}

function validateAppSandboxSources() {
  const roots = [
    NodePath.join(repositoryRoot, "apps/swift-ios"),
    NodePath.join(repositoryRoot, "apps/desktop/src"),
    NodePath.join(repositoryRoot, "apps/desktop/scripts"),
    NodePath.join(repositoryRoot, "apps/server/src/http.ts"),
    NodePath.join(repositoryRoot, "scripts/build-desktop-artifact.ts"),
    NodePath.join(repositoryRoot, "scripts/dev-runner.ts"),
  ];
  const files = roots
    .flatMap(collectFiles)
    .filter((file) => !file.includes(`${NodePath.sep}.build${NodePath.sep}`));
  const source = files.map((file) => NodeFS.readFileSync(file, "utf8")).join("\n");
  const errors = [];
  const forbiddenAppTokens = [
    "com.t3tools.t3code.swiftui",
    "group.com.t3tools.t3code.swiftui",
    "t3code-swiftui",
    "T3CodeSwift",
    "codes.t3.swift-ios",
    "com.t3tools.t3code.dev",
    '"com.t3tools.t3code"',
    "t3code://app",
    "t3code-dev://app",
  ];
  const requiredAppTokens = [
    "com.alxs.t3code.typed-swiftui",
    "group.com.alxs.t3code.typed-swiftui",
    "t3code-typed-swiftui",
    "T3CodeTypedSwiftUI",
    "com.alxs.t3code.typed-swiftui.desktop",
    "t3code-typed-swiftui-desktop",
    "T3 Typed Desktop",
    "T3 Typed SwiftUI",
  ];

  for (const token of forbiddenAppTokens) {
    if (source.includes(token)) errors.push(`sandbox source contains existing-app token: ${token}`);
  }
  for (const token of requiredAppTokens) {
    if (!source.includes(token)) errors.push(`sandbox source is missing reserved token: ${token}`);
  }
  if (source.includes("buildConfig.publish = [publishConfig]")) {
    errors.push("sandbox desktop builds must not inherit a GitHub auto-update feed");
  }
  const desktopConfigSource = NodeFS.readFileSync(
    NodePath.join(repositoryRoot, "apps/desktop/src/app/DesktopConfig.ts"),
    "utf8",
  );
  if (desktopConfigSource.includes('trimmedString("T3CODE_')) {
    errors.push("sandbox desktop config must not consume existing-product T3CODE_* overrides");
  }
  if (!desktopConfigSource.includes("T3_TYPED_SWIFTUI_")) {
    errors.push("sandbox desktop config must consume its reserved environment namespace");
  }

  const devRunnerSource = NodeFS.readFileSync(
    NodePath.join(repositoryRoot, "scripts/dev-runner.ts"),
    "utf8",
  );
  if (
    !devRunnerSource.includes("output.T3_TYPED_SWIFTUI_HOME = resolvedBaseDir") ||
    !devRunnerSource.includes("output.T3_TYPED_SWIFTUI_PORT = String(serverPort)")
  ) {
    errors.push("sandbox desktop dev runner must emit the reserved environment namespace");
  }

  return errors;
}

function run() {
  const argumentsSet = new Set(NodeProcess.argv.slice(2));
  const manifest = JSON.parse(NodeFS.readFileSync(defaultManifestPath, "utf8"));
  const errors = [
    ...validateManifest(manifest),
    ...validateAppSandboxSources(),
    ...(argumentsSet.has("--live") ? validateLiveRepository() : []),
    ...(argumentsSet.has("--receipts") ? validateReceipts() : []),
  ];

  if (errors.length > 0) {
    for (const error of errors) console.error(`project isolation error: ${error}`);
    NodeProcess.exit(1);
  }

  const checks = ["static identity contract"];
  if (argumentsSet.has("--live")) checks.push("live Git/remotes");
  if (argumentsSet.has("--receipts")) checks.push("upstream receipts");
  console.log(`Project isolation verified: ${checks.join(", ")}.`);
}

if (import.meta.url === NodeURL.pathToFileURL(NodeProcess.argv[1]).href) run();
