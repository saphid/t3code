/**
 * VoiceDictationService - on-device dictation via the native sidecar.
 *
 * Audio arrives base64-encoded over RPC, is bounced through a scoped temp
 * file, and is transcribed by `t3-voice-transcriber` (Apple's speech stack,
 * macOS 26+ only). Nothing leaves the machine.
 *
 * Vocabulary: the client sends terms extracted from what the user is looking
 * at; the server adds terms learned from recent user-authored messages and
 * thread titles in the projections DB (cached for five minutes), and the
 * merged list is handed to the recognizer plus used for post-transcription
 * corrections.
 *
 * @module VoiceDictationService
 */
import {
  VOICE_AUDIO_MAX_BYTES,
  VOICE_LOCALE_PATTERN,
  VoiceAudioTooLargeError,
  VoiceDictationUnsupportedError,
  type VoiceDictationStatus,
  type VoiceTranscribeInput,
  type VoiceTranscribeResult,
  VoiceTranscriptionFailedError,
} from "@t3tools/contracts";
import {
  applyVoiceVocabularyCorrections,
  extractVoiceVocabulary,
  mergeVoiceVocabulary,
  type VoiceVocabularySource,
} from "@t3tools/shared/voiceVocabulary";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { ProjectionThreadMessageRepository } from "../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionThreadRepository } from "../persistence/Services/ProjectionThreads.ts";
import { ProcessRunner } from "../processRunner.ts";

/** Learned history moves slowly; rebuilding it per keypress-sized request is waste. */
const LEARNED_VOCABULARY_TTL_MS = 5 * 60 * 1000;
const LEARNED_MESSAGE_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const LEARNED_MESSAGE_LIMIT = 500;
const LEARNED_TITLE_LIMIT = 200;

const STATUS_TIMEOUT = "30 seconds";
/** Asset download over a slow connection; generous by design. */
const INSTALL_TIMEOUT = "5 minutes";
const TRANSCRIBE_TIMEOUT = "3 minutes";

/** Longest stderr fragment allowed into the server-side warning log. */
const MAX_LOGGED_STDERR_LENGTH = 160;

const SidecarStatusOutput = Schema.Struct({
  supported: Schema.Boolean,
  installed: Schema.Boolean,
  locale: Schema.optional(Schema.String),
});
const decodeSidecarStatus = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    SidecarStatusOutput as unknown as Schema.Codec<typeof SidecarStatusOutput.Type>,
  ),
);

const SidecarTranscribeOutput = Schema.Struct({
  text: Schema.String,
});
const decodeSidecarTranscription = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    SidecarTranscribeOutput as unknown as Schema.Codec<typeof SidecarTranscribeOutput.Type>,
  ),
);

const VocabularyFile = Schema.Array(Schema.String);
const encodeVocabularyFile = Schema.encodeEffect(
  Schema.fromJsonString(VocabularyFile as unknown as Schema.Codec<typeof VocabularyFile.Type>),
);

export class VoiceDictationService extends Context.Service<
  VoiceDictationService,
  {
    readonly getStatus: (
      localeHint?: string,
    ) => Effect.Effect<VoiceDictationStatus, VoiceTranscriptionFailedError>;
    readonly install: (
      localeHint?: string,
    ) => Effect.Effect<
      VoiceDictationStatus,
      VoiceDictationUnsupportedError | VoiceTranscriptionFailedError
    >;
    readonly transcribe: (
      input: VoiceTranscribeInput,
    ) => Effect.Effect<
      VoiceTranscribeResult,
      VoiceDictationUnsupportedError | VoiceAudioTooLargeError | VoiceTranscriptionFailedError
    >;
  }
>()("t3/voice/VoiceDictationService") {}

/** Unsupported everywhere, for suites that only need the RPC surface to resolve. */
export const layerTest = Layer.succeed(
  VoiceDictationService,
  VoiceDictationService.of({
    getStatus: (localeHint) =>
      Effect.succeed({ supported: false, installed: false, locale: localeHint ?? "en_US" }),
    install: () => Effect.fail(new VoiceDictationUnsupportedError()),
    transcribe: () => Effect.fail(new VoiceDictationUnsupportedError()),
  }),
);

/**
 * Normalizes a locale to the sidecar's underscore form. Anything that does
 * not match the strict pattern is rejected: the value becomes a CLI argument.
 */
export function normalizeVoiceLocale(candidate: string | undefined): string | null {
  if (candidate === undefined) return null;
  const normalized = candidate.trim().replace("-", "_");
  return VOICE_LOCALE_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Upper bound on the decoded size of a base64 payload, computed without
 * decoding so an oversized recording is rejected before it costs memory.
 */
export function estimateBase64DecodedBytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function audioExtensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("aiff") || normalized.includes("x-aiff")) return "aiff";
  if (normalized.includes("m4a") || normalized.includes("mp4")) return "m4a";
  return "wav";
}

/**
 * Logs a sidecar failure server-side with a bounded stderr excerpt. The raw
 * stderr never reaches the client; callers hand the client a fixed string.
 */
function logSidecarFailure(
  command: string,
  output: { readonly code: number | null; readonly stderr: string },
) {
  const firstLine = output.stderr.trim().split("\n")[0]?.trim() ?? "";
  const bounded =
    firstLine.length === 0
      ? "(no stderr)"
      : firstLine.length > MAX_LOGGED_STDERR_LENGTH
        ? `${firstLine.slice(0, MAX_LOGGED_STDERR_LENGTH - 1)}…`
        : firstLine;
  return Effect.logWarning(
    `voice sidecar '${command}' exited with code ${output.code}: ${bounded}`,
  );
}

interface LearnedVocabularyCache {
  readonly fetchedAtMs: number;
  readonly terms: ReadonlyArray<string>;
}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processRunner = yield* ProcessRunner;
  const platform = yield* HostProcessPlatform;
  const environment = yield* HostProcessEnvironment;
  const threadMessages = yield* ProjectionThreadMessageRepository;
  const threads = yield* ProjectionThreadRepository;

  const learnedCache = yield* Ref.make<LearnedVocabularyCache | null>(null);

  const hostLocale =
    normalizeVoiceLocale(Intl.DateTimeFormat().resolvedOptions().locale) ?? "en_US";

  const resolveLocale = (localeHint: string | undefined): string =>
    normalizeVoiceLocale(localeHint) ?? hostLocale;

  // Dev builds run from source, so the sidecar sits next to the server
  // package rather than next to the emitted bundle; probe both layouts.
  const binaryCandidates = [
    ...(environment.T3_VOICE_TRANSCRIBER_PATH ? [environment.T3_VOICE_TRANSCRIBER_PATH] : []),
    path.resolve(import.meta.dirname, "voice-transcriber", "t3-voice-transcriber"),
    path.resolve(
      import.meta.dirname,
      "../../native/voice-transcriber/.build/arm64-apple-macosx/release/t3-voice-transcriber",
    ),
    path.resolve(
      import.meta.dirname,
      "../../../native/voice-transcriber/.build/arm64-apple-macosx/release/t3-voice-transcriber",
    ),
  ];

  const resolveBinary = Effect.fn("VoiceDictationService.resolveBinary")(function* () {
    if (platform !== "darwin") return null;
    for (const candidate of binaryCandidates) {
      const exists = yield* fileSystem
        .exists(candidate)
        .pipe(Effect.catchTag("PlatformError", () => Effect.succeed(false)));
      if (exists) return candidate;
    }
    return null;
  });

  const getStatus: VoiceDictationService["Service"]["getStatus"] = Effect.fn(
    "VoiceDictationService.getStatus",
  )(function* (localeHint?: string) {
    const locale = resolveLocale(localeHint);
    const binary = yield* resolveBinary();
    if (binary === null) {
      return { supported: false, installed: false, locale };
    }

    // A status probe that cannot run is an unsupported environment, not an
    // error page: older macOS exits nonzero here and that answer is "no".
    // Only expected process failures map to "no"; defects and interruption
    // must propagate.
    const output = yield* processRunner
      .run({
        command: binary,
        args: ["status", "--locale", locale],
        timeout: STATUS_TIMEOUT,
      })
      .pipe(
        Effect.catchTags({
          ProcessSpawnError: () => Effect.succeed(null),
          ProcessStdinError: () => Effect.succeed(null),
          ProcessOutputLimitError: () => Effect.succeed(null),
          ProcessReadError: () => Effect.succeed(null),
          ProcessTimeoutError: () => Effect.succeed(null),
        }),
      );
    if (output === null || output.code !== 0) {
      return { supported: false, installed: false, locale };
    }

    const parsed = yield* decodeSidecarStatus(output.stdout).pipe(
      Effect.catchTag("SchemaError", () => Effect.succeed(null)),
    );
    if (parsed === null) {
      return { supported: false, installed: false, locale };
    }

    return {
      supported: parsed.supported,
      installed: parsed.installed,
      locale: parsed.locale ?? locale,
    };
  });

  const requireBinary = Effect.fn("VoiceDictationService.requireBinary")(function* () {
    const binary = yield* resolveBinary();
    if (binary === null) {
      return yield* new VoiceDictationUnsupportedError();
    }
    return binary;
  });

  const install: VoiceDictationService["Service"]["install"] = Effect.fn(
    "VoiceDictationService.install",
  )(function* (localeHint?: string) {
    const locale = resolveLocale(localeHint);
    const binary = yield* requireBinary();

    const output = yield* processRunner
      .run({
        command: binary,
        args: ["install", "--locale", locale],
        timeout: INSTALL_TIMEOUT,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VoiceTranscriptionFailedError({
              detail:
                cause._tag === "ProcessTimeoutError"
                  ? "Installing dictation assets timed out."
                  : "The dictation installer could not be started.",
              cause,
            }),
        ),
      );
    if (output.code !== 0) {
      yield* logSidecarFailure("install", output);
      return yield* new VoiceTranscriptionFailedError({
        detail: "Installing dictation assets failed.",
      });
    }

    return yield* getStatus(locale);
  });

  const readLearnedVocabulary = Effect.fn("VoiceDictationService.readLearnedVocabulary")(
    function* () {
      const now = yield* Clock.currentTimeMillis;
      const cached = yield* Ref.get(learnedCache);
      if (cached !== null && now - cached.fetchedAtMs < LEARNED_VOCABULARY_TTL_MS) {
        return cached.terms;
      }

      const since = DateTime.formatIso(DateTime.makeUnsafe(now - LEARNED_MESSAGE_LOOKBACK_MS));
      const sources = yield* Effect.gen(function* () {
        const [messageTexts, titles] = yield* Effect.all([
          threadMessages.listRecentUserMessageTexts({ since, limit: LEARNED_MESSAGE_LIMIT }),
          threads.listRecentTitles({ limit: LEARNED_TITLE_LIMIT }),
        ]);
        return [
          // Titles are condensed, user-facing summaries; their terms are worth
          // double a passing mention in a message body.
          ...titles.map((title): VoiceVocabularySource => ({ text: title, weight: 2 })),
          ...messageTexts.map((text): VoiceVocabularySource => ({ text, weight: 1 })),
        ];
      }).pipe(
        // Missing history must degrade the vocabulary, never the dictation.
        // Only repository failures are absorbed; interruption propagates.
        Effect.catchTags({
          PersistenceSqlError: () => Effect.succeed<VoiceVocabularySource[]>([]),
          PersistenceDecodeError: () => Effect.succeed<VoiceVocabularySource[]>([]),
        }),
      );

      const terms = extractVoiceVocabulary(sources);
      yield* Ref.set(learnedCache, { fetchedAtMs: now, terms });
      return terms;
    },
  );

  const transcribe: VoiceDictationService["Service"]["transcribe"] = Effect.fn(
    "VoiceDictationService.transcribe",
  )(function* (input: VoiceTranscribeInput) {
    const binary = yield* requireBinary();
    const locale = resolveLocale(input.localeHint);

    // Reject on the encoded length alone: an oversized recording must never
    // be buffered, decoded, or written anywhere first.
    const estimatedBytes = estimateBase64DecodedBytes(input.audioBase64);
    if (estimatedBytes > VOICE_AUDIO_MAX_BYTES) {
      return yield* new VoiceAudioTooLargeError({ receivedBytes: estimatedBytes });
    }

    const audioBytes = Buffer.from(input.audioBase64, "base64");
    if (audioBytes.byteLength === 0) {
      return yield* new VoiceTranscriptionFailedError({ detail: "The recording was empty." });
    }
    if (audioBytes.byteLength > VOICE_AUDIO_MAX_BYTES) {
      return yield* new VoiceAudioTooLargeError({ receivedBytes: audioBytes.byteLength });
    }

    const learned = yield* readLearnedVocabulary();
    const vocabulary = mergeVoiceVocabulary([input.sessionTerms, learned]);

    return yield* Effect.gen(function* () {
      const tempDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-voice-" });
      const audioPath = path.join(tempDir, `audio.${audioExtensionForMimeType(input.mimeType)}`);
      const vocabPath = path.join(tempDir, "vocab.json");
      yield* fileSystem.writeFile(audioPath, new Uint8Array(audioBytes));
      const vocabularyJson = yield* encodeVocabularyFile(vocabulary).pipe(
        Effect.catchTag(
          "SchemaError",
          (cause) =>
            new VoiceTranscriptionFailedError({
              detail: "The vocabulary list could not be serialized.",
              cause,
            }),
        ),
      );
      yield* fileSystem.writeFileString(vocabPath, vocabularyJson);

      const output = yield* processRunner
        .run({
          command: binary,
          args: ["transcribe", "--audio", audioPath, "--locale", locale, "--vocab", vocabPath],
          timeout: TRANSCRIBE_TIMEOUT,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new VoiceTranscriptionFailedError({
                detail:
                  cause._tag === "ProcessTimeoutError"
                    ? "Transcription timed out."
                    : "The transcriber could not be started.",
                cause,
              }),
          ),
        );
      if (output.code !== 0) {
        yield* logSidecarFailure("transcribe", output);
        return yield* new VoiceTranscriptionFailedError({
          detail: "The transcriber exited with an error.",
        });
      }

      const parsed = yield* decodeSidecarTranscription(output.stdout).pipe(
        Effect.catchTag(
          "SchemaError",
          (cause) =>
            new VoiceTranscriptionFailedError({
              detail: "The transcriber returned an unreadable result.",
              cause,
            }),
        ),
      );

      return {
        text: applyVoiceVocabularyCorrections(parsed.text, vocabulary),
        vocabularyCount: vocabulary.length,
      } satisfies VoiceTranscribeResult;
    }).pipe(
      Effect.scoped,
      Effect.catchTags({
        // Temp-file plumbing failures are environmental; keep the raw error
        // server-side and hand the client a bounded description.
        PlatformError: (cause) =>
          new VoiceTranscriptionFailedError({
            detail: "The recording could not be staged for transcription.",
            cause,
          }),
      }),
    );
  });

  return { getStatus, install, transcribe } as const;
});

export const layer = Layer.effect(VoiceDictationService, make);
