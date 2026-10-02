import { extensionWorkspaceRevision } from "@t3tools/contracts";
import { validateEnvironmentPackage } from "@t3tools/extension-sdk/environment";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import type { MobileInstallation } from "./mobileExtensionHost";

export function mobileAgentsContext(
  thread: {
    environmentId: string;
    id: string;
    projectId: string;
    worktreePath: string | null;
  } | null,
  project: { id: string; workspaceRoot: string } | null,
): ViewContext | null {
  if (!thread || !project?.workspaceRoot || thread.projectId !== project.id) return null;
  return {
    client: "mobile",
    resource: {
      namespace: "t3.thread",
      id: thread.id,
      environmentId: thread.environmentId,
      projectId: thread.projectId,
      threadId: thread.id,
    },
    workspaceRevision: extensionWorkspaceRevision(project.workspaceRoot, thread.worktreePath),
  };
}
export type MobileAgentsStatus =
  | "loading"
  | "ready"
  | "missing"
  | "disabled"
  | "revoked"
  | "incompatible"
  | "offline"
  | "thread-unavailable";
export function selectMobileAgentsEntry(
  installations: readonly MobileInstallation[] | null,
  context: ViewContext | null,
  connected: boolean,
): {
  status: MobileAgentsStatus;
  visible: boolean;
  installation?: MobileInstallation;
} {
  const installation = installations?.find((item) => item.id === "t3.agents");
  const result = (status: MobileAgentsStatus) => ({
    status,
    visible: !!installation,
    installation,
  });
  if (!connected) return result("offline");
  if (!context) return result("thread-unavailable");
  if (!installations) return result("loading");
  if (!installation) return result("missing");
  if (!installation.enabled) return result("disabled");
  try {
    const pkg = validateEnvironmentPackage(installation.package);
    const surface = pkg.manifest.surfaces.find((item) => item.id === "t3.agents/view");
    if (
      pkg.manifest.id !== installation.id ||
      !surface?.clients.includes("mobile") ||
      surface.scope !== "thread" ||
      !installation.installationGeneration
    )
      return result("incompatible");
    if (
      !installation.grants.projectIds.includes(context.resource.projectId ?? "") ||
      ["t3.orchestration/read", ...surface.capabilities].some(
        (grant) => !installation.grants.capabilities.includes(grant),
      )
    )
      return result("revoked");
    return result("ready");
  } catch {
    return result("incompatible");
  }
}
export function mobileAgentsPath(environmentId: string, threadId: string) {
  return `/threads/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}/agents`;
}
export function eligibleAgentsWidgetPath(
  installations: readonly MobileInstallation[] | null,
  context: ViewContext | null,
  connected: boolean,
) {
  return context && selectMobileAgentsEntry(installations, context, connected).status === "ready"
    ? mobileAgentsPath(context.resource.environmentId, context.resource.threadId!)
    : null;
}
export const mobileAgentsNotice: Record<
  Exclude<MobileAgentsStatus, "ready">,
  { title: string; detail: string }
> = {
  loading: { title: "Opening Agents", detail: "Checking the installed Agents pack." },
  missing: {
    title: "Agents pack missing",
    detail:
      "Install the Agents pack in this environment from desktop Extensions settings, then refresh.",
  },
  disabled: {
    title: "Agents pack disabled",
    detail:
      "Enable the Agents pack in this environment from desktop Extensions settings, then refresh.",
  },
  revoked: {
    title: "Agents access revoked",
    detail:
      "Restore this project's Agents permissions in desktop Extensions settings, then refresh.",
  },
  incompatible: {
    title: "Agents update required",
    detail:
      "Update this environment and its Agents pack to a version that supports mobile, then refresh.",
  },
  offline: { title: "Environment offline", detail: "Reconnect the environment to open Agents." },
  "thread-unavailable": {
    title: "Thread unavailable",
    detail: "Return to the thread list and select an available thread.",
  },
};

export const MOBILE_AGENTS_LINKING_PATH = "threads/:environmentId/:threadId/agents";
