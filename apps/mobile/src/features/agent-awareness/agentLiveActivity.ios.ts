import { EnvironmentId, ThreadId, ProjectId } from "@t3tools/contracts";
import { Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobileExtensionInstallations } from "../../state/extension-installations";
import { environmentThreadShells } from "../../state/threads";
import { environmentProjects } from "../../state/projects";
import { eligibleAgentsWidgetPath, mobileAgentsContext } from "../extensions/mobileAgentsEntry";
import { environmentPresentations } from "../../state/presentation";
import AgentActivity, { type AgentActivityProps } from "../../widgets/AgentActivity";

export function getAgentLiveActivities() {
  return AgentActivity.getInstances();
}

export function startAgentLiveActivity(props: AgentActivityProps) {
  return AgentActivity.start({
    ...props,
    activities: props.activities.map((row) => {
      if (!row.environmentId || !row.threadId) return row;
      const environmentId = EnvironmentId.make(row.environmentId);
      const thread = appAtomRegistry.get(
        environmentThreadShells.threadShellAtom({
          environmentId,
          threadId: ThreadId.make(row.threadId),
        }),
      );
      const project = thread
        ? appAtomRegistry.get(
            environmentProjects.projectAtom({
              environmentId,
              projectId: ProjectId.make(thread.projectId),
            }),
          )
        : null;
      const installations = Option.getOrNull(
        AsyncResult.value(appAtomRegistry.get(mobileExtensionInstallations(environmentId))),
      );
      const connected =
        appAtomRegistry.get(environmentPresentations.presentationAtom(environmentId))?.connection
          .phase === "connected";
      const agentsDeepLink = eligibleAgentsWidgetPath(
        installations,
        mobileAgentsContext(thread, project),
        connected,
      );
      return { ...row, agentsDeepLink: agentsDeepLink ?? undefined };
    }),
  });
}
