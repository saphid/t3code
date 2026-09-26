// @effect-diagnostics nodeBuiltinImport:off - the broker install proof stages a package on disk.
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type AgentSessionImportSource,
} from "@t3tools/contracts";
import { createExtensionRuntime, type HostApiRootAuthority } from "@t3tools/extension-runtime";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import type { HostApiProvider } from "@t3tools/extension-runtime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type {
  AgentSessionRecentThread,
  AgentSessionThread,
} from "../project/AgentSessionScanner.ts";
import { createAgentSessionsApiProvider } from "./agentSessionsApi.ts";

const ENV = "env-a";
const PROJECT = ProjectId.make("project-a");
const OTHER = ProjectId.make("project-b");
const ROOTS: Record<string, string> = { [PROJECT]: "/work/a", [OTHER]: "/work/b" };
const context: ViewContext = {
  client: "web",
  workspaceRevision: JSON.stringify(["/work/a", null]),
  resource: {
    namespace: "test.agents",
    id: "view",
    environmentId: EnvironmentId.make(ENV),
    projectId: PROJECT,
  },
};
const signal = new AbortController().signal;
const meta = (
  provider: HostApiProvider,
  scopes = ["orchestration:read", "orchestration:operate"],
) => ({
  callId: "call",
  rootCallerId: "root",
  callerId: "caller",
  providerId: provider.providerId,
  providerGeneration: 1,
  callerGenerations: [],
  principal: { kind: "environment-session" as const, id: "session", environmentId: ENV, scopes },
});

const session = (id: string, root = "/work/a", title = `Session ${id}`): AgentSessionThread => ({
  source: "codex",
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerSessionId: id,
  title,
  model: null,
  createdAt: "2026-09-20T10:00:00.000Z",
  updatedAt: "2026-09-20T10:05:00.000Z",
  messages: [
    { role: "user", text: `secret prompt ${id} ${root}`, createdAt: "2026-09-20T10:00:00.000Z" },
    { role: "assistant", text: "done", createdAt: "2026-09-20T10:05:00.000Z" },
  ],
});
const sourceOf = (thread: AgentSessionThread): AgentSessionImportSource => ({
  provider: thread.source,
  providerInstanceId: thread.providerInstanceId,
  providerSessionId: thread.providerSessionId,
  filePath: `/home/me/.codex/sessions/${thread.providerSessionId}.jsonl`,
  size: 10,
  mtimeMs: 1_758_362_700_000,
  device: 1,
  inode: 2,
  birthtimeMs: 0,
});
const importable = (thread: AgentSessionThread): AgentSessionRecentThread => ({
  _tag: "Importable",
  thread,
  source: sourceOf(thread),
});

type ThreadRow = {
  projectId: ProjectId;
  worktreePath: null;
  deletedAt: string | null;
  title: string;
  updatedAt: string;
};

/**
 * In-memory host: `byRoot` is what the native scanner would discover under
 * each project root, `threads` is the projection, and `importThread` persists
 * like the native importer and returns a monotonically increasing sequence.
 */
const makeHost = (byRoot: Record<string, AgentSessionRecentThread[]>) => {
  const threads = new Map<string, ThreadRow>();
  const imports: string[] = [];
  let sequence = 40;
  let failImport = false;
  const provider = createAgentSessionsApiProvider({
    environmentId: ENV,
    projects: {
      getById: ({ projectId }) =>
        Effect.succeed(
          ROOTS[projectId]
            ? Option.some({ projectId, workspaceRoot: ROOTS[projectId]!, deletedAt: null })
            : Option.none(),
        ),
    },
    threads: {
      getById: ({ threadId }) => Effect.succeed(Option.fromNullishOr(threads.get(threadId))),
    },
    recentThreads: (workspaceRoot) => Stream.fromIterable(byRoot[workspaceRoot] ?? []),
    importThread: (input) =>
      Effect.gen(function* () {
        if (failImport) return yield* Effect.die("decider rejected");
        // Yield first so a concurrent import would interleave here if it were not serialized.
        yield* Effect.yieldNow;
        const id = `import:${input.thread.providerInstanceId}:${input.thread.providerSessionId}`;
        imports.push(id);
        threads.set(id, {
          projectId: input.projectId,
          worktreePath: null,
          deletedAt: null,
          title: input.thread.title,
          updatedAt: input.thread.updatedAt,
        });
        sequence += 2;
        return { sequence };
      }),
  });
  return {
    provider,
    threads,
    imports,
    failNextImports: () => {
      failImport = true;
    },
    scan: (scopes?: string[]) =>
      provider.invoke("scan", {}, context, signal, meta(provider, scopes)) as Promise<{
        sessions: Record<string, unknown>[];
        truncated: boolean;
        skipped: number;
        scope: string;
      }>,
    importKey: (input: unknown, scopes?: string[]) =>
      provider.invoke("import", input as never, context, signal, meta(provider, scopes)) as Promise<
        Record<string, unknown>
      >,
  };
};
const key = (id: string) => ({ providerInstanceId: "codex", providerSessionId: id });

it("separates the read scope for scan from the operate scope for import", async () => {
  const host = makeHost({ "/work/a": [importable(session("s1"))] });
  await expect(host.scan(["orchestration:operate"])).rejects.toThrow(
    "AgentSessionsAuthorityDenied: orchestration:read",
  );
  await expect(host.importKey(key("s1"), ["orchestration:read"])).rejects.toThrow(
    "AgentSessionsAuthorityDenied: orchestration:operate",
  );
  expect(host.imports).toEqual([]);
});

it("lists only this project's sessions, bounded, without paths or transcript text", async () => {
  const many = Array.from({ length: 60 }, (_, index) => importable(session(`s${index}`)));
  const host = makeHost({
    "/work/a": [
      { _tag: "Skipped" },
      importable(session("long", "/work/a", `  ${"x".repeat(300)}  `)),
      { _tag: "Duplicate", source: sourceOf(session("long")) },
      importable(session("bad id!")),
      ...many,
    ],
    "/work/b": [importable(session("other-project"))],
  });
  const result = await host.scan();
  expect(result.scope).toBe("project");
  expect(result.sessions).toHaveLength(50);
  expect(result.truncated).toBe(true);
  // One native skip plus one id the contract cannot name.
  expect(result.skipped).toBe(2);
  expect(result.sessions[0]).toEqual({
    providerInstanceId: "codex",
    providerSessionId: "long",
    source: "codex",
    title: "x".repeat(200),
    lastActiveAt: "2026-09-20T10:05:00.000Z",
    status: "importable",
    threadId: null,
  });
  const wire = JSON.stringify(result);
  expect(wire).not.toContain("/home/me");
  expect(wire).not.toContain("secret prompt");
  expect(wire).not.toContain("other-project");

  const exact = makeHost({ "/work/a": many.slice(0, 50) });
  expect((await exact.scan()).truncated).toBe(false);
});

it("marks sessions already imported into this project and hides another project's", async () => {
  const mine = session("mine");
  const theirs = session("theirs");
  const host = makeHost({
    "/work/a": [
      importable(mine),
      importable(theirs),
      { _tag: "AlreadyImported", source: sourceOf(session("gone")) },
    ],
  });
  host.threads.set("import:codex:mine", {
    projectId: PROJECT,
    worktreePath: null,
    deletedAt: null,
    title: "Mine",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
  host.threads.set("import:codex:theirs", {
    projectId: OTHER,
    worktreePath: null,
    deletedAt: null,
    title: "Theirs",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
  const result = await host.scan();
  expect(
    result.sessions.map((entry) => [entry.providerSessionId, entry.status, entry.threadId]),
  ).toEqual([["mine", "imported", "import:codex:mine"]]);
});

it("imports a discovered session and returns the persisted event sequence", async () => {
  const host = makeHost({ "/work/a": [importable(session("s1"))] });
  expect(await host.importKey(key("s1"))).toEqual({
    status: "imported",
    threadId: "import:codex:s1",
    sequence: 42,
    messageCount: 2,
    error: null,
  });
  expect(host.threads.get("import:codex:s1")?.projectId).toBe(PROJECT);
  // The next scan reflects the import.
  expect((await host.scan()).sessions[0]).toMatchObject({
    status: "imported",
    threadId: "import:codex:s1",
  });
});

it("names duplicates, cross-project sessions, and other projects' threads", async () => {
  const host = makeHost({
    "/work/a": [importable(session("s1")), importable(session("conflict"))],
    "/work/b": [importable(session("elsewhere", "/work/b"))],
  });
  await host.importKey(key("s1"));
  expect(await host.importKey(key("s1"))).toEqual({
    status: "rejected",
    threadId: "import:codex:s1",
    sequence: null,
    messageCount: 0,
    error: "AgentSessionAlreadyImported",
  });
  // A session that ran in project b is not discoverable from project a's scope.
  expect(await host.importKey(key("elsewhere"))).toMatchObject({
    status: "rejected",
    threadId: null,
    error: "AgentSessionOutOfScope",
  });
  host.threads.set("import:codex:conflict", {
    projectId: OTHER,
    worktreePath: null,
    deletedAt: null,
    title: "Conflict",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
  // Another project's thread id is not disclosed.
  expect(await host.importKey(key("conflict"))).toMatchObject({
    status: "rejected",
    threadId: null,
    error: "AgentSessionProjectConflict",
  });
  expect(host.imports).toEqual(["import:codex:s1"]);
});

it("serializes concurrent imports so a double click creates one thread", async () => {
  const host = makeHost({ "/work/a": [importable(session("s1"))] });
  const [first, second] = await Promise.all([host.importKey(key("s1")), host.importKey(key("s1"))]);
  expect([first.status, second.status].toSorted()).toEqual(["imported", "rejected"]);
  expect([first.error, second.error]).toContain("AgentSessionAlreadyImported");
  expect(host.imports).toEqual(["import:codex:s1"]);
});

it("rejects malformed sources by name and reports a refused native import", async () => {
  const host = makeHost({ "/work/a": [importable(session("s1"))] });
  for (const input of [
    {},
    { providerInstanceId: "codex" },
    { providerInstanceId: "codex", providerSessionId: "../../etc" },
    { providerInstanceId: "9bad", providerSessionId: "s1" },
    { ...key("s1"), projectId: OTHER },
  ]) {
    await expect(host.importKey(input)).rejects.toThrow("AgentSessionMalformedSource");
  }
  host.failNextImports();
  expect(await host.importKey(key("s1"))).toMatchObject({
    status: "rejected",
    error: "AgentSessionImportRejected",
  });
  expect(host.imports).toEqual([]);
});

it("refuses a stale workspace context before reading sessions", async () => {
  const host = makeHost({ "/work/a": [importable(session("s1"))] });
  const stale = { ...context, workspaceRevision: JSON.stringify(["/elsewhere", null]) };
  await expect(
    host.provider.invoke("import", key("s1"), stale, signal, meta(host.provider)),
  ).rejects.toThrow("Extension workspace context is stale.");
  expect(host.imports).toEqual([]);
});

const CONSUMER_MANIFEST =
  '{"format":2,"manifest":{"id":"test.agent-sessions","apiVersion":1,"version":"1.0.0","surfaces":[]},' +
  '"serverEntry":"server.mjs","tools":[],"provides":[],' +
  '"requires":[{"id":"t3.agents/sessions","versionRange":"^1.0.0"}],"dependencies":[]}';
const root: HostApiRootAuthority = {
  principal: {
    kind: "environment-session",
    id: "session",
    environmentId: ENV,
    scopes: ["orchestration:read", "orchestration:operate"],
  },
  allowWrite: true,
  revalidate: () => {},
};

it("gates scan on its read grant and import on the distinct import grant through the broker", async () => {
  const dir = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "agent-sessions-install-")),
  );
  const host = makeHost({ "/work/a": [importable(session("s1"))] });
  try {
    const source = NodePath.join(dir, "source");
    await NodeFSP.mkdir(source);
    await NodeFSP.writeFile(NodePath.join(source, "t3-extension.json"), CONSUMER_MANIFEST);
    await NodeFSP.writeFile(
      NodePath.join(source, "server.mjs"),
      "export default {tools:[],apis:[]};",
    );
    const runtime = await createExtensionRuntime({
      rootDir: NodePath.join(dir, "state"),
      environmentId: ENV,
      services: [],
      apiProviders: [host.provider],
      authorize: (installation, grant) => installation.grants.capabilities.includes(grant),
    });
    try {
      const installed = await runtime.install(source, { capabilities: [], projectIds: [PROJECT] });
      const invoke = (method: string, input: Record<string, string>) =>
        runtime.invokeApi(
          installed.id,
          installed.contentHash,
          { id: "t3.agents/sessions", versionRange: "^1.0.0", method, input, context },
          signal,
          root,
        );
      await expect(invoke("scan", {})).rejects.toThrow(
        "API capability denied: t3.agents/scan-sessions",
      );
      await runtime.updateGrants(installed.id, {
        capabilities: ["t3.agents/scan-sessions"],
        projectIds: [PROJECT],
      });
      expect(await invoke("scan", {})).toMatchObject({ sessions: [{ providerSessionId: "s1" }] });
      await expect(invoke("import", key("s1"))).rejects.toThrow(
        "API capability denied: t3.agents/import-sessions",
      );
      expect(host.imports).toEqual([]);
      await runtime.updateGrants(installed.id, {
        capabilities: ["t3.agents/scan-sessions", "t3.agents/import-sessions"],
        projectIds: [PROJECT],
      });
      expect(await invoke("import", key("s1"))).toMatchObject({
        status: "imported",
        threadId: ThreadId.make("import:codex:s1"),
      });
      // Malformed keys never reach the adapter: the contract schema rejects them first.
      await expect(
        invoke("import", { providerInstanceId: "codex", providerSessionId: "a/b" }),
      ).rejects.toThrow();
    } finally {
      await runtime.dispose();
    }
  } finally {
    await NodeFSP.rm(dir, { recursive: true, force: true });
  }
});
