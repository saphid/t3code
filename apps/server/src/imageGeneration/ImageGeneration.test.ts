import { it } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { ServerProvider } from "@t3tools/contracts";
import { ProjectIconGenerationError } from "@t3tools/contracts";

import { buildProjectIconImagePrompt, ICON_VARIANT_DIRECTIONS } from "./iconPrompt.ts";
import {
  makeImageGenerationFromRegistry,
  type ImageGenerationInstance,
} from "./ImageGeneration.ts";

const isProjectIconGenerationError = Schema.is(ProjectIconGenerationError);

const okInstance: ImageGenerationInstance = {
  generateProjectIcons: (input) =>
    Effect.succeed({
      iconPaths: [`/icons/${input.prompt.length}.png`, "/icons/2.png", "/icons/3.png"],
    }),
};

function makeInstance(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    instanceId: "instance-1",
    driverKind: "codex",
    enabled: true,
    snapshot: {
      getSnapshot: Effect.succeed({
        displayName: "Codex",
        enabled: true,
        installed: true,
        status: "ready",
        availability: "available",
        supportsImageGeneration: true,
      } as unknown as ServerProvider),
    },
    ...overrides,
  } as never;
}

describe("buildProjectIconImagePrompt", () => {
  it("asks for one full-bleed icon with the variant direction and no text", () => {
    const prompt = buildProjectIconImagePrompt(
      { prompt: "A rocket ship", vibe: "neon" },
      ICON_VARIANT_DIRECTIONS[1],
    );
    expect(prompt).toContain("exactly one image");
    expect(prompt).toContain("A rocket ship");
    expect(prompt).toContain("Visual style: neon.");
    expect(prompt).toContain(ICON_VARIANT_DIRECTIONS[1]);
    expect(prompt).toContain("edge to edge");
    expect(prompt).toContain("no text, letters, or numbers");
  });

  it("omits the style line when no vibe is set", () => {
    expect(
      buildProjectIconImagePrompt({ prompt: "A rocket ship" }, ICON_VARIANT_DIRECTIONS[0]),
    ).not.toContain("Visual style");
  });
});

describe("makeImageGenerationFromRegistry", () => {
  it.effect("fails with unsupported when no instance carries the capability", () =>
    Effect.gen(function* () {
      const service = makeImageGenerationFromRegistry({
        listInstances: Effect.succeed([makeInstance()]),
      } as never);
      const error = yield* Effect.flip(service.generateProjectIcons({ prompt: "A rocket ship" }));
      expect(isProjectIconGenerationError(error)).toBe(true);
      expect(error.reason).toBe("unsupported");
    }),
  );

  it.effect("delegates to the first enabled instance that can generate", () =>
    Effect.gen(function* () {
      const service = makeImageGenerationFromRegistry({
        listInstances: Effect.succeed([
          makeInstance(),
          makeInstance({ instanceId: "instance-2", imageGeneration: okInstance }),
        ]),
      } as never);
      const result = yield* service.generateProjectIcons({ prompt: "A rocket ship", vibe: "neon" });
      expect(result.iconPaths).toHaveLength(3);
    }),
  );

  it.effect("treats a not-ready provider as unsupported", () =>
    Effect.gen(function* () {
      const service = makeImageGenerationFromRegistry({
        listInstances: Effect.succeed([
          makeInstance({
            imageGeneration: okInstance,
            snapshot: {
              getSnapshot: Effect.succeed({
                displayName: "Codex",
                enabled: true,
                installed: true,
                status: "error",
                supportsImageGeneration: true,
              } as unknown as ServerProvider),
            },
          }),
        ]),
      } as never);
      const error = yield* Effect.flip(service.generateProjectIcons({ prompt: "A rocket ship" }));
      expect(error.reason).toBe("unsupported");
    }),
  );

  it.effect("skips an instance whose account cannot make images for one that can", () =>
    Effect.gen(function* () {
      const service = makeImageGenerationFromRegistry({
        listInstances: Effect.succeed([
          makeInstance({
            imageGeneration: {
              generateProjectIcons: () => Effect.die("should not be called"),
            } satisfies ImageGenerationInstance,
            snapshot: {
              getSnapshot: Effect.succeed({
                displayName: "Codex",
                installed: true,
                status: "ready",
                availability: "available",
                supportsImageGeneration: false,
              } as unknown as ServerProvider),
            },
          }),
          makeInstance({ instanceId: "instance-2", imageGeneration: okInstance }),
        ]),
      } as never);
      const result = yield* service.generateProjectIcons({ prompt: "A rocket" });
      expect(result.iconPaths).toHaveLength(3);
    }),
  );
});
