import { ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  ThreadStatusLabel,
  ThreadWorktreeIndicator,
  TurnCompletionTickIcon,
} from "./ThreadStatusIndicators";

describe("ThreadWorktreeIndicator", () => {
  it("renders the worktree folder and branch in an accessible label", () => {
    const markup = renderToStaticMarkup(
      <ThreadWorktreeIndicator
        thread={{
          id: ThreadId.make("thread-1"),
          branch: "feature/sidebar-indicator",
          worktreePath: "/tmp/worktrees/sidebar-indicator",
        }}
      />,
    );

    expect(markup).toContain('role="img"');
    expect(markup).toContain(
      'aria-label="Worktree: sidebar-indicator (feature/sidebar-indicator)"',
    );
    expect(markup).toContain('data-testid="thread-worktree-thread-1"');
  });

  it.each([null, "", "   "])("renders nothing for an absent worktree path", (worktreePath) => {
    const markup = renderToStaticMarkup(
      <ThreadWorktreeIndicator
        thread={{
          id: ThreadId.make("thread-1"),
          branch: "main",
          worktreePath,
        }}
      />,
    );

    expect(markup).toBe("");
  });
});

describe("turn completion tick presentation", () => {
  const completedStatus = {
    label: "Completed" as const,
    colorClass: "text-emerald-600",
    dotClass: "bg-emerald-500",
    pulse: false,
  };

  it("keeps the explicit status label while making the tick decorative", () => {
    const markup = renderToStaticMarkup(
      <ThreadStatusLabel status={completedStatus} completionTick />,
    );

    expect(markup).toContain('aria-label="Completed"');
    expect(markup).toContain(">Completed</span>");
    expect(markup).toContain('data-testid="turn-completion-tick"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('focusable="false"');
    expect(markup).not.toContain("animate-status-pulse");
  });

  it("renders a silent standalone mark when the quiet row has no label", () => {
    const markup = renderToStaticMarkup(<TurnCompletionTickIcon className="size-4" />);

    expect(markup).toContain('data-testid="turn-completion-tick"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('role="status"');
  });
});
