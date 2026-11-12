import { ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";

import { projectsBySession, sessionKey } from "./UsageProjectAttribution.ts";

it("keeps project attribution when only the thread is ambiguous", () => {
  const row = (nativeId: string, project: string, thread = `t-${project}`) => ({
    driver: "claudeAgent",
    nativeId,
    projectId: ProjectId.make(project),
    projectTitle: project === "p-app" ? "App" : "",
    workspaceRoot: `/work/${project}`,
    threadId: ThreadId.make(thread),
    threadTitle: thread === "t-p-app" ? "Build usage" : null,
  });
  const projects = projectsBySession([
    row("bound", "p-app"),
    row("bound", "p-app"),
    row("untitled", "p-other"),
    row("ambiguous-thread", "p-app"),
    row("ambiguous-thread", "p-app", "t-other"),
    row("ambiguous-project", "p-app"),
    row("ambiguous-project", "p-other"),
  ]);

  expect(projects.get(sessionKey("claudeAgent", "bound"))).toEqual({
    project: { projectId: "p-app", title: "App" },
    threadId: "t-p-app",
    threadTitle: "Build usage",
  });
  expect(projects.get(sessionKey("claudeAgent", "untitled"))?.project.title).toBe("p-other");
  expect(projects.get(sessionKey("claudeAgent", "ambiguous-thread"))).toEqual({
    project: { projectId: "p-app", title: "App" },
  });
  expect(projects.has(sessionKey("claudeAgent", "ambiguous-project"))).toBe(false);
});
