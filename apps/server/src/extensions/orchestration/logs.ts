// @effect-diagnostics nodeBuiltinImport:off - agent log sources are host files read at the adapter boundary.
/**
 * `t3.orchestration/logs@1.0.0` — read-only agent log/output inspection.
 *
 * Sources come from the thread's own folded roster (`outputFile`); callers
 * name a roster id, never a path, and results never carry a host path.
 * Containment mirrors `workflowScriptQuery.ts`: the realpath must sit under a
 * provider root *and* that root's slug directory for the thread's workspace,
 * and the opened inode must match what realpath resolved. Only the last
 * `maxBytes` bytes are read. Failures are fixed `AgentLogs*` codes that never
 * interpolate paths or contents.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { AuthOrchestrationReadScope, ExtensionOperationError, ThreadId } from "@t3tools/contracts";
import { foldSubagentActivities } from "@t3tools/client-runtime/state/subagentRuntime";
import {
  AGENT_LOG_TAIL_MAX_BYTES,
  AGENT_LOG_TAIL_MAX_LINES,
  AGENT_LOG_TITLE_MAX_LENGTH,
  ORCHESTRATION_LOGS_API,
  type AgentLogRun,
  type AgentLogRuns,
  type AgentLogTail,
} from "@t3tools/extension-sdk/catalogue";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import type { HostApiInvocationMetadata, HostApiProvider } from "@t3tools/extension-runtime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { makeExtensionScopeResolver } from "../scope.ts";
import { boundedPrefix } from "../vcsDiffApi.ts";

const fail = (detail: string) =>
  new ExtensionOperationError({ operation: "orchestration.logs", detail });
const isEmptyObject = (input: unknown) =>
  typeof input === "object" &&
  input !== null &&
  !Array.isArray(input) &&
  Object.keys(input).length === 0;
const tailInput = Schema.decodeUnknownSync(
  Schema.Struct({
    runId: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(160)),
    source: Schema.Literal("output"),
    maxBytes: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: AGENT_LOG_TAIL_MAX_BYTES })),
    ),
    maxLines: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: AGENT_LOG_TAIL_MAX_LINES })),
    ),
  }),
  { onExcessProperty: "error" },
);
/** Same window `projectAgents` publishes, so run ids match the roster stream. */
const ROSTER_CAP = 100;

/**
 * Directories the Claude harness writes agent output under: transcripts in
 * `~/.claude/projects`, task `.output` files (often symlinks into the former)
 * in `/tmp/claude-<uid>`. Missing roots are skipped.
 */
export function defaultAgentLogRoots(): readonly string[] {
  const roots = [NodePath.join(NodeOS.homedir(), ".claude", "projects")];
  if (typeof process.getuid === "function") roots.push(`/tmp/claude-${process.getuid()}`);
  return roots;
}

/** Claude's per-workspace directory name: every non-alphanumeric becomes `-`. */
export const claudeWorkspaceSlug = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, "-");

/**
 * Shapes a byte window that ends at the end of the source. `start` is the
 * window's offset in the source. A cut window drops leading UTF-8
 * continuation bytes and, when it holds a later line, its partial first
 * line; `maxLines` then keeps the last N lines.
 */
export function shapeLogTail(
  window: Uint8Array,
  start: number,
  maxLines: number | undefined,
): { readonly contents: string; readonly truncated: boolean } {
  let offset = 0;
  if (start > 0) {
    while (offset < window.length && (window[offset]! & 0xc0) === 0x80) offset++;
    const newline = window.indexOf(0x0a, offset);
    if (newline !== -1 && newline < window.length - 1) offset = newline + 1;
  }
  let contents = new TextDecoder().decode(window.subarray(offset));
  let truncated = start + offset > 0;
  if (maxLines !== undefined) {
    const lines = contents.split("\n");
    const count = contents.endsWith("\n") ? lines.length - 1 : lines.length;
    if (count > maxLines) {
      contents = lines.slice(count - maxLines).join("\n");
      truncated = true;
    }
  }
  return { contents, truncated };
}

type Dependencies = Parameters<typeof makeExtensionScopeResolver>[0] & {
  readonly snapshots: Pick<ProjectionSnapshotQuery["Service"], "getThreadDetailSnapshot">;
  readonly roots: () => readonly string[];
};

export function createOrchestrationLogsApiProvider(deps: Dependencies): HostApiProvider {
  const resolve = makeExtensionScopeResolver(deps);
  const guard = async (
    context: ViewContext,
    signal: AbortSignal,
    metadata: HostApiInvocationMetadata,
  ) => {
    signal.throwIfAborted();
    if (
      metadata.principal?.environmentId !== deps.environmentId ||
      !metadata.principal.scopes.includes(AuthOrchestrationReadScope)
    )
      throw fail(`AgentLogsAuthorityDenied: ${AuthOrchestrationReadScope}`);
    if (!context.resource.threadId) throw fail("AgentLogsThreadScopeRequired");
    const scope = await Effect.runPromise(resolve(context), { signal });
    await metadata.assertAuthority?.();
    return scope;
  };
  const roster = async (threadId: string, signal: AbortSignal) => {
    const found = await Effect.runPromise(
      deps.snapshots.getThreadDetailSnapshot(ThreadId.make(threadId)),
      { signal },
    );
    if (Option.isNone(found) || found.value.thread.deletedAt !== null)
      throw fail("AgentLogsThreadUnavailable");
    const thread = found.value.thread;
    return foldSubagentActivities(thread.activities, {
      sessionLive:
        thread.session !== null &&
        !["stopped", "interrupted", "error"].includes(thread.session.status),
    });
  };
  const contain = async (handle: string, cwd: string) => {
    const resolved = await NodeFSP.realpath(handle).catch(() => {
      throw fail("AgentLogsSourceUnavailable");
    });
    const slugs = new Set([claudeWorkspaceSlug(cwd)]);
    await NodeFSP.realpath(cwd).then(
      (real) => slugs.add(claudeWorkspaceSlug(real)),
      () => undefined,
    );
    for (const root of deps.roots()) {
      const real = await NodeFSP.realpath(root).catch(() => null);
      if (!real) continue;
      for (const slug of slugs)
        if (resolved.startsWith(NodePath.join(real, slug) + NodePath.sep)) return resolved;
    }
    throw fail("AgentLogsOutOfScope");
  };
  const readWindow = async (resolved: string, maxBytes: number) => {
    const file = await NodeFSP.open(resolved, "r").catch(() => {
      throw fail("AgentLogsSourceUnavailable");
    });
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw fail("AgentLogsSourceUnavailable");
      // Open first, then compare inodes: a swap between realpath and open
      // changes the inode and cannot pass this check.
      const pathStat = await NodeFSP.lstat(resolved);
      if (stat.ino !== pathStat.ino || stat.dev !== pathStat.dev)
        throw fail("AgentLogsSourceChanged");
      const start = Math.max(0, stat.size - maxBytes);
      const window = Buffer.alloc(stat.size - start);
      const { bytesRead } = await file.read(window, 0, window.length, start);
      return { window: window.subarray(0, bytesRead), start, byteLength: stat.size };
    } finally {
      await file.close();
    }
  };

  return {
    providerId: "t3.host-orchestration-logs",
    definition: ORCHESTRATION_LOGS_API,
    requiresRootAuthority: true,
    async invoke(method, input, context, signal, metadata) {
      const scope = await guard(context, signal, metadata);
      const threadId = context.resource.threadId!;
      if (method === "listRuns") {
        if (!isEmptyObject(input)) throw fail("AgentLogsInvalidInput");
        const agents = await roster(threadId, signal);
        const visible = agents.slice(-ROSTER_CAP);
        const toRun = (agent: (typeof agents)[number]): AgentLogRun | null =>
          agent.outputFile && agent.id.length <= 160
            ? {
                runId: agent.id,
                kind: agent.kind,
                title: boundedPrefix(agent.title, AGENT_LOG_TITLE_MAX_LENGTH),
                status: agent.status,
                sources: ["output"],
              }
            : null;
        const result: AgentLogRuns = {
          runs: visible.map(toRun).filter((run) => run !== null),
          truncated: agents.slice(0, -ROSTER_CAP).some((agent) => toRun(agent) !== null),
        };
        return result;
      }
      if (method !== "readTail") throw fail(`AgentLogsUnsupported: ${method}`);
      let safe: ReturnType<typeof tailInput>;
      try {
        safe = tailInput(input);
      } catch {
        throw fail("AgentLogsInvalidInput");
      }
      const agent = (await roster(threadId, signal))
        .slice(-ROSTER_CAP)
        .find((item) => item.id === safe.runId);
      if (!agent) throw fail("AgentLogsRunUnknown");
      if (!agent.outputFile) throw fail("AgentLogsSourceUnavailable");
      const resolved = await contain(agent.outputFile, scope.cwd);
      const read = await readWindow(resolved, safe.maxBytes ?? AGENT_LOG_TAIL_MAX_BYTES);
      // A session revoked mid-read never receives the bytes.
      await guard(context, signal, metadata);
      const shaped = shapeLogTail(read.window, read.start, safe.maxLines);
      if (shaped.contents.length > AGENT_LOG_TAIL_MAX_BYTES) throw fail("AgentLogsTailTooLarge");
      const result: AgentLogTail = {
        runId: agent.id,
        source: "output",
        contents: shaped.contents,
        byteLength: read.byteLength,
        truncated: shaped.truncated,
      };
      return result;
    },
  };
}

export const makeOrchestrationLogsApiProvider = Effect.fn("OrchestrationLogsApi.make")(
  function* () {
    const environment = yield* ServerEnvironment;
    return createOrchestrationLogsApiProvider({
      environmentId: yield* environment.getEnvironmentId,
      projects: yield* ProjectionProjectRepository,
      threads: yield* ProjectionThreadRepository,
      snapshots: yield* ProjectionSnapshotQuery,
      roots: defaultAgentLogRoots,
    });
  },
);
