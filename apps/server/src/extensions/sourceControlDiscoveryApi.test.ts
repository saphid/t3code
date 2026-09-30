import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  AuthOrchestrationReadScope,
  SourceControlRepositoryError,
  type SourceControlProviderDiscoveryItem,
} from "@t3tools/contracts";
import {
  createSourceControlDiscoveryApiProvider,
  projectSourceControlDiscovery,
} from "./sourceControlDiscoveryApi.ts";

const provider = (
  kind: SourceControlProviderDiscoveryItem["kind"],
  status: SourceControlProviderDiscoveryItem["status"] = "available",
  authStatus: SourceControlProviderDiscoveryItem["auth"]["status"] = "authenticated",
): SourceControlProviderDiscoveryItem => ({
  kind,
  label: kind,
  status,
  installHint: "Install the CLI",
  version: Option.none(),
  detail: Option.none(),
  auth: {
    status: authStatus,
    account: Option.some("alex"),
    host: Option.none(),
    detail: Option.none(),
  },
});

it("mirrors native readiness including installed providers with unknown auth", () => {
  const projected = projectSourceControlDiscovery([
    provider("github"),
    provider("gitlab", "missing"),
    provider("forgejo", "available", "unauthenticated"),
    provider("bitbucket", "available", "unknown"),
  ]);
  expect(projected.providers.map((item) => item.ready)).toEqual([true, false, false, true]);
  expect(projected.providers[0]?.account).toBe("alex");
  expect(projected.providers[1]?.hint).toBe("Install the CLI");
  expect(JSON.stringify(projected)).not.toContain("_tag");
});

it("reuses native repository lookup and bounded listing, with environment read authority", async () => {
  const calls: unknown[] = [];
  let probes = 0;
  const repository = {
    provider: "github" as const,
    nameWithOwner: "alex/repo",
    url: "https://github.com/alex/repo",
    sshUrl: "git@github.com:alex/repo.git",
  };
  const api = createSourceControlDiscoveryApiProvider({
    environmentId: "env",
    cwd: "/host",
    discovery: {
      discover: Effect.sync(() => {
        probes++;
        return [provider("github"), provider("gitlab", "missing")];
      }),
    },
    repositories: {
      lookupRepository: (input) => {
        calls.push(input);
        return Effect.succeed(repository);
      },
    },
    listRepositories: (input) => {
      if (input.provider === "gitlab")
        return Effect.fail(
          new SourceControlRepositoryError({
            operation: "listRepositories",
            provider: "gitlab",
            detail: "Native provider CLI unavailable",
          }),
        );
      calls.push(input);
      return Effect.succeed({ repositories: [repository], truncated: false });
    },
  });
  const context = {
    resource: { namespace: "test", id: "view", environmentId: "env" },
    client: "test",
  };
  const signal = new AbortController().signal;
  const metadata = {
    callId: "call",
    rootCallerId: "caller",
    callerId: "caller",
    providerId: api.providerId,
    providerGeneration: 1,
    callerGenerations: [],
    principal: {
      kind: "environment-session" as const,
      id: "session",
      environmentId: "env",
      scopes: [AuthOrchestrationReadScope],
    },
    assertAuthority: async () => {},
  };
  expect(
    await api.invoke(
      "lookupRepository",
      { provider: "github", repository: "alex/repo" },
      context,
      signal,
      metadata,
    ),
  ).toEqual(repository);
  expect(
    await api.invoke("listRepositories", { provider: "github" }, context, signal, metadata),
  ).toEqual({ repositories: [repository], truncated: false });
  expect(probes).toBe(0);
  expect(calls).toEqual([
    { provider: "github", repository: "alex/repo", cwd: "/host" },
    { provider: "github", cwd: "/host" },
  ]);
  await expect(
    api.invoke("listRepositories", { provider: "gitlab" }, context, signal, metadata),
  ).rejects.toThrow();
  await expect(
    api.invoke("discover", {}, context, signal, {
      ...metadata,
      principal: { ...metadata.principal, scopes: [] },
    }),
  ).rejects.toThrow();
  await expect(
    api.invoke("discover", {}, context, signal, {
      ...metadata,
      assertAuthority: async () => {
        throw new Error("revoked");
      },
    }),
  ).rejects.toThrow("revoked");
  await expect(
    api.invoke(
      "lookupRepository",
      { provider: "github", repository: "alex/repo", cwd: "/escape" },
      context,
      signal,
      metadata,
    ),
  ).rejects.toThrow();
  expect(calls).toHaveLength(2);
  await api.invoke("discover", {}, context, signal, metadata);
  expect(probes).toBe(1);
});
