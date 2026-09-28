import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId, type ClientProviderCaller } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { createPanelsClientProvider } from "./clientProviders";
import { ClientProviderOpError, type ClientProviderInvokeCall } from "./clientProviderTypes";
import type { InstalledPackage } from "./installedController";

const shells = vi.hoisted(() => new Map<string, { projectId: string }>());
vi.mock("../state/entities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/entities")>()),
  readThreadShell: (ref: { threadId: string }) => shells.get(ref.threadId) ?? null,
}));
vi.mock("../components/ThreadTerminalDrawer", () => ({ terminalThemeFromApp: () => ({}) }));

const ENV = "env-a";
const INSTALL = "ext.a";

const caller: ClientProviderCaller = {
  installationId: INSTALL,
  contentHash: "hash-a",
  installationGeneration: 1,
};

const context: ViewContext = {
  client: "web",
  resource: {
    namespace: INSTALL,
    id: `${INSTALL}/view`,
    environmentId: ENV,
    projectId: "project-a",
    threadId: "thread-a",
  },
};

function provider(capabilities: readonly string[] = ["t3.ui/panels"]) {
  const installation = {
    id: INSTALL,
    contentHash: "hash-a",
    enabled: true,
    installationGeneration: 1,
    grants: { capabilities: [...capabilities], projectIds: [ProjectId.make("project-a")] },
    package: { manifest: { id: INSTALL, apiVersion: 1, version: "1.0.0", surfaces: [] } },
  } as unknown as InstalledPackage;
  return createPanelsClientProvider({
    environmentId: EnvironmentId.make(ENV),
    client: "web",
    emit: vi.fn(),
    installations: () => [installation],
  });
}

const openFile = (input: Record<string, unknown>): ClientProviderInvokeCall => ({
  method: "openFile",
  input: input as ClientProviderInvokeCall["input"],
  context,
  caller,
  signal: new AbortController().signal,
});

function expectRejected(fn: () => unknown, code: string) {
  try {
    fn();
    expect.unreachable("expected a ClientProviderOpError");
  } catch (error) {
    expect(error).toBeInstanceOf(ClientProviderOpError);
    expect((error as ClientProviderOpError).code).toBe(code);
  }
}

const threadA = scopeThreadRef(EnvironmentId.make(ENV), ThreadId.make("thread-a"));
const panel = () => selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadA);

describe("panels openFile", () => {
  beforeEach(() => {
    shells.clear();
    shells.set("thread-a", { projectId: "project-a" });
    shells.set("thread-b", { projectId: "project-b" });
    useRightPanelStore.setState(useRightPanelStore.getInitialState(), true);
  });

  it("opens and activates the host file view at the path and line", () => {
    expect(
      provider().invoke(openFile({ threadId: "thread-a", relativePath: "src/app.ts", line: 3 })),
    ).toEqual({ applied: true });
    const state = panel();
    expect(state.isOpen).toBe(true);
    expect(state.activeSurfaceId).toBe("file:src/app.ts");
    expect(state.surfaces.find((surface) => surface.id === "file:src/app.ts")).toMatchObject({
      kind: "file",
      relativePath: "src/app.ts",
      revealLine: 3,
    });
  });

  it("refuses without the grant, outside granted projects, and for non-workspace paths", () => {
    expectRejected(
      () => provider([]).invoke(openFile({ threadId: "thread-a", relativePath: "a.ts" })),
      "client-target-denied",
    );
    expectRejected(
      () => provider().invoke(openFile({ threadId: "thread-b", relativePath: "a.ts" })),
      "client-target-denied",
    );
    for (const relativePath of ["/etc/passwd", "../up.ts", "src/../../up.ts", "C:/x.ts", "a\\b"])
      expectRejected(
        () => provider().invoke(openFile({ threadId: "thread-a", relativePath })),
        "provider-rejected",
      );
    expect(panel().surfaces).toEqual([]);
  });
});
