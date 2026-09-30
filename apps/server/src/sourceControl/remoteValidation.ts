import type { SourceControlProviderKind } from "@t3tools/contracts";

export function isSafeRepositoryRemote(remote: string, allowHttp = false): boolean {
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*:[^\s]+$/.test(remote)) return true;
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
  const segments = locator.split("/");
  const segmentPattern =
    provider === "azure-devops" ? /^[\p{L}\p{N}_.-][\p{L}\p{N} ._-]*$/u : /^[A-Za-z0-9._-]+$/;
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
      return segments.length === 2 || segments.length === 3;
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
