import { describe, expect, it } from "vite-plus/test";
import { SourceControlProviderKind, type RepositoryIdentity } from "@t3tools/contracts";
import {
  nativePullRequestBrowserLink,
  nativePullRequestDestination,
} from "../../lib/pullRequestNavigation";
const context = { environmentId: "remote", projectId: "project" };
describe("native PR entry points", () => {
  it("keeps a thread link in its own environment and handles renamed host path shapes", () => {
    expect(
      nativePullRequestDestination("https://github.com/org/repo/pull/12/files#diff", context),
    ).toEqual({ ...context, host: "github.com", repository: "org/repo", number: 12 });
    expect(
      nativePullRequestDestination("https://git.example/group/sub/repo/-/merge_requests/9", context)
        ?.repository,
    ).toBe("group/sub/repo");
    expect(
      nativePullRequestDestination("http://forgejo.test:3000/org/repo/pulls/3", context)?.host,
    ).toBe("forgejo.test:3000");
  });
  it("leaves issues, unknown sites, and unscoped links to the external opener", () => {
    expect(
      nativePullRequestDestination("https://github.com/org/repo/issues/12", context),
    ).toBeNull();
    expect(
      nativePullRequestDestination("https://example.com/org/repo/pull/12", context),
    ).toBeNull();
    expect(nativePullRequestDestination("https://github.com/org/repo/pull/12", null)).toBeNull();
  });
});

describe("native PR browser fallback", () => {
  const reference = { repository: "pingdotgg/t3code", number: 20063 };
  const identity = {
    provider: "github",
    canonicalKey: "github.com/pingdotgg/t3code",
    locator: {
      source: "git-remote",
      remoteName: "origin",
      remoteUrl: "git@github.com:pingdotgg/t3code.git",
    },
  } satisfies RepositoryIdentity;

  it("opens a GitHub PR from local identity when detail and summary are unavailable", () => {
    expect(nativePullRequestBrowserLink(reference, identity)).toEqual({
      provider: "github",
      url: "https://github.com/pingdotgg/t3code/pull/20063",
    });
  });

  it("uses the route repository when the PR belongs to another repository", () => {
    expect(
      nativePullRequestBrowserLink({ ...reference, repository: "other/repo" }, identity)?.url,
    ).toBe("https://github.com/other/repo/pull/20063");
  });

  it("uses an explicit GitHub host even without a project identity", () => {
    expect(nativePullRequestBrowserLink({ ...reference, host: "github.com" }, null)).toEqual({
      provider: "github",
      url: "https://github.com/pingdotgg/t3code/pull/20063",
    });
  });

  it("preserves the web origin of a GitHub Enterprise repository", () => {
    expect(
      nativePullRequestBrowserLink(
        { ...reference, host: "code.example.test" },
        {
          ...identity,
          canonicalKey: "code.example.test/pingdotgg/t3code",
          locator: {
            ...identity.locator,
            remoteUrl: "https://code.example.test:8443/pingdotgg/t3code.git",
          },
        },
      )?.url,
    ).toBe("https://code.example.test:8443/pingdotgg/t3code/pull/20063");
  });

  it.each([
    ["github", "https://github.acme.test:8443/org/repo/pull/20063"],
    ["gitlab", "https://git.example/org/repo/-/merge_requests/20063"],
    ["forgejo", "http://forge.example:3000/org/repo/pulls/20063"],
  ] as const)("preserves a cached %s URL and its provider", (provider, url) => {
    expect(
      nativePullRequestBrowserLink(
        {
          ...reference,
          initialSummary: { provider: SourceControlProviderKind.make(provider), url },
        },
        identity,
      ),
    ).toEqual({ provider, url });
  });

  it("does not redirect an explicit host to the project's different host", () => {
    expect(
      nativePullRequestBrowserLink({ ...reference, host: "other.example.test" }, identity),
    ).toBeNull();
  });

  it("does not guess a GitHub URL for an unknown or non-GitHub repository", () => {
    expect(nativePullRequestBrowserLink(reference, null)).toBeNull();
    expect(nativePullRequestBrowserLink(reference, { ...identity, provider: "gitlab" })).toBeNull();
  });
});
