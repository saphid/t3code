import { EnvironmentId, ThreadId, UsageDay } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({ useUsageThreads: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../../state/usage", () => ({ useUsageThreads: testState.useUsageThreads }));
vi.mock("../ui/tooltip", async () => {
  const React = await import("react");
  return {
    Tooltip: "span",
    TooltipPopup: "span",
    TooltipTrigger: ({
      render,
      children,
    }: {
      render: React.ReactElement;
      children: React.ReactNode;
    }) => React.cloneElement(render, {}, children),
  };
});
vi.mock("./usageProviders", () => ({
  PROVIDER_PRESENTATION: {
    claude: { mark: "span" },
    codex: { mark: "span" },
    grok: { mark: "span" },
  },
}));

import { ThreadRowGroup, UsageThreadTable } from "./UsageThreadTable";

const input = {
  sinceDay: UsageDay.make("2026-08-01"),
  untilDay: UsageDay.make("2026-08-31"),
  timeZone: "UTC",
};

beforeEach(() => {
  testState.useUsageThreads.mockReset();
});

describe("UsageThreadTable", () => {
  it("reveals subagent rows under their thread with aligned metric columns", () => {
    const totals = {
      uncachedInputTokens: 10,
      cachedInputTokens: 20,
      cacheCreationTokens: 0,
      outputTokens: 30,
      reasoningTokens: 0,
    };
    const props = {
      row: {
        environmentId: EnvironmentId.make("environment-one"),
        key: "thread-one",
        threadId: null,
        title: "Parent",
        provider: "claude" as const,
        totals,
        costUsd: 10,
        cacheWriteUsd: 0,
        sessions: 1,
        daily: [],
        agents: [
          {
            agentId: "child-one",
            cacheWriteUsd: 0,
            totals,
            costUsd: 2,
            componentCosts: { inputUsd: 0.5, outputUsd: 1, cacheReadUsd: 0.5 },
          },
        ],
      },
      tokens: 120,
      share: 1,
      sinceDay: input.sinceDay,
      untilDay: input.untilDay,
      onToggle: vi.fn(),
      columns: ["cost", "share", "input", "output", "cacheReads", "cacheWrites"] as const,
    };
    const closed = renderToStaticMarkup(
      <table>
        <tbody>
          <ThreadRowGroup {...props} open={false} />
        </tbody>
      </table>,
    );
    expect(closed).not.toContain("child-one");
    expect(closed).toContain('aria-label="Expand Parent details and subagents"');
    const cost = renderToStaticMarkup(
      <table>
        <tbody>
          <ThreadRowGroup {...props} metric="cost" open />
        </tbody>
      </table>,
    );
    expect(cost).toContain("child-one");
    expect(cost).toContain("$0.50");
    expect(cost).toContain("20.0%");
    expect(cost).toContain("already included in its totals");
    const tokens = renderToStaticMarkup(
      <table>
        <tbody>
          <ThreadRowGroup
            {...props}
            columns={["tokens", "share", "input", "output"]}
            metric="tokens"
            open
          />
        </tbody>
      </table>,
    );
    expect(tokens).toContain("50.0%");
    expect(tokens).not.toContain("$0.50");
  });
  it("uses the shared skeleton treatment while thread data is pending", () => {
    testState.useUsageThreads.mockReturnValue({
      rows: [],
      truncatedRows: 0,
      isPending: true,
      failedEnvironments: 0,
    });

    const markup = renderToStaticMarkup(
      <UsageThreadTable
        input={input}
        providerContributions={[]}
        summaryFailedEnvironments={0}
        sort={{ column: "cost", direction: "desc" }}
        onSort={() => {}}
      />,
    );

    expect(markup).toContain("motion-safe:animate-skeleton");
  });

  it("reports an unavailable breakdown when every query failed", () => {
    testState.useUsageThreads.mockReturnValue({
      rows: [],
      truncatedRows: 0,
      isPending: false,
      failedEnvironments: 0,
    });

    const markup = renderToStaticMarkup(
      <UsageThreadTable
        input={input}
        providerContributions={[]}
        summaryFailedEnvironments={2}
        sort={{ column: "cost", direction: "desc" }}
        onSort={() => {}}
      />,
    );

    expect(markup).toContain("Thread activity could not be loaded");
    expect(markup).not.toContain("No activity in this window");
  });

  it("uses a keyboard-accessible disclosure button without a native title", () => {
    testState.useUsageThreads.mockReturnValue({
      rows: [
        {
          environmentId: EnvironmentId.make("environment-one"),
          key: "row-one",
          threadId: ThreadId.make("thread-one"),
          title: "Fix the flaky test",
          provider: "claude",
          totals: {
            uncachedInputTokens: 1,
            cachedInputTokens: 2,
            cacheCreationTokens: 3,
            outputTokens: 4,
            reasoningTokens: 0,
          },
          costUsd: 1,
          cacheWriteUsd: 0.25,
          sessions: 1,
          agents: [
            {
              agentId: "agent-one",
              totals: {
                uncachedInputTokens: 1,
                cachedInputTokens: 0,
                cacheCreationTokens: 0,
                outputTokens: 1,
                reasoningTokens: 0,
              },
              costUsd: 0.1,
            },
          ],
          daily: [],
        },
      ],
      truncatedRows: 0,
      isPending: false,
      failedEnvironments: 0,
    });

    const markup = renderToStaticMarkup(
      <UsageThreadTable
        input={input}
        providerContributions={[]}
        summaryFailedEnvironments={0}
        sort={{ column: "cost", direction: "desc" }}
        onSort={() => {}}
      />,
    );

    expect(markup).toContain('<button type="button" aria-expanded="false"');
    expect(markup).toContain('data-slot="badge"');
    expect(markup).toContain("1 subagent");
    expect(markup).toContain('aria-label="Open thread"');
    expect(markup).not.toContain('title="Fix the flaky test"');
  });
});
