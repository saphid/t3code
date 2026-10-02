import { describe, expect, it } from "vite-plus/test";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
const navigationRequire = NodeModule.createRequire(
  NodeModule.createRequire(import.meta.url).resolve("@react-navigation/native"),
);
const { getStateFromPath } = navigationRequire(
  NodePath.join(
    NodePath.dirname(navigationRequire.resolve("@react-navigation/core")),
    "getStateFromPath.js",
  ),
) as typeof import("@react-navigation/native");
import { extensionWorkspaceRevision } from "@t3tools/contracts";
import {
  mobileAgentsContext,
  selectMobileAgentsEntry,
  mobileAgentsPath,
  eligibleAgentsWidgetPath,
  MOBILE_AGENTS_LINKING_PATH,
} from "./mobileAgentsEntry";
import type { MobileInstallation } from "./mobileExtensionHost";
const context = mobileAgentsContext(
  { environmentId: "remote", id: "thread / one", projectId: "p", worktreePath: "/worktree" },
  { id: "p", workspaceRoot: "/project" },
)!;
function installed(): MobileInstallation {
  return {
    id: "t3.agents",
    enabled: true,
    contentHash: "a".repeat(64),
    installationGeneration: 7,
    grants: { projectIds: ["p"], capabilities: ["t3.orchestration/read"] },
    package: {
      format: 4,
      clientEntry: "client.mjs",
      manifest: {
        id: "t3.agents",
        apiVersion: 1,
        version: "0.2.2",
        surfaces: [
          {
            id: "t3.agents/view",
            title: "Agents",
            scope: "thread",
            placements: ["side-panel"],
            clients: ["mobile"],
            capabilities: [],
            stateVersion: 1,
          },
        ],
      },
      tools: [],
      dependencies: [],
      provides: [],
      requires: [],
      assets: [],
    },
  };
}
describe("installed mobile Agents entry", () => {
  it("derives current thread identity and workspace revision, refusing mismatched projects", () => {
    expect(context).toEqual({
      client: "mobile",
      resource: {
        namespace: "t3.thread",
        id: "thread / one",
        environmentId: "remote",
        projectId: "p",
        threadId: "thread / one",
      },
      workspaceRevision: extensionWorkspaceRevision("/project", "/worktree"),
    });
    expect(
      mobileAgentsContext(
        { environmentId: "remote", id: "t", projectId: "other", worktreePath: null },
        { id: "p", workspaceRoot: "/project" },
      ),
    ).toBeNull();
    expect(
      mobileAgentsContext(
        { environmentId: "remote", id: "t", projectId: "p", worktreePath: null },
        { id: "p", workspaceRoot: "/new" },
      )?.workspaceRevision,
    ).toBe(extensionWorkspaceRevision("/new", null));
  });
  it("selects the actual enabled mobile surface with current hash and epoch", () => {
    const item = installed();
    const entry = selectMobileAgentsEntry([item], context, true);
    expect(entry.status).toBe("ready");
    expect(entry.installation).toBe(item);
    expect(entry.visible).toBe(true);
    item.contentHash = "b".repeat(64);
    item.installationGeneration = 8;
    expect(selectMobileAgentsEntry([item], context, true).installation?.contentHash).toBe(
      item.contentHash,
    );
  });
  it("distinguishes missing, disabled, revoked, incompatible and offline states", () => {
    expect(selectMobileAgentsEntry([], context, true)).toMatchObject({
      status: "missing",
      visible: false,
    });
    expect(
      selectMobileAgentsEntry([{ ...installed(), enabled: false }], context, true).status,
    ).toBe("disabled");
    expect(
      selectMobileAgentsEntry(
        [{ ...installed(), grants: { projectIds: [], capabilities: [] } }],
        context,
        true,
      ).status,
    ).toBe("revoked");
    expect(
      selectMobileAgentsEntry(
        [{ ...installed(), grants: { projectIds: ["p"], capabilities: [] } }],
        context,
        true,
      ).status,
    ).toBe("revoked");
    expect(selectMobileAgentsEntry([{ ...installed(), package: {} }], context, true).status).toBe(
      "incompatible",
    );
    expect(
      selectMobileAgentsEntry(
        [{ ...installed(), installationGeneration: undefined }],
        context,
        true,
      ).status,
    ).toBe("incompatible");
    expect(selectMobileAgentsEntry([installed()], context, false).status).toBe("offline");
    expect(selectMobileAgentsEntry(null, context, true).status).toBe("loading");
  });
  it.each([
    "Remote environment endpoint https://fixture.example/api/extensions/list returned undeclared status 503.",
    "Remote environment endpoint https://fixture.example/api/extensions/list returned undeclared status 401.",
    "The environment request failed.",
  ])("does not mount a stale catalogue or call request failures offline: %s", (message) => {
    expect(
      selectMobileAgentsEntry([installed()], context, true, { catalogueError: new Error(message) }),
    ).toMatchObject({ status: "unavailable", visible: true });
  });
  it("keeps a connected cold link loading until thread selection settles", () => {
    expect(selectMobileAgentsEntry([installed()], null, true, { threadPending: true }).status).toBe(
      "loading",
    );
    expect(
      selectMobileAgentsEntry([installed()], null, true, { threadPending: false }).status,
    ).toBe("thread-unavailable");
    expect(
      selectMobileAgentsEntry([installed()], null, false, { threadPending: true }).status,
    ).toBe("offline");
  });
  it("routes encoded deep links through the production stack and offers widgets only when eligible", () => {
    expect(mobileAgentsPath("remote", "thread / one")).toBe(
      "/threads/remote/thread%20%2F%20one/agents",
    );
    expect(eligibleAgentsWidgetPath([installed()], context, true)).toBe(
      mobileAgentsPath("remote", "thread / one"),
    );
    expect(
      eligibleAgentsWidgetPath([{ ...installed(), enabled: false }], context, true),
    ).toBeNull();
    expect(eligibleAgentsWidgetPath(null, context, true)).toBeNull();
    expect(
      getStateFromPath(mobileAgentsPath("remote", "thread / one"), {
        screens: { ThreadAgents: MOBILE_AGENTS_LINKING_PATH },
      })?.routes[0],
    ).toMatchObject({
      name: "ThreadAgents",
      params: { environmentId: "remote", threadId: "thread / one" },
    });
  });
});
