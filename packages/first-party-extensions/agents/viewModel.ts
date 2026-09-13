/**
 * Pure view-model for the Agents panel skeleton (AGENTS-SHELL). Owns the two
 * halves of the parity matrix that shipped contracts can serve today:
 *
 * - checked-in `t3.json` script derivation (rows 17/18 — the native settings
 *   script list has no public read contract, but the checked-in project file
 *   is readable through `t3.workspace/files` `readText`), and
 * - the script-run terminal plan over `t3.terminal/control` (row 18 —
 *   attach-or-spawn with a client-chosen id, busy sessions overflow to a
 *   numbered id, then a `command + "\r"` write exactly as the native
 *   `runProjectScript` does).
 *
 * Everything the native fleet view draws from the orchestration fold (roster,
 * status, metrics, workflows, actions, checkpoints) rides the unshipped
 * `t3.orchestration/*` family (P12-gated). Those sections render as named
 * deferred states — never as a loading spinner.
 */
import { projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";

/** One runnable entry parsed from the checked-in t3.json (`T3ProjectFileScript` shape). */
export interface WorkspaceScript {
  readonly name: string;
  readonly command: string;
  readonly icon: string | null;
  readonly runOnWorktreeCreate: boolean;
  readonly previewUrl: string | null;
}

export type ScriptSourceState =
  | { readonly kind: "ready"; readonly scripts: readonly WorkspaceScript[] }
  | { readonly kind: "empty" }
  | { readonly kind: "invalid"; readonly message: string };

/** `T3_PROJECT_FILE_MAX_SCRIPTS` — a longer scripts array fails the native decode too. */
export const T3_PROJECT_FILE_MAX_SCRIPTS = 50;
/** `ProjectScriptIcon` literals from `@t3tools/contracts` (kept package-local). */
const SCRIPT_ICONS = new Set(["play", "test", "lint", "configure", "build", "debug"]);

const trimmedNonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Parse the checked-in `t3.json` scripts array into runnable entries. The
 * native loader treats an unparseable or invalid file as absent; the panel
 * instead shows the invalid state by name (the settings UI does the same —
 * "t3.json is invalid").
 */
export function parseT3ProjectFile(contents: string): ScriptSourceState {
  let root: unknown;
  try {
    root = JSON.parse(contents);
  } catch {
    return { kind: "invalid", message: "t3.json is not valid JSON" };
  }
  if (root === null || typeof root !== "object" || Array.isArray(root))
    return { kind: "invalid", message: "t3.json must be a JSON object" };
  const scripts = (root as { readonly scripts?: unknown }).scripts;
  if (scripts === undefined) return { kind: "empty" };
  if (!Array.isArray(scripts))
    return { kind: "invalid", message: "t3.json scripts must be an array" };
  if (scripts.length > T3_PROJECT_FILE_MAX_SCRIPTS)
    return {
      kind: "invalid",
      message: `t3.json declares ${scripts.length} scripts (max ${T3_PROJECT_FILE_MAX_SCRIPTS})`,
    };
  const parsed: WorkspaceScript[] = [];
  for (const [index, entry] of scripts.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry))
      return { kind: "invalid", message: `t3.json script #${index + 1} must be an object` };
    const record = entry as Record<string, unknown>;
    if (!trimmedNonEmpty(record.name))
      return { kind: "invalid", message: `t3.json script #${index + 1} needs a non-empty name` };
    if (!trimmedNonEmpty(record.command))
      return {
        kind: "invalid",
        message: `t3.json script "${record.name as string}" needs a non-empty command`,
      };
    if (
      record.icon !== undefined &&
      (typeof record.icon !== "string" || !SCRIPT_ICONS.has(record.icon))
    )
      return {
        kind: "invalid",
        message: `t3.json script "${record.name}" has an unknown icon "${String(record.icon)}"`,
      };
    if (record.runOnWorktreeCreate !== undefined && typeof record.runOnWorktreeCreate !== "boolean")
      return {
        kind: "invalid",
        message: `t3.json script "${record.name}" runOnWorktreeCreate must be a boolean`,
      };
    if (record.previewUrl !== undefined && !trimmedNonEmpty(record.previewUrl))
      return {
        kind: "invalid",
        message: `t3.json script "${record.name}" previewUrl must be a non-empty string`,
      };
    parsed.push({
      name: record.name.trim(),
      command: record.command.trim(),
      icon: (record.icon as string | undefined) ?? null,
      runOnWorktreeCreate: record.runOnWorktreeCreate === true,
      previewUrl: (record.previewUrl as string | undefined)?.trim() || null,
    });
  }
  return parsed.length === 0 ? { kind: "empty" } : { kind: "ready", scripts: parsed };
}

/**
 * The launch identity the extension view context carries: the host's
 * `extensionWorkspaceRevision` payload, JSON `[workspaceRoot, worktreePath|null]`.
 * Same parse the terminal package runs on the same field.
 */
export interface ScriptWorkspace {
  /** The cwd a launched terminal must claim — worktree when the thread has one. */
  readonly cwd: string;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
}

export function workspaceFromRevision(
  workspaceRevision: string | undefined,
): ScriptWorkspace | null {
  if (workspaceRevision === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(workspaceRevision);
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== "string" ||
      parsed[0].trim().length === 0 ||
      (parsed[1] !== null && (typeof parsed[1] !== "string" || parsed[1].trim().length === 0))
    )
      return null;
    const workspaceRoot = parsed[0];
    const worktreePath = parsed[1];
    return { cwd: worktreePath ?? workspaceRoot, workspaceRoot, worktreePath };
  } catch {
    return null;
  }
}

/** Runtime env for the spawned terminal — the same helper native runProjectScript uses. */
export function scriptRuntimeEnv(workspace: ScriptWorkspace): Record<string, string> {
  return projectScriptRuntimeEnv({
    project: { cwd: workspace.workspaceRoot },
    worktreePath: workspace.worktreePath,
  });
}

/** New-terminal bounds mirror the native script-run spawn (ChatView SCRIPT_TERMINAL_*). */
export const SCRIPT_TERMINAL_COLS = 120;
export const SCRIPT_TERMINAL_ROWS = 30;

/**
 * Terminal id slug for a script name. Same normalization as the native
 * script-id rule (trim, lowercase, non-alphanumerics collapse to dashes, edge
 * dashes trimmed), bounded so `t3-agents-<slug>-NN` always fits the 128-char
 * terminal id limit.
 */
const SCRIPT_SLUG_MAX = 24;
export function scriptSlug(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) return "script";
  if (cleaned.length <= SCRIPT_SLUG_MAX) return cleaned;
  return cleaned.slice(0, SCRIPT_SLUG_MAX).replace(/-+$/g, "") || "script";
}

export const SCRIPT_TERMINAL_PREFIX = "t3-agents-";
export function scriptTerminalBaseId(script: Pick<WorkspaceScript, "name">): string {
  return `${SCRIPT_TERMINAL_PREFIX}${scriptSlug(script.name)}`;
}

/**
 * Overflow allocation: the dedicated per-script terminal is tried first; when
 * it reports a running subprocess the next free `<base>-N` id is used — the
 * client-chosen-id rule (the server never allocates terminal ids).
 */
export function nextScriptTerminalId(baseId: string, taken: ReadonlySet<string>): string {
  if (!taken.has(baseId)) return baseId;
  let index = 2;
  while (taken.has(`${baseId}-${index}`)) index += 1;
  return `${baseId}-${index}`;
}

/** The busy half of the native allocation rule: a running subprocess means "allocate new". */
export function terminalBusy(
  metadata: { readonly hasRunningSubprocess?: boolean } | null | undefined,
): boolean {
  return metadata?.hasRunningSubprocess === true;
}

/** Native writes `${command}\r` to run a project script (ChatView runProjectScript). */
export function scriptWriteData(command: string): string {
  return `${command}\r`;
}

/** Script-run state machine for the panel's run rows. */
export type ScriptRunStage = "attach" | "respawn" | "write";
export type ScriptRun =
  | {
      readonly kind: "running";
      readonly stage: ScriptRunStage;
      readonly terminalId: string;
    }
  | { readonly kind: "sent"; readonly terminalId: string; readonly status: string }
  | {
      readonly kind: "failed";
      readonly stage: ScriptRunStage;
      readonly terminalId: string | null;
      readonly message: string;
    };

export function describeScriptRun(run: ScriptRun): string {
  switch (run.kind) {
    case "running":
      return run.stage === "write"
        ? `Sending command to ${run.terminalId}…`
        : run.stage === "respawn"
          ? `Dedicated terminal busy — opening ${run.terminalId}…`
          : `Opening terminal ${run.terminalId}…`;
    case "sent":
      return `Sent to ${run.terminalId} (session ${run.status}) — output appears in the terminal surface`;
    case "failed":
      return `Run failed while ${
        run.stage === "write"
          ? "writing the command"
          : run.stage === "respawn"
            ? "opening an overflow terminal"
            : "opening the terminal"
      }${run.terminalId ? ` (${run.terminalId})` : ""}: ${run.message}`;
  }
}

export interface DeferredSection {
  readonly title: string;
  readonly blocker: string;
  readonly rows: string;
}

/**
 * Every parity row the panel names but cannot serve. Rendered as static text —
 * a deferred section is a statement about a missing contract, not a promise of
 * data in flight.
 */
export const DEFERRED_SECTIONS: readonly DeferredSection[] = [
  {
    title: "Agent roster, status, and per-agent metrics",
    blocker: "t3.orchestration/* status/subscribe is not a shipped contract (P12-gated)",
    rows: "2–5, 14, 19",
  },
  {
    title: "Start, cancel, approvals, settle",
    blocker: "t3.orchestration/* write commands are P12-gated",
    rows: "6–8, 12",
  },
  {
    title: "Checkpoints and turn diffs",
    blocker: "P12 checkpoint boundary",
    rows: "9–11",
  },
  {
    title: "Workflow launch",
    blocker: "no native binding exists to extract — net-new design, not fakeable",
    rows: "15",
  },
  {
    title: "Workflow script view",
    blocker: "native RPC exists but is outside the shipped contract surface (NEW-NARROW)",
    rows: "16",
  },
  {
    title: "Agent logs, session deep links, session scan",
    blocker: "no native web/desktop binding exists — net-new design",
    rows: "20–22",
  },
];

/** Why the scripts list covers only the checked-in file (row 17's deferred half). */
export const SCRIPTS_SCOPE_NOTE =
  "Checked-in t3.json scripts only. Project scripts stored in settings (machine defaults and per-project overrides) are not readable through public contracts yet.";

/** Row 13's host half, stated where a user would look for it. */
export const HOST_CHROME_NOTE =
  "The chat badge and spawn CTA rows are host chat UI a plugin cannot install; this surface is the plugin-owned half of Agents navigation.";

/** The roster area's headline — the panel's primary content is the deferred fleet view. */
export const ROSTER_UNAVAILABLE_NOTICE =
  "Agent roster unavailable — the fleet view reads t3.orchestration/* status/subscribe, which is not a shipped contract (P12-gated).";
