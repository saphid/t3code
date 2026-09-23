import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";
import type { CodexSettings, ProjectIconGenerationResult } from "@t3tools/contracts";
import { ProjectIconGenerationError } from "@t3tools/contracts";
import type * as CodexSchema from "effect-codex-app-server/schema";

import { withCodexAppServerClient } from "../provider/Layers/CodexProvider.ts";
import { resolveCodexLaunchArgs } from "../provider/Layers/codexLaunchArgs.ts";
import type { ImageGenerationInstance } from "./ImageGeneration.ts";
import { buildProjectIconImagePrompt, ICON_VARIANT_DIRECTIONS } from "./iconPrompt.ts";
import { PngError, resizeToSquareIcon } from "./png.ts";

const GENERATION_TIMEOUT_MS = 240_000;
/** Saved icon size: sharp at 16 px on 3x displays and in the picker preview. */
const ICON_SIZE = 256;

const isProjectIconGenerationError = Schema.is(ProjectIconGenerationError);

/**
 * Build a Codex image-generation closure bound to a specific `CodexSettings`
 * payload. Runs one ephemeral app-server turn per icon variant; each turn's
 * image generation tool reports a saved image, which the adapter shrinks to
 * icon size and saves into a fresh directory for this generation.
 */
export const makeCodexImageGeneration = Effect.fn("makeCodexImageGeneration")(function* (
  codexConfig: CodexSettings,
  environment: NodeJS.ProcessEnv | undefined,
  outputDir: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const resolvedEnvironment = environment ?? process.env;

  const generateProjectIcons: ImageGenerationInstance["generateProjectIcons"] = (input) =>
    Effect.gen(function* () {
      const failure = (
        reason: "failed" | "timeout" | "invalid-output",
        message: string,
        cause?: unknown,
      ) => new ProjectIconGenerationError({ reason, message, ...(cause ? { cause } : {}) });

      const generationDir = path.join(outputDir, yield* crypto.randomUUIDv4);
      yield* fileSystem
        .makeDirectory(generationDir, { recursive: true })
        .pipe(
          Effect.mapError((cause) =>
            failure("failed", "Failed to prepare the icon output directory.", cause),
          ),
        );

      const { client } = yield* withCodexAppServerClient({
        binaryPath: codexConfig.binaryPath || "codex",
        homePath: codexConfig.homePath,
        launchArgs: resolveCodexLaunchArgs(codexConfig.launchArgs, resolvedEnvironment),
        // The image generation tool decides where to save; any directory serves.
        cwd: generationDir,
        environment: resolvedEnvironment,
      }).pipe(Effect.mapError((cause) => failure("failed", "Codex could not be started.", cause)));

      // One ephemeral thread per variant, run in parallel on the same
      // app-server: a model asked for several icons in one image draws grids
      // that cannot be reliably cut apart.
      const generateVariant = (direction: string, index: number) =>
        Effect.gen(function* () {
          const thread = yield* client
            .request("thread/start", { ephemeral: true, sandbox: "read-only", cwd: generationDir })
            .pipe(
              Effect.mapError((cause) =>
                failure("failed", "Codex could not start a session.", cause),
              ),
            );
          const threadId = thread.thread.id;
          let savedPath: string | undefined;
          yield* client.handleServerNotification("item/completed", (notification) =>
            Effect.sync(() => {
              const item = notification.item;
              if (
                notification.threadId === threadId &&
                item.type === "imageGeneration" &&
                item.status === "completed" &&
                item.savedPath
              ) {
                savedPath = item.savedPath;
              }
            }),
          );
          const turnCompleted =
            yield* Deferred.make<CodexSchema.V2TurnCompletedNotification["turn"]["status"]>();
          yield* client.handleServerNotification("turn/completed", (notification) =>
            notification.threadId === threadId
              ? Deferred.succeed(turnCompleted, notification.turn.status).pipe(Effect.asVoid)
              : Effect.void,
          );

          yield* client
            .request("turn/start", {
              threadId,
              input: [{ type: "text", text: buildProjectIconImagePrompt(input, direction) }],
            })
            .pipe(
              Effect.mapError((cause) =>
                failure("failed", "Codex rejected the image generation request.", cause),
              ),
            );
          const turnStatus = yield* Deferred.await(turnCompleted);
          if (!savedPath) {
            return yield* turnStatus === "completed"
              ? failure("invalid-output", "Codex finished without producing an icon image.")
              : failure("failed", "Codex failed to generate an icon image.");
          }

          const bytes = yield* fileSystem
            .readFile(savedPath)
            .pipe(
              Effect.mapError((cause) =>
                failure("invalid-output", "The generated icon image could not be read.", cause),
              ),
            );
          const icon = yield* Effect.try({
            try: () => resizeToSquareIcon(bytes, ICON_SIZE),
            catch: (cause) =>
              failure(
                "invalid-output",
                cause instanceof PngError
                  ? `The generated image is not a usable PNG: ${cause.message}`
                  : "The generated image could not be processed.",
                cause,
              ),
          });
          const iconPath = path.join(generationDir, `icon-${index + 1}.png`);
          yield* fileSystem
            .writeFile(iconPath, icon)
            .pipe(
              Effect.mapError((cause) =>
                failure("failed", "Failed to save the generated icon.", cause),
              ),
            );
          return iconPath;
        });

      const results = yield* Effect.forEach(
        ICON_VARIANT_DIRECTIONS,
        (direction, index) => Effect.result(generateVariant(direction, index)),
        { concurrency: "unbounded" },
      ).pipe(Effect.timeoutOption(GENERATION_TIMEOUT_MS));
      if (Option.isNone(results)) {
        return yield* failure("timeout", "Codex took too long to generate the icons.");
      }

      // Partial success still gives the user something to pick; surface the
      // first failure only when every variant failed.
      const iconPaths = results.value.flatMap((result) =>
        result._tag === "Success" ? [result.success] : [],
      );
      const firstFailure = results.value.find((result) => result._tag === "Failure");
      if (iconPaths.length === 0 && firstFailure?._tag === "Failure") {
        return yield* firstFailure.failure;
      }
      return { iconPaths } satisfies ProjectIconGenerationResult;
    }).pipe(
      // `withCodexAppServerClient` needs the spawner; capture it at
      // construction so the returned closure has no requirements.
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.scoped,
      Effect.catch((error) =>
        isProjectIconGenerationError(error)
          ? Effect.fail(error)
          : Effect.fail(
              new ProjectIconGenerationError({
                reason: "failed",
                message: "Codex image generation failed.",
                cause: error,
              }),
            ),
      ),
    );

  return { generateProjectIcons };
});
