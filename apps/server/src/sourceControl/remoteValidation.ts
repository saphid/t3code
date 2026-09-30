import type {
  SourceControlProviderDiscoveryItem,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import * as Option from "effect/Option";

export function isSafeRepositoryRemote(remote: string, allowHttp = false): boolean {
  if (/[\s\u0000-\u001f\u007f\\]/.test(remote)) return false;
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*:[^\s]+$/.test(remote)) return true;
  if (!remote.includes("://")) return false;
  try {
    const url = new URL(remote);
    return (
      (url.protocol === "https:" ||
        url.protocol === "ssh:" ||
        (allowHttp && url.protocol === "http:")) &&
      url.hostname.length > 0 &&
      !decodeURIComponent(url.hostname).startsWith("-") &&
      !decodeURIComponent(url.username).startsWith("-") &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === "ssh:" || !url.username)
    );
  } catch {
    return false;
  }
}

export function isSafeRepositoryIdentifier(
  provider: SourceControlProviderKind,
  repository: string,
): boolean {
  if (repository !== repository.trim() || repository.startsWith("-")) return false;
  let locator = repository;
  if (repository.includes("://")) {
    if (!isSafeRepositoryRemote(repository)) return false;
    try {
      locator = decodeURIComponent(new URL(repository).pathname.slice(1));
    } catch {
      return false;
    }
  }
  if (!repository.includes("://") && providerRepositoryHost(provider, repository) !== null)
    locator = repository.split("/").slice(1).join("/");
  const segments = locator.split("/");
  const segmentPattern =
    provider === "azure-devops" ? /^[\p{L}\p{N}_.-][\p{L}\p{N} ._()&-]*$/u : /^[A-Za-z0-9._-]+$/;
  if (
    locator.startsWith("-") ||
    !segments.every(
      (segment) =>
        segment !== "." &&
        segment !== ".." &&
        segment === segment.trim() &&
        segmentPattern.test(segment),
    )
  )
    return false;
  switch (provider) {
    case "github":
      return segments.length === 2;
    case "gitlab":
      return segments.length >= 2;
    case "forgejo":
    case "bitbucket":
      return segments.length === 2;
    case "azure-devops":
      return segments.length <= 3 || (segments.length === 4 && segments[2] === "_git");
    case "unknown":
      return false;
  }
}

export function repositoryRemoteHost(remote: string): string | null {
  if (!isSafeRepositoryRemote(remote, true)) return null;
  if (!remote.includes("://")) return /^[^@]+@([^:]+):/.exec(remote)?.[1]?.toLowerCase() ?? null;
  return new URL(remote).host.toLowerCase();
}

export function providerRepositoryHost(
  provider: SourceControlProviderKind,
  repository: string,
): string | null {
  if (repository.includes("://")) return repositoryRemoteHost(repository);
  const segments = repository.split("/");
  return (provider === "github" && segments.length === 3) ||
    (segments.length >= 3 && /[.]/.test(segments[0] ?? ""))
    ? (segments[0] ?? "").toLowerCase()
    : null;
}

export function isConfiguredRepositoryHost(
  provider: SourceControlProviderKind,
  repository: string,
  providers: readonly SourceControlProviderDiscoveryItem[],
): boolean {
  const host = providerRepositoryHost(provider, repository);
  return (
    host === null ||
    providers.some(
      (configured) =>
        configured.kind === provider &&
        configured.status === "available" &&
        configured.auth.status === "authenticated" &&
        Option.getOrNull(configured.auth.host)?.toLowerCase() === host,
    )
  );
}
