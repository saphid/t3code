import * as NodeFs from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { VOICE_AUDIO_MAX_BYTES } from "@t3tools/contracts";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionThreadMessageRepository } from "../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionThreadRepository } from "../persistence/Services/ProjectionThreads.ts";
import { ProcessRunner, type ProcessRunOutput } from "../processRunner.ts";
import * as VoiceDictationService from "./VoiceDictationService.ts";
import { estimateBase64DecodedBytes, normalizeVoiceLocale } from "./VoiceDictationService.ts";

const successOutput = (stdout: string): ProcessRunOutput => ({
  stdout,
  stderr: "",
  code: 0 as ProcessRunOutput["code"],
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});

interface RecordedRun {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

const stubRepositoriesLayer = (input?: {
  readonly messageTexts?: ReadonlyArray<string>;
  readonly titles?: ReadonlyArray<string>;
}) =>
  Layer.mergeAll(
    Layer.succeed(ProjectionThreadMessageRepository, {
      upsert: () => Effect.void,
      getByMessageId: () => Effect.succeed(Option.none()),
      listByThreadId: () => Effect.succeed([]),
      deleteByThreadId: () => Effect.void,
      listRecentUserMessageTexts: () => Effect.succeed(input?.messageTexts ?? []),
    }),
    Layer.succeed(ProjectionThreadRepository, {
      upsert: () => Effect.void,
      getById: () => Effect.succeed(Option.none()),
      listByProjectId: () => Effect.succeed([]),
      deleteById: () => Effect.void,
      listRecentTitles: () => Effect.succeed(input?.titles ?? []),
    }),
  );

const testLayer = (input: {
  readonly platform?: NodeJS.Platform;
  readonly runs?: RecordedRun[];
  readonly run?: ProcessRunner["Service"]["run"];
  readonly messageTexts?: ReadonlyArray<string>;
  readonly titles?: ReadonlyArray<string>;
}) =>
  VoiceDictationService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ProcessRunner, {
          run: (runInput) => {
            input.runs?.push({ command: runInput.command, args: runInput.args });
            return (
              input.run?.(runInput) ??
              Effect.succeed(successOutput('{"supported":true,"installed":true}'))
            );
          },
        }),
        stubRepositoriesLayer(input),
        Layer.succeed(HostProcessPlatform, input.platform ?? "darwin"),
        // The dev-relative sidecar candidates may or may not be built on the
        // machine running the suite; pinning the override to a file that
        // always exists keeps binary resolution deterministic.
        Layer.succeed(HostProcessEnvironment, {
          T3_VOICE_TRANSCRIBER_PATH: process.execPath,
        } as NodeJS.ProcessEnv),
        NodeServices.layer,
      ),
    ),
  );

// A tiny valid-base64 payload; content is irrelevant because the runner is stubbed.
const SMALL_AUDIO_BASE64 = Buffer.from("not really audio").toString("base64");

it("normalizes locales and rejects anything shell-shaped", () => {
  assert.strictEqual(normalizeVoiceLocale("en-AU"), "en_AU");
  assert.strictEqual(normalizeVoiceLocale("en_AU"), "en_AU");
  assert.strictEqual(normalizeVoiceLocale("en"), "en");
  assert.strictEqual(normalizeVoiceLocale("en_AU; rm -rf /"), null);
  assert.strictEqual(normalizeVoiceLocale("$(whoami)"), null);
  assert.strictEqual(normalizeVoiceLocale(undefined), null);
});

it("estimates decoded base64 size without decoding", () => {
  const bytes = Buffer.from("hello voice dictation");
  assert.strictEqual(estimateBase64DecodedBytes(bytes.toString("base64")), bytes.byteLength);
  assert.strictEqual(estimateBase64DecodedBytes(""), 0);
});

it.effect("reports unsupported when the platform has no sidecar", () =>
  Effect.gen(function* () {
    const voice = yield* VoiceDictationService.VoiceDictationService;
    const status = yield* voice.getStatus("en_AU");
    assert.deepStrictEqual(status, { supported: false, installed: false, locale: "en_AU" });

    const transcribeExit = yield* voice
      .transcribe({ audioBase64: SMALL_AUDIO_BASE64, mimeType: "audio/wav", sessionTerms: [] })
      .pipe(Effect.flip);
    assert.strictEqual(transcribeExit._tag, "VoiceDictationUnsupportedError");
  }).pipe(Effect.provide(testLayer({ platform: "linux" }))),
);

it.effect("rejects oversized recordings before spawning anything", () =>
  Effect.gen(function* () {
    const runs: RecordedRun[] = [];
    const voice = yield* VoiceDictationService.VoiceDictationService;
    // Base64 whose decoded estimate lands just past the cap.
    const oversized = "A".repeat(Math.ceil(((VOICE_AUDIO_MAX_BYTES + 4) * 4) / 3));
    const error = yield* voice
      .transcribe({ audioBase64: oversized, mimeType: "audio/wav", sessionTerms: [] })
      .pipe(Effect.flip);
    assert.strictEqual(error._tag, "VoiceAudioTooLargeError");
    assert.isAbove((error as { receivedBytes: number }).receivedBytes, VOICE_AUDIO_MAX_BYTES);
    assert.deepStrictEqual(runs, []);
  }).pipe(Effect.provide(testLayer({ runs: [] }))),
);

it.effect("merges session terms ahead of learned history and applies corrections", () =>
  Effect.gen(function* () {
    const runs: RecordedRun[] = [];
    let vocabularyFileContents: string | null = null;
    const layer = testLayer({
      runs,
      // Learned history that yields identifier-like vocabulary.
      messageTexts: [
        "please run pnpm inside the t3code repo",
        "the t3code build uses pnpm and tsgo",
      ],
      titles: ["Fix worktreeCleanup crash"],
      run: (runInput) => {
        runs.push({ command: runInput.command, args: runInput.args });
        if (runInput.args[0] === "transcribe") {
          const vocabIndex = runInput.args.indexOf("--vocab");
          const vocabPath = runInput.args[vocabIndex + 1]!;
          vocabularyFileContents = NodeFs.readFileSync(vocabPath, "utf8");
          return Effect.succeed(successOutput('{"text":"word tree run via PNP"}'));
        }
        return Effect.succeed(successOutput('{"supported":true,"installed":true}'));
      },
    });

    const result = yield* Effect.gen(function* () {
      const voice = yield* VoiceDictationService.VoiceDictationService;
      return yield* voice.transcribe({
        audioBase64: SMALL_AUDIO_BASE64,
        mimeType: "audio/wav",
        localeHint: "en-AU",
        sessionTerms: ["worktree", "pnpm"],
      });
    }).pipe(Effect.provide(layer));

    // The sidecar received the vocab file with session terms first.
    assert.isNotNull(vocabularyFileContents);
    const vocabulary = JSON.parse(vocabularyFileContents!) as string[];
    assert.deepStrictEqual(vocabulary.slice(0, 2), ["worktree", "pnpm"]);
    assert.include(vocabulary, "worktreeCleanup");
    assert.include(vocabulary, "t3code");
    // No case-insensitive duplicates from the learned list.
    assert.strictEqual(vocabulary.filter((term) => term.toLowerCase() === "pnpm").length, 1);
    assert.strictEqual(result.vocabularyCount, vocabulary.length);

    // Near-miss recognitions snapped back to vocabulary terms.
    assert.strictEqual(result.text, "worktree run via pnpm");

    // The locale hint was normalized to underscore form for the CLI.
    const transcribeRun = runs.find((run) => run.args[0] === "transcribe");
    assert.isDefined(transcribeRun);
    const localeIndex = transcribeRun!.args.indexOf("--locale");
    assert.strictEqual(transcribeRun!.args[localeIndex + 1], "en_AU");
  }),
);

it.effect("maps a nonzero sidecar exit to a fixed detail that never carries stderr", () =>
  Effect.gen(function* () {
    const voice = yield* VoiceDictationService.VoiceDictationService;
    const error = yield* voice
      .transcribe({ audioBase64: SMALL_AUDIO_BASE64, mimeType: "audio/wav", sessionTerms: [] })
      .pipe(Effect.flip);
    assert.strictEqual(error._tag, "VoiceTranscriptionFailedError");
    assert.strictEqual(
      (error as { detail: string }).detail,
      "The transcriber exited with an error.",
    );
    assert.notInclude((error as { detail: string }).detail, "assets are not installed");
  }).pipe(
    Effect.provide(
      testLayer({
        run: () =>
          Effect.succeed({
            ...successOutput(""),
            code: 1 as ProcessRunOutput["code"],
            stderr:
              "dictation assets are not installed for this locale\nand a second line that must not leak",
          }),
      }),
    ),
  ),
);
