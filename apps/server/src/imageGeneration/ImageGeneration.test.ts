import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { ServerProvider } from "@t3tools/contracts";
import { ProjectIconGenerationError } from "@t3tools/contracts";

import { buildProjectIconImagePrompt } from "./iconPrompt.ts";
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
      } as unknown as ServerProvider),
    },
    ...overrides,
  } as never;
}

describe("buildProjectIconImagePrompt", () => {
  it("describes a single image with three variants and no text", () => {
    const prompt = buildProjectIconImagePrompt({ prompt: "A rocket ship", vibe: "neon" });
    expect(prompt).toContain("three distinct app icon variants");
    expect(prompt).toContain("A rocket ship");
    expect(prompt).toContain("Visual style: neon.");
    expect(prompt).toContain("No text");
  });

  it("omits the style line when no vibe is set", () => {
    expect(buildProjectIconImagePrompt({ prompt: "A rocket ship" })).not.toContain("Visual style");
  });
});

describe("makeImageGenerationFromRegistry", () => {
  it("fails with unsupported when no instance carries the capability", async () => {
    const service = makeImageGenerationFromRegistry({
      listInstances: Effect.succeed([makeInstance()]),
    } as never);
    const error = await Effect.runPromise(
      Effect.flip(service.generateProjectIcons({ prompt: "A rocket ship" })),
    );
    expect(isProjectIconGenerationError(error)).toBe(true);
    if (isProjectIconGenerationError(error)) {
      expect(error.reason).toBe("unsupported");
    }
  });

  it("delegates to the first enabled instance that can generate", async () => {
    const service = makeImageGenerationFromRegistry({
      listInstances: Effect.succeed([
        makeInstance(),
        makeInstance({ instanceId: "instance-2", imageGeneration: okInstance }),
      ]),
    } as never);
    const result = await Effect.runPromise(
      service.generateProjectIcons({ prompt: "A rocket ship", vibe: "neon" }),
    );
    expect(result.iconPaths).toHaveLength(3);
  });

  it("treats a not-ready provider as unsupported", async () => {
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
            } as unknown as ServerProvider),
          },
        }),
      ]),
    } as never);
    const error = await Effect.runPromise(
      Effect.flip(service.generateProjectIcons({ prompt: "A rocket ship" })),
    );
    expect(isProjectIconGenerationError(error)).toBe(true);
  });
});
