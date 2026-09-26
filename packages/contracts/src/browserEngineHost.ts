/**
 * Private wire types for the authenticated browser engine host (P08-ENGINE-ATTACH,
 * P08-HOST-AUTHORITY, P08-NAV-ACK).
 *
 * A desktop renderer that owns Chromium guests registers as the environment's
 * engine host over its authenticated WebSocket. Registration is accepted only
 * from the desktop's own bootstrap session, so web, mobile, relay and tunnel
 * clients can never become a host: with no host, engine commands on
 * `t3.browser/sessions` stay named-unsupported.
 *
 * The host claims each guest it renders under an engine generation (the
 * serialized webContents id, shared with `t3.browser/frames`). Only the
 * claiming connection may report page status or answer commands for that
 * generation; a second host needs an explicit handoff, which fences the old
 * generation out. None of these methods are reachable from extensions.
 */
import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { BrowserFrameEngineGeneration } from "./browserFrames.ts";
import {
  PREVIEW_URL_MAX_LENGTH,
  PreviewAppearancePreference,
  PreviewNavStatus,
  PreviewTabId,
  PreviewZoomFactor,
} from "./preview.ts";

/** Max favicon data URL length, matching the desktop bridge's own bound. */
export const BROWSER_ENGINE_FAVICON_MAX_LENGTH = 8192;

export const BrowserEngineHostConnectionId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
export type BrowserEngineHostConnectionId = typeof BrowserEngineHostConnectionId.Type;

export const BrowserEngineCommandId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
export type BrowserEngineCommandId = typeof BrowserEngineCommandId.Type;

/**
 * Page commands. Navigation, resize and privileged verbs are not here.
 * `setPictureInPicture` pops the guest out into the host's native
 * picture-in-picture window; the server gates it on its own grant.
 */
export const BrowserEngineCommand = Schema.Union([
  Schema.TaggedStruct("back", {}),
  Schema.TaggedStruct("forward", {}),
  Schema.TaggedStruct("reload", {}),
  /** Bypasses the HTTP cache; cookies and storage are untouched. */
  Schema.TaggedStruct("hardReload", {}),
  Schema.TaggedStruct("zoom", { zoomFactor: PreviewZoomFactor }),
  Schema.TaggedStruct("setAppearance", { appearance: PreviewAppearancePreference }),
  Schema.TaggedStruct("setAudioMuted", { muted: Schema.Boolean }),
  Schema.TaggedStruct("setPictureInPicture", { open: Schema.Boolean }),
]);
export type BrowserEngineCommand = typeof BrowserEngineCommand.Type;

/** The logical session a guest renders, fenced by server epoch. */
export const BrowserEngineSessionTarget = Schema.Struct({
  threadId: ThreadId,
  tabId: PreviewTabId,
  serverEpoch: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
});
export type BrowserEngineSessionTarget = typeof BrowserEngineSessionTarget.Type;

/**
 * Observed page state of a claimed guest. Title rides `navStatus`. The
 * favicon stays server-side: the public sessions projection stores it as a
 * bounded asset and carries only its ref (P08-FAVICON-REF).
 */
export const BrowserEnginePageStatus = Schema.Struct({
  navStatus: PreviewNavStatus,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
  zoomFactor: PreviewZoomFactor,
  appearance: PreviewAppearancePreference,
  audioMuted: Schema.Boolean,
  audible: Schema.Boolean,
  /** The guest is shown in the host's native picture-in-picture window. */
  pictureInPicture: Schema.Boolean,
  favicon: Schema.NullOr(
    Schema.Struct({
      dataUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(BROWSER_ENGINE_FAVICON_MAX_LENGTH)),
      pageUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(PREVIEW_URL_MAX_LENGTH)),
    }),
  ),
});
export type BrowserEnginePageStatus = typeof BrowserEnginePageStatus.Type;

/** Identity comes from the authenticated socket, never from the payload. */
export const BrowserEngineHostRegisterInput = Schema.Struct({});
export type BrowserEngineHostRegisterInput = typeof BrowserEngineHostRegisterInput.Type;

export const BrowserEngineHostStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("registered"),
    hostConnectionId: BrowserEngineHostConnectionId,
  }),
  Schema.Struct({
    type: Schema.Literal("command"),
    commandId: BrowserEngineCommandId,
    target: BrowserEngineSessionTarget,
    engineGeneration: BrowserFrameEngineGeneration,
    command: BrowserEngineCommand,
  }),
]);
export type BrowserEngineHostStreamEvent = typeof BrowserEngineHostStreamEvent.Type;

const HostFence = {
  hostConnectionId: BrowserEngineHostConnectionId,
  target: BrowserEngineSessionTarget,
  engineGeneration: BrowserFrameEngineGeneration,
};

export const BrowserEngineHostClaimInput = Schema.Struct({
  ...HostFence,
  /** Take over a guest another host owns. Invalidates the previous generation. */
  handoff: Schema.optional(Schema.Boolean),
});
export type BrowserEngineHostClaimInput = typeof BrowserEngineHostClaimInput.Type;

export const BrowserEngineHostReleaseInput = Schema.Struct(HostFence);
export type BrowserEngineHostReleaseInput = typeof BrowserEngineHostReleaseInput.Type;

/**
 * Guest lifecycle outside normal page status. `crashed`: the guest's render
 * process is gone. `recovering`: the host is replacing it (the replacement
 * is released and freshly claimed under its new generation). `exhausted`:
 * recovery gave up; the guest stays dead until the session is reopened.
 * A page status report on the same claim returns the guest to live.
 */
export const BrowserEngineHostLifecycle = Schema.Literals(["crashed", "recovering", "exhausted"]);
export type BrowserEngineHostLifecycle = typeof BrowserEngineHostLifecycle.Type;

export const BrowserEngineHostReportInput = Schema.Union([
  Schema.Struct({ ...HostFence, status: BrowserEnginePageStatus }),
  Schema.Struct({ ...HostFence, lifecycle: BrowserEngineHostLifecycle }),
]);
export type BrowserEngineHostReportInput = typeof BrowserEngineHostReportInput.Type;

export const BrowserEngineCommandRejection = Schema.Literals([
  "stale-generation",
  "session-not-found",
  "not-applicable",
  "failed",
]);
export type BrowserEngineCommandRejection = typeof BrowserEngineCommandRejection.Type;

/** `applied` means the guest accepted the command, not that a page finished loading. */
export const BrowserEngineHostCommandResultInput = Schema.Struct({
  hostConnectionId: BrowserEngineHostConnectionId,
  commandId: BrowserEngineCommandId,
  result: Schema.Union([
    Schema.Struct({ outcome: Schema.Literal("applied") }),
    Schema.Struct({
      outcome: Schema.Literal("rejected"),
      reason: BrowserEngineCommandRejection,
    }),
  ]),
});
export type BrowserEngineHostCommandResultInput = typeof BrowserEngineHostCommandResultInput.Type;

export class BrowserEngineHostError extends Schema.TaggedError<BrowserEngineHostError>()(
  "BrowserEngineHostError",
  {
    reason: Schema.Literals([
      /** The caller is not the desktop's own authenticated session. */
      "desktop-required",
      /** The host connection is unknown or belongs to another socket. */
      "host-not-registered",
      /** Another host owns the guest and no handoff was requested. */
      "foreign-host",
      "stale-epoch",
      "stale-generation",
      "session-not-found",
    ]),
    message: Schema.String,
  },
) {}
