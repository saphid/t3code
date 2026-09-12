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
};
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
export type VcsPullResult = {
  readonly status: "pulled" | "skipped_up_to_date";
  readonly refName: string;
  readonly upstreamRef: string | null;
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
/**
 * Review-shaped diff reads (private review.getDiffPreview /
 * review.getDiffFileContents). Native gates these on `review:write` though
 * both are semantic reads — the public contract correctly puts them under
 * `t3.vcs/read`. `diff` is capped at 512 000 chars; the adapter slices and
 * ORs `truncated` because native joins a ≤120 KB tracked patch with up to
 * 80 KB per untracked file. `getFileContents` is a git-only operation on
 * the host today — other drivers fail by name.
 */
export const vcsDiffApi = defineApi<{
  getPreview: { input: VcsDiffPreviewInput; output: VcsDiffPreviewResult };
  getFileContents: { input: VcsDiffFileContentsInput; output: VcsDiffFileContentsResult };
}>({
  id: VCS_DIFF,
  version: "1.0.0",
  methods: [
    {
      name: "getPreview",
      effect: "read",
      requiredGrants: [VCS_READ],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          baseRef: vcsRevSpec,
          ignoreWhitespace: { type: "boolean" },
        },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["generatedAt", "sources"],
        properties: {
          generatedAt: { type: "string", maxLength: 64 },
          sources: { type: "array", maxItems: 8, items: vcsDiffPreviewSourceSchema },
        },
      },
    },
    {
      name: "getFileContents",
      effect: "read",
      requiredGrants: [VCS_READ],
      inputSchema: {
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
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["oldContents", "newContents"],
        properties: {
          oldContents: { type: "string", maxLength: 1048576 },
          newContents: { type: "string", maxLength: 1048576 },
        },
      },
    },
  ],
});

const vcsOperationsSupportSchema = {
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
/**
 * Repository-level capability discovery and authorized mutations.
 * `getCapabilities` is the honesty mechanism — it names the detected kind,
 * the driver flag set, and per-operation support so consumers never guess.
 * `pull`/`init`/`createWorktree`/`removeWorktree` mirror the private
 * vcs.pull / vcs.init / worktree RPCs under `t3.vcs/mutate`.
 */
export const vcsRepositoryApi = defineApi<{
  getCapabilities: { input: Record<string, never>; output: VcsCapabilitiesResult };
  pull: { input: Record<string, never>; output: VcsPullResult };
  init: { input: VcsInitInput; output: VcsEmptyResult };
  createWorktree: { input: VcsCreateWorktreeInput; output: VcsCreateWorktreeResult };
  removeWorktree: { input: VcsRemoveWorktreeInput; output: VcsEmptyResult };
}>({
  id: VCS_REPOSITORY,
  version: "1.0.0",
  methods: [
    {
      name: "getCapabilities",
      effect: "read",
      requiredGrants: [VCS_READ],
      inputSchema: vcsEmptyInputSchema,
      outputSchema: {
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
      },
    },
    {
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
    },
    {
      name: "init",
      effect: "write",
      requiredGrants: [VCS_MUTATE],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { kind: { enum: ["git"] } },
      },
      outputSchema: vcsAckOutputSchema,
    },
    {
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
    },
    {
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
    },
  ],
});

export const VCS_STATUS_API = vcsStatusApi.definition;
export const VCS_REFS_API = vcsRefsApi.definition;
export const VCS_CHANGES_API = vcsChangesApi.definition;
export const VCS_DIFF_API = vcsDiffApi.definition;
export const VCS_REPOSITORY_API = vcsRepositoryApi.definition;

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
  vcsStatusApi.definition,
  vcsRefsApi.definition,
  vcsChangesApi.definition,
  vcsDiffApi.definition,
  vcsRepositoryApi.definition,
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
