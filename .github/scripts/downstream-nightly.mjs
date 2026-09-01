#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const NIGHTLY_TAG_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)-nightly\.(\d{8})\.(\d+)$/u;
const RELEASE_MARKER_PREFIX = "<!-- downstream-nightly-source: ";
const REQUIRED_UPDATE_MANIFESTS = ["nightly-linux.yml", "nightly-mac.yml", "nightly.yml"];
const RELEASE_PACKAGE_FILES = [
  "apps/server/package.json",
  "apps/desktop/package.json",
  "apps/web/package.json",
  "packages/contracts/package.json",
];

function fail(message) {
  throw new Error(message);
}

function assertRepository(value, field) {
  if (typeof value !== "string" || !REPOSITORY_PATTERN.test(value)) {
    fail(`${field} must be a GitHub owner/repository slug.`);
  }
  return value;
}

function assertSha(value, field) {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) {
    fail(`${field} must be a full 40-character lowercase commit SHA.`);
  }
  return value;
}

export function parseManifest(raw) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    fail(`Downstream Nightly manifest is not valid JSON: ${error.message}`);
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("Downstream Nightly manifest must be a JSON object.");
  }

  const upstreamRepository = assertRepository(input.upstreamRepository, "upstreamRepository");
  const releaseRepository = assertRepository(input.releaseRepository, "releaseRepository");
  if (
    typeof input.generatedBranch !== "string" ||
    input.generatedBranch.length === 0 ||
    input.generatedBranch.startsWith("/") ||
    input.generatedBranch.endsWith("/") ||
    input.generatedBranch.includes("..") ||
    /[~^:?*\[\\\s]/u.test(input.generatedBranch)
  ) {
    fail("generatedBranch must be a valid non-empty Git branch name.");
  }
  if (!Array.isArray(input.patches)) {
    fail("patches must be an array.");
  }

  const patches = input.patches.map((patch, index) => {
    const field = `patches[${index}]`;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      fail(`${field} must be an object.`);
    }
    const repository = assertRepository(patch.repository, `${field}.repository`);

    if (patch.type === "pull_request") {
      if (!Number.isSafeInteger(patch.number) || patch.number <= 0) {
        fail(`${field}.number must be a positive integer.`);
      }
      return {
        type: patch.type,
        repository,
        number: patch.number,
        headSha: assertSha(patch.headSha, `${field}.headSha`),
      };
    }

    if (patch.type === "commit") {
      return {
        type: patch.type,
        repository,
        sha: assertSha(patch.sha, `${field}.sha`),
      };
    }

    if (patch.type === "ref") {
      if (typeof patch.ref !== "string" || patch.ref.length === 0) {
        fail(`${field}.ref must be a non-empty Git ref.`);
      }
      return {
        type: patch.type,
        repository,
        ref: patch.ref,
        expectedSha: assertSha(patch.expectedSha, `${field}.expectedSha`),
      };
    }

    fail(`${field}.type must be pull_request, commit, or ref.`);
  });

  return {
    upstreamRepository,
    releaseRepository,
    generatedBranch: input.generatedBranch,
    patches,
  };
}

export function selectLatestNightlyRelease(releases) {
  return releases
    .filter(
      (release) =>
        release &&
        release.draft !== true &&
        release.prerelease === true &&
        typeof release.tag_name === "string" &&
        NIGHTLY_TAG_PATTERN.test(release.tag_name),
    )
    .sort((left, right) => {
      const rightDate = Date.parse(right.published_at ?? right.created_at ?? "");
      const leftDate = Date.parse(left.published_at ?? left.created_at ?? "");
      return rightDate - leftDate;
    })[0];
}

export function fingerprintPlan(upstreamTag, patches) {
  return createHash("sha256").update(JSON.stringify({ upstreamTag, patches })).digest("hex");
}

export function resolveCustomNightlyVersion(upstreamTag, fingerprint) {
  const match = NIGHTLY_TAG_PATTERN.exec(upstreamTag);
  if (!match) fail(`Upstream release tag '${upstreamTag}' is not a supported Nightly tag.`);
  const [, major, minor, patch, date, upstreamSerial] = match;
  const suffix = (BigInt(`0x${fingerprint.slice(0, 12)}`) % 900_000n) + 100_000n;
  const serial = BigInt(upstreamSerial) * 1_000_000n + suffix;
  return `${major}.${minor}.${patch}-nightly.${date}.${serial}`;
}

export function releaseMarker(upstreamTag, fingerprint) {
  return `${RELEASE_MARKER_PREFIX}${JSON.stringify({ upstreamTag, fingerprint })} -->`;
}

export function isCompleteMatchingRelease(release, upstreamTag, fingerprint) {
  if (typeof release?.body !== "string") return false;
  if (!release.body.includes(releaseMarker(upstreamTag, fingerprint))) return false;
  const assetNames = new Set((release.assets ?? []).map((asset) => asset?.name));
  return REQUIRED_UPDATE_MANIFESTS.every((name) => assetNames.has(name));
}

async function githubRequest(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "t3code-downstream-nightly",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    fail(`GitHub API request failed (${response.status}) for ${path}: ${body}`);
  }
  return response.json();
}

async function githubPaginate(path, token) {
  const separator = path.includes("?") ? "&" : "?";
  const results = [];
  for (let page = 1; ; page += 1) {
    const values = await githubRequest(`${path}${separator}per_page=100&page=${page}`, token);
    if (!Array.isArray(values)) fail(`Expected an array from GitHub API path ${path}.`);
    results.push(...values);
    if (values.length < 100) return results;
  }
}

async function resolvePatch(patch, token) {
  if (patch.type === "commit") {
    const commit = await githubRequest(
      `/repos/${patch.repository}/commits/${encodeURIComponent(patch.sha)}`,
      token,
    );
    if (commit.sha !== patch.sha)
      fail(`Commit ${patch.repository}@${patch.sha} did not resolve exactly.`);
    return {
      ...patch,
      fetchUrl: `https://github.com/${patch.repository}.git`,
      fetchRef: patch.sha,
      commits: [patch.sha],
      label: `${patch.repository}@${patch.sha.slice(0, 12)}`,
    };
  }

  if (patch.type === "ref") {
    const commit = await githubRequest(
      `/repos/${patch.repository}/commits/${encodeURIComponent(patch.ref)}`,
      token,
    );
    if (commit.sha !== patch.expectedSha) {
      fail(
        `Ref ${patch.repository}@${patch.ref} moved from pinned SHA ${patch.expectedSha} to ${commit.sha}.`,
      );
    }
    return {
      ...patch,
      fetchUrl: `https://github.com/${patch.repository}.git`,
      fetchRef: patch.ref,
      commits: [patch.expectedSha],
      label: `${patch.repository}@${patch.ref}`,
    };
  }

  const pullRequest = await githubRequest(
    `/repos/${patch.repository}/pulls/${patch.number}`,
    token,
  );
  if (pullRequest.head?.sha !== patch.headSha) {
    fail(
      `PR ${patch.repository}#${patch.number} moved from pinned head ${patch.headSha} to ${pullRequest.head?.sha ?? "unknown"}.`,
    );
  }
  const commits = await githubPaginate(
    `/repos/${patch.repository}/pulls/${patch.number}/commits`,
    token,
  );
  const shas = commits.map((commit) => assertSha(commit.sha, `PR #${patch.number} commit`));
  if (shas.length === 0 || shas.at(-1) !== patch.headSha) {
    fail(`PR ${patch.repository}#${patch.number} did not return its pinned head commit.`);
  }
  return {
    ...patch,
    fetchUrl: `https://github.com/${patch.repository}.git`,
    fetchRef: `refs/pull/${patch.number}/head`,
    commits: shas,
    label: `${patch.repository}#${patch.number}`,
  };
}

export async function resolvePlan(manifest, token) {
  const upstreamReleases = await githubPaginate(
    `/repos/${manifest.upstreamRepository}/releases`,
    token,
  );
  const upstreamRelease = selectLatestNightlyRelease(upstreamReleases);
  if (!upstreamRelease)
    fail(`No upstream Nightly release found in ${manifest.upstreamRepository}.`);

  const patches = [];
  for (const patch of manifest.patches) {
    patches.push(await resolvePatch(patch, token));
  }

  const fingerprint = fingerprintPlan(upstreamRelease.tag_name, patches);
  const version = resolveCustomNightlyVersion(upstreamRelease.tag_name, fingerprint);
  const tag = `v${version}`;
  const downstreamReleases = await githubPaginate(
    `/repos/${manifest.releaseRepository}/releases`,
    token,
  );
  const matchingRelease = downstreamReleases.find((release) => release.tag_name === tag);
  if (
    matchingRelease &&
    !matchingRelease.body?.includes(releaseMarker(upstreamRelease.tag_name, fingerprint))
  ) {
    fail(`Release tag ${tag} already exists for a different patch-stack fingerprint.`);
  }

  return {
    shouldBuild: !isCompleteMatchingRelease(matchingRelease, upstreamRelease.tag_name, fingerprint),
    upstreamRepository: manifest.upstreamRepository,
    upstreamTag: upstreamRelease.tag_name,
    upstreamUrl: upstreamRelease.html_url,
    releaseRepository: manifest.releaseRepository,
    generatedBranch: manifest.generatedBranch,
    fingerprint,
    version,
    tag,
    patches,
  };
}

function runGit(sourceDir, args, options = {}) {
  const output = execFileSync("git", ["-C", sourceDir, ...args], {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  return typeof output === "string" ? output.trim() : "";
}

function cherryPick(sourceDir, sha, label) {
  const ancestor = spawnSync("git", ["-C", sourceDir, "merge-base", "--is-ancestor", sha, "HEAD"]);
  if (ancestor.status === 0) {
    console.log(`Skipping ${sha}: already contained in generated source.`);
    return;
  }
  if (ancestor.status !== 1) fail(`Could not compare ${sha} with generated source.`);

  const result = spawnSync("git", ["-C", sourceDir, "cherry-pick", sha], {
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status === 0) return;

  const workingTreeClean =
    spawnSync("git", ["-C", sourceDir, "diff", "--quiet"]).status === 0 &&
    spawnSync("git", ["-C", sourceDir, "diff", "--cached", "--quiet"]).status === 0;
  if (workingTreeClean) {
    console.log(`Skipping ${sha}: its changes are already present.`);
    runGit(sourceDir, ["cherry-pick", "--skip"]);
    return;
  }

  runGit(sourceDir, ["cherry-pick", "--abort"]);
  fail(`Patch ${label} conflicts while cherry-picking ${sha}.`);
}

function updatePackageVersions(sourceDir, version) {
  for (const relativePath of RELEASE_PACKAGE_FILES) {
    const path = resolve(sourceDir, relativePath);
    const packageJson = JSON.parse(readFileSync(path, "utf8"));
    packageJson.version = version;
    writeFileSync(path, `${JSON.stringify(packageJson, null, 2)}\n`);
  }
}

function stringifyBuildMetadata(metadata) {
  const json = JSON.stringify(metadata, null, 2).replace(
    /"commits": \[\n\s+("[0-9a-f]{40}")\n\s+\]/g,
    '"commits": [$1]',
  );
  return `${json}\n`;
}

export function applyPlan(plan, sourceDir) {
  runGit(sourceDir, ["config", "user.name", "github-actions[bot]"]);
  runGit(sourceDir, [
    "config",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
  ]);

  for (const [index, patch] of plan.patches.entries()) {
    const localRef = `refs/downstream/patch-${index}`;
    runGit(sourceDir, ["fetch", "--no-tags", patch.fetchUrl, `+${patch.fetchRef}:${localRef}`]);
    for (const sha of patch.commits) cherryPick(sourceDir, sha, patch.label);
  }

  updatePackageVersions(sourceDir, plan.version);
  const metadataPath = resolve(sourceDir, ".github/downstream-nightly-build.json");
  writeFileSync(
    metadataPath,
    stringifyBuildMetadata({
      upstreamRepository: plan.upstreamRepository,
      upstreamTag: plan.upstreamTag,
      upstreamUrl: plan.upstreamUrl,
      releaseRepository: plan.releaseRepository,
      fingerprint: plan.fingerprint,
      version: plan.version,
      tag: plan.tag,
      patches: plan.patches.map(({ label, commits }) => ({ label, commits })),
    }),
  );
  runGit(sourceDir, ["add", ...RELEASE_PACKAGE_FILES, ".github/downstream-nightly-build.json"]);
  runGit(sourceDir, ["commit", "-m", `build: assemble ${plan.tag}`]);
  return runGit(sourceDir, ["rev-parse", "HEAD"], { capture: true });
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || value === undefined) fail(`Invalid argument near '${flag}'.`);
    values.set(flag.slice(2), value);
  }
  return { command, values };
}

function requireArgument(values, name) {
  const value = values.get(name);
  if (!value) fail(`Missing required --${name} argument.`);
  return value;
}

function appendGithubOutput(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  writeFileSync(outputPath, `${lines.join("\n")}\n`, { flag: "a" });
}

async function main() {
  const { command, values } = parseArguments(process.argv.slice(2));
  if (command === "resolve") {
    const manifestPath = requireArgument(values, "manifest");
    const outputPath = requireArgument(values, "output");
    const token = process.env.GITHUB_TOKEN;
    if (!token) fail("GITHUB_TOKEN is required to resolve a Downstream Nightly plan.");
    const manifest = parseManifest(readFileSync(manifestPath, "utf8"));
    const plan = await resolvePlan(manifest, token);
    writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
    appendGithubOutput({
      should_build: String(plan.shouldBuild),
      upstream_repository: plan.upstreamRepository,
      upstream_tag: plan.upstreamTag,
      release_repository: plan.releaseRepository,
      generated_branch: plan.generatedBranch,
      fingerprint: plan.fingerprint,
      version: plan.version,
      tag: plan.tag,
    });
    console.log(
      plan.shouldBuild
        ? `Will build ${plan.tag} from ${plan.upstreamTag}.`
        : `${plan.tag} is already complete.`,
    );
    return;
  }

  if (command === "apply") {
    const plan = JSON.parse(readFileSync(requireArgument(values, "plan"), "utf8"));
    const sourceDir = requireArgument(values, "source");
    const sourceSha = applyPlan(plan, sourceDir);
    appendGithubOutput({ source_sha: sourceSha });
    console.log(`Generated source commit ${sourceSha}.`);
    return;
  }

  fail("Expected the resolve or apply command.");
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
