import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";
import type {
  CodexSettings,
  ProjectIconGenerationInput,
  ProjectIconGenerationResult,
} from "@t3tools/contracts";
import { ProjectIconGenerationError } from "@t3tools/contracts";
import type * as CodexSchema from "effect-codex-app-server/schema";

import { withCodexAppServerClient } from "../provider/Layers/CodexProvider.ts";
import { resolveCodexLaunchArgs } from "../provider/Layers/codexLaunchArgs.ts";
import type { ImageGenerationInstance } from "./ImageGeneration.ts";
import { buildProjectIconImagePrompt } from "./iconPrompt.ts";
import { PngError, sliceHorizontalGrid } from "./pngGrid.ts";

const GENERATION_TIMEOUT_MS = 240_000;
const ICON_COUNT = 3;

const isProjectIconGenerationError = Schema.is(ProjectIconGenerationError);

/**
 * Build a Codex image-generation closure bound to a specific `CodexSettings`
 * payload. Runs exactly one ephemeral app-server turn: the model's image
 * generation tool reports a saved image containing the three-icon grid, and
 * the adapter slices that image into the individual icon files.
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

      // The imageGeneration thread item arrives via item/completed; the turn
      // completion notification bounds the wait. One generation, one image.
      const savedPaths: string[] = [];
      yield* client.handleServerNotification("item/completed", (notification) =>
        Effect.sync(() => {
          const item = notification.item;
          if (item.type === "imageGeneration" && item.status === "completed" && item.savedPath) {
            savedPaths.push(item.savedPath);
          }
        }),
      );
      const turnCompleted =
        yield* Deferred.make<CodexSchema.V2TurnCompletedNotification["turn"]["status"]>();
      yield* client.handleServerNotification("turn/completed", (notification) =>
        Deferred.succeed(turnCompleted, notification.turn.status).pipe(Effect.asVoid),
      );

      const thread = yield* client
        .request("thread/start", {
          ephemeral: true,
          sandbox: "read-only",
          cwd: generationDir,
        })
        .pipe(
          Effect.mapError((cause) => failure("failed", "Codex could not start a session.", cause)),
        );

      yield* client
        .request("turn/start", {
          threadId: thread.thread.id,
          input: [{ type: "text", text: buildProjectIconImagePrompt(input) }],
        })
        .pipe(
          Effect.mapError((cause) =>
            failure("failed", "Codex rejected the image generation request.", cause),
          ),
        );

      const turnStatus = yield* Deferred.await(turnCompleted).pipe(
        Effect.timeoutOption(GENERATION_TIMEOUT_MS),
        Effect.mapError((cause) => failure("failed", "Codex image generation crashed.", cause)),
      );
      if (Option.isNone(turnStatus)) {
        return yield* failure("timeout", "Codex took too long to generate the icon image.");
      }

      if (savedPaths.length === 0) {
        return yield* failure(
          turnStatus.value === "completed" ? "invalid-output" : "failed",
          turnStatus.value === "completed"
            ? "Codex finished without producing an icon image."
            : "Codex failed to generate an icon image.",
        );
      }

      // The model sometimes returns several images per turn; the one that
      // slices into the most variants is the intended icon grid.
      let best: { tiles: ReadonlyArray<Uint8Array>; error?: unknown } | null = null;
      for (const savedPath of [...savedPaths].reverse()) {
        const bytes = yield* fileSystem
          .readFile(savedPath)
          .pipe(
            Effect.mapError((cause) =>
              failure("invalid-output", "The generated icon image could not be read.", cause),
            ),
          );
        try {
          const tiles = sliceHorizontalGrid(bytes, ICON_COUNT);
          if (!best || tiles.length > best.tiles.length) {
            best = { tiles };
          }
          if (tiles.length >= ICON_COUNT) break;
        } catch (cause) {
          if (!best) best = { tiles: [], error: cause };
        }
      }
      if (!best || best.tiles.length === 0) {
        const cause = best?.error;
        const message =
          cause instanceof PngError
            ? `The generated image is not a usable PNG: ${cause.message}`
            : "The generated image could not be sliced into icons.";
        return yield* failure("invalid-output", message, cause);
      }
      const tiles = best.tiles;

      const iconPaths: string[] = [];
      for (const [index, tile] of tiles.entries()) {
        const tilePath = path.join(generationDir, `icon-${index + 1}.png`);
        yield* fileSystem
          .writeFile(tilePath, tile)
          .pipe(
            Effect.mapError((cause) =>
              failure("failed", "Failed to save the generated icon tiles.", cause),
            ),
          );
        iconPaths.push(tilePath);
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
