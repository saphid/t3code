import { defineApi, type ApiDefinition } from "./capabilities.js";
import type { JsonObject } from "./environment.js";
import type { WorkspaceReadTextInput, WorkspaceReadTextResult } from "./workspace.js";

export const WORKSPACE_FILES = "t3.workspace/files";
export const WORKSPACE_LIST_ENTRIES = "t3.workspace/list-entries";
export const FILE_PRESENTATION = "t3.file/presentation";
export const FILE_PRESENTATION_OPEN = "t3.file/open";
export const TERMINAL_SESSIONS = "t3.terminal/sessions";
export const TERMINAL_READ = "t3.terminal/read";
export const TERMINAL_OUTPUT = "t3.terminal/output";
export const TERMINAL_READ_OUTPUT = "t3.terminal/read-output";
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
export type TerminalSessionResult = {
  readonly terminalId: string;
  readonly status: "starting" | "running" | "exited" | "error";
  readonly label: string;
  readonly hasRunningSubprocess: boolean;
  readonly exitCode: number | null;
  readonly exitSignal: number | null;
  readonly updatedAt: string;
} | null;
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
export const terminalSessionsApi = defineApi<{
  inspect: { input: TerminalSessionsInput; output: TerminalSessionResult };
}>({
  id: TERMINAL_SESSIONS,
  version: "1.0.0",
  methods: [
    {
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
        type: ["object", "null"],
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
      },
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

/** Contracts only: their presence does not advertise a functioning or authorized provider. */
export const GENERIC_API_CATALOGUE: readonly ApiDefinition[] = [
  workspaceFilesApi.definition,
  filePresentationApi.definition,
  terminalSessionsApi.definition,
  terminalOutputApi.definition,
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
  const generic = GENERIC_API_CATALOGUE.find((item) => item.id === definition.id);
  if (!generic || canonical(generic) !== canonical(definition))
    throw new Error("Foreign API namespace or incompatible shared API contract");
}

export const WORKSPACE_FILES_API = workspaceFilesApi.definition;
export const FILE_PRESENTATION_API = filePresentationApi.definition;
export const TERMINAL_SESSIONS_API = terminalSessionsApi.definition;

export const TERMINAL_OUTPUT_API = terminalOutputApi.definition;
