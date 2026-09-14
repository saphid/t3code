import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { UsageBreakdownTable, type BreakdownTableRow } from "./UsageBreakdownTable";

const row = (key: string, costUsd: number): BreakdownTableRow => ({
  key,
  label: key,
  color: "#5b8def",
  costUsd,
  totalTokens: 100,
  share: 0.5,
  cacheWriteTokens: 10,
  cacheWriteUsd: 0.1,
  inputTokens: 20,
  outputTokens: 30,
  cacheReadTokens: 40,
  sessions: null,
  componentCosts: { inputUsd: 1.23, outputUsd: 2.34, cacheReadUsd: 3.45 },
});

describe("UsageBreakdownTable", () => {
  const props = {
    rows: [row("Atlas", 20), row("Orion", 1)],
    nameLabel: "Project",
    ariaLabel: "Project breakdown",
    metric: "cost" as const,
    sort: { column: "cost", direction: "desc" } as const,
    hidden: new Set<string>(),
    activeKey: null,
    onSort: vi.fn(),
    onToggleHidden: vi.fn(),
    onSetAllHidden: vi.fn(),
    onActiveKeyChange: vi.fn(),
    onToggleFavorite: vi.fn(),
  };
  it("renders component cells and footer in the selected units", () => {
    const cost = renderToStaticMarkup(<UsageBreakdownTable {...props} />);
    const tokens = renderToStaticMarkup(<UsageBreakdownTable {...props} metric="tokens" />);
    expect(cost).toContain("$1.23");
    expect(cost).toContain("$2.46");
    expect(tokens).not.toContain("$1.23");
    expect(tokens).toContain(">20<");
    expect(tokens).toContain(">40<");
  });
  it("keeps favorites above cost-sorted rows without loading collapsed threads", () => {
    const renderThreads = vi.fn();
    const markup = renderToStaticMarkup(
      <UsageBreakdownTable {...props} favoriteProjects={["Orion"]} renderThreads={renderThreads} />,
    );
    expect(markup.indexOf('aria-label="Unfavorite Orion"')).toBeLessThan(
      markup.indexOf('aria-label="Favorite Atlas"'),
    );
    expect(markup).toContain('aria-label="Expand Orion threads"');
    expect(renderThreads).not.toHaveBeenCalled();
  });
  it("omits disabled columns and keeps the remaining totals", () => {
    const markup = renderToStaticMarkup(
      <UsageBreakdownTable {...props} hiddenColumns={["input", "output", "cacheReads"]} />,
    );
    expect(markup).not.toContain(">Input<");
    expect(markup).not.toContain(">Output<");
    expect(markup).not.toContain(">Cache reads<");
    expect(markup).toContain("Cache writes");
    expect(markup).toContain("$21.00");
  });
});
