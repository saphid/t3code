import {
  AuthAccessWriteScope,
  type AuthSessionState,
  type PluginInstallation,
  type PluginInstallationStatus,
  pluginInstallationStatus,
} from "@t3tools/contracts";

export type PluginStateTone = "neutral" | "success" | "info" | "warning" | "error";

/** What web and mobile show for one installation, and which controls it offers. */
interface PluginInstallationPresentation {
  readonly status: PluginInstallationStatus;
  readonly title: string;
  readonly stateLabel: string;
  readonly tone: PluginStateTone;
  /** The problem, failure reason, or what happens next. */
  readonly detail: string | null;
  readonly canReview: boolean;
  readonly canEnable: boolean;
  readonly canDisable: boolean;
  readonly canResume: boolean;
}

function directoryName(directory: string): string {
  const parts = directory.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? directory;
}

function enabledState(
  hostState: PluginInstallation["hostState"],
): Pick<PluginInstallationPresentation, "stateLabel" | "tone" | "detail" | "canResume"> {
  // Absent on an enabled row is a state this client cannot decode, never idle.
  if (hostState === undefined)
    return {
      stateLabel: "Unknown state",
      tone: "warning",
      detail: "The server reported a plugin state this app does not recognize. Update the app.",
      canResume: false,
    };
  switch (hostState._tag) {
    case "idle":
      return {
        stateLabel: "Enabled",
        tone: "success",
        detail: "Starts when first used.",
        canResume: false,
      };
    case "starting":
      return { stateLabel: "Starting", tone: "info", detail: null, canResume: false };
    case "running":
      return { stateLabel: "Running", tone: "success", detail: null, canResume: false };
    case "backoff":
      return {
        stateLabel: "Restarting",
        tone: "warning",
        detail: `Failed ${hostState.failures === 1 ? "once" : `${hostState.failures} times`}: ${hostState.reason} It starts again on next use after a short wait.`,
        canResume: true,
      };
    case "quarantined":
      return {
        stateLabel: "Stopped after repeated failures",
        tone: "error",
        detail: `${hostState.reason} Fix the problem, then resume it.`,
        canResume: true,
      };
    case "incompatible":
      return {
        stateLabel: "Incompatible",
        tone: "error",
        detail: `${hostState.reason} Update the plugin, then resume it.`,
        canResume: true,
      };
  }
}

export function presentPluginInstallation(
  installation: PluginInstallation,
): PluginInstallationPresentation {
  const status = pluginInstallationStatus(installation);
  const title = installation.manifest?.name ?? directoryName(installation.directory);
  // Disable is a way out from every state, so it follows `enabled` rather than status.
  const base = {
    status,
    title,
    canReview: status === "needs-consent",
    canEnable: status === "disabled",
    canDisable: installation.enabled,
  };
  switch (status) {
    case "unavailable":
      return {
        ...base,
        stateLabel: "Unavailable",
        tone: "error",
        detail: installation.problem ?? "The plugin directory could not be read.",
        canResume: false,
      };
    case "needs-consent":
      return installation.consent === null
        ? {
            ...base,
            stateLabel: "Needs approval",
            tone: "info",
            detail: "Review its files and capabilities to approve it. Nothing runs until then.",
            canResume: false,
          }
        : {
            ...base,
            stateLabel: "Changed since approval",
            tone: "warning",
            detail:
              "Files in its directory changed after you approved it, so it was stopped. Review the new files to run it again.",
            canResume: false,
          };
    case "disabled":
      return { ...base, stateLabel: "Disabled", tone: "neutral", detail: null, canResume: false };
    case "enabled":
      return { ...base, ...enabledState(installation.hostState) };
  }
}

function formatPluginSourceSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function describePluginSource(source: NonNullable<PluginInstallation["source"]>): string {
  return `${source.files === 1 ? "1 file" : `${source.files} files`}, ${formatPluginSourceSize(source.bytes)}`;
}

/** Shown before consent: plugins are trusted code, not a sandbox. */
export function pluginTrustStatement(environmentLabel: string): string {
  return `Plugins are trusted local code, not a sandbox. Once enabled, this plugin runs as your user account on ${environmentLabel}'s machine, with the same access to its files, programs, and network. Only approve code you trust.`;
}

/** What the digest does and does not promise. */
export const PLUGIN_DIGEST_STATEMENT =
  "Approval covers these exact files. If any file in the plugin's directory changes, T3 Code stops the plugin and asks again. The digest records what you approved; it does not stop the directory's owner from changing it, and code the plugin loads from outside its directory is not covered.";

export const PLUGIN_DIRECTORY_GUIDANCE =
  "Add a plugin's build directory, not a git checkout: every file counts, hidden ones included. A plugin must keep its own data outside its directory, or it will need approval again.";

/** Where the directory path lives, worded for whether the server shares this device. */
export function pluginDirectoryLocation(
  environmentLabel: string,
  device: "this-device" | "other-device" | "unknown",
): string {
  const where =
    device === "this-device"
      ? `on ${environmentLabel}'s machine (this device)`
      : device === "other-device"
        ? `on ${environmentLabel}'s machine, not on this device`
        : `on ${environmentLabel}'s machine, which may not be this device`;
  return `An absolute path ${where}. Adding reads its manifest and files; nothing runs until you approve it.`;
}

export const PLUGIN_MANAGE_ACCESS_REQUIRED =
  "Managing plugins needs administrative access (access:write) to this environment. Pair with an administrative link to add, approve, enable, or remove plugins.";

export type PluginManageAccess = "granted" | "denied" | "pending";

/**
 * Management needs `access:write`. Any server with the plugin catalogue reports
 * its scopes, so a missing list means denied. A failed session read stays
 * optimistic: the server still refuses an unauthorized command.
 */
export function resolvePluginManageAccess(input: {
  readonly session: Pick<AuthSessionState, "authenticated" | "scopes"> | null;
  readonly isPending: boolean;
  readonly hasError: boolean;
}): PluginManageAccess {
  if (input.session === null) {
    if (input.isPending) return "pending";
    return input.hasError ? "granted" : "denied";
  }
  return input.session.authenticated && input.session.scopes?.includes(AuthAccessWriteScope)
    ? "granted"
    : "denied";
}

/** The server's own message for a failed plugin command. */
export function pluginCommandErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.trim().length > 0) return message;
  }
  return "The plugin command failed. Try again.";
}
