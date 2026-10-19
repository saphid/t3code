// @vitest-environment jsdom
import type { UsageSummaryInput } from "@t3tools/contracts";
import { USAGE_CONTRACT_VERSION } from "@t3tools/contracts";
import { mergeUsage } from "@t3tools/shared/usageMerge";
import { USAGE_AUTO_REFRESH_MS } from "@t3tools/shared/usageRefresh";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ windows: [] as UsageSummaryInput[], refresh: vi.fn() }));
const passthrough = vi.hoisted(
  () =>
    ({ children }: { children?: ReactNode }) =>
      children,
);

vi.mock("../../env", () => ({ isElectron: false }));
vi.mock("../../state/usage", () => ({
  useUsage: (input: UsageSummaryInput) => {
    state.windows.push(input);
    return {
      merged: mergeUsage([], USAGE_CONTRACT_VERSION),
      environments: [],
      isPending: false,
      isPartial: false,
      refresh: state.refresh,
    };
  },
}));
vi.mock("../ui/button", () => ({ Button: "button" }));
vi.mock("../ui/scroll-area", () => ({ ScrollArea: passthrough }));
vi.mock("../ui/sidebar", () => ({ SidebarInset: passthrough }));
vi.mock("../ui/select", () => ({
  Select: passthrough,
  SelectItem: passthrough,
  SelectPopup: passthrough,
  SelectTrigger: passthrough,
  SelectValue: passthrough,
}));
vi.mock("../ui/toggle-group", () => ({
  Toggle: "button",
  ToggleGroup: ({
    children,
    onValueChange,
  }: {
    children: ReactNode;
    onValueChange: (value: string[]) => void;
  }) =>
    createElement(
      "div",
      {
        onClick: (event: { target: HTMLElement }) => {
          const value = event.target.closest("button")?.getAttribute("value");
          if (value) onValueChange([value]);
        },
      },
      children,
    ),
}));
vi.mock("../WorkspaceBreadcrumb", () => ({
  WorkspaceBreadcrumb: passthrough,
  WorkspaceBreadcrumbItem: passthrough,
  WorkspaceBreadcrumbSeparator: () => null,
}));
vi.mock("../WorkspacePageContainer", () => ({ WorkspacePageContainer: passthrough }));
vi.mock("../WorkspacePageHeader", () => ({ WorkspacePageHeader: passthrough }));
vi.mock("./UsageProviderChart", () => ({ UsageProviderChart: () => null }));
vi.mock("./UsageThreadTable", () => ({ UsageThreadTable: () => null }));

import { UsagePage } from "./UsagePage";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("TZ", "UTC");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-31T23:45:00Z"));
  state.windows.length = 0;
  state.refresh.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<UsagePage />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("usage page auto-refresh windows", () => {
  it("advances a daily preset across midnight", () => {
    expect(state.windows.at(-1)?.untilDay).toBe("2026-08-31");
    act(() => vi.advanceTimersByTime(USAGE_AUTO_REFRESH_MS));
    expect(state.windows.at(-1)?.untilDay).toBe("2026-09-01");
    expect(container.textContent).toContain("Sep 1");
  });

  it("keeps Past 24h rolling on every interval", () => {
    const preset = container.querySelector<HTMLButtonElement>('button[value="1"]');
    expect(preset).not.toBeNull();
    act(() => preset?.click());
    const originalEnd = state.windows.at(-1)?.untilTime;
    act(() => vi.advanceTimersByTime(USAGE_AUTO_REFRESH_MS));
    const window = state.windows.at(-1);
    expect(window?.untilTime).not.toBe(originalEnd);
    expect(window?.untilTime).toBe("2026-09-01T00:15:00.000Z");
    expect(Date.parse(window?.untilTime ?? "") - Date.parse(window?.sinceTime ?? "")).toBe(
      24 * 60 * 60 * 1000,
    );
  });
});
