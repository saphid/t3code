import {
  SourceControlProviderKind,
  type PullRequestListEntry,
  type RepositoryIdentity,
} from "@t3tools/contracts";
import {
  gitHubPullRequestBrowserUrl,
  parseChangeRequestUrl,
} from "@t3tools/shared/changeRequestUrl";

export function nativePullRequestBrowserLink(
  reference: {
    readonly repository: string;
    readonly number: number;
    readonly host?: string;
    readonly initialSummary?: Pick<PullRequestListEntry, "url" | "provider">;
  },
  identity: RepositoryIdentity | null | undefined,
) {
  if (reference.initialSummary) {
    return { url: reference.initialSummary.url, provider: reference.initialSummary.provider };
  }
  const host = reference.host?.toLowerCase();
  if (host === "github.com") {
    return {
      url: `https://github.com/${reference.repository}/pull/${reference.number}`,
      provider: SourceControlProviderKind.make("github"),
    };
  }
  if (host && host !== identity?.canonicalKey.split("/")[0]?.toLowerCase()) return null;
  const url = gitHubPullRequestBrowserUrl(identity, reference.repository, reference.number);
  return url ? { url, provider: SourceControlProviderKind.make("github") } : null;
}

export function nativePullRequestDestination(
  url: string,
  context: { environmentId: string; projectId: string } | null,
) {
  const parsed = parseChangeRequestUrl(url);
  if (!parsed || !context) return null;
  return {
    ...context,
    repository: parsed.repository,
    number: parsed.number,
    host: parsed.authority ?? parsed.host,
  };
}
