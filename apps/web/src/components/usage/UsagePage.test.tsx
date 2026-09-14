import { ProjectId, USAGE_CONTRACT_VERSION } from "@t3tools/contracts";
import { mergeUsage } from "@t3tools/shared/usageMerge";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({ useUsage: vi.fn(), metric: "cost" as "cost" | "tokens" }));
vi.mock("./usagePagePreferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./usagePagePreferences")>();
  return {
    ...actual,
    readUsagePagePreferences: () => ({
      ...actual.DEFAULT_USAGE_PAGE_PREFERENCES,
      metric: testState.metric,
    }),
  };
});

vi.mock("../../env", () => ({ isElectron: false }));
vi.mock("../../state/environments", () => ({ usePrimaryEnvironmentId: () => null }));
vi.mock("../../state/usage", () => ({ useUsage: testState.useUsage }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../ui/scroll-area", () => ({ ScrollArea: "div" }));
vi.mock("../ui/sidebar", () => ({ SidebarInset: "div" }));
vi.mock("../WorkspaceBreadcrumb", () => ({
  WorkspaceBreadcrumb: "div",
  WorkspaceBreadcrumbItem: "div",
}));
vi.mock("../WorkspacePageContainer", () => ({ WorkspacePageContainer: "main" }));
vi.mock("../WorkspacePageHeader", () => ({ WorkspacePageHeader: "header" }));
vi.mock("./UsageLimits", () => ({ UsageLimitsSection: () => <div>CLIProxyAPI limits</div> }));
vi.mock("./UsageProjectThreads", () => ({
  UsageProjectThreads: () => <div>Thread breakdown</div>,
}));

import { UsagePage } from "./UsagePage";

const projectId = ProjectId.make("project-one");

beforeEach(() => {
  testState.metric = "cost";
  const merged = {
    ...mergeUsage([], USAGE_CONTRACT_VERSION),
    costUsd: 12,
    totalTokens: 12_000,
    sessions: 2,
    projects: [
      {
        projectId,
        projectKey: "environment-one:id:project-one",
        project: "Project One",
        costUsd: 12,
        totalTokens: 12_000,
        cacheWriteTokens: 0,
        cacheWriteUsd: 0,
        records: 2,
        costShare: 1,
      },
    ],
    providers: [
      {
        provider: "grok" as const,
        costUsd: 12,
        totalTokens: 12_000,
        records: 2,
        sessions: 2,
        costShare: 1,
        tokenShare: 1,
      },
    ],
    models: [
      {
        provider: "grok" as const,
        model: "grok-code-fast",
        costUsd: 12,
        totalTokens: 12_000,
        cacheWriteTokens: 0,
        cacheWriteUsd: 0,
        records: 2,
        costShare: 1,
      },
    ],
    timeline: [
      {
        periodStart: "2026-09-03T00:00:00.000Z",
        projectKey: "environment-one:id:project-one",
        project: "Project One",
        provider: "grok" as const,
        model: "grok-code-fast",
        costUsd: 12,
        totalTokens: 12_000,
      },
    ],
  };
  testState.useUsage.mockReturnValue({
    merged,
    environments: [],
    isPending: false,
    isPartial: false,
    isRefreshing: false,
    refreshError: null,
    refresh: vi.fn(),
  });
});

describe("UsagePage", () => {
  it("keeps summary units fixed and shows only token totals in Tokens mode", () => {
    testState.metric = "tokens";
    const markup = renderToStaticMarkup(<UsagePage />);
    expect(markup).toContain("API-rate estimate");
    const table = markup.slice(markup.indexOf("<table"), markup.indexOf("</table>"));
    expect(table).not.toContain(">Cost<");
    expect(table).toContain(">Tokens<");
    expect(markup).not.toContain("Processed tokens");
    expect(markup).toContain(">Tokens<");
  });
  it("requests a seven-day half-hour timeline by default", () => {
    renderToStaticMarkup(<UsagePage />);
    const input = testState.useUsage.mock.calls.at(-1)?.[0];
    expect(input.resolution).toBe("halfHour");
    expect(Date.parse(input.untilTime) - Date.parse(input.sinceTime)).toBe(7 * 24 * 60 * 60_000);
  });

  it("renders the merged summary with the fixture without throwing", () => {
    const markup = renderToStaticMarkup(<UsagePage />);
    expect(markup).toContain("Project One");
    expect(markup).toContain("Model prices");
    expect(markup).toContain("Columns");
    expect(markup).toContain("Expand Project One threads");
    expect(markup).not.toContain('value="threads"');
    expect(markup).toContain("Cache reads");
    expect(markup).toContain(">Input<");
    expect(markup).toContain(">Output<");
  });
});
