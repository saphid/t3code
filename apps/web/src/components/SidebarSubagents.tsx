import type { ThreadSubagentSummary } from "@t3tools/contracts";
import {
  deriveSidebarSubagents,
  SUBAGENT_STATUS_LABELS,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { BotIcon, ChevronDownIcon } from "lucide-react";
import { memo, useId, useMemo, useState } from "react";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const statusClass = {
  pending: "text-info",
  running: "text-info",
  waiting: "text-warning",
  idle: "text-muted-foreground",
  completed: "text-success",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
  interrupted: "text-muted-foreground",
} satisfies Record<ThreadSubagentSummary["status"], string>;

export const SidebarSubagents = memo(function SidebarSubagents({
  agents,
  threadTitle,
}: {
  agents: ReadonlyArray<ThreadSubagentSummary> | undefined;
  threadTitle: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const treeId = useId();
  const model = useMemo(() => deriveSidebarSubagents(agents), [agents]);
  if (model.rows.length === 0) return null;

  return (
    <div
      data-thread-selection-safe
      className="px-[var(--sidebar-row-content-inset,0.625rem)] pb-1"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      }}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={treeId}
        aria-label={`Subagents for ${threadTitle}: ${model.label}`}
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          "flex w-full cursor-pointer flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border px-2 py-1 text-left text-[11px] outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring",
          expanded ? "border-border/70 bg-sidebar-accent/50" : "border-border/40 bg-muted/30",
        )}
      >
        <BotIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium text-secondary-label">Subagents</span>
        <span className="ml-auto flex flex-wrap items-center gap-x-1 text-muted-foreground tabular-nums">
          <span className={model.running > 0 ? "text-info" : undefined}>
            {model.running} running
          </span>
          <span aria-hidden>·</span>
          <span>{model.finished} finished</span>
          {model.waiting > 0 ? <span>· {model.waiting} waiting</span> : null}
          {model.idle > 0 ? <span>· {model.idle} idle</span> : null}
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn("size-3 shrink-0 text-muted-foreground", expanded && "rotate-180")}
        />
      </button>
      <ul
        id={treeId}
        aria-label={`Subagents for ${threadTitle}`}
        hidden={!expanded}
        className="ml-2 mt-1 border-l border-border/60 pl-2"
      >
        {expanded
          ? model.rows.map(({ agent, depth }) => (
              <li
                key={agent.id}
                className="flex min-w-0 items-center gap-1.5 py-1 text-xs"
                style={{ paddingLeft: Math.min(depth, 4) * 10 }}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full bg-current",
                    statusClass[agent.status],
                  )}
                />
                <Tooltip>
                  <TooltipTrigger
                    render={<span className="min-w-0 flex-1 truncate text-secondary-label" />}
                  >
                    {agent.title}
                  </TooltipTrigger>
                  <TooltipPopup>{agent.title}</TooltipPopup>
                </Tooltip>
                <span className={cn("shrink-0 text-[10px]", statusClass[agent.status])}>
                  {SUBAGENT_STATUS_LABELS[agent.status]}
                </span>
              </li>
            ))
          : null}
      </ul>
    </div>
  );
});
