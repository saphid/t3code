import { copyJson } from "./contracts.js";
import { defineApi, type TypedApi } from "./capabilities.js";
import type { JsonObject } from "./environment.js";

/**
 * Editable workspace text checkpoint. Separate from t3.workspace/read-text:
 * the read grant alone never authorizes a write, and registration in the
 * shared catalogue is an agreed contract identity, not a permission grant.
 */
export const WORKSPACE_READ_TEXT_EDITS = "t3.workspace/text-edits";
export const WORKSPACE_READ_TEXT_GRANT = "t3.workspace/read-text";
export const WORKSPACE_WRITE_TEXT = "t3.workspace/write-text";
/** Complete-file ceiling on UTF-8 bytes; whole-JSON payloads stay under the 64KiB envelope. */
export const EDITABLE_TEXT_MAX_BYTES = 24000;
export const REVISION_HEX_LENGTH = 64;

export type EditableRelativePath = string;
/** SHA-256 hex of the complete original file bytes. */
export type TextRevision = string;

export type ReadSnapshotInput = {
  readonly relativePath: EditableRelativePath;
};
export type EditableSnapshot = {
  readonly kind: "editable";
  readonly relativePath: EditableRelativePath;
  readonly contents: string;
  readonly revision: TextRevision;
};
export type NotEditableSnapshot = {
  readonly kind: "not-editable";
  readonly relativePath: EditableRelativePath;
  readonly reason:
    | "not-found"
    | "not-regular-file"
    | "binary"
    | "invalid-utf8"
    | "oversized"
    | "outside-workspace"
    | "unsafe-path"
    | "changed-during-read"
    | "io-error";
};
export type ReadSnapshotResult = EditableSnapshot | NotEditableSnapshot;

export type SaveInput = {
  readonly relativePath: EditableRelativePath;
  readonly expectedRevision: TextRevision;
  readonly contents: string;
};
export type SavedResult = {
  readonly kind: "saved";
  readonly relativePath: EditableRelativePath;
  readonly revision: TextRevision;
};
export type ConflictResult = {
  readonly kind: "conflict";
  readonly relativePath: EditableRelativePath;
};
export type SaveResult = SavedResult | ConflictResult;

const revision = {
  type: "string",
  minLength: REVISION_HEX_LENGTH,
  maxLength: REVISION_HEX_LENGTH,
  pattern: "^[0-9a-f]{64}$",
};
const path = { type: "string", minLength: 1, maxLength: 512 };
const contents = { type: "string", maxLength: EDITABLE_TEXT_MAX_BYTES };
/**
 * Discriminated unions use const-kind oneOf branches like the workspace tree
 * events. contents bounds are characters here; byte-level caps are enforced by
 * the host on both directions so escaped JSON stays inside the transport envelope.
 */
export const textEditsApi: TypedApi<{
  readSnapshot: { input: ReadSnapshotInput; output: ReadSnapshotResult };
  save: { input: SaveInput; output: SaveResult };
}> = defineApi<{
  readSnapshot: { input: ReadSnapshotInput; output: ReadSnapshotResult };
  save: { input: SaveInput; output: SaveResult };
}>({
  id: WORKSPACE_READ_TEXT_EDITS,
  version: "1.0.0",
  methods: [
    {
      name: "readSnapshot",
      effect: "read",
      requiredGrants: [WORKSPACE_READ_TEXT_GRANT],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["relativePath"],
        properties: { relativePath: path },
      },
      outputSchema: {
        type: "object",
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "relativePath", "contents", "revision"],
            properties: {
              kind: { const: "editable" },
              relativePath: path,
              contents: { type: "string", maxLength: 48000 },
              revision,
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "relativePath", "reason"],
            properties: {
              kind: { const: "not-editable" },
              relativePath: path,
              reason: {
                enum: [
                  "not-found",
                  "not-regular-file",
                  "binary",
                  "invalid-utf8",
                  "oversized",
                  "outside-workspace",
                  "unsafe-path",
                  "changed-during-read",
                  "io-error",
                ],
              },
            },
          },
        ],
      },
    },
    {
      name: "save",
      effect: "write",
      requiredGrants: [WORKSPACE_WRITE_TEXT],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["relativePath", "expectedRevision", "contents"],
        properties: {
          relativePath: path,
          expectedRevision: revision,
          contents: { type: "string", maxLength: 48000 },
        },
      },
      outputSchema: {
        type: "object",
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "relativePath", "revision"],
            properties: { kind: { const: "saved" }, relativePath: path, revision },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["kind", "relativePath"],
            properties: { kind: { const: "conflict" }, relativePath: path },
          },
        ],
      },
    },
  ],
});

export function validateEditableRelativePath(value: unknown): EditableRelativePath {
  if (typeof value !== "string") throw new Error("Expected a workspace-relative path");
  const path = value;
  if (
    !path ||
    path !== path.trim() ||
    path.length > 512 ||
    /[\\:]/.test(path) ||
    [...path].some((character) => character.charCodeAt(0) < 32) ||
    path.startsWith("/") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Expected a workspace-relative path using forward slashes");
  return path;
}

function requireObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const input = copyJson(value);
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== keys.length ||
    !keys.every((key) => key in input)
  )
    throw new Error("Invalid editable text request");
  return input as Record<string, unknown>;
}

export function validateReadSnapshotInput(value: unknown): ReadSnapshotInput {
  const input = requireObject(value, ["relativePath"]);
  return { relativePath: validateEditableRelativePath(input.relativePath) };
}

export function isTextRevision(value: unknown): value is TextRevision {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function validateSaveInput(value: unknown): SaveInput {
  const input = requireObject(value, ["relativePath", "expectedRevision", "contents"]);
  if (typeof input.contents !== "string" || input.contents.length > EDITABLE_TEXT_MAX_BYTES)
    throw new Error("Editable text save exceeds the supported length.");
  if (!isTextRevision(input.expectedRevision))
    throw new Error("Expected a sha-256 hex revision of the complete original bytes.");
  return {
    relativePath: validateEditableRelativePath(input.relativePath),
    expectedRevision: input.expectedRevision,
    contents: input.contents,
  };
}

export function validateReadSnapshotResult(value: unknown): ReadSnapshotResult {
  const result = copyJson(value) as Record<string, unknown>;
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("Invalid editable text request");
  const relativePath = validateEditableRelativePath(
    (result as Record<string, unknown>).relativePath,
  );
  if (result.kind === "editable") {
    const full = requireObject(value, ["kind", "relativePath", "contents", "revision"]);
    if (typeof full.contents !== "string" || !isTextRevision(full.revision))
      throw new Error("Invalid editable snapshot");
    return {
      kind: "editable",
      relativePath,
      contents: full.contents,
      revision: full.revision,
    };
  }
  if (result.kind === "not-editable") {
    const full = requireObject(value, ["kind", "relativePath", "reason"]);
    const reasons: readonly NotEditableSnapshot["reason"][] = [
      "not-found",
      "not-regular-file",
      "binary",
      "invalid-utf8",
      "oversized",
      "outside-workspace",
      "unsafe-path",
      "changed-during-read",
      "io-error",
    ];
    if (!reasons.includes(full.reason as NotEditableSnapshot["reason"]))
      throw new Error("Invalid not-editable reason");
    return {
      kind: "not-editable",
      relativePath,
      reason: full.reason as NotEditableSnapshot["reason"],
    };
  }
  throw new Error("Invalid editable snapshot result");
}

export function validateSaveResult(value: unknown): SaveResult {
  const result = copyJson(value) as Record<string, unknown>;
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("Invalid editable text request");
  const relativePath = validateEditableRelativePath(
    (result as Record<string, unknown>).relativePath,
  );
  if (result.kind === "saved") {
    const full = requireObject(value, ["kind", "relativePath", "revision"]);
    if (!isTextRevision(full.revision)) throw new Error("Invalid saved revision");
    return { kind: "saved", relativePath, revision: full.revision };
  }
  if (result.kind === "conflict") {
    requireObject(value, ["kind", "relativePath"]);
    return { kind: "conflict", relativePath };
  }
  throw new Error("Invalid save result");
}

export type TextEditsJsonSchemas = {
  readonly readSnapshotInput: JsonObject;
  readonly readSnapshotOutput: JsonObject;
  readonly saveInput: JsonObject;
  readonly saveOutput: JsonObject;
};
