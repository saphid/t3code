import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vite-plus/test";
import type { Extension } from "@t3tools/extension-sdk/host";
import type { SurfaceRenderer } from "@t3tools/extension-sdk/react";
import type { ViewRecord } from "@t3tools/extension-sdk/contracts";
import {
  registerWorkspaceExtension,
  useWorkspaceSurfaceTitles,
  WorkspaceExtensionSurface,
} from "./workspaceRegistry";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
describe("workspace extension registration", () => {
  it("updates mounted tab text and close labels when registration changes", async () => {
    const extension: Extension<SurfaceRenderer> = {
      manifest: {
        id: "community.metadata",
        version: "1.0.0",
        apiVersion: 1,
        surfaces: [
          {
            id: "community.metadata/view",
            title: "Metadata",
            scope: "project",
            clients: ["web"],
            placements: ["side-panel"],
            capabilities: [],
            stateVersion: 1,
          },
        ],
      },
      surfaces: [
        {
          id: "community.metadata/view",
          validateRestore: (state) => state === null,
          createView: () => ({ renderer: () => <span>Metadata body</span> }),
        },
      ],
    };
    function TabMetadata() {
      const titles = useWorkspaceSurfaceTitles();
      const title = titles.get("community.metadata/view") ?? "Install metadata";
      return <button aria-label={`Close ${title}`}>{title}</button>;
    }
    let root!: ReactTestRenderer;
    let unregister = () => {};
    try {
      await act(async () => {
        root = create(<TabMetadata />);
      });
      expect(root.root.findByType("button").children).toEqual(["Install metadata"]);
      expect(root.root.findByType("button").props["aria-label"]).toBe("Close Install metadata");
      await act(async () => {
        unregister = registerWorkspaceExtension(extension);
      });
      expect(root.root.findByType("button").children).toEqual(["Metadata"]);
      expect(root.root.findByType("button").props["aria-label"]).toBe("Close Metadata");
      await act(async () => {
        unregister();
      });
      expect(root.root.findByType("button").children).toEqual(["Install metadata"]);
      expect(root.root.findByType("button").props["aria-label"]).toBe("Close Install metadata");
    } finally {
      await act(async () => {
        root?.unmount();
        unregister();
      });
    }
  });
  it("opens an independent contribution, contains disable, and restores its retained record", async () => {
    let disposed = 0;
    const extension: Extension<SurfaceRenderer> = {
      manifest: {
        id: "community.sample",
        version: "1.0.0",
        apiVersion: 1,
        surfaces: [
          {
            id: "community.sample/view",
            title: "Sample",
            scope: "project",
            clients: ["web"],
            placements: ["side-panel"],
            capabilities: [],
            stateVersion: 1,
          },
        ],
      },
      surfaces: [
        {
          id: "community.sample/view",
          validateRestore: (state) => state === null,
          createView: () => ({
            renderer: () => <button>Independent sample</button>,
            dispose: () => {
              disposed++;
            },
          }),
        },
      ],
    };
    const record: ViewRecord = {
      version: 1,
      surfaceId: "community.sample/view",
      placement: "side-panel",
      stateVersion: 1,
      restoreState: null,
      fallback: "Install Sample to restore this view",
      context: {
        client: "web",
        resource: {
          namespace: "community.resource",
          id: "sample",
          environmentId: "env",
          projectId: "project",
        },
      },
    };
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(<WorkspaceExtensionSurface record={record} visible />);
    });
    expect(root.root.findByProps({ role: "status" }).children).toEqual([record.fallback]);
    let unregister!: () => void;
    await act(async () => {
      unregister = registerWorkspaceExtension(extension);
    });
    expect(root.root.findByType("button").children).toEqual(["Independent sample"]);
    expect(() => registerWorkspaceExtension(extension)).toThrow("already registered");
    await act(async () => {
      unregister();
      unregister();
    });
    expect(disposed).toBe(1);
    expect(root.root.findByProps({ role: "status" }).children).toEqual([record.fallback]);
    await act(async () => {
      unregister = registerWorkspaceExtension(extension);
    });
    expect(root.root.findByType("button").children).toEqual(["Independent sample"]);
    await act(async () => {
      root.unmount();
      unregister();
    });
    expect(disposed).toBe(2);
  });
});
