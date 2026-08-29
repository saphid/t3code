import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as CodexClient from "effect-codex-app-server/client";
import packageJson from "../../../package.json" with { type: "json" };

import {
  applyPreferredCodexDefaultModel,
  buildCodexInitializeParams,
  CodexInitializeCompatibilityError,
  initializeCodexAppServer,
  mapCodexModelCapabilities,
} from "./CodexProvider.ts";

it("builds the stable Codex initialize payload", () => {
  assert.deepStrictEqual(buildCodexInitializeParams(), {
    clientInfo: {
      name: "t3code_desktop",
      version: packageJson.version,
    },
    capabilities: {
      experimentalApi: true,
    },
  });
});

it.effect("accepts initialize responses from older supported Codex versions", () =>
  Effect.gen(function* () {
    let request: { readonly method: string; readonly payload: unknown } | undefined;
    const client = {
      raw: {
        request: (method: string, payload: unknown) => {
          request = { method, payload };
          return Effect.succeed({ userAgent: "codex_cli_rs/0.100.0" });
        },
      },
    } as unknown as CodexClient.CodexAppServerClient["Service"];

    const response = yield* initializeCodexAppServer(client);

    assert.deepStrictEqual(response, { userAgent: "codex_cli_rs/0.100.0" });
    assert.deepStrictEqual(request, {
      method: "initialize",
      payload: buildCodexInitializeParams(),
    });
  }),
);

it.effect("accepts current Codex initialize response metadata", () =>
  Effect.gen(function* () {
    const response = {
      userAgent: "codex_cli_rs/0.149.1",
      codexHome: "C:\\Users\\Jos\u00e9 Agent\\.codex",
      platformFamily: "windows",
      platformOs: "windows",
    };
    const client = {
      raw: {
        request: () => Effect.succeed(response),
      },
    } as unknown as CodexClient.CodexAppServerClient["Service"];

    assert.deepStrictEqual(yield* initializeCodexAppServer(client), response);
  }),
);

it.effect("returns an actionable typed error for incompatible initialize responses", () =>
  Effect.gen(function* () {
    const client = {
      raw: {
        request: () => Effect.succeed({ platformFamily: "windows" }),
      },
    } as unknown as CodexClient.CodexAppServerClient["Service"];

    const error = yield* initializeCodexAppServer(client).pipe(Effect.flip);

    assert.instanceOf(error, CodexInitializeCompatibilityError);
    assert.match(error.message, /Update Codex and try again/);
  }),
);

it("maps current Codex model capability fields", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: [],
    defaultReasoningEffort: "super-high",
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    defaultServiceTier: "flex",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "Lower latency responses.",
      },
      {
        id: "flex",
        name: "Flex",
        description: "Lower-cost asynchronous routing.",
      },
    ],
    supportedReasoningEfforts: [
      {
        description: "Maximum reasoning",
        reasoningEffort: "super-high",
      },
    ],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [{ id: "super-high", label: "super-high", isDefault: true }],
      currentValue: "super-high",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard" },
        {
          id: "priority",
          label: "Fast",
          description: "Lower latency responses.",
        },
        {
          id: "flex",
          label: "Flex",
          description: "Lower-cost asynchronous routing.",
          isDefault: true,
        },
      ],
      currentValue: "flex",
    },
  ]);
});

it("uses standard routing when the catalog has no default service tier", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: ["fast"],
    defaultReasoningEffort: "medium",
    defaultServiceTier: null,
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "1.5x speed, increased usage",
      },
    ],
    supportedReasoningEfforts: [],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        {
          id: "priority",
          label: "Fast",
          description: "1.5x speed, increased usage",
        },
      ],
      currentValue: "default",
    },
  ]);
});

it("marks the most preferred available model as default", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(
    models.map((model) => ({ slug: model.slug, isDefault: model.isDefault })),
    [
      { slug: "gpt-5.6-terra", isDefault: true },
      { slug: "gpt-5.4", isDefault: undefined },
    ],
  );
});

it("prefers sol over terra when both are available", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.6-sol", name: "GPT-5.6-Sol", isCustom: false, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.6-sol");
});

it("keeps Codex's own default when no preferred model is available", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.5", name: "GPT-5.5", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});

it("ignores custom models that shadow a preferred slug", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-sol", name: "gpt-5.6-sol", isCustom: true, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});
