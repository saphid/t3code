export * from "@t3tools/shared/subagentRuntime";

import type { ThreadSubagentSummary } from "@t3tools/contracts";

export const SUBAGENT_STATUS_LABELS = {
  pending: "Queued",
  running: "Running",
  waiting: "Waiting",
  idle: "Idle",
  completed: "Finished",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Stopped",
} satisfies Record<ThreadSubagentSummary["status"], string>;

/** Count leaf agents once and retain their ancestry for the sidebar tree. */
export function deriveSidebarSubagents(agents: ReadonlyArray<ThreadSubagentSummary> = []) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const parents = new Set(agents.map((agent) => agent.parentAgentId));
  let running = 0;
  let finished = 0;
  let waiting = 0;
  let idle = 0;
  for (const agent of agents) {
    if (agent.kind === "workflow" && parents.has(agent.id)) continue;
    switch (agent.status) {
      case "pending":
      case "running":
        running += 1;
        break;
      case "waiting":
        waiting += 1;
        break;
      case "idle":
        idle += 1;
        break;
      default:
        finished += 1;
    }
  }
  const rows: Array<{ agent: ThreadSubagentSummary; depth: number }> = [];
  const visited = new Set<string>();
  const children = new Map<string | null, ThreadSubagentSummary[]>();
  for (const agent of agents) {
    const parent =
      agent.parentAgentId !== null && byId.has(agent.parentAgentId) ? agent.parentAgentId : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(agent);
    children.set(parent, siblings);
  }
  const visit = (agent: ThreadSubagentSummary, depth: number) => {
    if (visited.has(agent.id)) return;
    visited.add(agent.id);
    rows.push({ agent, depth });
    for (const child of children.get(agent.id) ?? []) visit(child, depth + 1);
  };
  for (const agent of children.get(null) ?? []) visit(agent, 0);
  // Malformed provider ancestry must not hide agents or recurse forever.
  for (const agent of agents) visit(agent, 0);
  const label = [
    `${running} running`,
    `${finished} finished`,
    ...(waiting > 0 ? [`${waiting} waiting`] : []),
    ...(idle > 0 ? [`${idle} idle`] : []),
  ].join(" · ");
  return { running, finished, waiting, idle, rows, label };
}
