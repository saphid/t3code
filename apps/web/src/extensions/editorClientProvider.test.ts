import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, type ClientProviderCaller } from "@t3tools/contracts";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { createEditorClientProvider, type EditorLauncher } from "./clientProviders";
import type { ClientProviderInvokeCall } from "./clientProviderTypes";
import type { InstalledPackage } from "./installedController";

const shells = vi.hoisted(
  () => new Map<string, { projectId: string; worktreePath: string | null }>(),
);
vi.mock("../state/entities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/entities")>()),
  readThreadShell: (ref: { threadId: string }) => shells.get(ref.threadId) ?? null,
  readProject: (ref: { projectId: string }) =>
    ref.projectId === "project-a" ? { workspaceRoot: "/project/root" } : null,
}));
vi.mock("../components/ThreadTerminalDrawer", () => ({ terminalThemeFromApp: () => ({}) }));

const caller: ClientProviderCaller = {
  installationId: "ext.files",
  contentHash: "hash",
  installationGeneration: 1,
};
const context: ViewContext = {
  client: "web",
  resource: {
    namespace: "ext.files",
    id: "ext.files/view",
    environmentId: "env",
    projectId: "project-a",
    threadId: "thread-a",
  },
};
const installation = {
  id: "ext.files",
  contentHash: "hash",
  installationGeneration: 1,
  enabled: true,
  grants: { capabilities: ["t3.ui/editor.open"], projectIds: [ProjectId.make("project-a")] },
  package: {
    manifest: {
      surfaces: [
        {
          id: "ext.files/view",
          scope: "project",
          clients: ["web"],
          placements: ["side-panel"],
          capabilities: [],
          stateVersion: 1,
        },
      ],
    },
  },
} as unknown as InstalledPackage;

function provider() {
  const openInEditor = vi.fn(async () => AsyncResult.success(undefined));
  const launcher: EditorLauncher = {
    availableEditors: () => ["vscode"],
    remoteState: () => ({ mode: "local-exec" }),
    remoteEditors: async () => ["vscode"],
    openRemoteUrl: vi.fn(async () => true),
    openInEditor,
  };
  return {
    openInEditor,
    editor: createEditorClientProvider(
      {
        environmentId: EnvironmentId.make("env"),
        client: "web",
        emit: vi.fn(),
        installations: () => [installation],
      },
      launcher,
    ),
  };
}

function workspaceOpen(overrides: Partial<ViewContext["resource"]> = {}): ClientProviderInvokeCall {
  return {
    method: "openPath",
    input: { path: "src/my file.ts:4", workspace: true },
    context: { ...context, resource: { ...context.resource, ...overrides } },
    caller,
    signal: new AbortController().signal,
  };
}

describe("workspace editor path", () => {
  beforeEach(() => {
    shells.clear();
    shells.set("thread-a", { projectId: "project-a", worktreePath: "/thread/checkout" });
  });

  it("uses the selected thread's checkout before the project root", async () => {
    const { editor, openInEditor } = provider();
    await expect(editor.invoke(workspaceOpen())).resolves.toEqual({
      status: "opened",
      path: "/thread/checkout/src/my file.ts:4",
      editor: "vscode",
    });
    expect(openInEditor).toHaveBeenCalledWith({
      environmentId: "env",
      input: { cwd: "/thread/checkout/src/my file.ts:4", editor: "vscode" },
    });
  });

  it("falls back to the project root for a project-scoped surface without a thread", async () => {
    const call = workspaceOpen();
    const { threadId: _threadId, ...resource } = call.context.resource;
    await expect(
      provider().editor.invoke({ ...call, context: { ...context, resource } }),
    ).resolves.toMatchObject({ status: "opened", path: "/project/root/src/my file.ts:4" });
  });

  it.each([{ threadId: "gone" }, { projectId: "project-other" }, { threadId: "other" }])(
    "refuses a missing or cross-project checkout (%s)",
    async (resource) => {
      shells.set("other", { projectId: "project-other", worktreePath: "/other" });
      const { editor, openInEditor } = provider();
      await expect(editor.invoke(workspaceOpen(resource))).rejects.toMatchObject({
        code: "client-target-denied",
      });
      expect(openInEditor).not.toHaveBeenCalled();
    },
  );
});
