/**
 * Voice dictation contract.
 *
 * Dictation is transcribed on the environment itself by a native sidecar
 * (Apple's on-device speech stack on macOS 26+). Audio is captured by the
 * client, shipped as base64 over the existing RPC transport, transcribed
 * locally, and never leaves the machine that received it.
 *
 * The client sends `sessionTerms`, vocabulary extracted from the current
 * draft and thread, which the server merges with vocabulary learned from
 * recent history before handing the list to the recognizer.
 *
 * @module voice
 */
import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Apple's speech APIs accept at most 100 contextual phrases, so the client
 * never needs to send more than the recognizer can use.
 */
export const VOICE_SESSION_TERMS_MAX_ITEMS = 100;

/**
 * Vocabulary terms are short words or identifiers; anything longer is not
 * something a recognizer can use as a contextual phrase.
 */
export const VOICE_SESSION_TERM_MAX_LENGTH = 64;

/**
 * Decoded audio cap: about six minutes of 16 kHz 16-bit mono WAV. Enforced
 * against the base64 length before any decoding happens.
 */
export const VOICE_AUDIO_MAX_BYTES = 12 * 1024 * 1024;

/**
 * Schema-level bound on the base64 payload: ceil(12 MB * 4 / 3) plus padding
 * headroom. The service re-checks the decoded size as defense in depth.
 */
export const VOICE_AUDIO_BASE64_MAX_LENGTH = 16_800_000;

/**
 * BCP47-ish primary language plus optional region, e.g. `en`, `en_AU`,
 * `en-AU`. Deliberately strict: the locale ends up as a CLI argument on the
 * server, so nothing shell-shaped may pass.
 */
export const VOICE_LOCALE_PATTERN = /^[A-Za-z]{2}(?:[_-][A-Za-z]{2})?$/;

export const VoiceLocaleHint = TrimmedNonEmptyString.check(Schema.isPattern(VOICE_LOCALE_PATTERN));
export type VoiceLocaleHint = typeof VoiceLocaleHint.Type;

export const VoiceDictationStatus = Schema.Struct({
  /** False when the environment cannot transcribe at all (not macOS 26+, or no sidecar). */
  supported: Schema.Boolean,
  /** Whether the on-device dictation assets for `locale` are downloaded. */
  installed: Schema.Boolean,
  /** The locale the status was resolved for. */
  locale: Schema.String,
});
export type VoiceDictationStatus = typeof VoiceDictationStatus.Type;

/** A single contextual-vocabulary term: trimmed, short, and non-empty. */
export const VoiceSessionTerm = TrimmedNonEmptyString.check(
  Schema.isMaxLength(VOICE_SESSION_TERM_MAX_LENGTH),
);
export type VoiceSessionTerm = typeof VoiceSessionTerm.Type;

export const VoiceTranscribeInput = Schema.Struct({
  /** Base64-encoded audio; wav, aiff, or m4a containers are accepted. */
  audioBase64: TrimmedNonEmptyString.check(Schema.isMaxLength(VOICE_AUDIO_BASE64_MAX_LENGTH)),
  mimeType: TrimmedNonEmptyString,
  localeHint: Schema.optional(VoiceLocaleHint),
  /**
   * Client-extracted vocabulary from the current session (draft text, thread
   * title, visible messages). Listed first when the server merges lists, so
   * what the user is looking at outranks learned history.
   */
  sessionTerms: Schema.Array(VoiceSessionTerm).check(
    Schema.isMaxLength(VOICE_SESSION_TERMS_MAX_ITEMS),
  ),
});
export type VoiceTranscribeInput = typeof VoiceTranscribeInput.Type;

export const VoiceTranscribeResult = Schema.Struct({
  text: Schema.String,
  /** Size of the merged vocabulary list the recognizer was given. */
  vocabularyCount: NonNegativeInt,
});
export type VoiceTranscribeResult = typeof VoiceTranscribeResult.Type;

export class VoiceDictationUnsupportedError extends Schema.TaggedErrorClass<VoiceDictationUnsupportedError>()(
  "VoiceDictationUnsupportedError",
  {},
) {
  override get message(): string {
    return "This environment cannot transcribe voice. On-device dictation requires macOS 26 or newer.";
  }
}

export class VoiceAudioTooLargeError extends Schema.TaggedErrorClass<VoiceAudioTooLargeError>()(
  "VoiceAudioTooLargeError",
  { receivedBytes: Schema.Number },
) {
  override get message(): string {
    return "The recording exceeds the 12 MB limit.";
  }
}

export class VoiceTranscriptionFailedError extends Schema.TaggedErrorClass<VoiceTranscriptionFailedError>()(
  "VoiceTranscriptionFailedError",
  {
    /** Stable, bounded description; never the sidecar's raw stderr. */
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Voice transcription failed: ${this.detail}`;
  }
}
