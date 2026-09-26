import { defineApi } from "./capabilities.js";

/**
 * Agent CLI sessions (Claude, Codex) that ran in the caller's project and can
 * be imported as T3 threads. Scope is the view context's project only: the
 * host re-discovers the session inside that project's root on every import,
 * and transcript paths, message text and resume cursors never leave the host.
 */
export const AGENT_SESSIONS_API = "t3.agents/sessions";
/** Read grant: list importable sessions of the granted project. */
export const AGENT_SESSIONS_SCAN = "t3.agents/scan-sessions";
/** Mutation grant: create a thread from one listed session. Import also requires the scan grant. */
export const AGENT_SESSIONS_IMPORT = "t3.agents/import-sessions";
export const AGENT_SESSIONS_SCAN_CAP = 50;
export const AGENT_SESSION_TITLE_MAX_LENGTH = 200;

export type AgentSessionKey = {
  readonly providerInstanceId: string;
  readonly providerSessionId: string;
};
export type AgentSessionSummary = AgentSessionKey & {
  readonly source: "claudeAgent" | "codex";
  readonly title: string;
  readonly lastActiveAt: string;
  /** `imported` sessions already have a thread; `threadId` names it. */
  readonly status: "importable" | "imported";
  readonly threadId: string | null;
};
export type AgentSessionsScanResult = {
  readonly scope: "project";
  /** Newest first, at most `AGENT_SESSIONS_SCAN_CAP`. */
  readonly sessions: readonly AgentSessionSummary[];
  /** More listable sessions existed than were returned. */
  readonly truncated: boolean;
  /** Transcripts the host could not list (unreadable, over its read budget, or unsupported ids). */
  readonly skipped: number;
  readonly scannedAt: string;
};
export type AgentSessionImportError =
  | "AgentSessionOutOfScope"
  | "AgentSessionAlreadyImported"
  | "AgentSessionProjectConflict"
  | "AgentSessionImportRejected";
/**
 * Import receipt. `sequence` is the orchestration event sequence of the
 * import, present once the thread and its history are persisted.
 * `AgentSessionAlreadyImported` carries the existing `threadId`, so a retry
 * after a lost response is safe.
 */
export type AgentSessionImportReceipt =
  | {
      readonly status: "imported";
      readonly threadId: string;
      readonly sequence: number;
      readonly messageCount: number;
      readonly error: null;
    }
  | {
      readonly status: "rejected";
      readonly threadId: string | null;
      readonly sequence: null;
      readonly messageCount: 0;
      readonly error: AgentSessionImportError;
    };

const providerInstanceIdSchema = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  pattern: "^[a-zA-Z][a-zA-Z0-9_-]*$",
} as const;
const providerSessionIdSchema = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
} as const;
const threadIdSchema = { type: ["string", "null"], maxLength: 256 } as const;

export const agentSessionsApi = defineApi<{
  scan: { input: Record<string, never>; output: AgentSessionsScanResult };
  import: { input: AgentSessionKey; output: AgentSessionImportReceipt };
}>({
  id: AGENT_SESSIONS_API,
  version: "1.0.0",
  methods: [
    {
      name: "scan",
      effect: "read",
      requiredGrants: [AGENT_SESSIONS_SCAN],
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["scope", "sessions", "truncated", "skipped", "scannedAt"],
        properties: {
          scope: { const: "project" },
          truncated: { type: "boolean" },
          skipped: { type: "integer", minimum: 0 },
          scannedAt: { type: "string", minLength: 1, maxLength: 40 },
          sessions: {
            type: "array",
            maxItems: AGENT_SESSIONS_SCAN_CAP,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "providerInstanceId",
                "providerSessionId",
                "source",
                "title",
                "lastActiveAt",
                "status",
                "threadId",
              ],
              properties: {
                providerInstanceId: providerInstanceIdSchema,
                providerSessionId: providerSessionIdSchema,
                source: { enum: ["claudeAgent", "codex"] },
                title: { type: "string", minLength: 1, maxLength: AGENT_SESSION_TITLE_MAX_LENGTH },
                lastActiveAt: { type: "string", minLength: 1, maxLength: 40 },
                status: { enum: ["importable", "imported"] },
                threadId: threadIdSchema,
              },
            },
          },
        },
      },
    },
    {
      name: "import",
      effect: "write",
      requiredGrants: [AGENT_SESSIONS_SCAN, AGENT_SESSIONS_IMPORT],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["providerInstanceId", "providerSessionId"],
        properties: {
          providerInstanceId: providerInstanceIdSchema,
          providerSessionId: providerSessionIdSchema,
        },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["status", "threadId", "sequence", "messageCount", "error"],
        properties: {
          status: { enum: ["imported", "rejected"] },
          threadId: threadIdSchema,
          sequence: { type: ["integer", "null"], minimum: 0 },
          messageCount: { type: "integer", minimum: 0 },
          error: {
            enum: [
              null,
              "AgentSessionOutOfScope",
              "AgentSessionAlreadyImported",
              "AgentSessionProjectConflict",
              "AgentSessionImportRejected",
            ],
          },
        },
      },
    },
  ],
});
