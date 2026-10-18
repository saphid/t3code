/**
 * ImageGeneration - Effect service for AI-generated project icons.
 *
 * Mirrors the `textGeneration` seam: the service resolves a capable provider
 * instance from the registry and delegates to the per-driver adapter. A
 * driver that cannot make images simply never attaches the capability, which
 * is the per-adapter "not supported here" decision.
 *
 * @module imageGeneration/ImageGeneration
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ProjectIconGenerationInput, ProjectIconGenerationResult } from "@t3tools/contracts";
import {
  isProviderAvailable,
  ProjectIconGenerationError,
  type ServerProvider,
} from "@t3tools/contracts";

import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";

/** The per-driver capability attached to a `ProviderInstance`. */
export interface ImageGenerationInstance {
  readonly generateProjectIcons: (
    input: ProjectIconGenerationInput,
  ) => Effect.Effect<ProjectIconGenerationResult, ProjectIconGenerationError>;
}

export class ImageGeneration extends Context.Service<
  ImageGeneration,
  {
    /**
     * Generate three icon tiles from one prompt. The provider produces a
     * single image holding all three variants; the adapter slices it.
     */
    readonly generateProjectIcons: (
      input: ProjectIconGenerationInput,
    ) => Effect.Effect<ProjectIconGenerationResult, ProjectIconGenerationError>;
  }
>()("t3/imageGeneration/ImageGeneration") {}

const isUsableSnapshot = (snapshot: ServerProvider): boolean =>
  snapshot.installed && snapshot.status === "ready" && isProviderAvailable(snapshot);

export const makeImageGenerationFromRegistry = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
): ImageGeneration["Service"] =>
  ImageGeneration.of({
    generateProjectIcons: (input) =>
      Effect.gen(function* () {
        const instances = yield* registry.listInstances;
        let notReady: ServerProvider | undefined;
        for (const instance of instances) {
          if (!instance.enabled || !instance.imageGeneration) continue;
          const snapshot = yield* instance.snapshot.getSnapshot;
          if (isUsableSnapshot(snapshot))
            return yield* instance.imageGeneration.generateProjectIcons(input);
          notReady ??= snapshot;
        }
        return yield* Effect.fail(
          new ProjectIconGenerationError({
            reason: "unsupported",
            message:
              notReady === undefined
                ? "No provider with image generation is available. Add and sign in to a provider that supports it, such as Codex."
                : `${notReady.displayName ?? "The provider"} is available but not ready. Check its status in Settings → Connections.`,
          }),
        );
      }),
  });

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  return makeImageGenerationFromRegistry(registry);
});

export const layer = Layer.effect(ImageGeneration, make);
