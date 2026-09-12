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

/**
 * Contracts only: their presence does not advertise a functioning or
 * authorized provider. Shared ids may hold multiple frozen versions (newest
 * first); providers must match one of them canonically.
 */
export const GENERIC_API_CATALOGUE: readonly ApiDefinition[] = [
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
