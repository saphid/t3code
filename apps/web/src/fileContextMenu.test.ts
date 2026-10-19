import * as NodeAssert from "node:assert/strict";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildFileContextMenuItems,
  fileManagerMenuLabel,
  resolveFileContextMenuAbsolutePath,
} from "./fileContextMenu";

const BASE_TARGET = {
  environmentId: EnvironmentId.make("environment-local"),
  filePath: "src/index.ts",
  workspaceRoot: "/workspace/project",
};

describe("resolveFileContextMenuAbsolutePath", () => {
  it("joins workspace-relative diff paths onto the workspace root", () => {
    expect(resolveFileContextMenuAbsolutePath(BASE_TARGET)).toBe("/workspace/project/src/index.ts");
  });

  it("strips the repository prefix when the repo root is nested in the workspace", () => {
    expect(
      resolveFileContextMenuAbsolutePath({
        ...BASE_TARGET,
        workspaceRoot: "/workspace/project/packages/app",
        repositoryRoot: "/workspace/project",
        filePath: "packages/app/src/index.ts",
      }),
    ).toBe("/workspace/project/packages/app/src/index.ts");
  });

  it("returns null for paths outside the workspace when a repository root is set", () => {
    expect(
      resolveFileContextMenuAbsolutePath({
        ...BASE_TARGET,
        workspaceRoot: "/workspace/project/packages/app",
        repositoryRoot: "/workspace/project",
        filePath: "other/src/index.ts",
      }),
    ).toBeNull();
  });

  it("rejects absolute paths without a workspace root, matching diff path resolution", () => {
    expect(
      resolveFileContextMenuAbsolutePath({
        ...BASE_TARGET,
        workspaceRoot: undefined,
        filePath: "/absolute/src/index.ts",
      }),
    ).toBeNull();
  });
});

describe("buildFileContextMenuItems", () => {
  it("offers open, reveal, and an open-with submenu", () => {
    const items = buildFileContextMenuItems({
      hasAbsolutePath: true,
      canOpenDefault: true,
      editorIds: ["vscode", "cursor", "file-manager"],
      platform: "MacIntel",
    });

    expect(items.map((item) => item.id)).toEqual(["open", "reveal-in-folder", "open-with"]);
    expect(items[0]).toMatchObject({ label: "Open" });
    expect(items[1]).toMatchObject({ label: "Show in Finder" });
    const openWith = items[2];
    NodeAssert.ok(openWith);
    expect(openWith.children?.map((child) => child.id)).toEqual(["editor:vscode", "editor:cursor"]);
  });

  it("drops default-app open and labels the file manager per platform", () => {
    const items = buildFileContextMenuItems({
      hasAbsolutePath: true,
      canOpenDefault: false,
      editorIds: [],
      platform: "Win32",
    });

    expect(items.map((item) => item.id)).toEqual(["reveal-in-folder"]);
    expect(items[0]).toMatchObject({ label: "Show in Explorer" });
    expect(fileManagerMenuLabel("Linux x86_64")).toBe("file manager");
  });

  it("offers nothing when the path cannot be resolved", () => {
    expect(
      buildFileContextMenuItems({
        hasAbsolutePath: false,
        canOpenDefault: true,
        editorIds: ["vscode"],
      }),
    ).toEqual([]);
  });
});
