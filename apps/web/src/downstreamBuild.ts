const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const PULL_REQUEST_LABEL_PATTERN = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9][0-9]*)$/u;
const COMMIT_LABEL_PATTERN = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@[0-9a-f]{12}$/u;

export interface DownstreamBuildPatch {
  readonly label: string;
  readonly name: string | null;
  readonly commits: ReadonlyArray<string>;
}

export interface DownstreamBuildMetadata {
  readonly upstreamRepository: string;
  readonly upstreamTag: string;
  readonly upstreamUrl: string;
  readonly releaseRepository: string;
  readonly fingerprint: string;
  readonly version: string;
  readonly tag: string;
  readonly patches: ReadonlyArray<DownstreamBuildPatch>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isGitHubUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com";
  } catch {
    return false;
  }
}

function parsePatch(value: unknown): DownstreamBuildPatch | null {
  if (!isRecord(value) || !isNonEmptyString(value.label) || !Array.isArray(value.commits)) {
    return null;
  }
  if (!PULL_REQUEST_LABEL_PATTERN.test(value.label) && !COMMIT_LABEL_PATTERN.test(value.label)) {
    return null;
  }
  if (
    !value.commits.every(
      (commit): commit is string => typeof commit === "string" && COMMIT_SHA_PATTERN.test(commit),
    )
  ) {
    return null;
  }
  if (value.name !== undefined && value.name !== null && !isNonEmptyString(value.name)) {
    return null;
  }
  return {
    label: value.label,
    name: value.name?.trim() ?? null,
    commits: value.commits,
  };
}

export function parseDownstreamBuildMetadata(
  raw: string | undefined,
): DownstreamBuildMetadata | null {
  if (!raw?.trim()) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || !Array.isArray(value.patches)) return null;
  if (
    !isNonEmptyString(value.upstreamRepository) ||
    !GITHUB_REPOSITORY_PATTERN.test(value.upstreamRepository) ||
    !isNonEmptyString(value.releaseRepository) ||
    !GITHUB_REPOSITORY_PATTERN.test(value.releaseRepository) ||
    !isNonEmptyString(value.upstreamTag) ||
    !isGitHubUrl(value.upstreamUrl) ||
    !isNonEmptyString(value.fingerprint) ||
    !isNonEmptyString(value.version) ||
    !isNonEmptyString(value.tag)
  ) {
    return null;
  }

  const patches = value.patches.map(parsePatch);
  if (patches.some((patch) => patch === null)) return null;

  return {
    upstreamRepository: value.upstreamRepository,
    upstreamTag: value.upstreamTag,
    upstreamUrl: value.upstreamUrl,
    releaseRepository: value.releaseRepository,
    fingerprint: value.fingerprint,
    version: value.version,
    tag: value.tag,
    patches: patches as DownstreamBuildPatch[],
  };
}

export function resolveDownstreamPatchUrl(patch: DownstreamBuildPatch): string {
  const pullRequest = PULL_REQUEST_LABEL_PATTERN.exec(patch.label);
  if (pullRequest) {
    return `https://github.com/${pullRequest[1]}/pull/${pullRequest[2]}`;
  }
  const commit = COMMIT_LABEL_PATTERN.exec(patch.label);
  const repository = commit?.[1];
  return repository && patch.commits[0]
    ? `https://github.com/${repository}/commit/${patch.commits[0]}`
    : "https://github.com";
}

export function resolveDownstreamCommitUrl(patch: DownstreamBuildPatch, commit: string): string {
  const repository =
    PULL_REQUEST_LABEL_PATTERN.exec(patch.label)?.[1] ??
    COMMIT_LABEL_PATTERN.exec(patch.label)?.[1];
  return repository ? `https://github.com/${repository}/commit/${commit}` : "https://github.com";
}

export const DOWNSTREAM_BUILD_METADATA = parseDownstreamBuildMetadata(
  import.meta.env.T3CODE_DOWNSTREAM_BUILD_METADATA,
);
