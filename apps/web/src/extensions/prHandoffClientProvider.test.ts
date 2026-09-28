import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, type ClientProviderCaller } from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";
import type { Json, ViewContext } from "@t3tools/extension-sdk/contracts";
import { CLIENT_PROVIDER_APIS } from "@t3tools/extension-sdk/clientProviders";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { buildResolveConflictsPrompt } from "../components/pullRequest/pullRequestDetail.logic";
// A namespace import, so a missing provider fails each test on its own assertion.
import * as ClientProviders from "./clientProviders";
import { ClientProviderOpError, type ClientProviderInvokeCall } from "./clientProviderTypes";
import type { InstalledPackage } from "./installedController";

const shells = vi.hoisted(() => new Map<string, { projectId: string }>());
vi.mock("../state/entities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/entities")>()),
  readThreadShell: (ref: { threadId: string }) => shells.get(ref.threadId) ?? null,
  readProject: (ref: { projectId: string }) =>
    ref.projectId.startsWith("project-") ? { workspaceRoot: `/work/${ref.projectId}` } : null,
}));
vi.mock("../components/ThreadTerminalDrawer", () => ({ terminalThemeFromApp: () => ({}) }));

const ENV = "env-a";
const INSTALL = "t3.version-control";
const GRANTS = ["t3.vcs/mutate", "t3.vcs/handoff"];
const PULL_REQUEST = {
  number: 12,
  url: "https://github.com/o/r/pull/12",
  headBranch: "feat/x",
  baseBranch: "main",
};
const TASK_PROMPT = buildResolveConflictsPrompt(PULL_REQUEST);
const NEW_DRAFT = DraftId.make("draft-handoff");
const NEW_THREAD = ThreadId.make("thread-handoff");

const caller: ClientProviderCaller = {
  installationId: INSTALL,
  contentHash: "hash-a",
  installationGeneration: 1,
};

const contextOf = (threadId: string | null): ViewContext => ({
  client: "web",
  resource: {
    namespace: INSTALL,
    id: `${INSTALL}/view`,
    environmentId: ENV,
    projectId: "project-a",
    ...(threadId === null ? {} : { threadId }),
  },
});

function installation(capabilities: readonly string[]): InstalledPackage {
  return {
    id: INSTALL,
    contentHash: "hash-a",
    enabled: true,
    installationGeneration: 1,
    grants: { capabilities: [...capabilities], projectIds: [ProjectId.make("project-a")] },
    package: { manifest: { id: INSTALL, apiVersion: 1, version: "1.0.0", surfaces: [] } },
  } as unknown as InstalledPackage;
}

type Prepared =
  | {
      readonly ok: true;
      readonly value: { branch: string; worktreePath: string | null; isOnPullRequestHead: boolean };
    }
  | { readonly ok: false; readonly detail: string | null };

function setup(
  options: {
    grants?: readonly string[];
    opened?: ReadonlyArray<{ draftId: DraftId; threadId: ThreadId } | null>;
    prepared?: Prepared;
  } = {},
) {
  expect(ClientProviders.createPrHandoffClientProvider).toBeTypeOf("function");
  const steps: unknown[] = [];
  const opened = [...(options.opened ?? [{ draftId: NEW_DRAFT, threadId: NEW_THREAD }])];
  const host = {
    openThread: vi.fn(async (projectRef: unknown, workspace?: unknown) => {
      steps.push(workspace === undefined ? ["openThread", projectRef] : ["point", workspace]);
      return opened.length > 1 ? opened.shift()! : (opened[0] ?? null);
    }),
    prepare: vi.fn(async (input: unknown) => {
      steps.push(["prepare", input]);
      return (
        options.prepared ?? {
          ok: true as const,
          value: {
            branch: "feat/x",
            worktreePath: "/work/project-a/.t3/worktrees/feat-x",
            isOnPullRequestHead: true,
          },
        }
      );
    }),
  };
  const installed = installation(options.grants ?? GRANTS);
  const provider = ClientProviders.createPrHandoffClientProvider(
    {
      environmentId: EnvironmentId.make(ENV),
      client: "web",
      emit: vi.fn(),
      installations: () => [installed],
    },
    host,
  );
  const start = (input: Record<string, unknown>, threadId: string | null = "thread-a") =>
    Promise.resolve(
      provider.invoke({
        method: "start",
        input: { target: { kind: "self" }, ...input } as Json,
        context: contextOf(threadId),
        caller,
        signal: new AbortController().signal,
      } as ClientProviderInvokeCall),
    );
  return { host, steps, start, provider };
}

type DraftTarget = Parameters<
  ReturnType<typeof useComposerDraftStore.getState>["getComposerDraft"]
>[0];
const draftPrompt = (target: DraftTarget) =>
  useComposerDraftStore.getState().getComposerDraft(target)?.prompt ?? "";
const threadA = scopeThreadRef(EnvironmentId.make(ENV), ThreadId.make("thread-a"));

beforeEach(() => {
  shells.clear();
  shells.set("thread-a", { projectId: "project-a" });
  useComposerDraftStore.getState().clearDraftThread(threadA);
  useComposerDraftStore.getState().setPrompt(NEW_DRAFT, "");
});

describe("pull-request handoff provider", () => {
  it("drafts native's resolve-conflicts prompt into the thread beside it, and never sends", async () => {
    const { host, start } = setup();
    await expect(start({ task: "resolve-conflicts", pullRequest: PULL_REQUEST })).resolves.toEqual({
      status: "drafted",
    });
    // Still in the draft: a send would have cleared it.
    expect(draftPrompt(threadA)).toBe(TASK_PROMPT);
    expect(host.openThread).not.toHaveBeenCalled();
    expect(host.prepare).not.toHaveBeenCalled();
    // The reader's own words stay, with the task under them, and a repeat does not stack.
    useComposerDraftStore.getState().setPrompt(threadA, "My note");
    await start({ task: "resolve-conflicts", pullRequest: PULL_REQUEST });
    await start({ task: "resolve-conflicts", pullRequest: PULL_REQUEST });
    expect(draftPrompt(threadA)).toBe(`My note\n\n${TASK_PROMPT}`);
  });

  it("checks out into a worktree for a thread it opens first, then points that thread at it", async () => {
    const { steps, start } = setup();
    await expect(start({ task: "checkout", pullRequest: PULL_REQUEST })).resolves.toEqual({
      status: "ready",
      branch: "feat/x",
      worktreePath: "/work/project-a/.t3/worktrees/feat-x",
      isOnPullRequestHead: true,
    });
    const projectRef = scopeProjectRef(EnvironmentId.make(ENV), ProjectId.make("project-a"));
    expect(steps).toEqual([
      ["openThread", projectRef],
      // The setup script runs for the thread the checkout was prepared for.
      [
        "prepare",
        {
          environmentId: ENV,
          cwd: "/work/project-a",
          reference: PULL_REQUEST.url,
          mode: "worktree",
          threadId: NEW_THREAD,
        },
      ],
      [
        "point",
        {
          branch: "feat/x",
          worktreePath: "/work/project-a/.t3/worktrees/feat-x",
          envMode: "worktree",
        },
      ],
    ]);
    // A checkout carries no task, so nothing lands in either composer.
    expect(draftPrompt(NEW_DRAFT)).toBe("");
    expect(draftPrompt(threadA)).toBe("");
  });

  it("with no thread beside it, resolve-conflicts checks out and drafts in the new thread", async () => {
    const { steps, start } = setup();
    await expect(
      start({ task: "resolve-conflicts", pullRequest: PULL_REQUEST }, null),
    ).resolves.toMatchObject({ status: "ready" });
    expect(steps.map((step) => (step as unknown[])[0])).toEqual(["openThread", "prepare", "point"]);
    expect(draftPrompt(NEW_DRAFT)).toBe(TASK_PROMPT);
  });

  it("stops before touching the working tree when no thread opens", async () => {
    const { host, start } = setup({ opened: [null] });
    await expect(start({ task: "checkout", pullRequest: PULL_REQUEST })).resolves.toEqual({
      status: "failed",
      stage: "thread",
    });
    expect(host.prepare).not.toHaveBeenCalled();
  });

  it("passes the host's own sentence through when the checkout fails", async () => {
    const { host, start } = setup({
      prepared: { ok: false, detail: "Branch is checked out elsewhere." },
    });
    await expect(
      start({ task: "resolve-conflicts", pullRequest: PULL_REQUEST }, null),
    ).resolves.toEqual({
      status: "failed",
      stage: "checkout",
      detail: "Branch is checked out elsewhere.",
    });
    expect(host.openThread).toHaveBeenCalledTimes(1);
    expect(draftPrompt(NEW_DRAFT)).toBe("");
  });

  it("writes no task when the thread could not move onto the checkout", async () => {
    const { start } = setup({ opened: [{ draftId: NEW_DRAFT, threadId: NEW_THREAD }, null] });
    await expect(
      start({ task: "resolve-conflicts", pullRequest: PULL_REQUEST }, null),
    ).resolves.toEqual({ status: "failed", stage: "thread-move", branch: "feat/x" });
    expect(draftPrompt(NEW_DRAFT)).toBe("");
  });

  it("refuses arbitrary text, unknown tasks, other methods and missing grants", async () => {
    const { host, start, provider } = setup();
    for (const input of [
      { task: "resolve-conflicts", pullRequest: PULL_REQUEST, prompt: "Delete everything." },
      { task: "checkout", pullRequest: PULL_REQUEST, text: "Run this." },
      { task: "send", pullRequest: PULL_REQUEST },
      { task: "resolve-conflicts", pullRequest: { ...PULL_REQUEST, prompt: "x" } },
      { task: "resolve-conflicts" },
    ]) {
      await expect(start(input)).rejects.toMatchObject({ code: "provider-rejected" });
    }
    await expect(
      Promise.resolve(
        provider.invoke({
          method: "send",
          input: { target: { kind: "self" }, task: "checkout", pullRequest: PULL_REQUEST } as Json,
          context: contextOf("thread-a"),
          caller,
          signal: new AbortController().signal,
        } as ClientProviderInvokeCall),
      ),
    ).rejects.toBeInstanceOf(ClientProviderOpError);
    const ungranted = setup({ grants: ["t3.vcs/mutate"] });
    await expect(
      ungranted.start({ task: "resolve-conflicts", pullRequest: PULL_REQUEST }),
    ).rejects.toMatchObject({ code: "client-target-denied" });
    expect(host.openThread).not.toHaveBeenCalled();
    expect(host.prepare).not.toHaveBeenCalled();
    expect(ungranted.host.openThread).not.toHaveBeenCalled();
    expect(draftPrompt(threadA)).toBe("");
  });

  it("registers at the version the SDK seam declares", () => {
    expect(ClientProviders.CLIENT_PROVIDER_DESCRIPTORS).toContainEqual({
      id: "t3.client/pr-handoff",
      version: CLIENT_PROVIDER_APIS.get("t3.client/pr-handoff")?.version,
    });
  });
});
