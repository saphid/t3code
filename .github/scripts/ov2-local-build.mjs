#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  applyPlan,
  fingerprintPlan,
  parseManifest,
  resolveCustomNightlyVersion,
} from "./downstream-nightly.mjs";

const registry = join(homedir(), ".local/share/t3-ov2-builds/latest.json");
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const save = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
function capture(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
}
const git = (cwd, ...args) => capture("git", args, cwd);
function run(command, args, cwd, env = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed: ${result.error?.message ?? result.status}`);
}

// Keep the same code identity and version algorithm as the hosted assembler.
export function localPlan(manifest, source, upstreamSha, releases = []) {
  if (manifest.releaseChannel !== "nightly-v2" || !manifest.upstreamBranch)
    throw new Error("Expected an OV2 branch manifest.");
  const patches = manifest.patches.map((patch) => {
    if (patch.type !== "commit")
      throw new Error(
        "Local builds require single-commit pins. Resolve PRs/refs into reviewed commit pins first.",
      );
    git(source, "cat-file", "-e", `${patch.sha}^{commit}`);
    return {
      ...patch,
      name: patch.name ?? git(source, "show", "-s", "--format=%s", patch.sha),
      fetchUrl: `https://github.com/${patch.repository}.git`,
      fetchRef: patch.sha,
      commits: [patch.sha],
      label: `${patch.repository}@${patch.sha.slice(0, 12)}`,
    };
  });
  const version = JSON.parse(
    git(source, "show", `${upstreamSha}:apps/desktop/package.json`),
  ).version;
  const base = /^(\d+\.\d+\.\d+)(?:-|$)/.exec(version)?.[1];
  const epoch = Number(git(source, "show", "-s", "--format=%ct", upstreamSha));
  if (!base || !Number.isFinite(epoch)) throw new Error("Invalid upstream version/date.");
  const date = new Date(epoch * 1000).toISOString().slice(0, 10).replaceAll("-", "");
  const fingerprint = fingerprintPlan(upstreamSha, patches);
  const buildVersion = resolveCustomNightlyVersion(
    `${base}-nightly.${date}.${epoch}`,
    fingerprint,
    releases,
    { channel: "nightly-v2", sourceIdentity: upstreamSha },
  );
  return {
    ...manifest,
    upstreamTag: upstreamSha,
    upstreamCheckoutRef: upstreamSha,
    upstreamUrl: `https://github.com/${manifest.upstreamRepository}/commit/${upstreamSha}`,
    patches,
    fingerprint,
    version: buildVersion,
    tag: `v${buildVersion}`,
  };
}

export function assemble({ repo, manifestPath, output, upstreamUrl, releases = [] }) {
  // Never reuse an existing directory or modify the caller's checkout.
  if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
  const manifest = parseManifest(readFileSync(manifestPath, "utf8"));
  if (manifest.patches.some((p) => p.type !== "commit"))
    throw new Error("Local builds require single-commit pins.");
  mkdirSync(output, { recursive: true });
  const source = join(output, "source");
  run("git", ["clone", "--shared", "--no-checkout", repo, source], repo);
  run("git", ["sparse-checkout", "set", "--no-cone", "/*", "!/.repos/"], source);
  run(
    "git",
    [
      "fetch",
      "--no-tags",
      upstreamUrl ?? `https://github.com/${manifest.upstreamRepository}.git`,
      `+refs/heads/${manifest.upstreamBranch}:refs/local-build/upstream`,
    ],
    source,
  );
  const upstream = git(source, "rev-parse", "refs/local-build/upstream");
  run("git", ["checkout", "-b", "local-ov2", upstream], source);
  for (const patch of manifest.patches) {
    const has = spawnSync("git", ["-C", source, "cat-file", "-e", `${patch.sha}^{commit}`]);
    if (has.status !== 0)
      run(
        "git",
        ["fetch", "--no-tags", `https://github.com/${patch.repository}.git`, patch.sha],
        source,
      );
  }
  const plan = localPlan(manifest, source, upstream, releases);
  save(join(output, "plan.json"), plan);
  copyFileSync(manifestPath, join(output, "manifest.json"));
  // All pins are now available locally. Keep canonical GitHub URLs in the fingerprint.
  const commit = applyPlan(plan, source, { localRepository: source, preserveConflicts: true });
  save(join(output, "build.json"), {
    status: "assembled",
    source,
    commit,
    upstream,
    version: plan.version,
    fingerprint: plan.fingerprint,
    distribution: "Fork",
    releaseRepository: plan.releaseRepository,
    releaseChannel: "nightly-v2",
    assembledAt: new Date().toISOString(),
  });
  return source;
}

export function verifySource(output) {
  const build = json(join(output, "build.json"));
  if (
    git(build.source, "rev-parse", "HEAD") !== build.commit ||
    git(build.source, "status", "--porcelain")
  )
    throw new Error("Assembled source changed. Assemble again from reviewed pins before building.");
  return build;
}

export function build(output, monitorFrom) {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("This local builder currently targets Apple Silicon macOS.");
  const info = verifySource(output);
  const source = info.source;
  const artifacts = join(output, "artifacts");
  if (existsSync(artifacts))
    throw new Error("Artifacts directory already exists. Preserve it and assemble a fresh build.");
  save(join(output, "build.json"), { ...info, status: "building" });
  run("vp", ["i", "--frozen-lockfile", "--ignore-scripts"], source);
  run("node", ["apps/desktop/scripts/ensure-electron-runtime.mjs"], source);
  run(
    "vp",
    [
      "test",
      "run",
      "apps/server/src/orchestration-v2/testkit/ProviderSwitch.integration.test.ts",
      "apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts",
      "apps/server/src/provider/Layers/CodexSessionRuntime.test.ts",
      "apps/server/src/voice",
      "apps/web/src/voice",
      "apps/web/src/downstreamBuild.test.ts",
      "apps/web/src/fileContextMenu.test.ts",
      "apps/web/src/keybindings.test.ts",
      "apps/web/src/components/threadActionMenu.logic.test.ts",
      "apps/web/src/components/settings/KeybindingsSettings.logic.test.ts",
      "apps/desktop/src/app/DesktopDeepLink.test.ts",
      "apps/server/src/vcs/GitVcsDriverCore.test.ts",
      "apps/desktop/src/updates",
      "apps/server/src/desktopUpdate",
      "apps/server/src/cli/update.test.ts",
    ],
    source,
  );
  for (const project of ["apps/web", "apps/server", "apps/desktop", "packages/contracts"])
    run("vp", ["exec", "tsc", "--noEmit", "-p", `${project}/tsconfig.json`], source);
  let reuse = "0";
  const monitor = "native/resource-monitor/target/aarch64-apple-darwin/release/t3-resource-monitor";
  if (monitorFrom) {
    const before = git(monitorFrom, "rev-parse", "HEAD:native/resource-monitor");
    const after = git(source, "rev-parse", "HEAD:native/resource-monitor");
    if (
      before !== after ||
      git(
        monitorFrom,
        "status",
        "--porcelain",
        "--untracked-files=no",
        "--",
        "native/resource-monitor",
      )
    )
      throw new Error(
        "Cached resource monitor source differs; omit --resource-monitor-from to rebuild it.",
      );
    mkdirSync(dirname(join(source, monitor)), { recursive: true });
    copyFileSync(join(monitorFrom, monitor), join(source, monitor));
    reuse = "1";
  }
  run(
    "vp",
    [
      "run",
      "dist:desktop:artifact",
      "--platform",
      "mac",
      "--arch",
      "arm64",
      "--target",
      "zip",
      "--build-version",
      info.version,
      "--output-dir",
      artifacts,
      "--stable-mac-adhoc-signature",
      "--keep-stage",
    ],
    source,
    {
      T3CODE_DESKTOP_DISTRIBUTION: "Fork",
      T3CODE_DESKTOP_UPDATE_REPOSITORY: info.releaseRepository,
      T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR: reuse,
    },
  );
  run("node", ["apps/server/scripts/cli.ts", "build-exe", "--verbose"], source, {
    VP_NODE_VERSION: "26.8.2",
  });
  const monitorDir = join(output, "cli-monitor");
  mkdirSync(join(monitorDir, "darwin-arm64"), { recursive: true });
  copyFileSync(join(source, monitor), join(monitorDir, "darwin-arm64/t3-resource-monitor"));
  run(
    "node",
    [
      "scripts/build-cli-archive.ts",
      "--platform",
      "mac",
      "--arch",
      "arm64",
      "--version",
      info.version,
      "--resource-monitor-dir",
      monitorDir,
      "--output-dir",
      artifacts,
    ],
    source,
  );
  const archive = join(artifacts, `t3-${info.version}-darwin-arm64.tar.gz`);
  run(
    "node",
    ["scripts/smoke-cli-archive.ts", "--archive", archive, "--expect-version", info.version],
    source,
  );
  const appDir = join(output, "desktop");
  run("ditto", ["-x", "-k", join(artifacts, `T3-Code-${info.version}-arm64.zip`), appDir], source);
  const appPath = join(appDir, "T3 Code (Fork Nightly).app");
  run("codesign", ["--verify", "--deep", "--strict", appPath], source);
  const require = createRequire(join(source, "scripts/package.json"));
  const packaged = JSON.parse(
    require("@electron/asar").extractFile(
      join(appPath, "Contents/Resources/app.asar"),
      "package.json",
    ),
  );
  if (packaged.version !== info.version || packaged.t3codeCommitHash !== info.commit.slice(0, 12))
    throw new Error("Desktop package version or source commit does not match the assembled build.");
  save(join(output, "packaged-source.json"), packaged);
  copyFileSync(
    join(repository, ".github/scripts/ov2-install-local.py"),
    join(output, "install.py"),
  );
  writeFileSync(
    join(output, "install.command"),
    '#!/bin/sh\nset -eu\ncd "$(dirname "$0")"\nexec python3 ./install.py "$PWD" --install\n',
    { mode: 0o755 },
  );
  const sums = readdirSync(artifacts)
    .filter((name) => name.endsWith(".zip") || name.endsWith(".tar.gz"))
    .map(
      (name) =>
        `${createHash("sha256")
          .update(readFileSync(join(artifacts, name)))
          .digest("hex")}  ${name}`,
    );
  writeFileSync(join(artifacts, "SHA256SUMS"), `${sums.join("\n")}\n`);
  save(join(output, "build.json"), {
    ...info,
    status: "ready",
    completedAt: new Date().toISOString(),
    artifacts,
  });
  mkdirSync(dirname(registry), { recursive: true });
  save(registry, { output });
  console.log(
    `\nReady: ${output}\nThis command did not install, restart, push, or publish anything.`,
  );
}

export async function status(output, manifestPath) {
  const info = json(join(output, "build.json"));
  const plan = json(join(output, "plan.json"));
  const latest = capture("git", [
    "ls-remote",
    `https://github.com/${plan.upstreamRepository}.git`,
    `refs/heads/${plan.upstreamBranch}`,
  ]).split(/\s+/)[0];
  if (!/^[a-f0-9]{40}$/.test(latest)) throw new Error("Could not resolve upstream branch.");
  const desired = parseManifest(readFileSync(manifestPath, "utf8"));
  const desiredPins = desired.patches.map((patch) => patch.sha);
  const builtPins = plan.patches.map((patch) => patch.commits[0]);
  let runningServer;
  try {
    const response = await fetch("http://127.0.0.1:3773/.well-known/t3/environment", {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const live = await response.json();
    runningServer = {
      version: live.serverVersion,
      matchesBuild: live.serverVersion === info.version,
    };
  } catch (error) {
    runningServer = { error: error.message };
  }
  const require = createRequire(join(info.source, "scripts/package.json"));
  const installedPath = ["T3 Code (Fork Nightly).app", "T3 Code (Alpha).app"]
    .map((name) =>
      join(homedir(), ".local/share/t3-v2-desktop", name, "Contents/Resources/app.asar"),
    )
    .find((path) => existsSync(path));
  let installedDesktop;
  if (installedPath) {
    const installed = JSON.parse(
      require("@electron/asar").extractFile(installedPath, "package.json"),
    );
    installedDesktop = {
      path: installedPath,
      version: installed.version,
      sourceCommit: installed.t3codeCommitHash,
      matchesBuild:
        installed.version === info.version &&
        installed.t3codeCommitHash === info.commit.slice(0, 12),
    };
  }
  console.log(
    JSON.stringify(
      {
        ...info,
        runningServer,
        installedDesktop,
        selectedPatchesCurrent: JSON.stringify(desiredPins) === JSON.stringify(builtPins),
        latestUpstream: latest,
        current: latest === info.upstream,
        includedPatches: plan.patches.map(({ name, commits }) => ({ name, commits })),
      },
      null,
      2,
    ),
  );
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      repo: { type: "string", default: repository },
      manifest: { type: "string", default: join(repository, ".github/downstream-nightly-v2.json") },
      output: { type: "string" },
      "resource-monitor-from": { type: "string" },
      help: { type: "boolean" },
    },
  });
  const command = positionals[0] ?? "build";
  if (values.help) {
    console.log(
      "node .github/scripts/ov2-local-build.mjs [build|assemble|package|status] [--output NEW_DIRECTORY] [--resource-monitor-from SOURCE_CHECKOUT]\nBuild fetches latest OV2, replays the pinned manifest, tests and packages it. Package resumes an assembled directory. Status compares its upstream commit with GitHub.",
    );
    return;
  }
  if (!["build", "assemble", "package", "status"].includes(command))
    throw new Error(`Unknown command: ${command}`);
  if (command === "package" && !values.output)
    throw new Error("--output is required for package/status.");
  const output = resolve(
    values.output ??
      (command === "status" ? json(registry).output : undefined) ??
      join(homedir(), ".local/share/t3-ov2-builds", new Date().toISOString().replaceAll(":", "-")),
  );
  if (command === "status") return status(output, resolve(values.manifest));
  if (command !== "package") {
    const manifest = parseManifest(readFileSync(values.manifest, "utf8"));
    const releases = JSON.parse(
      capture("gh", [
        "api",
        "--paginate",
        "--slurp",
        `repos/${manifest.releaseRepository}/releases?per_page=100`,
      ]),
    ).flat();
    assemble({
      repo: resolve(values.repo),
      manifestPath: resolve(values.manifest),
      output,
      releases,
    });
  }
  if (command !== "assemble")
    build(output, values["resource-monitor-from"] && resolve(values["resource-monitor-from"]));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
