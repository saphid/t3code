import { defineOrchestrationStatusApi, orchestrationControlApi } from "./orchestration.js";
export * from "./orchestration.js";
import {
  defineApi,
  defineStreamApi,
  type ApiDefinition,
  type TypedApi,
  type TypedStreamApi,
} from "./capabilities.js";
import type { JsonObject } from "./environment.js";
import type { WorkspaceReadTextInput, WorkspaceReadTextResult } from "./workspace.js";
import { textEditsApi, textEditsApiV1 } from "./textEdits.js";

export {
  EDITABLE_TEXT_MAX_BYTES,
  REVISION_HEX_LENGTH,
  WORKSPACE_READ_TEXT_EDITS,
  WORKSPACE_READ_TEXT_GRANT,
  WORKSPACE_WRITE_TEXT,
  textEditsApi,
  textEditsApiV1,
  isTextRevision,
  validateReadSnapshotInput,
  validateReadSnapshotResult,
  validateSaveInput,
  validateSaveResult,
} from "./textEdits.js";
export type {
  EditableSnapshot,
  EditableRelativePath,
  NotEditableSnapshot,
  ReadSnapshotInput,
  ReadSnapshotResult,
  SaveInput,
  SaveResult,
  SavedResult,
  ConflictResult,
  TextRevision,
} from "./textEdits.js";

/** Read-only environment loopback suggestions, not an engine or arbitrary URL probe. */
export const BROWSER_LOCAL_SERVERS = "t3.browser/local-servers";
export const BROWSER_READ_LOCAL_SERVERS = "t3.browser/read-local-servers";
export type BrowserLocalServersSnapshot = {
  readonly kind: "snapshot";
  readonly scope: "environment";
  readonly servers: readonly { readonly url: string; readonly port: number }[];
  readonly truncated: boolean;
};
export type BrowserLocalServersEvent =
  | BrowserLocalServersSnapshot
  | { readonly kind: "closed"; readonly reason: "source-unavailable" };
export const browserLocalServersApi = defineStreamApi<{
  subscribe: { input: Record<string, never>; event: BrowserLocalServersEvent };
}>({
  id: BROWSER_LOCAL_SERVERS,
  version: "1.0.0",
  methods: [],
  streams: [
    {
      name: "subscribe",
      requiredGrants: [BROWSER_READ_LOCAL_SERVERS],
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      eventSchema: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "scope", "servers", "truncated"],
            properties: {
              kind: { const: "snapshot" },
              scope: { const: "environment" },
              truncated: { type: "boolean" },
              servers: {
                type: "array",
                maxItems: 64,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["url", "port"],
                  properties: {
                    url: { type: "string", minLength: 1, maxLength: 256 },
                    port: { type: "integer", minimum: 1, maximum: 65535 },
                  },
                },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "reason"],
            properties: { kind: { const: "closed" }, reason: { const: "source-unavailable" } },
          },
        ],
      },
    },
  ],
});

export const WORKSPACE_FILES = "t3.workspace/files";
export const WORKSPACE_LIST_ENTRIES = "t3.workspace/list-entries";
export const FILE_PRESENTATION = "t3.file/presentation";
export const FILE_PRESENTATION_OPEN = "t3.file/open";
export const TERMINAL_SESSIONS = "t3.terminal/sessions";
export const TERMINAL_READ = "t3.terminal/read";
export const TERMINAL_OUTPUT = "t3.terminal/output";
export const TERMINAL_READ_OUTPUT = "t3.terminal/read-output";
export const TERMINAL_OUTPUT_EVENTS = "t3.terminal/output-events";
export const TERMINAL_CONTROL = "t3.terminal/control";
/**
 * Distinct write grant for terminal lifecycle/input. Spawn/write authority
 * never rides the read grants (`t3.terminal/read`, `t3.terminal/read-output`).
 */
export const TERMINAL_OPERATE = "t3.terminal/operate";
export const WORKSPACE_SEARCH = "t3.workspace/search";
export type WorkspaceSearchInput = {
  readonly query: string;
  readonly limit?: number;
  readonly kind?: "file" | "directory";
  readonly imageOnly?: boolean;
};
export type WorkspaceSearchResultEntry = {
  readonly path: string;
  readonly kind: "file" | "directory";
};
export type WorkspaceSearchResult = {
  readonly entries: readonly WorkspaceSearchResultEntry[];
  readonly truncated: boolean;
};
export type WorkspaceSearchContentsInput = {
  readonly query: string;
  readonly limit?: number;
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
  readonly useRegex?: boolean;
};
export type WorkspaceContentMatchRange = { readonly start: number; readonly end: number };
export type WorkspaceContentMatch = {
  readonly path: string;
  readonly lineNumber: number;
  readonly lineContent: string;
  readonly matchRanges: readonly WorkspaceContentMatchRange[];
};
export type WorkspaceSearchContentsResult = {
  readonly matches: readonly WorkspaceContentMatch[];
  readonly truncated: boolean;
  readonly regexFallbackError?: string;
};
export type WorkspaceListEntriesInput = {
  readonly relativePath: string;
  readonly cursor?: string;
  readonly limit?: number;
};
export type WorkspaceEntry = {
  readonly name: string;
  readonly relativePath: string;
  readonly kind: "file" | "directory";
};
export type WorkspaceListEntriesResult = {
  readonly entries: readonly WorkspaceEntry[];
  readonly nextCursor: string | null;
};
export type FilePresentationInput = { readonly relativePath: string };
export type FilePresentationResult = {
  readonly surfaceId: string;
  readonly placement: "side-panel" | "bottom-dock" | "full-page" | "compact-detail";
  readonly restoreState: JsonObject;
};
export type TerminalSessionsInput = { readonly terminalId: string };
export type TerminalOutputInput = { readonly terminalId: string };
export type TerminalOutputResult = {
  readonly terminalId: string;
  readonly contents: string;
  readonly retainedByteLength: number;
  readonly truncated: boolean;
} | null;
export type TerminalOutputEventsInput = { readonly terminalId: string };
export type TerminalOutputEventsSnapshot = {
  readonly kind: "snapshot";
  readonly terminalId: string;
  readonly streamEpoch: string;
  readonly status: "starting" | "running" | "exited" | "error";
  readonly contents: string;
  readonly retainedByteLength: number;
  readonly truncated: boolean;
  readonly boundarySequence: number;
};
export type TerminalOutputEventsOutput = {
  readonly kind: "output";
  readonly terminalId: string;
  readonly streamEpoch: string;
  readonly sequence: number;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly data: string;
};
export type TerminalOutputEventsReset = {
  readonly kind: "reset";
  readonly terminalId: string;
  readonly streamEpoch: string;
  readonly sequence: number;
  readonly reason: "history-cleared";
};
export type TerminalOutputEventsExit = {
  readonly kind: "exit";
  readonly terminalId: string;
  readonly streamEpoch: string;
  readonly sequence: number;
  readonly exitCode: number | null;
  readonly exitSignal: number | null;
};
export type TerminalOutputEventsClosed = {
  readonly kind: "closed";
  readonly terminalId: string;
  readonly streamEpoch: string;
  readonly reason: "terminal-closed" | "identity-changed" | "overflow" | "terminal-error";
};
export type TerminalOutputEventsValue =
  | TerminalOutputEventsSnapshot
  | TerminalOutputEventsOutput
  | TerminalOutputEventsReset
  | TerminalOutputEventsExit
  | TerminalOutputEventsClosed;
export type TerminalSessionResult = {
  readonly terminalId: string;
  readonly status: "starting" | "running" | "exited" | "error";
  readonly label: string;
  readonly hasRunningSubprocess: boolean;
  readonly exitCode: number | null;
  readonly exitSignal: number | null;
  readonly updatedAt: string;
} | null;
/** The non-null session metadata projection shared by inspect, list and control results. */
export type TerminalSessionMetadata = NonNullable<TerminalSessionResult>;
export type TerminalSessionsListInput = Record<string, never>;
export type TerminalSessionsListEvent =
  | {
      readonly kind: "snapshot";
      readonly terminals: readonly TerminalSessionMetadata[];
    }
  | { readonly kind: "upsert"; readonly terminal: TerminalSessionMetadata }
  | { readonly kind: "remove"; readonly terminalId: string }
  | { readonly kind: "closed"; readonly reason: "overflow" | "terminal-error" };
export type TerminalControlOpenInput = {
  readonly terminalId: string;
  readonly cwd: string;
  readonly worktreePath?: string | null;
  readonly cols?: number;
  readonly rows?: number;
  readonly env?: { readonly [key: string]: string };
  readonly providerInstanceId?: string;
};
export type TerminalControlAttachInput = {
  readonly terminalId: string;
  readonly cwd?: string;
  readonly worktreePath?: string | null;
  readonly cols?: number;
  readonly rows?: number;
  readonly env?: { readonly [key: string]: string };
  readonly providerInstanceId?: string;
  readonly restartIfNotRunning?: boolean;
};
export type TerminalControlWriteInput = {
  readonly terminalId: string;
  readonly data: string;
};
export type TerminalControlResizeInput = {
  readonly terminalId: string;
  readonly cols: number;
  readonly rows: number;
};
export type TerminalControlClearInput = { readonly terminalId: string };
export type TerminalControlRestartInput = {
  readonly terminalId: string;
  readonly cwd: string;
  readonly worktreePath?: string | null;
  readonly cols: number;
  readonly rows: number;
  readonly env?: { readonly [key: string]: string };
  readonly providerInstanceId?: string;
};
export type TerminalControlCloseInput = {
  readonly terminalId?: string;
  readonly deleteHistory?: boolean;
};
export type TerminalControlAck = Record<string, never>;
const path = { type: "string", maxLength: 512 };
export const workspaceFilesApi = defineApi<{
  listEntries: { input: WorkspaceListEntriesInput; output: WorkspaceListEntriesResult };
  readText: { input: WorkspaceReadTextInput; output: WorkspaceReadTextResult };
}>({
  id: WORKSPACE_FILES,
  version: "1.0.0",
  methods: [
    {
      name: "listEntries",
      effect: "read",
      requiredGrants: [WORKSPACE_LIST_ENTRIES],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["relativePath"],
        properties: {
          relativePath: path,
          cursor: { type: "string", maxLength: 2048 },
          limit: { type: "integer", minimum: 1, maximum: 200 },
        },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["entries", "nextCursor"],
        properties: {
          entries: {
            type: "array",
            maxItems: 200,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "relativePath", "kind"],
              properties: {
                name: { type: "string", minLength: 1, maxLength: 512 },
                relativePath: path,
                kind: { enum: ["file", "directory"] },
              },
            },
          },
          nextCursor: { type: ["string", "null"], maxLength: 2048 },
        },
      },
    },
    {
      name: "readText",
      effect: "read",
      requiredGrants: ["t3.workspace/read-text"],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["relativePath"],
        properties: { relativePath: path },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["relativePath", "contents", "byteLength", "truncated"],
        properties: {
          relativePath: path,
          contents: { type: "string", maxLength: 48000 },
          byteLength: { type: "integer", minimum: 0 },
          truncated: { type: "boolean" },
        },
      },
    },
  ],
});
export const filePresentationApi = defineApi<{
  open: { input: FilePresentationInput; output: FilePresentationResult };
}>({
  id: FILE_PRESENTATION,
  version: "1.0.0",
  methods: [
    {
      name: "open",
      effect: "read",
      requiredGrants: [FILE_PRESENTATION_OPEN],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["relativePath"],
        properties: { relativePath: path },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["surfaceId", "placement", "restoreState"],
        properties: {
          surfaceId: { type: "string", minLength: 1, maxLength: 160 },
          placement: { enum: ["side-panel", "bottom-dock", "full-page", "compact-detail"] },
          restoreState: { type: "object" },
        },
      },
    },
  ],
});
const terminalSessionMetadataSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "terminalId",
    "status",
    "label",
    "hasRunningSubprocess",
    "exitCode",
    "exitSignal",
    "updatedAt",
  ],
  properties: {
    terminalId: { type: "string", minLength: 1, maxLength: 128 },
    status: { enum: ["starting", "running", "exited", "error"] },
    label: { type: "string", maxLength: 128 },
    hasRunningSubprocess: { type: "boolean" },
    exitCode: { type: ["integer", "null"] },
    exitSignal: { type: ["integer", "null"] },
    updatedAt: { type: "string", maxLength: 64 },
  },
} as const;
const terminalSessionsInspectMethod = {
  name: "inspect",
  effect: "read",
  requiredGrants: [TERMINAL_READ],
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["terminalId"],
    properties: { terminalId: { type: "string", minLength: 1, maxLength: 128 } },
  },
  outputSchema: {
    ...terminalSessionMetadataSchema,
    type: ["object", "null"],
  },
} as const;
/**
 * Thread-scoped live session list: a full snapshot followed by upsert/remove
 * rows, folded from the native metadata stream. `closed` is the honest
 * teardown signal; there is no resume cursor.
 */
const terminalSessionsListEventSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "terminals"],
      properties: {
        kind: { const: "snapshot" },
        terminals: { type: "array", maxItems: 128, items: terminalSessionMetadataSchema },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "terminal"],
      properties: {
        kind: { const: "upsert" },
        terminal: terminalSessionMetadataSchema,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "terminalId"],
      properties: {
        kind: { const: "remove" },
        terminalId: { type: "string", minLength: 1, maxLength: 128 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "reason"],
      properties: {
        kind: { const: "closed" },
        reason: { enum: ["overflow", "terminal-error"] },
      },
    },
  ],
} as const;
/**
 * Sessions metadata, newest version first. 1.1.0 adds the `list` stream;
 * `inspect` is byte-identical to 1.0.0, which stays frozen below so consumers
 * and providers built against it keep canonical equality.
 */
export const terminalSessionsApi: TypedApi<{
  inspect: { input: TerminalSessionsInput; output: TerminalSessionResult };
}> &
  TypedStreamApi<{
    list: { input: TerminalSessionsListInput; event: TerminalSessionsListEvent };
  }> = defineStreamApi<{
  list: { input: TerminalSessionsListInput; event: TerminalSessionsListEvent };
}>({
  id: TERMINAL_SESSIONS,
  version: "1.1.0",
  methods: [terminalSessionsInspectMethod],
  streams: [
    {
      name: "list",
      requiredGrants: [TERMINAL_READ],
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      eventSchema: terminalSessionsListEventSchema,
    },
  ],
});
/** Frozen published 1.0.0 definition; shared definitions are immutable per version. */
export const terminalSessionsApiV1 = defineApi<{
  inspect: { input: TerminalSessionsInput; output: TerminalSessionResult };
}>({
  id: TERMINAL_SESSIONS,
  version: "1.0.0",
  methods: [terminalSessionsInspectMethod],
});

/** Bounds mirror the native RPC payloads in @t3tools/contracts terminal.ts. */
const terminalIdInput = { type: "string", minLength: 1, maxLength: 128 } as const;
const terminalColsInput = { type: "integer", minimum: 1, maximum: 1000 } as const;
const terminalRowsInput = { type: "integer", minimum: 1, maximum: 500 } as const;
const terminalCwdInput = { type: "string", minLength: 1, maxLength: 32768 } as const;
const terminalWorktreePathInput = {
  type: ["string", "null"],
  minLength: 1,
  maxLength: 32768,
} as const;
const terminalEnvInput = {
  type: "object",
  maxProperties: 128,
  propertyNames: { pattern: "^[A-Za-z_][A-Za-z0-9_]*$", maxLength: 128 },
  additionalProperties: { type: "string", maxLength: 8192 },
} as const;
const terminalProviderInstanceInput = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  pattern: "^[a-zA-Z][a-zA-Z0-9_-]*$",
} as const;
const terminalSessionOutputSchema = terminalSessionMetadataSchema;
const terminalAckOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;
const terminalLaunchOptionals = {
  worktreePath: terminalWorktreePathInput,
  cols: terminalColsInput,
  rows: terminalRowsInput,
  env: terminalEnvInput,
  providerInstanceId: terminalProviderInstanceInput,
} as const;

/**
 * Terminal lifecycle and input. Every method is a write under the distinct
 * `t3.terminal/operate` grant — spawn authority is never conveyed by the read
 * grants. `attach` is open-or-attach: it never spawns without `cwd`, and a
 * stopped session respawns only when `restartIfNotRunning` is set. Reading
 * output stays on `t3.terminal/output-events`, which cannot spawn.
 */
export const terminalControlApi = defineApi<{
  open: { input: TerminalControlOpenInput; output: TerminalSessionMetadata };
  attach: { input: TerminalControlAttachInput; output: TerminalSessionMetadata };
  write: { input: TerminalControlWriteInput; output: TerminalControlAck };
  resize: { input: TerminalControlResizeInput; output: TerminalControlAck };
  clear: { input: TerminalControlClearInput; output: TerminalControlAck };
  restart: { input: TerminalControlRestartInput; output: TerminalSessionMetadata };
  close: { input: TerminalControlCloseInput; output: TerminalControlAck };
}>({
  id: TERMINAL_CONTROL,
  version: "1.0.0",
  methods: [
    {
      name: "open",
      effect: "write",
      requiredGrants: [TERMINAL_OPERATE],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["terminalId", "cwd"],
        properties: {
          terminalId: terminalIdInput,
          cwd: terminalCwdInput,
          ...terminalLaunchOptionals,
        },
      },
      outputSchema: terminalSessionOutputSchema,
    },
    {
      name: "attach",
      effect: "write",
      requiredGrants: [TERMINAL_OPERATE],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["terminalId"],
        properties: {
          terminalId: terminalIdInput,
          cwd: terminalCwdInput,
          restartIfNotRunning: { type: "boolean" },
          ...terminalLaunchOptionals,
        },
      },
      outputSchema: terminalSessionOutputSchema,
    },
    {
      name: "write",
      effect: "write",
      requiredGrants: [TERMINAL_OPERATE],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["terminalId", "data"],
        properties: {
          terminalId: terminalIdInput,
          data: { type: "string", minLength: 1, maxLength: 65536 },
        },
      },
      outputSchema: terminalAckOutputSchema,
    },
    {
      name: "resize",
      effect: "write",
      requiredGrants: [TERMINAL_OPERATE],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["terminalId", "cols", "rows"],
        properties: {
          terminalId: terminalIdInput,
          cols: terminalColsInput,
          rows: terminalRowsInput,
        },
      },
      outputSchema: terminalAckOutputSchema,
    },
    {
      name: "clear",
      effect: "write",
      requiredGrants: [TERMINAL_OPERATE],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["terminalId"],
        properties: { terminalId: terminalIdInput },
      },
      outputSchema: terminalAckOutputSchema,
    },
    {
      name: "restart",
      effect: "write",
      requiredGrants: [TERMINAL_OPERATE],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["terminalId", "cwd", "cols", "rows"],
        properties: {
          terminalId: terminalIdInput,
          cwd: terminalCwdInput,
          ...terminalLaunchOptionals,
        },
      },
      outputSchema: terminalSessionOutputSchema,
    },
    {
      name: "close",
      effect: "write",
      requiredGrants: [TERMINAL_OPERATE],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          terminalId: terminalIdInput,
          deleteHistory: { type: "boolean" },
        },
      },
      outputSchema: terminalAckOutputSchema,
    },
  ],
});

export const terminalOutputApi = defineApi<{
  readSnapshot: { input: TerminalOutputInput; output: TerminalOutputResult };
}>({
  id: TERMINAL_OUTPUT,
  version: "1.0.0",
  methods: [
    {
      name: "readSnapshot",
      effect: "read",
      requiredGrants: [TERMINAL_READ_OUTPUT],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["terminalId"],
        properties: { terminalId: { type: "string", minLength: 1, maxLength: 128 } },
      },
      outputSchema: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["terminalId", "contents", "retainedByteLength", "truncated"],
        properties: {
          terminalId: { type: "string", minLength: 1, maxLength: 128 },
          contents: { type: "string", maxLength: 8192 },
          retainedByteLength: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          truncated: { type: "boolean" },
        },
      },
    },
  ],
});

const terminalOutputEventsValueSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: [
        "kind",
        "terminalId",
        "streamEpoch",
        "status",
        "contents",
        "retainedByteLength",
        "truncated",
        "boundarySequence",
      ],
      properties: {
        kind: { const: "snapshot" },
        terminalId: { type: "string", minLength: 1, maxLength: 128 },
        streamEpoch: { type: "string", minLength: 1, maxLength: 128 },
        status: { enum: ["starting", "running", "exited", "error"] },
        contents: { type: "string", maxLength: 8192 },
        retainedByteLength: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        truncated: { type: "boolean" },
        boundarySequence: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "kind",
        "terminalId",
        "streamEpoch",
        "sequence",
        "chunkIndex",
        "chunkCount",
        "data",
      ],
      properties: {
        kind: { const: "output" },
        terminalId: { type: "string", minLength: 1, maxLength: 128 },
        streamEpoch: { type: "string", minLength: 1, maxLength: 128 },
        sequence: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        chunkIndex: { type: "integer", minimum: 0, maximum: 63 },
        chunkCount: { type: "integer", minimum: 1, maximum: 64 },
        data: { type: "string", maxLength: 8192 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "terminalId", "streamEpoch", "sequence", "reason"],
      properties: {
        kind: { const: "reset" },
        terminalId: { type: "string", minLength: 1, maxLength: 128 },
        streamEpoch: { type: "string", minLength: 1, maxLength: 128 },
        sequence: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        reason: { const: "history-cleared" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "terminalId", "streamEpoch", "sequence", "exitCode", "exitSignal"],
      properties: {
        kind: { const: "exit" },
        terminalId: { type: "string", minLength: 1, maxLength: 128 },
        streamEpoch: { type: "string", minLength: 1, maxLength: 128 },
        sequence: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        exitCode: {
          type: ["integer", "null"],
          minimum: -Number.MAX_SAFE_INTEGER,
          maximum: Number.MAX_SAFE_INTEGER,
        },
        exitSignal: {
          type: ["integer", "null"],
          minimum: -Number.MAX_SAFE_INTEGER,
          maximum: Number.MAX_SAFE_INTEGER,
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "terminalId", "streamEpoch", "reason"],
      properties: {
        kind: { const: "closed" },
        terminalId: { type: "string", minLength: 1, maxLength: 128 },
        streamEpoch: { type: "string", minLength: 1, maxLength: 128 },
        reason: { enum: ["terminal-closed", "identity-changed", "overflow", "terminal-error"] },
      },
    },
  ],
} as const;

/** Stream-only additive contract; the existing unary output API is intentionally unchanged. */
export const terminalOutputEventsApi = defineStreamApi<{
  subscribe: { input: TerminalOutputEventsInput; event: TerminalOutputEventsValue };
}>({
  id: TERMINAL_OUTPUT_EVENTS,
  version: "1.0.0",
  methods: [],
  streams: [
    {
      name: "subscribe",
      requiredGrants: [TERMINAL_READ_OUTPUT],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["terminalId"],
        properties: { terminalId: { type: "string", minLength: 1, maxLength: 128 } },
      },
      eventSchema: terminalOutputEventsValueSchema,
    },
  ],
});

export type WorkspaceTreeEntry = { readonly path: string; readonly kind: "file" | "directory" };
export type WorkspaceTreeEvent =
  | {
      readonly kind: "chunk";
      readonly entries: readonly WorkspaceTreeEntry[];
      readonly truncated: boolean;
    }
  | { readonly kind: "complete"; readonly entryCount: number; readonly truncated: boolean };
/** A finite native-index snapshot. Publish only after complete; cancellation discards partial chunks. */
export const workspaceTreeApi = defineStreamApi<{
  snapshot: { input: Record<string, never>; event: WorkspaceTreeEvent };
}>({
  id: "t3.workspace/tree",
  version: "1.0.0",
  methods: [],
  streams: [
    {
      name: "snapshot",
      requiredGrants: [WORKSPACE_LIST_ENTRIES],
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      eventSchema: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "entries", "truncated"],
            properties: {
              kind: { const: "chunk" },
              truncated: { type: "boolean" },
              entries: {
                type: "array",
                maxItems: 200,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["path", "kind"],
                  properties: {
                    path: { type: "string", minLength: 1, maxLength: 32768 },
                    kind: { enum: ["file", "directory"] },
                  },
                },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "entryCount", "truncated"],
            properties: {
              kind: { const: "complete" },
              entryCount: { type: "integer", minimum: 0, maximum: 25000 },
              truncated: { type: "boolean" },
            },
          },
        ],
      },
    },
  ],
});

const searchEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["path", "kind"],
  properties: {
    path: { type: "string", minLength: 1, maxLength: 512 },
    kind: { enum: ["file", "directory"] },
  },
} as const;
/**
 * Bounded workspace search over the host's native index. Mirrors the bounds
 * of the private projectsSearchEntries/projectsSearchContents RPCs so a
 * plugin never has to pull the whole tree client-side to answer a query.
 */
export const workspaceSearchApi = defineApi<{
  search: { input: WorkspaceSearchInput; output: WorkspaceSearchResult };
  searchContents: { input: WorkspaceSearchContentsInput; output: WorkspaceSearchContentsResult };
}>({
  id: WORKSPACE_SEARCH,
  version: "1.0.0",
  methods: [
    {
      name: "search",
      effect: "read",
      requiredGrants: [WORKSPACE_SEARCH],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string", maxLength: 256 },
          limit: { type: "integer", minimum: 1, maximum: 200 },
          kind: { enum: ["file", "directory"] },
          imageOnly: { type: "boolean" },
        },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["entries", "truncated"],
        properties: {
          entries: { type: "array", maxItems: 200, items: searchEntrySchema },
          truncated: { type: "boolean" },
        },
      },
    },
    {
      name: "searchContents",
      effect: "read",
      requiredGrants: [WORKSPACE_SEARCH],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1, maxLength: 256 },
          limit: { type: "integer", minimum: 1, maximum: 500 },
          caseSensitive: { type: "boolean" },
          wholeWord: { type: "boolean" },
          useRegex: { type: "boolean" },
        },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["matches", "truncated"],
        properties: {
          matches: {
            type: "array",
            maxItems: 500,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["path", "lineNumber", "lineContent", "matchRanges"],
              properties: {
                path: { type: "string", minLength: 1, maxLength: 512 },
                lineNumber: { type: "integer", minimum: 1 },
                lineContent: { type: "string", maxLength: 8192 },
                matchRanges: {
                  type: "array",
                  maxItems: 512,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["start", "end"],
                    properties: {
                      start: { type: "integer", minimum: 0 },
                      end: { type: "integer", minimum: 0 },
                    },
                  },
                },
              },
            },
          },
          truncated: { type: "boolean" },
          regexFallbackError: { type: "string", maxLength: 512 },
        },
      },
    },
  ],
});

/* ------------------------------------------------------------------------
 * t3.vcs — backend-neutral source-control / diff contracts (P09).
 *
 * Grant split: `t3.vcs/read` covers every read method and the status stream;
 * `t3.vcs/mutate` is the DISTINCT mutation grant — stage/commit/branch/
 * worktree/pull/init never ride the read grant, and `effect:"write"` gives
 * the broker a second barrier on top of the grant check.
 *
 * Capability honesty: `t3.vcs/repository.getCapabilities` reports the
 * detected driver kind, the driver flag set, and per-operation support.
 * Unsupported operations fail with the named VcsUnsupportedOperationError
 * (mirrored as an ExtensionOperationError naming the operation + kind) —
 * never a silent no-op or a fabricated empty result.
 * --------------------------------------------------------------------- */
export const VCS_READ = "t3.vcs/read";
export const VCS_MUTATE = "t3.vcs/mutate";
export const VCS_STATUS = "t3.vcs/status";
export const VCS_REFS = "t3.vcs/refs";
export const VCS_CHANGES = "t3.vcs/changes";
export const VCS_DIFF = "t3.vcs/diff";
export const VCS_REPOSITORY = "t3.vcs/repository";

export type VcsDriverKindValue = "git" | "jj" | "unknown";
export type VcsSourceControlProvider = {
  readonly kind: "github" | "gitlab" | "azure-devops" | "bitbucket" | "unknown";
  readonly name: string;
  readonly baseUrl: string;
};
export type VcsStatusFile = {
  readonly path: string;
  readonly insertions: number;
  readonly deletions: number;
};
export type VcsStatusChangeRequest = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly state: "open" | "closed" | "merged";
  readonly isDraft?: boolean;
  readonly updatedAt?: string | null;
};
/** Local status half — mirrors VcsStatusLocalResult with a declared file cap. */
export type VcsStatusLocal = {
  readonly isRepo: boolean;
  readonly sourceControlProvider?: VcsSourceControlProvider;
  readonly hasPrimaryRemote: boolean;
  readonly isDefaultRef: boolean;
  readonly refName: string | null;
  readonly hasWorkingTreeChanges: boolean;
  readonly workingTree: {
    readonly files: readonly VcsStatusFile[];
    readonly insertions: number;
    readonly deletions: number;
    /** True when the host sliced the file list at the contract bound. */
    readonly truncated: boolean;
  };
};
/** Remote status half — mirrors VcsStatusRemoteResult. */
export type VcsStatusRemote = {
  readonly hasUpstream: boolean;
  readonly aheadCount: number;
  readonly behindCount: number;
  readonly aheadOfDefaultCount?: number;
  readonly pr: VcsStatusChangeRequest | null;
};
export type VcsStatusResult = VcsStatusLocal & VcsStatusRemote;
export type VcsStatusStreamEvent =
  | {
      readonly kind: "snapshot";
      readonly local: VcsStatusLocal;
      readonly remote: VcsStatusRemote | null;
    }
  | { readonly kind: "localUpdated"; readonly local: VcsStatusLocal }
  | { readonly kind: "remoteUpdated"; readonly remote: VcsStatusRemote | null }
  | { readonly kind: "closed"; readonly reason: "overflow" | "status-error" };
export type VcsListRefsInput = {
  readonly query?: string;
  readonly cursor?: number;
  readonly includeMatchingRemoteRefs?: boolean;
  readonly refKind?: "all" | "local" | "remote";
  readonly refresh?: boolean;
  readonly limit?: number;
};
export type VcsRefEntry = {
  readonly name: string;
  readonly isRemote?: boolean;
  readonly remoteName?: string;
  readonly current: boolean;
  readonly isDefault: boolean;
  readonly worktreePath: string | null;
};
export type VcsListRefsResult = {
  readonly refs: readonly VcsRefEntry[];
  readonly isRepo: boolean;
  readonly hasPrimaryRemote: boolean;
  readonly nextCursor: number | null;
  readonly totalCount: number;
};
export type VcsRefNameInput = { readonly refName: string };
export type VcsCreateRefInput = { readonly refName: string; readonly switchRef?: boolean };
export type VcsRefNameResult = { readonly refName: string };
export type VcsSwitchRefResult = { readonly refName: string | null };
/**
 * Per-path index state the private status payload drops — porcelain XY is
 * parsed for paths only upstream (GitVcsDriverCore), so a staging lane cannot
 * be rendered from `status`. This is the narrow net-new read surface.
 */
export type VcsChangeEntry = {
  readonly path: string;
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly untracked: boolean;
  readonly conflicted: boolean;
};
export type VcsChangesListResult = {
  readonly isRepo: boolean;
  readonly entries: readonly VcsChangeEntry[];
  readonly truncated: boolean;
};
export type VcsPathsInput = { readonly paths: readonly string[] };
export type VcsPathsResult = { readonly paths: readonly string[] };
export type VcsCommitInput = {
  readonly message: string;
  readonly paths?: readonly string[];
};
export type VcsCommitResult = {
  readonly commitSha: string;
  readonly refName: string | null;
};
export type VcsDiffPreviewInput = {
  readonly baseRef?: string;
  readonly ignoreWhitespace?: boolean;
};
export type VcsDiffPreviewSource = {
  readonly id: string;
  readonly kind: "working-tree" | "branch-range";
  readonly title: string;
  readonly baseRef: string | null;
  readonly headRef: string | null;
  readonly diff: string;
  readonly diffHash: string;
  readonly truncated: boolean;
};
export type VcsDiffPreviewResult = {
  readonly generatedAt: string;
  readonly sources: readonly VcsDiffPreviewSource[];
};
export type VcsDiffFileContentsInput = {
  readonly sourceKind: "working-tree" | "branch-range";
  readonly changeType: "change" | "rename-pure" | "rename-changed" | "new" | "deleted";
  readonly baseRef: string | null;
  readonly headRef: string | null;
  readonly oldPath: string;
  readonly newPath: string;
};
export type VcsDiffFileContentsResult = {
  readonly oldContents: string;
  readonly newContents: string;
};
/**
 * Per-source descriptor announced in the `streamPreview` manifest frame —
 * the unary `VcsDiffPreviewSource` fields minus the (chunked) `diff` body.
 * `diffHash` is sha256 over the delivered body, same recompute as invoke;
 * `chunkCount` chunk frames carry that body in `chunkIndex` order.
 */
export type VcsDiffStreamSource = {
  readonly id: string;
  readonly kind: "working-tree" | "branch-range";
  readonly title: string;
  readonly baseRef: string | null;
  readonly headRef: string | null;
  readonly truncated: boolean;
  readonly diffHash: string;
  readonly diffByteLength: number;
  readonly chunkCount: number;
};
/**
 * `streamPreview` frames: one `manifest` snapshot, then `chunk` data frames
 * per source, then a `complete` data frame. `payloadSha256` is the sha256
 * over the concatenated UTF-8 bytes of every delivered `diff` body in
 * manifest order — consumers reassemble per source and verify end-to-end.
 */
export type VcsDiffPreviewStreamEvent =
  | {
      readonly kind: "manifest";
      readonly generatedAt: string;
      readonly sources: readonly VcsDiffStreamSource[];
    }
  | {
      readonly kind: "chunk";
      readonly sourceIndex: number;
      readonly chunkIndex: number;
      readonly data: string;
    }
  | { readonly kind: "complete"; readonly payloadSha256: string };
/**
 * `streamFileContents` frames: one `manifest` snapshot announcing per-side
 * byte/chunk counts, then `chunk` data frames tagged by side, then a
 * `complete` data frame with each side's sha256 over its delivered contents.
 */
export type VcsDiffFileContentsStreamEvent =
  | {
      readonly kind: "manifest";
      readonly oldByteLength: number;
      readonly oldChunkCount: number;
      readonly newByteLength: number;
      readonly newChunkCount: number;
    }
  | {
      readonly kind: "chunk";
      readonly side: "old" | "new";
      readonly chunkIndex: number;
      readonly data: string;
    }
  | { readonly kind: "complete"; readonly oldSha256: string; readonly newSha256: string };
/** Per-operation support flags keyed by `api.method`. */
export type VcsOperationsSupport = {
  readonly "status.get": boolean;
  readonly "status.refresh": boolean;
  readonly "status.subscribe": boolean;
  readonly "refs.list": boolean;
  readonly "refs.create": boolean;
  readonly "refs.switch": boolean;
  readonly "changes.list": boolean;
  readonly "changes.stage": boolean;
  readonly "changes.unstage": boolean;
  readonly "changes.commit": boolean;
  readonly "diff.getPreview": boolean;
  readonly "diff.getFileContents": boolean;
  readonly "repository.pull": boolean;
  readonly "repository.init": boolean;
  readonly "repository.createWorktree": boolean;
  readonly "repository.removeWorktree": boolean;
  readonly "repository.push": boolean;
  readonly "repository.fetch": boolean;
  readonly "repository.listRemotes": boolean;
};
/** The operations map a frozen 1.0.0 host reports — the 16 shipped keys only. */
export type VcsOperationsSupportV1 = Omit<
  VcsOperationsSupport,
  "repository.push" | "repository.fetch" | "repository.listRemotes"
>;
export type VcsDriverCapabilitiesInfo = {
  readonly kind: VcsDriverKindValue;
  readonly supportsWorktrees: boolean;
  readonly supportsBookmarks: boolean;
  readonly supportsAtomicSnapshot: boolean;
  readonly supportsPushDefaultRemote: boolean;
  readonly ignoreClassifier: "native" | "git-compatible-fallback";
};
export type VcsCapabilitiesResult = {
  readonly detected: boolean;
  readonly kind: VcsDriverKindValue | null;
  /** Detection failure detail when a repository could not be resolved. */
  readonly detail: string | null;
  readonly driver: VcsDriverCapabilitiesInfo | null;
  readonly operations: VcsOperationsSupport;
};
/** Frozen 1.0.0 getCapabilities output — narrower operations map only. */
export type VcsCapabilitiesResultV1 = Omit<VcsCapabilitiesResult, "operations"> & {
  readonly operations: VcsOperationsSupportV1;
};
export type VcsPullResult = {
  readonly status: "pulled" | "skipped_up_to_date";
  readonly refName: string;
  readonly upstreamRef: string | null;
};
/** Mirrors the driver's GitPushResult under the contract's ref naming. */
export type VcsPushResult = {
  readonly status: "pushed" | "skipped_up_to_date";
  readonly refName: string;
  readonly upstreamRef: string | null;
  readonly setUpstream: boolean;
};
/** Fetch remote-tracking refs for one remote or, when omitted, every remote. */
export type VcsFetchInput = { readonly remoteName?: string };
export type VcsFetchResult = { readonly remotes: readonly string[] };
export type VcsRemoteEntry = {
  readonly name: string;
  readonly url: string;
  readonly pushUrl: string | null;
  readonly isPrimary: boolean;
};
export type VcsListRemotesResult = {
  readonly isRepo: boolean;
  readonly remotes: readonly VcsRemoteEntry[];
};
export type VcsInitInput = { readonly kind?: "git" };
export type VcsCreateWorktreeInput = {
  readonly refName: string;
  readonly newRefName?: string;
  readonly baseRefName?: string;
  readonly path: string | null;
};
export type VcsCreateWorktreeResult = {
  readonly worktree: { readonly path: string; readonly refName: string };
};
export type VcsRemoveWorktreeInput = { readonly path: string; readonly force?: boolean };
export type VcsEmptyResult = Record<string, never>;

const vcsPath = { type: "string", minLength: 1, maxLength: 512 } as const;
const vcsPathsInput = {
  type: "array",
  minItems: 1,
  maxItems: 100,
  items: vcsPath,
} as const;
/**
 * `git check-ref-format` essentials enforced declaratively — a bound the
 * private RPC leaves to the driver. Host-produced ref fields stay plain.
 */
const vcsRefNameInput = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  allOf: [
    { not: { pattern: "\\.\\." } },
    { not: { pattern: "@\\{" } },
    { not: { pattern: "[\\x00-\\x20~^:?*\\[\\\\]" } },
    { not: { pattern: "(^|/)\\." } },
    { not: { pattern: "//" } },
    { not: { pattern: "^[/-]" } },
    { not: { pattern: "[/.]$" } },
    { not: { pattern: "\\.lock(/|$)" } },
    { not: { pattern: "^@$" } },
  ],
} as const;
const vcsRefNameOutput = { type: "string", minLength: 1, maxLength: 4096 } as const;
const vcsRefNameOrNull = { type: ["string", "null"], minLength: 1, maxLength: 4096 } as const;
/**
 * Revision inputs (diff baseRef/headRef) accept revspecs, not just refnames —
 * but a leading `-` would inject options into `git diff`/`git show` argv, and
 * whitespace/control characters are never valid. Enforced declaratively.
 */
const vcsRevSpec = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  allOf: [{ not: { pattern: "^-" } }, { not: { pattern: "[\\s\\x00-\\x1f]" } }],
} as const;
const vcsRevSpecOrNull = { anyOf: [{ type: "null" }, vcsRevSpec] } as const;
const vcsStatusFileSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path", "insertions", "deletions"],
  properties: {
    path: vcsPath,
    insertions: { type: "integer", minimum: 0 },
    deletions: { type: "integer", minimum: 0 },
  },
} as const;
const vcsStatusLocalSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "isRepo",
    "hasPrimaryRemote",
    "isDefaultRef",
    "refName",
    "hasWorkingTreeChanges",
    "workingTree",
  ],
  properties: {
    isRepo: { type: "boolean" },
    sourceControlProvider: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "name", "baseUrl"],
      properties: {
        kind: { enum: ["github", "gitlab", "azure-devops", "bitbucket", "unknown"] },
        name: { type: "string", minLength: 1, maxLength: 256 },
        baseUrl: { type: "string", maxLength: 2048 },
      },
    },
    hasPrimaryRemote: { type: "boolean" },
    isDefaultRef: { type: "boolean" },
    refName: vcsRefNameOrNull,
    hasWorkingTreeChanges: { type: "boolean" },
    workingTree: {
      type: "object",
      additionalProperties: false,
      required: ["files", "insertions", "deletions", "truncated"],
      properties: {
        files: { type: "array", maxItems: 5000, items: vcsStatusFileSchema },
        insertions: { type: "integer", minimum: 0 },
        deletions: { type: "integer", minimum: 0 },
        truncated: { type: "boolean" },
      },
    },
  },
} as const;
const vcsChangeRequestSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["number", "title", "url", "baseRef", "headRef", "state"],
  properties: {
    number: { type: "integer", minimum: 1 },
    title: { type: "string", minLength: 1, maxLength: 512 },
    url: { type: "string", maxLength: 2048 },
    baseRef: vcsRefNameOutput,
    headRef: vcsRefNameOutput,
    state: { enum: ["open", "closed", "merged"] },
    isDraft: { type: "boolean" },
    updatedAt: { type: ["string", "null"], maxLength: 64 },
  },
} as const;
const vcsStatusRemoteSchema = {
  type: "object",
  additionalProperties: false,
  required: ["hasUpstream", "aheadCount", "behindCount", "pr"],
  properties: {
    hasUpstream: { type: "boolean" },
    aheadCount: { type: "integer", minimum: 0 },
    behindCount: { type: "integer", minimum: 0 },
    aheadOfDefaultCount: { type: "integer", minimum: 0 },
    pr: vcsChangeRequestSchema,
  },
} as const;
const vcsStatusResultSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "isRepo",
    "hasPrimaryRemote",
    "isDefaultRef",
    "refName",
    "hasWorkingTreeChanges",
    "workingTree",
    "hasUpstream",
    "aheadCount",
    "behindCount",
    "pr",
  ],
  properties: {
    ...vcsStatusLocalSchema.properties,
    ...vcsStatusRemoteSchema.properties,
  },
} as const;
const vcsEmptyInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;
const vcsAckOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

/** Public stream event shape — the private `_tag` union mirrored with `kind`. */
const vcsStatusStreamEventSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "local", "remote"],
      properties: {
        kind: { const: "snapshot" },
        local: vcsStatusLocalSchema,
        remote: { anyOf: [vcsStatusRemoteSchema, { type: "null" }] },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "local"],
      properties: { kind: { const: "localUpdated" }, local: vcsStatusLocalSchema },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "remote"],
      properties: {
        kind: { const: "remoteUpdated" },
        remote: { anyOf: [vcsStatusRemoteSchema, { type: "null" }] },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "reason"],
      properties: {
        kind: { const: "closed" },
        reason: { enum: ["overflow", "status-error"] },
      },
    },
  ],
} as const;
/**
 * Working-tree + upstream status. `get` serves the cached/merged snapshot,
 * `refresh` forces local+remote recompute; both mirror the private
 * vcs.refreshStatus / subscribeVcsStatus semantics over
 * VcsStatusBroadcaster. `subscribe` emits snapshot → localUpdated /
 * remoteUpdated frames; there is no resume cursor.
 */
export const vcsStatusApi: TypedApi<{
  get: { input: Record<string, never>; output: VcsStatusResult };
  refresh: { input: Record<string, never>; output: VcsStatusResult };
}> &
  TypedStreamApi<{
    subscribe: { input: Record<string, never>; event: VcsStatusStreamEvent };
  }> = defineStreamApi<{
  subscribe: { input: Record<string, never>; event: VcsStatusStreamEvent };
}>({
  id: VCS_STATUS,
  version: "1.0.0",
  methods: [
    {
      name: "get",
      effect: "read",
      requiredGrants: [VCS_READ],
      inputSchema: vcsEmptyInputSchema,
      outputSchema: vcsStatusResultSchema,
    },
    {
      name: "refresh",
      effect: "read",
      requiredGrants: [VCS_READ],
      inputSchema: vcsEmptyInputSchema,
      outputSchema: vcsStatusResultSchema,
    },
  ],
  streams: [
    {
      name: "subscribe",
      requiredGrants: [VCS_READ],
      inputSchema: vcsEmptyInputSchema,
      eventSchema: vcsStatusStreamEventSchema,
    },
  ],
});

const vcsRefEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "current", "isDefault", "worktreePath"],
  properties: {
    name: vcsRefNameOutput,
    isRemote: { type: "boolean" },
    remoteName: vcsRefNameOutput,
    current: { type: "boolean" },
    isDefault: { type: "boolean" },
    worktreePath: { type: ["string", "null"], minLength: 1, maxLength: 32768 },
  },
} as const;
/**
 * Ref listing and checkout mutations. `list` mirrors vcs.listRefs (≤200 page,
 * query/kind/remote filters); `create`/`switch` mirror vcs.createRef /
 * vcs.switchRef and require `t3.vcs/mutate` — checkout moves the working
 * tree, so it is never authorized by the read grant.
 */
export const vcsRefsApi = defineApi<{
  list: { input: VcsListRefsInput; output: VcsListRefsResult };
  create: { input: VcsCreateRefInput; output: VcsRefNameResult };
  switch: { input: VcsRefNameInput; output: VcsSwitchRefResult };
}>({
  id: VCS_REFS,
  version: "1.0.0",
  methods: [
    {
      name: "list",
      effect: "read",
      requiredGrants: [VCS_READ],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", maxLength: 256 },
          cursor: { type: "integer", minimum: 0 },
          includeMatchingRemoteRefs: { type: "boolean" },
          refKind: { enum: ["all", "local", "remote"] },
          refresh: { type: "boolean" },
          limit: { type: "integer", minimum: 1, maximum: 200 },
        },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["refs", "isRepo", "hasPrimaryRemote", "nextCursor", "totalCount"],
        properties: {
          refs: { type: "array", maxItems: 200, items: vcsRefEntrySchema },
          isRepo: { type: "boolean" },
          hasPrimaryRemote: { type: "boolean" },
          nextCursor: { type: ["integer", "null"], minimum: 0 },
          totalCount: { type: "integer", minimum: 0 },
        },
      },
    },
    {
      name: "create",
      effect: "write",
      requiredGrants: [VCS_MUTATE],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["refName"],
        properties: { refName: vcsRefNameInput, switchRef: { type: "boolean" } },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["refName"],
        properties: { refName: vcsRefNameOutput },
      },
    },
    {
      name: "switch",
      effect: "write",
      requiredGrants: [VCS_MUTATE],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["refName"],
        properties: { refName: vcsRefNameInput },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["refName"],
        properties: { refName: vcsRefNameOrNull },
      },
    },
  ],
});

const vcsChangeEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["path", "staged", "unstaged", "untracked", "conflicted"],
  properties: {
    path: vcsPath,
    staged: { type: "boolean" },
    unstaged: { type: "boolean" },
    untracked: { type: "boolean" },
    conflicted: { type: "boolean" },
  },
} as const;
/**
 * Index staging. `list` exposes per-path staged/unstaged/untracked/
 * conflicted state the private status payload drops (porcelain XY state —
 * GitVcsDriverCore only keeps paths). `stage`/`unstage`/`commit` are the
 * same driver operations the native stacked action performs
 * (`add -A -- <paths>` / `reset` / `commit`), under `t3.vcs/mutate`.
 * `commit.paths` mirrors native semantics: given → reset + add -A those
 * paths only; omitted → add -A all changes.
 */
export const vcsChangesApi = defineApi<{
  list: { input: Record<string, never>; output: VcsChangesListResult };
  stage: { input: VcsPathsInput; output: VcsPathsResult };
  unstage: { input: VcsPathsInput; output: VcsPathsResult };
  commit: { input: VcsCommitInput; output: VcsCommitResult };
}>({
  id: VCS_CHANGES,
  version: "1.0.0",
  methods: [
    {
      name: "list",
      effect: "read",
      requiredGrants: [VCS_READ],
      inputSchema: vcsEmptyInputSchema,
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["isRepo", "entries", "truncated"],
        properties: {
          isRepo: { type: "boolean" },
          entries: { type: "array", maxItems: 5000, items: vcsChangeEntrySchema },
          truncated: { type: "boolean" },
        },
      },
    },
    {
      name: "stage",
      effect: "write",
      requiredGrants: [VCS_MUTATE],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["paths"],
        properties: { paths: vcsPathsInput },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["paths"],
        properties: { paths: vcsPathsInput },
      },
    },
    {
      name: "unstage",
      effect: "write",
      requiredGrants: [VCS_MUTATE],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["paths"],
        properties: { paths: vcsPathsInput },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["paths"],
        properties: { paths: vcsPathsInput },
      },
    },
    {
      name: "commit",
      effect: "write",
      requiredGrants: [VCS_MUTATE],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["message"],
        properties: {
          message: { type: "string", minLength: 1, maxLength: 10000 },
          paths: vcsPathsInput,
        },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["commitSha", "refName"],
        properties: {
          commitSha: { type: "string", minLength: 1, maxLength: 64 },
          refName: vcsRefNameOrNull,
        },
      },
    },
  ],
});

const vcsDiffPreviewSourceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "kind", "title", "baseRef", "headRef", "diff", "diffHash", "truncated"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 64 },
    kind: { enum: ["working-tree", "branch-range"] },
    title: { type: "string", minLength: 1, maxLength: 256 },
    baseRef: vcsRefNameOrNull,
    headRef: vcsRefNameOrNull,
    diff: { type: "string", maxLength: 512000 },
    diffHash: { type: "string", minLength: 1, maxLength: 128 },
    truncated: { type: "boolean" },
  },
} as const;
const vcsDiffPreviewInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    baseRef: vcsRevSpec,
    ignoreWhitespace: { type: "boolean" },
  },
} as const;
const vcsDiffFileContentsInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sourceKind", "changeType", "baseRef", "headRef", "oldPath", "newPath"],
  properties: {
    sourceKind: { enum: ["working-tree", "branch-range"] },
    changeType: { enum: ["change", "rename-pure", "rename-changed", "new", "deleted"] },
    baseRef: vcsRevSpecOrNull,
    headRef: vcsRevSpecOrNull,
    oldPath: vcsPath,
    newPath: vcsPath,
  },
} as const;
const vcsDiffGetPreviewMethod = {
  name: "getPreview",
  effect: "read",
  requiredGrants: [VCS_READ],
  inputSchema: vcsDiffPreviewInputSchema,
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["generatedAt", "sources"],
    properties: {
      generatedAt: { type: "string", maxLength: 64 },
      sources: { type: "array", maxItems: 8, items: vcsDiffPreviewSourceSchema },
    },
  },
} as const;
const vcsDiffGetFileContentsMethod = {
  name: "getFileContents",
  effect: "read",
  requiredGrants: [VCS_READ],
  inputSchema: vcsDiffFileContentsInputSchema,
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["oldContents", "newContents"],
    properties: {
      oldContents: { type: "string", maxLength: 1048576 },
      newContents: { type: "string", maxLength: 1048576 },
    },
  },
} as const;
const vcsDiffSha256 = {
  type: "string",
  minLength: 64,
  maxLength: 64,
  pattern: "^[0-9a-f]{64}$",
} as const;
/**
 * Chunk bodies stay at 8 192 UTF-16 units so the encoded broker frame can
 * never reach 64 KiB even under pathological JSON escaping (≤6 bytes per
 * unit). The adapter additionally verifies each wrapped frame's byte size.
 */
const vcsDiffChunkData = { type: "string", maxLength: 8192 } as const;
const vcsDiffStreamSourceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "kind",
    "title",
    "baseRef",
    "headRef",
    "truncated",
    "diffHash",
    "diffByteLength",
    "chunkCount",
  ],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 64 },
    kind: { enum: ["working-tree", "branch-range"] },
    title: { type: "string", minLength: 1, maxLength: 256 },
    baseRef: vcsRefNameOrNull,
    headRef: vcsRefNameOrNull,
    truncated: { type: "boolean" },
    diffHash: vcsDiffSha256,
    diffByteLength: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    chunkCount: { type: "integer", minimum: 0, maximum: 64 },
  },
} as const;
const vcsDiffPreviewStreamEventSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "generatedAt", "sources"],
      properties: {
        kind: { const: "manifest" },
        generatedAt: { type: "string", maxLength: 64 },
        sources: { type: "array", maxItems: 8, items: vcsDiffStreamSourceSchema },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "sourceIndex", "chunkIndex", "data"],
      properties: {
        kind: { const: "chunk" },
        sourceIndex: { type: "integer", minimum: 0, maximum: 7 },
        chunkIndex: { type: "integer", minimum: 0, maximum: 63 },
        data: vcsDiffChunkData,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "payloadSha256"],
      properties: {
        kind: { const: "complete" },
        payloadSha256: vcsDiffSha256,
      },
    },
  ],
} as const;
const vcsDiffFileContentsStreamEventSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "oldByteLength", "oldChunkCount", "newByteLength", "newChunkCount"],
      properties: {
        kind: { const: "manifest" },
        // A surrogate pair straddling a boundary shrinks a chunk to 8 191
        // units, so the worst case is ceil(1 048 576 / 8 191) = 129 chunks.
        oldByteLength: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        oldChunkCount: { type: "integer", minimum: 0, maximum: 129 },
        newByteLength: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        newChunkCount: { type: "integer", minimum: 0, maximum: 129 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "side", "chunkIndex", "data"],
      properties: {
        kind: { const: "chunk" },
        side: { enum: ["old", "new"] },
        chunkIndex: { type: "integer", minimum: 0, maximum: 128 },
        data: vcsDiffChunkData,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "oldSha256", "newSha256"],
      properties: {
        kind: { const: "complete" },
        oldSha256: vcsDiffSha256,
        newSha256: vcsDiffSha256,
      },
    },
  ],
} as const;
/**
 * Review-shaped diff reads (private review.getDiffPreview /
 * review.getDiffFileContents). Native gates these on `review:write` though
 * both are semantic reads — the public contract correctly puts them under
 * `t3.vcs/read`. `diff` is capped at 512 000 chars; the adapter slices and
 * ORs `truncated` because native joins a ≤120 KB tracked patch with up to
 * 80 KB per untracked file. `getFileContents` is a git-only operation on
 * the host today — other drivers fail by name.
 *
 * Envelope interaction: invoke results cross the broker's 64 KiB payload
 * envelope, so a `truncated:true` preview can never be delivered by
 * `getPreview` — the smallest truncated body (one untracked file sliced at
 * 80 KB = 81 920 bytes) already exceeds it, and so does any untruncated
 * result past ~64 KiB — `getFileContents` payloads included once they cross
 * the envelope. The unary
 * methods remain correct for small diffs; `streamPreview` and
 * `streamFileContents` (1.1.0) deliver the same bounded payloads as ≤64 KiB
 * frames: a `manifest` snapshot with per-source sha256/chunk counts, `chunk`
 * data frames, then a `complete` frame carrying the sha256 over the full
 * delivered payload. Stream availability follows the unary support flags
 * (`diff.getPreview` / `diff.getFileContents` in getCapabilities). Streams
 * are one-shot — no resume cursor; cancel by abandoning the iterator.
 */
export const vcsDiffApi: TypedApi<{
  getPreview: { input: VcsDiffPreviewInput; output: VcsDiffPreviewResult };
  getFileContents: { input: VcsDiffFileContentsInput; output: VcsDiffFileContentsResult };
}> &
  TypedStreamApi<{
    streamPreview: { input: VcsDiffPreviewInput; event: VcsDiffPreviewStreamEvent };
    streamFileContents: {
      input: VcsDiffFileContentsInput;
      event: VcsDiffFileContentsStreamEvent;
    };
  }> = defineStreamApi<{
  streamPreview: { input: VcsDiffPreviewInput; event: VcsDiffPreviewStreamEvent };
  streamFileContents: {
    input: VcsDiffFileContentsInput;
    event: VcsDiffFileContentsStreamEvent;
  };
}>({
  id: VCS_DIFF,
  version: "1.1.0",
  methods: [vcsDiffGetPreviewMethod, vcsDiffGetFileContentsMethod],
  streams: [
    {
      name: "streamPreview",
      requiredGrants: [VCS_READ],
      inputSchema: vcsDiffPreviewInputSchema,
      eventSchema: vcsDiffPreviewStreamEventSchema,
    },
    {
      name: "streamFileContents",
      requiredGrants: [VCS_READ],
      inputSchema: vcsDiffFileContentsInputSchema,
      eventSchema: vcsDiffFileContentsStreamEventSchema,
    },
  ],
});
/** Frozen published 1.0.0 definition; shared definitions are immutable per version. */
export const vcsDiffApiV1 = defineApi<{
  getPreview: { input: VcsDiffPreviewInput; output: VcsDiffPreviewResult };
  getFileContents: { input: VcsDiffFileContentsInput; output: VcsDiffFileContentsResult };
}>({
  id: VCS_DIFF,
  version: "1.0.0",
  methods: [vcsDiffGetPreviewMethod, vcsDiffGetFileContentsMethod],
});

const vcsOperationsSupportSchemaV1 = {
  type: "object",
  additionalProperties: false,
  required: [
    "status.get",
    "status.refresh",
    "status.subscribe",
    "refs.list",
    "refs.create",
    "refs.switch",
    "changes.list",
    "changes.stage",
    "changes.unstage",
    "changes.commit",
    "diff.getPreview",
    "diff.getFileContents",
    "repository.pull",
    "repository.init",
    "repository.createWorktree",
    "repository.removeWorktree",
  ],
  properties: {
    "status.get": { type: "boolean" },
    "status.refresh": { type: "boolean" },
    "status.subscribe": { type: "boolean" },
    "refs.list": { type: "boolean" },
    "refs.create": { type: "boolean" },
    "refs.switch": { type: "boolean" },
    "changes.list": { type: "boolean" },
    "changes.stage": { type: "boolean" },
    "changes.unstage": { type: "boolean" },
    "changes.commit": { type: "boolean" },
    "diff.getPreview": { type: "boolean" },
    "diff.getFileContents": { type: "boolean" },
    "repository.pull": { type: "boolean" },
    "repository.init": { type: "boolean" },
    "repository.createWorktree": { type: "boolean" },
    "repository.removeWorktree": { type: "boolean" },
  },
} as const;
/** 1.1.0 operations map — 1.0.0 keys plus the push/fetch/listRemotes rows. */
const vcsOperationsSupportSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    ...vcsOperationsSupportSchemaV1.required,
    "repository.push",
    "repository.fetch",
    "repository.listRemotes",
  ],
  properties: {
    ...vcsOperationsSupportSchemaV1.properties,
    "repository.push": { type: "boolean" },
    "repository.fetch": { type: "boolean" },
    "repository.listRemotes": { type: "boolean" },
  },
} as const;
const vcsDriverCapabilitiesSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  required: [
    "kind",
    "supportsWorktrees",
    "supportsBookmarks",
    "supportsAtomicSnapshot",
    "supportsPushDefaultRemote",
    "ignoreClassifier",
  ],
  properties: {
    kind: { enum: ["git", "jj", "unknown"] },
    supportsWorktrees: { type: "boolean" },
    supportsBookmarks: { type: "boolean" },
    supportsAtomicSnapshot: { type: "boolean" },
    supportsPushDefaultRemote: { type: "boolean" },
    ignoreClassifier: { enum: ["native", "git-compatible-fallback"] },
  },
} as const;
const vcsCapabilitiesResultSchemaV1 = {
  type: "object",
  additionalProperties: false,
  required: ["detected", "kind", "detail", "driver", "operations"],
  properties: {
    detected: { type: "boolean" },
    kind: { type: ["string", "null"], enum: ["git", "jj", "unknown", null] },
    detail: { type: ["string", "null"], maxLength: 512 },
    driver: vcsDriverCapabilitiesSchema,
    operations: vcsOperationsSupportSchemaV1,
  },
} as const;
const vcsCapabilitiesResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["detected", "kind", "detail", "driver", "operations"],
  properties: {
    detected: { type: "boolean" },
    kind: { type: ["string", "null"], enum: ["git", "jj", "unknown", null] },
    detail: { type: ["string", "null"], maxLength: 512 },
    driver: vcsDriverCapabilitiesSchema,
    operations: vcsOperationsSupportSchema,
  },
} as const;
const vcsRepositoryGetCapabilitiesMethodV1 = {
  name: "getCapabilities",
  effect: "read",
  requiredGrants: [VCS_READ],
  inputSchema: vcsEmptyInputSchema,
  outputSchema: vcsCapabilitiesResultSchemaV1,
} as const;
const vcsRepositoryGetCapabilitiesMethod = {
  name: "getCapabilities",
  effect: "read",
  requiredGrants: [VCS_READ],
  inputSchema: vcsEmptyInputSchema,
  outputSchema: vcsCapabilitiesResultSchema,
} as const;
const vcsRepositoryPullMethod = {
  name: "pull",
  effect: "write",
  requiredGrants: [VCS_MUTATE],
  inputSchema: vcsEmptyInputSchema,
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["status", "refName", "upstreamRef"],
    properties: {
      status: { enum: ["pulled", "skipped_up_to_date"] },
      refName: vcsRefNameOutput,
      upstreamRef: vcsRefNameOrNull,
    },
  },
} as const;
const vcsRepositoryInitMethod = {
  name: "init",
  effect: "write",
  requiredGrants: [VCS_MUTATE],
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { kind: { enum: ["git"] } },
  },
  outputSchema: vcsAckOutputSchema,
} as const;
const vcsRepositoryCreateWorktreeMethod = {
  name: "createWorktree",
  effect: "write",
  requiredGrants: [VCS_MUTATE],
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["refName", "path"],
    properties: {
      refName: vcsRefNameInput,
      newRefName: vcsRefNameInput,
      baseRefName: vcsRefNameInput,
      path: { type: ["string", "null"], minLength: 1, maxLength: 32768 },
    },
  },
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["worktree"],
    properties: {
      worktree: {
        type: "object",
        additionalProperties: false,
        required: ["path", "refName"],
        properties: {
          path: { type: "string", minLength: 1, maxLength: 32768 },
          refName: vcsRefNameOutput,
        },
      },
    },
  },
} as const;
const vcsRepositoryRemoveWorktreeMethod = {
  name: "removeWorktree",
  effect: "write",
  requiredGrants: [VCS_MUTATE],
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: {
        type: "string",
        minLength: 1,
        maxLength: 32768,
      },
      force: { type: "boolean" },
    },
  },
  outputSchema: vcsAckOutputSchema,
} as const;
const vcsRepositoryPushMethod = {
  name: "push",
  effect: "write",
  requiredGrants: [VCS_MUTATE],
  inputSchema: vcsEmptyInputSchema,
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["status", "refName", "upstreamRef", "setUpstream"],
    properties: {
      status: { enum: ["pushed", "skipped_up_to_date"] },
      refName: vcsRefNameOutput,
      upstreamRef: vcsRefNameOrNull,
      setUpstream: { type: "boolean" },
    },
  },
} as const;
/** Remote names reject option-injection prefixes and whitespace/controls. */
const vcsRemoteNameInput = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  allOf: [{ not: { pattern: "^-" } }, { not: { pattern: "[\\s\\x00-\\x1f]" } }],
} as const;
const vcsRepositoryFetchMethod = {
  name: "fetch",
  effect: "write",
  requiredGrants: [VCS_MUTATE],
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { remoteName: vcsRemoteNameInput },
  },
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["remotes"],
    properties: {
      remotes: {
        type: "array",
        maxItems: 64,
        items: { type: "string", minLength: 1, maxLength: 256 },
      },
    },
  },
} as const;
const vcsRepositoryListRemotesMethod = {
  name: "listRemotes",
  effect: "read",
  requiredGrants: [VCS_READ],
  inputSchema: vcsEmptyInputSchema,
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["isRepo", "remotes"],
    properties: {
      isRepo: { type: "boolean" },
      remotes: {
        type: "array",
        maxItems: 64,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "url", "pushUrl", "isPrimary"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 256 },
            url: { type: "string", minLength: 1, maxLength: 2048 },
            pushUrl: { type: ["string", "null"], minLength: 1, maxLength: 2048 },
            isPrimary: { type: "boolean" },
          },
        },
      },
    },
  },
} as const;
/**
 * Repository-level capability discovery and authorized mutations.
 * `getCapabilities` is the honesty mechanism — it names the detected kind,
 * the driver flag set, and per-operation support so consumers never guess.
 * `pull`/`init`/`createWorktree`/`removeWorktree` mirror the private
 * vcs.pull / vcs.init / worktree RPCs under `t3.vcs/mutate`; 1.1.0 adds the
 * sync primitives `push`/`fetch` (write, mutate grant — fetch writes
 * remote-tracking refs) and `listRemotes` (read) off the driver interface.
 */
export const vcsRepositoryApi = defineApi<{
  getCapabilities: { input: Record<string, never>; output: VcsCapabilitiesResult };
  pull: { input: Record<string, never>; output: VcsPullResult };
  init: { input: VcsInitInput; output: VcsEmptyResult };
  createWorktree: { input: VcsCreateWorktreeInput; output: VcsCreateWorktreeResult };
  removeWorktree: { input: VcsRemoveWorktreeInput; output: VcsEmptyResult };
  push: { input: Record<string, never>; output: VcsPushResult };
  fetch: { input: VcsFetchInput; output: VcsFetchResult };
  listRemotes: { input: Record<string, never>; output: VcsListRemotesResult };
}>({
  id: VCS_REPOSITORY,
  version: "1.1.0",
  methods: [
    vcsRepositoryGetCapabilitiesMethod,
    vcsRepositoryPullMethod,
    vcsRepositoryInitMethod,
    vcsRepositoryCreateWorktreeMethod,
    vcsRepositoryRemoveWorktreeMethod,
    vcsRepositoryPushMethod,
    vcsRepositoryFetchMethod,
    vcsRepositoryListRemotesMethod,
  ],
});
/** Frozen published 1.0.0 definition; shared definitions are immutable per version. */
export const vcsRepositoryApiV1 = defineApi<{
  getCapabilities: { input: Record<string, never>; output: VcsCapabilitiesResultV1 };
  pull: { input: Record<string, never>; output: VcsPullResult };
  init: { input: VcsInitInput; output: VcsEmptyResult };
  createWorktree: { input: VcsCreateWorktreeInput; output: VcsCreateWorktreeResult };
  removeWorktree: { input: VcsRemoveWorktreeInput; output: VcsEmptyResult };
}>({
  id: VCS_REPOSITORY,
  version: "1.0.0",
  methods: [
    vcsRepositoryGetCapabilitiesMethodV1,
    vcsRepositoryPullMethod,
    vcsRepositoryInitMethod,
    vcsRepositoryCreateWorktreeMethod,
    vcsRepositoryRemoveWorktreeMethod,
  ],
});

export const VCS_STATUS_API = vcsStatusApi.definition;
export const VCS_REFS_API = vcsRefsApi.definition;
export const VCS_CHANGES_API = vcsChangesApi.definition;
export const VCS_DIFF_API = vcsDiffApi.definition;
export const VCS_DIFF_API_V1 = vcsDiffApiV1.definition;
export const VCS_REPOSITORY_API = vcsRepositoryApi.definition;
export const VCS_REPOSITORY_API_V1 = vcsRepositoryApiV1.definition;

/* ------------------------------------------------------------------------
 * t3.resources/lease — promoted binary/media presentation leases
 * (docs/internals/extensions/resources-lease-design.md).
 *
 * `createPresentationUrl` mints the NATIVE signed asset URL
 * (`/api/assets/<token>/<name>`, 1h HMAC claims, canonical-path containment
 * re-checked at serve time) for a ResourceRef mirroring the private
 * `AssetResource` union. The signed token IS the auth on the asset route —
 * `<img>`/webviews cannot set headers — so mint-time is the only grant check
 * and it is per-kind: the broker ANDs `requiredGrants` over every caller,
 * which cannot express "the grant follows `resource._tag`", so both methods
 * declare none and the host adapter enforces RESOURCE_LEASE_KIND_GRANTS for
 * every caller in the chain, before and after minting.
 *
 * Grant map: `workspace-file` and `project-favicon` ride
 * `t3.workspace/resources` — the deferred P05-B contract's read grant,
 * declared here ahead of the contract (a grant id and an API id are distinct
 * registries, so the shared string cannot collide). `browser-surface` rides
 * `t3.browser/sessions` — the deferred P08-B contract's id, declared the same
 * way: only the browser sessions contract holder may vend presentation
 * leases onto a live engine session. `attachment` stays in the union but
 * carries no grant until the messages/composer read grant exists; the
 * adapter denies it by name. `media-file` (absolute paths are arbitrary-path
 * minting, a spec non-goal) and `native-app-icon` (no consumer) are not in
 * the union. ws-stream-class claims (`device-stream`) arrive with P16 on the
 * existing DeviceHubProxy wsTicket TTL semantics; `browser-surface` is a
 * URL/presentation-class claim, not ws-stream.
 * --------------------------------------------------------------------- */
export const RESOURCES_LEASE = "t3.resources/lease";
/**
 * The deferred P05-B `t3.workspace/resources` contract's read grant,
 * declared ahead of that contract so presentation leases can be minted today.
 */
export const WORKSPACE_RESOURCES = "t3.workspace/resources";
/**
 * The deferred P08-B `t3.browser/sessions` contract's id, declared ahead of
 * that contract as the `browser-surface` mint grant — the sessions contract
 * holder is the only authority the design allows to bind a presentation
 * lease to an engine session.
 */
export const BROWSER_SESSIONS = "t3.browser/sessions";

/**
 * The closed command vocabulary a `browser-surface` lease may carry — the
 * presentation-attachment channel's verbs: bind the session's presentation
 * (`attach`), drive bounds/visibility/stacking (`present`), and release
 * without closing the session (`release`). Engine commands (navigate,
 * reload, zoom, DevTools, …) are `t3.browser/sessions` methods checked per
 * call by the broker and are deliberately not encodable in a lease.
 */
export const BROWSER_SURFACE_COMMANDS = ["attach", "present", "release"] as const;
export type BrowserSurfaceCommand = (typeof BROWSER_SURFACE_COMMANDS)[number];

/** ResourceRef input kinds the contract accepts on the wire. */
export type ResourceLeaseRefKind =
  | "workspace-file"
  | "attachment"
  | "project-favicon"
  | "browser-surface";
/** The claim kinds a mint can produce; echoed back as `kind`. */
export type ResourceLeaseClaimKind =
  | "workspace-file"
  | "workspace-file-exact"
  | "project-favicon"
  | "project-favicon-external"
  | "browser-surface";
export type ResourceLeaseRef =
  | {
      readonly _tag: "workspace-file";
      readonly threadId: string;
      readonly path: string;
    }
  | {
      readonly _tag: "attachment";
      readonly attachmentId: string;
      readonly fileName?: string;
      readonly mimeType?: string;
      readonly disposition?: "inline" | "attachment";
    }
  | {
      readonly _tag: "project-favicon";
      readonly cwd: string;
      readonly path?: string | null;
    }
  | {
      readonly _tag: "browser-surface";
      readonly threadId: string;
      readonly tabId: string;
      readonly serverEpoch: string;
      readonly allowedCommands: readonly BrowserSurfaceCommand[];
    };
export type ResourceLeaseCreatePresentationUrlInput = { readonly resource: ResourceLeaseRef };
export type ResourceLeasePresentationUrl = {
  /** Server-relative minted path — resolve against the environment origin. */
  readonly url: string;
  readonly expiresAt: number;
  readonly kind: ResourceLeaseClaimKind;
};
export type ResourceLeaseCapabilities = {
  /** Kinds this build can mint for a caller holding the kind's grant. */
  readonly supportedKinds: readonly ResourceLeaseRefKind[];
};
/** Frozen 1.0.0 wire shapes — before `browser-surface` joined the union. */
export type ResourceLeaseRefV1 = Exclude<ResourceLeaseRef, { readonly _tag: "browser-surface" }>;
export type ResourceLeaseClaimKindV1 = Exclude<ResourceLeaseClaimKind, "browser-surface">;
export type ResourceLeaseRefKindV1 = Exclude<ResourceLeaseRefKind, "browser-surface">;
export type ResourceLeaseCreatePresentationUrlInputV1 = {
  readonly resource: ResourceLeaseRefV1;
};
export type ResourceLeasePresentationUrlV1 = {
  readonly url: string;
  readonly expiresAt: number;
  readonly kind: ResourceLeaseClaimKindV1;
};
export type ResourceLeaseCapabilitiesV1 = {
  readonly supportedKinds: readonly ResourceLeaseRefKindV1[];
};
/**
 * Mint-time authority per resource kind; `null` means no grant exists in this
 * build and the adapter fails closed by name. `supportedKinds` is exactly the
 * kinds with a declared grant.
 */
export const RESOURCE_LEASE_KIND_GRANTS: Readonly<Record<ResourceLeaseRefKind, string | null>> = {
  "workspace-file": WORKSPACE_RESOURCES,
  "project-favicon": WORKSPACE_RESOURCES,
  attachment: null,
  "browser-surface": BROWSER_SESSIONS,
};
export const RESOURCE_LEASE_SUPPORTED_KINDS: readonly ResourceLeaseRefKind[] = (
  Object.keys(RESOURCE_LEASE_KIND_GRANTS) as ResourceLeaseRefKind[]
).filter((kind) => RESOURCE_LEASE_KIND_GRANTS[kind] !== null);

const resourceLeaseRefSchemaV1 = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["_tag", "threadId", "path"],
      properties: {
        _tag: { const: "workspace-file" },
        threadId: { type: "string", minLength: 1, maxLength: 160 },
        path: { type: "string", minLength: 1, maxLength: 1024 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["_tag", "attachmentId"],
      properties: {
        _tag: { const: "attachment" },
        attachmentId: { type: "string", minLength: 1, maxLength: 256 },
        fileName: { type: "string", minLength: 1, maxLength: 255 },
        mimeType: { type: "string", minLength: 1, maxLength: 100 },
        disposition: { enum: ["inline", "attachment"] },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["_tag", "cwd"],
      properties: {
        _tag: { const: "project-favicon" },
        cwd: { type: "string", minLength: 1, maxLength: 1024 },
        path: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: 1024,
          pattern: "\\.(?:avif|gif|ico|jpe?g|png|svg|webp)$",
        },
      },
    },
  ],
} as const;

const resourceLeaseBrowserSurfaceCommandsSchema = {
  type: "array",
  minItems: 1,
  maxItems: 3,
  uniqueItems: true,
  items: { enum: [...BROWSER_SURFACE_COMMANDS] },
} as const;

/** 1.1.0 input union — the shipped 1.0.0 branches plus `browser-surface`. */
const resourceLeaseRefSchema = {
  oneOf: [
    ...resourceLeaseRefSchemaV1.oneOf,
    {
      type: "object",
      additionalProperties: false,
      required: ["_tag", "threadId", "tabId", "serverEpoch", "allowedCommands"],
      properties: {
        _tag: { const: "browser-surface" },
        threadId: { type: "string", minLength: 1, maxLength: 160 },
        tabId: { type: "string", minLength: 1, maxLength: 128 },
        serverEpoch: { type: "string", minLength: 1, maxLength: 128 },
        allowedCommands: resourceLeaseBrowserSurfaceCommandsSchema,
      },
    },
  ],
} as const;

export const resourcesLeaseApi = defineApi<{
  createPresentationUrl: {
    input: ResourceLeaseCreatePresentationUrlInput;
    output: ResourceLeasePresentationUrl;
  };
  getCapabilities: { input: Record<string, never>; output: ResourceLeaseCapabilities };
}>({
  id: RESOURCES_LEASE,
  version: "1.1.0",
  methods: [
    {
      name: "createPresentationUrl",
      effect: "read",
      // Per-kind grants are enforced inside the host adapter — a method-level
      // list can only express "every caller holds all of these".
      requiredGrants: [],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["resource"],
        properties: { resource: resourceLeaseRefSchema },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["url", "expiresAt", "kind"],
        properties: {
          url: { type: "string", minLength: 1, maxLength: 4096 },
          expiresAt: { type: "number" },
          kind: {
            enum: [
              "workspace-file",
              "workspace-file-exact",
              "project-favicon",
              "project-favicon-external",
              "browser-surface",
            ],
          },
        },
      },
    },
    {
      name: "getCapabilities",
      effect: "read",
      requiredGrants: [],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["supportedKinds"],
        properties: {
          supportedKinds: {
            type: "array",
            maxItems: 16,
            items: {
              enum: ["workspace-file", "attachment", "project-favicon", "browser-surface"],
            },
          },
        },
      },
    },
  ],
});
export const RESOURCES_LEASE_API = resourcesLeaseApi.definition;
/** Frozen published 1.0.0 definition; shared definitions are immutable per version. */
export const resourcesLeaseApiV1 = defineApi<{
  createPresentationUrl: {
    input: ResourceLeaseCreatePresentationUrlInputV1;
    output: ResourceLeasePresentationUrlV1;
  };
  getCapabilities: { input: Record<string, never>; output: ResourceLeaseCapabilitiesV1 };
}>({
  id: RESOURCES_LEASE,
  version: "1.0.0",
  methods: [
    {
      name: "createPresentationUrl",
      effect: "read",
      // Per-kind grants are enforced inside the host adapter — a method-level
      // list can only express "every caller holds all of these".
      requiredGrants: [],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["resource"],
        properties: { resource: resourceLeaseRefSchemaV1 },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["url", "expiresAt", "kind"],
        properties: {
          url: { type: "string", minLength: 1, maxLength: 4096 },
          expiresAt: { type: "number" },
          kind: {
            enum: [
              "workspace-file",
              "workspace-file-exact",
              "project-favicon",
              "project-favicon-external",
            ],
          },
        },
      },
    },
    {
      name: "getCapabilities",
      effect: "read",
      requiredGrants: [],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["supportedKinds"],
        properties: {
          supportedKinds: {
            type: "array",
            maxItems: 16,
            items: { enum: ["workspace-file", "attachment", "project-favicon"] },
          },
        },
      },
    },
  ],
});
export const RESOURCES_LEASE_API_V1 = resourcesLeaseApiV1.definition;

/* ------------------------------------------------------------------------
 * t3.prs/read — change-request (pull request) browser reads (P10C-PR).
 *
 * The native Version Control surface is fundamentally a PR browser; this is
 * the read side of that surface for plugins. Every method maps 1:1 onto a
 * native `pullRequests.*` read — the adapter calls PullRequestService and
 * never shells out to a host CLI itself.
 *
 * Grant: `t3.prs/read` covers every method and stream. Mutations
 * (pullRequests.runAction/update/comment/updateComment/submitReview/
 * replyToThread/setThreadResolution/setReaction/requestReviewers/setLabels —
 * all operate-scoped natively) are a later control contract, named deferred.
 *
 * Auth boundary: reads run on the environment's git-host credentials (the
 * signed-in gh/glab/az CLI or the server's configured Bitbucket token). The
 * plugin never supplies credentials — there is no auth field on any input —
 * and a project with no PR host or no working credentials fails by name
 * (PullRequestUnavailableError reason: cli-missing / cli-unauthenticated /
 * provider-unsupported) rather than returning an empty success.
 *
 * Capability honesty: `getCapabilities` reports the hosts the scoped project
 * resolves to (native PullRequestProviderSummary verbatim) plus a
 * per-operation support map derived from each configured host's provider —
 * e.g. Azure DevOps declares no diff capability, so `prs.streamDiff` reports
 * false there while `prs.list` stays true.
 * --------------------------------------------------------------------- */
export const PRS_READ = "t3.prs/read";

export type PrsProviderKind = "github" | "gitlab" | "azure-devops" | "bitbucket" | "unknown";
export type PrsActor = {
  readonly login: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
};
export type PrsLabel = { readonly name: string; readonly color: string | null };
export type PrsReaction = {
  readonly content:
    | "thumbs-up"
    | "thumbs-down"
    | "laugh"
    | "hooray"
    | "confused"
    | "heart"
    | "rocket"
    | "eyes";
  readonly count: number;
  readonly actors: readonly string[];
  readonly viewerHasReacted: boolean;
};
export type PrsCheck = {
  readonly name: string;
  readonly status:
    | "pending"
    | "action-required"
    | "success"
    | "failure"
    | "skipped"
    | "neutral"
    | "cancelled";
  readonly description: string | null;
  readonly url: string | null;
};
/**
 * One change request addressed on a host. `projectId` is absent: the
 * extension's project scope supplies it, exactly like the native
 * PullRequestRef the adapter constructs. `host` keeps the native cross-repo
 * routing — a thread in a frontend project may name a backend PR on the same
 * host.
 */
export type PrsRef = {
  readonly host?: string;
  readonly repository: string;
  readonly number: number;
};
export type PrsListFilters = {
  readonly draft?: "only" | "hide";
  readonly review?: "approved" | "changes-requested" | "review-required" | "none";
  readonly checks?: "passing" | "failing";
  readonly labels?: readonly (readonly string[])[];
  readonly excludedLabels?: readonly string[];
  readonly author?: string;
};
export type PrsListInput = {
  readonly state: "all" | "open" | "closed" | "merged";
  readonly involvement?: "all" | "reviewing" | "authored";
  readonly filters?: PrsListFilters;
  readonly host?: string;
  readonly limit?: number;
  readonly cursors?: Readonly<Record<string, string>>;
  readonly query?: string;
};
export type PrsStackMembership = {
  readonly number: number;
  readonly position: number;
  readonly size: number;
  readonly base: string;
};
export type PrsListEntry = {
  readonly stack?: PrsStackMembership;
  readonly provider: PrsProviderKind;
  readonly host: string;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly author: PrsActor | null;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly state: "open" | "closed" | "merged";
  readonly isDraft: boolean;
  readonly mergeability: "mergeable" | "conflicting" | "unknown";
  readonly additions: number;
  readonly deletions: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly viewerReviewRequested: boolean;
  readonly labels: readonly PrsLabel[];
  readonly reviewDecision?: "approved" | "changes-requested" | "review-required";
  readonly checksState?: "passing" | "failing" | "pending";
};
export type PrsProviderSummary = {
  readonly host: string;
  readonly kind: PrsProviderKind;
  readonly searchesOnHost: boolean;
  readonly projectCount: number;
  readonly configured: boolean;
  readonly detail: string | null;
};
export type PrsListProjectError = {
  readonly projectId: string;
  readonly projectTitle: string;
  readonly message: string;
};
export type PrsListResult = {
  readonly viewers: Readonly<Record<string, string>>;
  readonly providers: readonly PrsProviderSummary[];
  readonly entries: readonly PrsListEntry[];
  readonly errors: readonly PrsListProjectError[];
  readonly truncated: boolean;
  readonly nextCursors: Readonly<Record<string, string>>;
};
export type PrsListStatsInput = { readonly refs: readonly PrsRef[] };
export type PrsDiffStat = {
  readonly projectId: string;
  readonly repository: string;
  readonly number: number;
  readonly additions: number;
  readonly deletions: number;
};
export type PrsListStatsResult = { readonly stats: readonly PrsDiffStat[] };
export type PrsSummary = {
  readonly provider: PrsProviderKind;
  readonly projectId: string;
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "open" | "closed" | "merged";
  readonly isDraft?: boolean;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly closedAt?: string | null;
  readonly mergedAt?: string | null;
  readonly updatedAt: string;
  readonly author?: PrsActor | null;
  readonly additions?: number;
  readonly deletions?: number;
  readonly changedFiles?: number;
  readonly reviewDecision?: "approved" | "changes-requested" | "review-required" | null;
  readonly checksState?: "passing" | "failing" | "pending" | null;
  readonly mergeability?: "mergeable" | "conflicting" | "unknown";
};
export type PrsStack = {
  readonly id: string;
  readonly number: number;
  readonly url: string;
  readonly base: string;
  readonly layers: readonly {
    readonly number: number;
    readonly title?: string;
    readonly isDraft?: boolean;
    readonly headSha?: string;
    readonly headBranch: string;
    readonly state: "open" | "closed" | "merged";
  }[];
};
export type PrsLinkedThreadsResult = {
  readonly threads: readonly {
    readonly id: string;
    readonly projectId: string;
    readonly title: string;
    readonly archivedAt: string | null;
  }[];
  /** Rows were dropped to stay within the result bound. */
  readonly truncated: boolean;
};
export type PrsCapabilities = {
  readonly diff: boolean;
  readonly comment: boolean;
  readonly actions: readonly string[];
  readonly mergeMethods: readonly ("merge" | "squash" | "rebase")[];
  readonly updateMethods?: readonly ("merge" | "rebase")[];
  readonly search: boolean;
  readonly reactions?: boolean;
  readonly review: {
    readonly inlineComment: boolean;
    readonly reply: boolean;
    readonly resolve: boolean;
    readonly verdicts: readonly ("comment" | "approve" | "request-changes")[];
  };
  readonly reviewers: { readonly request: boolean; readonly listCandidates: boolean };
  readonly edit?: { readonly changeRequest: boolean; readonly comment: boolean };
  readonly stacks?: boolean;
  readonly stackActions?: boolean;
  readonly labels?: boolean;
};
export type PrsViewerPermissions = {
  readonly stackRebase?: boolean;
  readonly actions: readonly string[];
  readonly comment: boolean;
  readonly resolve: boolean;
  readonly verdicts: readonly ("comment" | "approve" | "request-changes")[];
  readonly requestReviewers: boolean;
  readonly updateMethods?: readonly ("merge" | "rebase")[];
  readonly labels?: boolean;
};
export type PrsDetail = {
  readonly provider: PrsProviderKind;
  readonly capabilities: PrsCapabilities;
  readonly viewerPermissions: PrsViewerPermissions;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly workspaceRoot: string;
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  readonly body: string;
  /** True when the adapter cut `body` at the contract's character bound. */
  readonly bodyTruncated?: boolean;
  readonly url: string;
  readonly author: PrsActor | null;
  readonly state: "open" | "closed" | "merged";
  readonly isDraft: boolean;
  readonly mergeability: "mergeable" | "conflicting" | "unknown";
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly headBranch: string;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly baseBranch: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly mergedAt: string | null;
  readonly closedAt: string | null;
  readonly reviewers: readonly PrsActor[];
  readonly labels: readonly PrsLabel[];
  readonly checks: readonly PrsCheck[];
  readonly mergeCapabilities: {
    readonly merge: boolean;
    readonly squash: boolean;
    readonly rebase: boolean;
  };
  readonly viewer?: string;
  readonly baseComparison?: "up-to-date" | "behind" | "unknown";
  readonly behindBy?: number;
  readonly autoMergeEnabled?: boolean;
  readonly autoMergeMethod?: "merge" | "squash" | "rebase";
  readonly workflowApprovalsRequired?: number;
};
export type PrsComment = {
  readonly id: string;
  readonly kind: "issue-comment" | "review-comment" | "review";
  readonly author: PrsActor | null;
  readonly body: string;
  readonly createdAt: string;
  readonly url: string | null;
  readonly path: string | null;
  readonly reviewState: string | null;
  readonly reactions?: readonly PrsReaction[];
};
export type PrsThreadComment = {
  readonly id: string;
  readonly author: PrsActor | null;
  readonly body: string;
  readonly createdAt: string;
  readonly url: string | null;
  readonly reactions?: readonly PrsReaction[];
};
export type PrsReviewThread = {
  readonly id: string;
  readonly path: string;
  readonly line: number | null;
  readonly side: "left" | "right";
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  readonly comments: readonly PrsThreadComment[];
  readonly commentCount?: number;
  readonly nextCommentsCursor?: string;
};
export type PrsCommit = {
  readonly oid: string;
  readonly messageHeadline: string;
  readonly committedDate: string;
  readonly additions?: number;
  readonly deletions?: number;
  readonly authors?: readonly PrsActor[];
};
export type PrsActivity = {
  readonly author?: PrsActor | null;
  readonly reviewers?: readonly PrsActor[];
  readonly comments: readonly PrsComment[];
  readonly commentCount: number;
  readonly commentsTruncated: boolean;
  readonly reviewThreads: readonly PrsReviewThread[];
  readonly commits: readonly PrsCommit[];
  readonly reactions?: readonly PrsReaction[];
  /**
   * The adapter cut something to fit the public bounds — a tail of
   * comments/reviewThreads/commits, or a body past the per-body character
   * bound. `commentsTruncated` is the native flag and is OR-ed in when
   * comments were cut.
   */
  readonly truncated: boolean;
};
export type PrsThreadCommentsInput = PrsRef & {
  readonly threadId: string;
  readonly cursor: string;
};
export type PrsThreadCommentsResult = {
  readonly comments: readonly PrsThreadComment[];
  /**
   * Host-issued resume point for the next page — null when comments were
   * dropped to fit the result bound, since that cursor describes the
   * position after rows the caller never received. A truncated page is an
   * explicitly lossy partial response: `threadComments` exposes no
   * page-size or query control, so dropped rows cannot be recovered
   * through this API — `truncated:true` + `nextCursor:null` is the honest
   * terminal state, not a retryable cursor.
   */
  readonly nextCursor: string | null;
  /** Comments were dropped (count or byte bound) or bodies were cut. */
  readonly truncated: boolean;
};
export type PrsReviewerCandidate = PrsActor & {
  readonly id: string;
  readonly kind: "user" | "team";
  readonly isRequested: boolean;
};
export type PrsReviewerCandidateList = {
  readonly candidates: readonly PrsReviewerCandidate[];
  readonly truncated: boolean;
};
export type PrsLabelCandidate = PrsLabel & {
  readonly description: string | null;
  readonly isApplied: boolean;
};
export type PrsLabelCandidateList = {
  readonly candidates: readonly PrsLabelCandidate[];
  readonly truncated: boolean;
};
export type PrsInvalidateInput = { readonly reference?: PrsRef };
export type PrsDiffInput = PrsRef & {
  /** One commit's own changes, rather than the whole change request. */
  readonly commit?: string;
  /** Resume point issued by a previous truncated stream, verbatim. */
  readonly cursor?: string;
};
export type PrsDiffFileContentsInput = PrsRef & {
  readonly commit?: string;
  readonly changeType: "change" | "rename-pure" | "rename-changed" | "new" | "deleted";
  readonly oldPath: string;
  readonly newPath: string;
};
export type PrsOmittedFileStat = {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
};
/**
 * `streamDiff` frames — the `t3.vcs/diff@1.1.0` family (manifest snapshot →
 * chunk data frames → complete) applied to one pull-request patch. The
 * adapter walks the host's own diff slices (`pullRequests.diff`) until the
 * diff is whole or the delivered-byte budget is hit; `nextCursor` is the
 * host-issued resume point for a follow-up stream. `diffHash` /
 * `payloadSha256` are sha256 over the delivered UTF-8 patch text, in chunk
 * order — the same verification the vcs diff streams run.
 */
export type PrsDiffStreamEvent =
  | {
      readonly kind: "manifest";
      readonly repository: string;
      readonly number: number;
      readonly host?: string;
      readonly commit?: string;
      readonly diffHash: string;
      readonly diffByteLength: number;
      readonly chunkCount: number;
      readonly truncated: boolean;
      readonly nextCursor: string | null;
      readonly omittedFileStats?: readonly PrsOmittedFileStat[];
    }
  | { readonly kind: "chunk"; readonly chunkIndex: number; readonly data: string }
  | { readonly kind: "complete"; readonly payloadSha256: string };
/**
 * `subscribeRefreshes` events — one per host-read invalidation cycle. The
 * stream closes with a named reason rather than going silent when the
 * consumer falls behind or the native stream fails.
 */
export type PrsRefreshedEvent =
  | { readonly kind: "refreshed"; readonly revision: number }
  | { readonly kind: "closed"; readonly reason: "overflow" | "refresh-error" };
/** Per-operation support flags keyed by `prs.<method>`/`prs.<stream>`. */
export type PrsOperationsSupport = {
  readonly "prs.list": boolean;
  readonly "prs.listStats": boolean;
  readonly "prs.summary": boolean;
  readonly "prs.detail": boolean;
  readonly "prs.activity": boolean;
  readonly "prs.threadComments": boolean;
  readonly "prs.linkedThreads": boolean;
  readonly "prs.stack": boolean;
  readonly "prs.reviewerCandidates": boolean;
  readonly "prs.labelCandidates": boolean;
  readonly "prs.invalidate": boolean;
  readonly "prs.streamDiff": boolean;
  readonly "prs.streamDiffFileContents": boolean;
  readonly "prs.subscribeRefreshes": boolean;
};
export type PrsCapabilitiesResult = {
  /**
   * The scoped project resolves to a PR host backed by a registered
   * provider. False on a local-only repository or an unimplemented host —
   * every host-bound operation then fails by name (provider-unsupported)
   * rather than answering an empty list.
   */
  readonly hosted: boolean;
  /**
   * The stable machine reason reads fail: `cli-missing`,
   * `cli-unauthenticated`, or `provider-unsupported`. Null when the probe
   * succeeded (per-host state lives on `providers[]`).
   */
  readonly reason: "cli-missing" | "cli-unauthenticated" | "provider-unsupported" | null;
  /**
   * Human-readable detail behind `reason` — e.g. which tool or credential
   * is missing. Null when the probe succeeded.
   */
  readonly detail: string | null;
  readonly providers: readonly PrsProviderSummary[];
  readonly operations: PrsOperationsSupport;
};

const prsActorSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["login", "name", "avatarUrl"],
  properties: {
    login: { type: "string", minLength: 1, maxLength: 256 },
    name: { type: ["string", "null"], maxLength: 512 },
    avatarUrl: { type: ["string", "null"], maxLength: 4096 },
  },
} as const;
const prsLabelSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "color"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 512 },
    color: { type: ["string", "null"], maxLength: 64 },
  },
} as const;
const prsReactionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["content", "count", "actors", "viewerHasReacted"],
  properties: {
    content: {
      enum: ["thumbs-up", "thumbs-down", "laugh", "hooray", "confused", "heart", "rocket", "eyes"],
    },
    count: { type: "integer", minimum: 1 },
    actors: {
      type: "array",
      maxItems: 500,
      items: { type: "string", minLength: 1, maxLength: 256 },
    },
    viewerHasReacted: { type: "boolean" },
  },
} as const;
const prsCheckSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "status", "description", "url"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 512 },
    status: {
      enum: ["pending", "action-required", "success", "failure", "skipped", "neutral", "cancelled"],
    },
    description: { type: ["string", "null"], maxLength: 4096 },
    url: { type: ["string", "null"], maxLength: 4096 },
  },
} as const;
const prsRepositoryField = { type: "string", minLength: 1, maxLength: 512 } as const;
const prsHostField = { type: "string", minLength: 1, maxLength: 256 } as const;
const prsRefInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["repository", "number"],
  properties: {
    host: prsHostField,
    repository: prsRepositoryField,
    number: { type: "integer", minimum: 1 },
  },
} as const;
const prsListFiltersSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    draft: { enum: ["only", "hide"] },
    review: { enum: ["approved", "changes-requested", "review-required", "none"] },
    checks: { enum: ["passing", "failing"] },
    labels: {
      type: "array",
      maxItems: 10,
      items: {
        type: "array",
        maxItems: 10,
        items: { type: "string", minLength: 1, maxLength: 200 },
      },
    },
    excludedLabels: {
      type: "array",
      maxItems: 10,
      items: { type: "string", minLength: 1, maxLength: 200 },
    },
    author: { type: "string", minLength: 1, maxLength: 200 },
  },
} as const;
const prsCursorsSchema = {
  type: "object",
  additionalProperties: { type: "string", minLength: 1, maxLength: 4096 },
  maxProperties: 100,
} as const;
const prsProviderSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["host", "kind", "searchesOnHost", "projectCount", "configured", "detail"],
  properties: {
    host: prsHostField,
    kind: { enum: ["github", "gitlab", "azure-devops", "bitbucket", "unknown"] },
    searchesOnHost: { type: "boolean" },
    projectCount: { type: "integer", minimum: 1 },
    configured: { type: "boolean" },
    detail: { type: ["string", "null"], maxLength: 1024 },
  },
} as const;
const prsListEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "provider",
    "host",
    "projectId",
    "projectTitle",
    "repository",
    "number",
    "title",
    "url",
    "author",
    "headBranch",
    "baseBranch",
    "state",
    "isDraft",
    "mergeability",
    "additions",
    "deletions",
    "createdAt",
    "updatedAt",
    "viewerReviewRequested",
    "labels",
  ],
  properties: {
    stack: {
      type: "object",
      additionalProperties: false,
      required: ["number", "position", "size", "base"],
      properties: {
        number: { type: "integer", minimum: 1 },
        position: { type: "integer", minimum: 1 },
        size: { type: "integer", minimum: 1 },
        base: { type: "string", minLength: 1, maxLength: 1024 },
      },
    },
    provider: { enum: ["github", "gitlab", "azure-devops", "bitbucket", "unknown"] },
    host: prsHostField,
    projectId: { type: "string", minLength: 1, maxLength: 160 },
    projectTitle: { type: "string", minLength: 1, maxLength: 512 },
    repository: prsRepositoryField,
    number: { type: "integer", minimum: 1 },
    title: { type: "string", minLength: 1, maxLength: 2048 },
    url: { type: "string", minLength: 1, maxLength: 4096 },
    author: prsActorSchema,
    headBranch: { type: "string", minLength: 1, maxLength: 1024 },
    baseBranch: { type: "string", minLength: 1, maxLength: 1024 },
    state: { enum: ["open", "closed", "merged"] },
    isDraft: { type: "boolean" },
    mergeability: { enum: ["mergeable", "conflicting", "unknown"] },
    additions: { type: "integer", minimum: 0 },
    deletions: { type: "integer", minimum: 0 },
    createdAt: { type: "string", maxLength: 64 },
    updatedAt: { type: "string", maxLength: 64 },
    viewerReviewRequested: { type: "boolean" },
    labels: { type: "array", maxItems: 100, items: prsLabelSchema },
    reviewDecision: { enum: ["approved", "changes-requested", "review-required"] },
    checksState: { enum: ["passing", "failing", "pending"] },
  },
} as const;
const prsListResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["viewers", "providers", "entries", "errors", "truncated", "nextCursors"],
  properties: {
    viewers: {
      type: "object",
      additionalProperties: { type: "string", minLength: 1, maxLength: 256 },
      maxProperties: 100,
    },
    providers: { type: "array", maxItems: 100, items: prsProviderSummarySchema },
    entries: { type: "array", maxItems: 100, items: prsListEntrySchema },
    errors: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["projectId", "projectTitle", "message"],
        properties: {
          projectId: { type: "string", minLength: 1, maxLength: 160 },
          projectTitle: { type: "string", minLength: 1, maxLength: 512 },
          message: { type: "string", minLength: 1, maxLength: 1024 },
        },
      },
    },
    truncated: { type: "boolean" },
    nextCursors: prsCursorsSchema,
  },
} as const;
const prsReviewVerdictsSchema = {
  type: "array",
  maxItems: 3,
  items: { enum: ["comment", "approve", "request-changes"] },
} as const;
const prsActionsSchema = {
  type: "array",
  maxItems: 16,
  items: {
    enum: [
      "merge",
      "ready",
      "draft",
      "close",
      "reopen",
      "update-branch",
      "enable-auto-merge",
      "disable-auto-merge",
      "revert",
      "approve-workflows",
    ],
  },
} as const;
const prsMergeMethodsSchema = {
  type: "array",
  maxItems: 3,
  items: { enum: ["merge", "squash", "rebase"] },
} as const;
const prsUpdateMethodsSchema = {
  type: "array",
  maxItems: 2,
  items: { enum: ["merge", "rebase"] },
} as const;
const prsCapabilitiesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["diff", "comment", "actions", "mergeMethods", "search", "review", "reviewers"],
  properties: {
    diff: { type: "boolean" },
    comment: { type: "boolean" },
    actions: prsActionsSchema,
    mergeMethods: prsMergeMethodsSchema,
    updateMethods: prsUpdateMethodsSchema,
    search: { type: "boolean" },
    reactions: { type: "boolean" },
    review: {
      type: "object",
      additionalProperties: false,
      required: ["inlineComment", "reply", "resolve", "verdicts"],
      properties: {
        inlineComment: { type: "boolean" },
        reply: { type: "boolean" },
        resolve: { type: "boolean" },
        verdicts: prsReviewVerdictsSchema,
      },
    },
    reviewers: {
      type: "object",
      additionalProperties: false,
      required: ["request", "listCandidates"],
      properties: {
        request: { type: "boolean" },
        listCandidates: { type: "boolean" },
      },
    },
    edit: {
      type: "object",
      additionalProperties: false,
      required: ["changeRequest", "comment"],
      properties: {
        changeRequest: { type: "boolean" },
        comment: { type: "boolean" },
      },
    },
    stacks: { type: "boolean" },
    stackActions: { type: "boolean" },
    labels: { type: "boolean" },
  },
} as const;
const prsViewerPermissionsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["actions", "comment", "resolve", "verdicts", "requestReviewers"],
  properties: {
    stackRebase: { type: "boolean" },
    actions: prsActionsSchema,
    comment: { type: "boolean" },
    resolve: { type: "boolean" },
    verdicts: prsReviewVerdictsSchema,
    requestReviewers: { type: "boolean" },
    updateMethods: prsUpdateMethodsSchema,
    labels: { type: "boolean" },
  },
} as const;
const prsDetailSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "provider",
    "capabilities",
    "viewerPermissions",
    "projectId",
    "projectTitle",
    "workspaceRoot",
    "repository",
    "number",
    "title",
    "body",
    "url",
    "author",
    "state",
    "isDraft",
    "mergeability",
    "additions",
    "deletions",
    "changedFiles",
    "headBranch",
    "baseBranch",
    "createdAt",
    "updatedAt",
    "mergedAt",
    "closedAt",
    "reviewers",
    "labels",
    "checks",
    "mergeCapabilities",
  ],
  properties: {
    provider: { enum: ["github", "gitlab", "azure-devops", "bitbucket", "unknown"] },
    capabilities: prsCapabilitiesSchema,
    viewerPermissions: prsViewerPermissionsSchema,
    projectId: { type: "string", minLength: 1, maxLength: 160 },
    projectTitle: { type: "string", minLength: 1, maxLength: 512 },
    workspaceRoot: { type: "string", minLength: 1, maxLength: 32768 },
    repository: prsRepositoryField,
    number: { type: "integer", minimum: 1 },
    title: { type: "string", minLength: 1, maxLength: 2048 },
    // Delivered bodies are cut at this bound; bodyTruncated says so.
    body: { type: "string", maxLength: 16384 },
    bodyTruncated: { type: "boolean" },
    url: { type: "string", minLength: 1, maxLength: 4096 },
    author: prsActorSchema,
    state: { enum: ["open", "closed", "merged"] },
    isDraft: { type: "boolean" },
    mergeability: { enum: ["mergeable", "conflicting", "unknown"] },
    additions: { type: "integer", minimum: 0 },
    deletions: { type: "integer", minimum: 0 },
    changedFiles: { type: "integer", minimum: 0 },
    headBranch: { type: "string", minLength: 1, maxLength: 1024 },
    headRepositoryNameWithOwner: { type: ["string", "null"], minLength: 1, maxLength: 1024 },
    baseBranch: { type: "string", minLength: 1, maxLength: 1024 },
    createdAt: { type: "string", maxLength: 64 },
    updatedAt: { type: "string", maxLength: 64 },
    mergedAt: { type: ["string", "null"], maxLength: 64 },
    closedAt: { type: ["string", "null"], maxLength: 64 },
    reviewers: { type: "array", maxItems: 100, items: prsActorSchema },
    labels: { type: "array", maxItems: 100, items: prsLabelSchema },
    checks: { type: "array", maxItems: 200, items: prsCheckSchema },
    mergeCapabilities: {
      type: "object",
      additionalProperties: false,
      required: ["merge", "squash", "rebase"],
      properties: {
        merge: { type: "boolean" },
        squash: { type: "boolean" },
        rebase: { type: "boolean" },
      },
    },
    viewer: { type: "string", minLength: 1, maxLength: 256 },
    baseComparison: { enum: ["up-to-date", "behind", "unknown"] },
    behindBy: { type: "integer", minimum: 0 },
    autoMergeEnabled: { type: "boolean" },
    autoMergeMethod: { enum: ["merge", "squash", "rebase"] },
    workflowApprovalsRequired: { type: "integer", minimum: 0 },
  },
} as const;
const prsCommentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "kind", "author", "body", "createdAt", "url", "path", "reviewState"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 512 },
    kind: { enum: ["issue-comment", "review-comment", "review"] },
    author: prsActorSchema,
    body: { type: "string", maxLength: 8192 },
    createdAt: { type: "string", maxLength: 64 },
    url: { type: ["string", "null"], maxLength: 4096 },
    path: { type: ["string", "null"], maxLength: 1024 },
    reviewState: { type: ["string", "null"], maxLength: 64 },
    reactions: { type: "array", maxItems: 8, items: prsReactionSchema },
  },
} as const;
const prsThreadCommentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "author", "body", "createdAt", "url"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 512 },
    author: prsActorSchema,
    body: { type: "string", maxLength: 8192 },
    createdAt: { type: "string", maxLength: 64 },
    url: { type: ["string", "null"], maxLength: 4096 },
    reactions: { type: "array", maxItems: 8, items: prsReactionSchema },
  },
} as const;
const prsReviewThreadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "path", "line", "side", "isResolved", "isOutdated", "comments"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 512 },
    path: { type: "string", minLength: 1, maxLength: 1024 },
    line: { type: ["integer", "null"], minimum: 1 },
    side: { enum: ["left", "right"] },
    isResolved: { type: "boolean" },
    isOutdated: { type: "boolean" },
    comments: { type: "array", maxItems: 100, items: prsThreadCommentSchema },
    commentCount: { type: "integer", minimum: 0 },
    nextCommentsCursor: { type: "string", minLength: 1, maxLength: 4096 },
  },
} as const;
const prsActivitySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "comments",
    "commentCount",
    "commentsTruncated",
    "reviewThreads",
    "commits",
    "truncated",
  ],
  properties: {
    author: prsActorSchema,
    reviewers: { type: "array", maxItems: 100, items: prsActorSchema },
    comments: { type: "array", maxItems: 100, items: prsCommentSchema },
    commentCount: { type: "integer", minimum: 0 },
    commentsTruncated: { type: "boolean" },
    reviewThreads: { type: "array", maxItems: 100, items: prsReviewThreadSchema },
    commits: {
      type: "array",
      maxItems: 250,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["oid", "messageHeadline", "committedDate"],
        properties: {
          oid: { type: "string", minLength: 1, maxLength: 128 },
          messageHeadline: { type: "string", maxLength: 4096 },
          committedDate: { type: "string", maxLength: 64 },
          additions: { type: "integer", minimum: 0 },
          deletions: { type: "integer", minimum: 0 },
          authors: { type: "array", maxItems: 8, items: prsActorSchema },
        },
      },
    },
    reactions: { type: "array", maxItems: 8, items: prsReactionSchema },
    truncated: { type: "boolean" },
  },
} as const;
const prsSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "provider",
    "projectId",
    "repository",
    "number",
    "title",
    "url",
    "state",
    "headBranch",
    "baseBranch",
    "updatedAt",
  ],
  properties: {
    provider: { enum: ["github", "gitlab", "azure-devops", "bitbucket", "unknown"] },
    projectId: { type: "string", minLength: 1, maxLength: 160 },
    repository: prsRepositoryField,
    number: { type: "integer", minimum: 1 },
    title: { type: "string", minLength: 1, maxLength: 2048 },
    url: { type: "string", minLength: 1, maxLength: 4096 },
    state: { enum: ["open", "closed", "merged"] },
    isDraft: { type: "boolean" },
    headBranch: { type: "string", minLength: 1, maxLength: 1024 },
    baseBranch: { type: "string", minLength: 1, maxLength: 1024 },
    closedAt: { type: ["string", "null"], maxLength: 64 },
    mergedAt: { type: ["string", "null"], maxLength: 64 },
    updatedAt: { type: "string", maxLength: 64 },
    author: prsActorSchema,
    additions: { type: "integer", minimum: 0 },
    deletions: { type: "integer", minimum: 0 },
    changedFiles: { type: "integer", minimum: 0 },
    reviewDecision: { enum: ["approved", "changes-requested", "review-required", null] },
    checksState: { enum: ["passing", "failing", "pending", null] },
    mergeability: { enum: ["mergeable", "conflicting", "unknown"] },
  },
} as const;
const prsStackSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["id", "number", "url", "base", "layers"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 512 },
    number: { type: "integer", minimum: 1 },
    url: { type: "string", minLength: 1, maxLength: 4096 },
    base: { type: "string", minLength: 1, maxLength: 1024 },
    layers: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["number", "headBranch", "state"],
        properties: {
          number: { type: "integer", minimum: 1 },
          title: { type: "string", maxLength: 2048 },
          isDraft: { type: "boolean" },
          headSha: { type: "string", minLength: 1, maxLength: 128 },
          headBranch: { type: "string", minLength: 1, maxLength: 1024 },
          state: { enum: ["open", "closed", "merged"] },
        },
      },
    },
  },
} as const;
const prsLinkedThreadsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["threads", "truncated"],
  properties: {
    threads: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "projectId", "title", "archivedAt"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 160 },
          projectId: { type: "string", minLength: 1, maxLength: 160 },
          title: { type: "string", maxLength: 2048 },
          archivedAt: { type: ["string", "null"], maxLength: 64 },
        },
      },
    },
    truncated: { type: "boolean" },
  },
} as const;
const prsThreadCommentsResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["comments", "nextCursor", "truncated"],
  properties: {
    comments: { type: "array", maxItems: 100, items: prsThreadCommentSchema },
    nextCursor: { type: ["string", "null"], minLength: 1, maxLength: 4096 },
    truncated: { type: "boolean" },
  },
} as const;
const prsReviewerCandidateListSchema = {
  type: "object",
  additionalProperties: false,
  required: ["candidates", "truncated"],
  properties: {
    candidates: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["login", "name", "avatarUrl", "id", "kind", "isRequested"],
        properties: {
          login: { type: "string", minLength: 1, maxLength: 256 },
          name: { type: ["string", "null"], maxLength: 512 },
          avatarUrl: { type: ["string", "null"], maxLength: 4096 },
          id: { type: "string", minLength: 1, maxLength: 512 },
          kind: { enum: ["user", "team"] },
          isRequested: { type: "boolean" },
        },
      },
    },
    truncated: { type: "boolean" },
  },
} as const;
const prsLabelCandidateListSchema = {
  type: "object",
  additionalProperties: false,
  required: ["candidates", "truncated"],
  properties: {
    candidates: {
      type: "array",
      maxItems: 500,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "color", "description", "isApplied"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 512 },
          color: { type: ["string", "null"], maxLength: 64 },
          description: { type: ["string", "null"], maxLength: 4096 },
          isApplied: { type: "boolean" },
        },
      },
    },
    truncated: { type: "boolean" },
  },
} as const;
const prsOperationsSupportSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "prs.list",
    "prs.listStats",
    "prs.summary",
    "prs.detail",
    "prs.activity",
    "prs.threadComments",
    "prs.linkedThreads",
    "prs.stack",
    "prs.reviewerCandidates",
    "prs.labelCandidates",
    "prs.invalidate",
    "prs.streamDiff",
    "prs.streamDiffFileContents",
    "prs.subscribeRefreshes",
  ],
  properties: {
    "prs.list": { type: "boolean" },
    "prs.listStats": { type: "boolean" },
    "prs.summary": { type: "boolean" },
    "prs.detail": { type: "boolean" },
    "prs.activity": { type: "boolean" },
    "prs.threadComments": { type: "boolean" },
    "prs.linkedThreads": { type: "boolean" },
    "prs.stack": { type: "boolean" },
    "prs.reviewerCandidates": { type: "boolean" },
    "prs.labelCandidates": { type: "boolean" },
    "prs.invalidate": { type: "boolean" },
    "prs.streamDiff": { type: "boolean" },
    "prs.streamDiffFileContents": { type: "boolean" },
    "prs.subscribeRefreshes": { type: "boolean" },
  },
} as const;
const prsCapabilitiesResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["hosted", "reason", "detail", "providers", "operations"],
  properties: {
    hosted: { type: "boolean" },
    reason: {
      enum: ["cli-missing", "cli-unauthenticated", "provider-unsupported", null],
    },
    detail: { type: ["string", "null"], maxLength: 1024 },
    providers: { type: "array", maxItems: 100, items: prsProviderSummarySchema },
    operations: prsOperationsSupportSchema,
  },
} as const;
const prsEmptyInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;
const prsEmptyOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;
const prsDiffStreamEventSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: [
        "kind",
        "repository",
        "number",
        "diffHash",
        "diffByteLength",
        "chunkCount",
        "truncated",
        "nextCursor",
      ],
      properties: {
        kind: { const: "manifest" },
        repository: prsRepositoryField,
        number: { type: "integer", minimum: 1 },
        host: prsHostField,
        commit: { type: "string", minLength: 1, maxLength: 128 },
        diffHash: vcsDiffSha256,
        diffByteLength: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        // The adapter's 4 Mi-unit delivered bound / 8 192-unit chunks = 512.
        chunkCount: { type: "integer", minimum: 0, maximum: 512 },
        truncated: { type: "boolean" },
        nextCursor: { type: ["string", "null"], minLength: 1, maxLength: 4096 },
        omittedFileStats: {
          type: "array",
          maxItems: 1000,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["path", "additions", "deletions"],
            properties: {
              path: { type: "string", minLength: 1, maxLength: 1024 },
              additions: { type: "number" },
              deletions: { type: "number" },
            },
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "chunkIndex", "data"],
      properties: {
        kind: { const: "chunk" },
        chunkIndex: { type: "integer", minimum: 0, maximum: 511 },
        data: vcsDiffChunkData,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "payloadSha256"],
      properties: { kind: { const: "complete" }, payloadSha256: vcsDiffSha256 },
    },
  ],
} as const;
const prsRefreshedEventSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "revision"],
      properties: {
        kind: { const: "refreshed" },
        revision: { type: "integer", minimum: 0 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "reason"],
      properties: {
        kind: { const: "closed" },
        reason: { enum: ["overflow", "refresh-error"] },
      },
    },
  ],
} as const;
const prsDiffInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["repository", "number"],
  properties: {
    host: prsHostField,
    repository: prsRepositoryField,
    number: { type: "integer", minimum: 1 },
    commit: { type: "string", minLength: 1, maxLength: 128 },
    cursor: { type: "string", minLength: 1, maxLength: 4096 },
  },
} as const;
const prsDiffFileContentsInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["repository", "number", "changeType", "oldPath", "newPath"],
  properties: {
    host: prsHostField,
    repository: prsRepositoryField,
    number: { type: "integer", minimum: 1 },
    commit: { type: "string", minLength: 1, maxLength: 128 },
    changeType: { enum: ["change", "rename-pure", "rename-changed", "new", "deleted"] },
    oldPath: { type: "string", minLength: 1, maxLength: 1024 },
    newPath: { type: "string", minLength: 1, maxLength: 1024 },
  },
} as const;
/**
 * The pull-request read surface. `list`/`detail`/`activity`/`threadComments`/
 * `stack`/`summary`/`linkedThreads`/`listStats`/`reviewerCandidates`/
 * `labelCandidates`/`invalidate` mirror the same-named `pullRequests.*`
 * reads; `streamDiff`/`streamDiffFileContents` cover the native diff
 * (HTTP-routed natively) as `t3.vcs/diff@1.1.0`-family frames so payload
 * size never matters; `subscribeRefreshes` mirrors the native refresh
 * counter so a plugin re-reads exactly when the native client would.
 */
export const prsReadApi: TypedApi<{
  getCapabilities: { input: Record<string, never>; output: PrsCapabilitiesResult };
  list: { input: PrsListInput; output: PrsListResult };
  listStats: { input: PrsListStatsInput; output: PrsListStatsResult };
  summary: { input: PrsRef; output: PrsSummary };
  detail: { input: PrsRef; output: PrsDetail };
  activity: { input: PrsRef; output: PrsActivity };
  threadComments: { input: PrsThreadCommentsInput; output: PrsThreadCommentsResult };
  stack: { input: PrsRef; output: PrsStack | null };
  linkedThreads: { input: PrsRef; output: PrsLinkedThreadsResult };
  reviewerCandidates: { input: PrsRef; output: PrsReviewerCandidateList };
  labelCandidates: { input: PrsRef; output: PrsLabelCandidateList };
  invalidate: { input: PrsInvalidateInput; output: Record<string, never> };
}> &
  TypedStreamApi<{
    streamDiff: { input: PrsDiffInput; event: PrsDiffStreamEvent };
    streamDiffFileContents: {
      input: PrsDiffFileContentsInput;
      event: VcsDiffFileContentsStreamEvent;
    };
    subscribeRefreshes: { input: Record<string, never>; event: PrsRefreshedEvent };
  }> = defineStreamApi<{
  streamDiff: { input: PrsDiffInput; event: PrsDiffStreamEvent };
  streamDiffFileContents: {
    input: PrsDiffFileContentsInput;
    event: VcsDiffFileContentsStreamEvent;
  };
  subscribeRefreshes: { input: Record<string, never>; event: PrsRefreshedEvent };
}>({
  id: PRS_READ,
  version: "1.0.0",
  methods: [
    {
      name: "getCapabilities",
      effect: "read",
      requiredGrants: [PRS_READ],
      inputSchema: prsEmptyInputSchema,
      outputSchema: prsCapabilitiesResultSchema,
    },
    {
      name: "list",
      effect: "read",
      requiredGrants: [PRS_READ],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["state"],
        properties: {
          state: { enum: ["all", "open", "closed", "merged"] },
          involvement: { enum: ["all", "reviewing", "authored"] },
          filters: prsListFiltersSchema,
          host: prsHostField,
          limit: { type: "integer", minimum: 1, maximum: 50 },
          cursors: prsCursorsSchema,
          query: { type: "string", minLength: 1, maxLength: 200 },
        },
      },
      outputSchema: prsListResultSchema,
    },
    {
      name: "listStats",
      effect: "read",
      requiredGrants: [PRS_READ],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["refs"],
        properties: {
          refs: { type: "array", minItems: 1, maxItems: 100, items: prsRefInputSchema },
        },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["stats"],
        properties: {
          stats: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["projectId", "repository", "number", "additions", "deletions"],
              properties: {
                projectId: { type: "string", minLength: 1, maxLength: 160 },
                repository: prsRepositoryField,
                number: { type: "integer", minimum: 1 },
                additions: { type: "integer", minimum: 0 },
                deletions: { type: "integer", minimum: 0 },
              },
            },
          },
        },
      },
    },
    {
      name: "summary",
      effect: "read",
      requiredGrants: [PRS_READ],
      inputSchema: prsRefInputSchema,
      outputSchema: prsSummarySchema,
    },
    {
      name: "detail",
      effect: "read",
      requiredGrants: [PRS_READ],
      inputSchema: prsRefInputSchema,
      outputSchema: prsDetailSchema,
    },
    {
      name: "activity",
      effect: "read",
      requiredGrants: [PRS_READ],
      inputSchema: prsRefInputSchema,
      outputSchema: prsActivitySchema,
    },
    {
      name: "threadComments",
      effect: "read",
      requiredGrants: [PRS_READ],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["repository", "number", "threadId", "cursor"],
        properties: {
          host: prsHostField,
          repository: prsRepositoryField,
          number: { type: "integer", minimum: 1 },
          threadId: { type: "string", minLength: 1, maxLength: 512 },
          cursor: { type: "string", minLength: 1, maxLength: 4096 },
        },
      },
      outputSchema: prsThreadCommentsResultSchema,
    },
    {
      name: "stack",
      effect: "read",
      requiredGrants: [PRS_READ],
      inputSchema: prsRefInputSchema,
      outputSchema: prsStackSchema,
    },
    {
      name: "linkedThreads",
      effect: "read",
      requiredGrants: [PRS_READ],
      inputSchema: prsRefInputSchema,
      outputSchema: prsLinkedThreadsSchema,
    },
    {
      name: "reviewerCandidates",
      effect: "read",
      requiredGrants: [PRS_READ],
      inputSchema: prsRefInputSchema,
      outputSchema: prsReviewerCandidateListSchema,
    },
    {
      name: "labelCandidates",
      effect: "read",
      requiredGrants: [PRS_READ],
      inputSchema: prsRefInputSchema,
      outputSchema: prsLabelCandidateListSchema,
    },
    {
      name: "invalidate",
      effect: "read",
      requiredGrants: [PRS_READ],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { reference: prsRefInputSchema },
      },
      outputSchema: prsEmptyOutputSchema,
    },
  ],
  streams: [
    {
      name: "streamDiff",
      requiredGrants: [PRS_READ],
      inputSchema: prsDiffInputSchema,
      eventSchema: prsDiffStreamEventSchema,
    },
    {
      name: "streamDiffFileContents",
      requiredGrants: [PRS_READ],
      inputSchema: prsDiffFileContentsInputSchema,
      eventSchema: vcsDiffFileContentsStreamEventSchema,
    },
    {
      name: "subscribeRefreshes",
      requiredGrants: [PRS_READ],
      inputSchema: prsEmptyInputSchema,
      eventSchema: prsRefreshedEventSchema,
    },
  ],
});
export const PRS_READ_API = prsReadApi.definition;

export const COMPOSER_CONTEXT = "t3.composer/context";
export const COMPOSER_WRITE = "t3.composer/write";
export const MESSAGES_ENRICHMENT = "t3.messages/enrichment";
export const MESSAGES_WRITE = "t3.messages/write";

export type ComposerContextRef = {
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly excerpt?: string;
};
export type ComposerContextInsertInput = {
  readonly threadId?: string;
  readonly refs: readonly ComposerContextRef[];
};
export type ComposerContextInsertResult = {
  readonly inserted: number;
  readonly target: string;
};
export type ComposerDraftStateResult = {
  readonly draft: {
    readonly prompt: string;
    readonly promptTruncated: boolean;
    readonly contextCounts: {
      readonly files: number;
      readonly images: number;
      readonly terminalContexts: number;
      readonly elementContexts: number;
      readonly previewAnnotations: number;
      readonly reviewComments: number;
    };
  } | null;
};
export type ComposerCapabilities = {
  readonly adapter: string;
  readonly transport: "server" | "client" | "unavailable";
  readonly detail: string | null;
  readonly operations: {
    readonly insertContext: boolean;
    readonly getDraftState: boolean;
  };
};
export type MessagesEnrichmentAnnotation = {
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly body: string;
  readonly excerpt?: string;
};
export type MessagesAttachAnnotationInput = {
  readonly threadId?: string;
  readonly annotation: MessagesEnrichmentAnnotation;
};
export type MessagesAttachAnnotationResult = {
  readonly annotationId: string;
};
export type MessagesEnrichmentCapabilities = {
  readonly adapter: string;
  readonly transport: "server" | "client" | "unavailable";
  readonly detail: string | null;
  readonly operations: {
    readonly attachAnnotation: boolean;
  };
};

const composerThreadIdInput = { type: "string", minLength: 1, maxLength: 128 } as const;
const composerLineInput = { type: "integer", minimum: 1, maximum: 1_000_000 } as const;
const composerContextRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path"],
  properties: {
    path: { type: "string", minLength: 1, maxLength: 512 },
    startLine: composerLineInput,
    endLine: composerLineInput,
    // 8 refs at these bounds encode to ≤51 KB worst-case (6 bytes/char for
    // C0 escapes) — inside the broker's 64 KiB copyJson envelope.
    excerpt: { type: "string", maxLength: 512 },
  },
} as const;
const composerTransportOutput = (operations: readonly string[]) =>
  ({
    type: "object",
    additionalProperties: false,
    required: ["adapter", "transport", "detail", "operations"],
    properties: {
      adapter: { type: "string", maxLength: 64 },
      transport: { enum: ["server", "client", "unavailable"] },
      detail: { type: ["string", "null"], maxLength: 512 },
      operations: {
        type: "object",
        additionalProperties: false,
        required: [...operations],
        properties: Object.fromEntries(operations.map((name) => [name, { type: "boolean" }])),
      },
    },
  }) as const;
const composerEmptyInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

/**
 * Composer draft context. The draft store is client-local, so `insertContext`
 * and `getDraftState` apply only once a client-adapter transport exists; until
 * then the host adapter reports them unsupported through `getCapabilities` and
 * fails invocations with a named error rather than silently no-opping.
 * Free-form send stays with `t3.orchestration/control` — this contract only
 * ever mutates draft content.
 */
export const composerContextApi = defineApi<{
  getCapabilities: { input: Record<string, never>; output: ComposerCapabilities };
  insertContext: {
    input: ComposerContextInsertInput;
    output: ComposerContextInsertResult;
  };
  getDraftState: { input: { threadId?: string }; output: ComposerDraftStateResult };
}>({
  id: COMPOSER_CONTEXT,
  version: "1.0.0",
  methods: [
    {
      name: "getCapabilities",
      effect: "read",
      // Capability discovery is grant-free so callers can tell "no capability"
      // apart from "no grant" — authority gates the mutations, not the report.
      requiredGrants: [],
      inputSchema: composerEmptyInputSchema,
      outputSchema: composerTransportOutput(["insertContext", "getDraftState"]),
    },
    {
      name: "insertContext",
      effect: "write",
      requiredGrants: [COMPOSER_WRITE],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["refs"],
        properties: {
          threadId: composerThreadIdInput,
          refs: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: composerContextRefSchema,
          },
        },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["inserted", "target"],
        properties: {
          inserted: { type: "integer", minimum: 0, maximum: 8 },
          target: { type: "string", minLength: 1, maxLength: 256 },
        },
      },
    },
    {
      name: "getDraftState",
      effect: "read",
      // Draft state carries the user's unsent words — it sits under the same
      // write authority as the mutations on this contract.
      requiredGrants: [COMPOSER_WRITE],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { threadId: composerThreadIdInput },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["draft"],
        properties: {
          draft: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["prompt", "promptTruncated", "contextCounts"],
            properties: {
              // 10,000 chars worst-case encodes to 60,000 UTF-8 bytes
              // (6/char for C0 escapes) — the response always fits the
              // broker's 64 KiB copyJson envelope. Longer drafts are cut
              // on a char boundary and disclosed via promptTruncated.
              prompt: { type: "string", maxLength: 10000 },
              promptTruncated: { type: "boolean" },
              contextCounts: {
                type: "object",
                additionalProperties: false,
                required: [
                  "files",
                  "images",
                  "terminalContexts",
                  "elementContexts",
                  "previewAnnotations",
                  "reviewComments",
                ],
                properties: {
                  files: { type: "integer", minimum: 0, maximum: 10000 },
                  images: { type: "integer", minimum: 0, maximum: 10000 },
                  terminalContexts: { type: "integer", minimum: 0, maximum: 10000 },
                  elementContexts: { type: "integer", minimum: 0, maximum: 10000 },
                  previewAnnotations: { type: "integer", minimum: 0, maximum: 10000 },
                  reviewComments: { type: "integer", minimum: 0, maximum: 10000 },
                },
              },
            },
          },
        },
      },
    },
  ],
});

/**
 * Review-style draft annotation. The native path is composer-insert only —
 * `buildFileReviewComment` + `addReviewComment` on the client draft store —
 * and annotations serialize into the next sent message. There is no
 * message-level annotation entity, so turn/sent-message enrichment is not
 * expressible and stays deferred.
 */
export const messagesEnrichmentApi = defineApi<{
  getCapabilities: { input: Record<string, never>; output: MessagesEnrichmentCapabilities };
  attachAnnotation: {
    input: MessagesAttachAnnotationInput;
    output: MessagesAttachAnnotationResult;
  };
}>({
  id: MESSAGES_ENRICHMENT,
  version: "1.0.0",
  methods: [
    {
      name: "getCapabilities",
      effect: "read",
      requiredGrants: [],
      inputSchema: composerEmptyInputSchema,
      outputSchema: composerTransportOutput(["attachAnnotation"]),
    },
    {
      name: "attachAnnotation",
      effect: "write",
      requiredGrants: [MESSAGES_WRITE],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["annotation"],
        properties: {
          threadId: composerThreadIdInput,
          annotation: {
            type: "object",
            additionalProperties: false,
            required: ["filePath", "startLine", "endLine", "body"],
            properties: {
              filePath: { type: "string", minLength: 1, maxLength: 512 },
              startLine: composerLineInput,
              endLine: composerLineInput,
              // body + excerpt at 4,096 chars each keep the worst-case
              // encoded request (~53 KB) inside the 64 KiB invoke envelope.
              body: { type: "string", minLength: 1, maxLength: 4096 },
              excerpt: { type: "string", maxLength: 4096 },
            },
          },
        },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["annotationId"],
        properties: {
          annotationId: { type: "string", minLength: 1, maxLength: 256 },
        },
      },
    },
  ],
});
export const COMPOSER_CONTEXT_API = composerContextApi.definition;
export const MESSAGES_ENRICHMENT_API = messagesEnrichmentApi.definition;

/**
 * Contracts only: their presence does not advertise a functioning or
 * authorized provider. Shared ids may hold multiple frozen versions (newest
 * first); providers must match one of them canonically.
 */
export const orchestrationStatusApi = defineOrchestrationStatusApi(vcsDiffPreviewStreamEventSchema);
export const ORCHESTRATION_STATUS_API = orchestrationStatusApi.definition;

export const GENERIC_API_CATALOGUE: readonly ApiDefinition[] = [
  orchestrationStatusApi.definition,
  orchestrationControlApi.definition,
  browserLocalServersApi.definition,
  workspaceFilesApi.definition,
  workspaceTreeApi.definition,
  workspaceSearchApi.definition,
  textEditsApi.definition,
  textEditsApiV1.definition,
  filePresentationApi.definition,
  terminalSessionsApi.definition,
  terminalOutputApi.definition,
  terminalOutputEventsApi.definition,
  terminalSessionsApiV1.definition,
  terminalControlApi.definition,
  vcsStatusApi.definition,
  vcsRefsApi.definition,
  vcsChangesApi.definition,
  vcsDiffApi.definition,
  vcsRepositoryApi.definition,
  vcsRepositoryApiV1.definition,
  vcsDiffApiV1.definition,
  resourcesLeaseApi.definition,
  resourcesLeaseApiV1.definition,
  prsReadApi.definition,
  composerContextApi.definition,
  messagesEnrichmentApi.definition,
];
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => JSON.stringify(key) + ":" + canonical(child))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function assertProvidedApiOwner(pluginId: string, definition: ApiDefinition): void {
  if (definition.id.startsWith(pluginId + "/")) return;
  const owned = GENERIC_API_CATALOGUE.some(
    (item) => item.id === definition.id && canonical(item) === canonical(definition),
  );
  if (!owned) throw new Error("Foreign API namespace or incompatible shared API contract");
}

export const WORKSPACE_FILES_API = workspaceFilesApi.definition;
export const WORKSPACE_SEARCH_API = workspaceSearchApi.definition;
export const FILE_PRESENTATION_API = filePresentationApi.definition;
export const TERMINAL_SESSIONS_API = terminalSessionsApi.definition;
export const TERMINAL_SESSIONS_API_V1 = terminalSessionsApiV1.definition;

export const TERMINAL_OUTPUT_API = terminalOutputApi.definition;
export const TERMINAL_OUTPUT_EVENTS_API = terminalOutputEventsApi.definition;
export const TERMINAL_CONTROL_API = terminalControlApi.definition;
