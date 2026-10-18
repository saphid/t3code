import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  projection: null as unknown,
  visibleTurnItems: [] as unknown[],
  shell: null as unknown,
}));

vi.mock("../DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock("@legendapp/list/react", () => ({
  LegendList: () => null,
  useAnimatedRef: () => ({ current: null }),
}));

vi.mock("../../state/entities", () => ({
  useThreadProjection: () => (state.projection === null ? null : { projection: state.projection }),
  useThreadVisibleTurnItems: () => state.visibleTurnItems,
  useThreadShell: () => state.shell,
  useProject: () => null,
}));
vi.mock("../../hooks/useSettings", () => ({
  useClientSettings: (selector: (settings: { timestampFormat: string }) => unknown) =>
    selector({ timestampFormat: "relative" }),
}));
vi.mock("../../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../../hooks/useTurnDiffSummaries", () => ({
  useTurnDiffSummaries: () => ({ turnDiffSummaries: [], inferredCheckpointTurnCountByRunId: {} }),
}));

import { ThreadTranscriptPanel } from "./ThreadTranscriptPanel";

let renderer: ReactTestRenderer | undefined;

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  state.projection = null;
  state.visibleTurnItems = [];
  state.shell = null;
});

it("renders an empty read-only transcript without crashing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(async () => {
    renderer = create(
      <ThreadTranscriptPanel
        environmentId={EnvironmentId.make("test")}
        threadId={ThreadId.make("child-1")}
      />,
    );
  });
  const text = renderer!.root
    .findAll((node) => typeof node.type === "string")
    .flatMap((node) => node.children.filter((child) => typeof child === "string"))
    .join(" ");
  expect(text).toContain("No messages yet.");
});
