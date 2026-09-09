import * as Schema from "effect/Schema";
import * as HttpServerRespondable from "effect/unstable/http/HttpServerRespondable";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { EnvironmentId, ProjectId, ThreadId } from "./baseSchemas.ts";

const Identity = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160));
export const ExtensionContentHash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const ExtensionGrants = Schema.Struct({
  capabilities: Schema.Array(Identity).check(Schema.isMaxLength(64)),
  projectIds: Schema.Array(ProjectId).check(Schema.isMaxLength(128)),
});
/** Portable package metadata is validated against the public SDK at the host boundary. */
export const ExtensionInstallation = Schema.Struct({
  id: Identity,
  contentHash: ExtensionContentHash,
  package: Schema.JsonObject,
  enabled: Schema.Boolean,
  grants: ExtensionGrants,
});
export type ExtensionInstallation = typeof ExtensionInstallation.Type;
export const ExtensionViewContext = Schema.Struct({
  resource: Schema.Struct({
    namespace: Identity,
    id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
    environmentId: EnvironmentId,
    projectId: Schema.optional(ProjectId),
    threadId: Schema.optional(ThreadId),
  }),
  workspaceRevision: Schema.optional(Schema.String.check(Schema.isMaxLength(1024))),
  client: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
});
export type ExtensionViewContext = typeof ExtensionViewContext.Type;
export const ExtensionInstallInput = Schema.Struct({
  sourceDir: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  ...ExtensionGrants.fields,
  trusted: Schema.Literal(true),
});
export type ExtensionInstallInput = typeof ExtensionInstallInput.Type;
export const ExtensionManageInput = Schema.Struct({
  id: Identity,
  action: Schema.Literals(["enable", "disable", "remove", "update"]),
  sourceDir: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096))),
  trusted: Schema.optional(Schema.Literal(true)),
});
export type ExtensionManageInput = typeof ExtensionManageInput.Type;
export const ExtensionClientInput = Schema.Struct({
  id: Identity,
  expectedContentHash: ExtensionContentHash,
});
export type ExtensionClientInput = typeof ExtensionClientInput.Type;
export const ExtensionInvokeInput = Schema.Struct({
  toolId: Identity,
  input: Schema.Json,
  context: ExtensionViewContext,
  expectedContentHash: ExtensionContentHash,
});
export type ExtensionInvokeInput = typeof ExtensionInvokeInput.Type;
export class ExtensionOperationError extends Schema.TaggedError<ExtensionOperationError>()(
  "ExtensionOperationError",
  { operation: Schema.String, detail: Schema.String },
  { httpApiStatus: 400 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(ExtensionOperationError)(this, { status: 400 });
  }
  override get message(): string {
    return this.detail;
  }
}
