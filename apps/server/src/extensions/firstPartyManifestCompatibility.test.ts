import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { ApiDefinition } from "@t3tools/extension-sdk/capabilities";
import * as Catalogue from "@t3tools/extension-sdk/catalogue";
import {
  resolveCapabilities,
  type ResolutionInstallation,
} from "@t3tools/extension-runtime/resolution";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

const PACKS = ["browser", "diff", "terminal", "version-control"];

/** The committed manifests, as the host loads them. */
const loadInstallations = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const packs = path.resolve(import.meta.dirname, "../../../../packages/first-party-extensions");
  return yield* Effect.forEach(PACKS, (pack, index) =>
    fs.readFileString(path.join(packs, pack, ".t3-extension/t3-extension.json")).pipe(
      Effect.map((text): ResolutionInstallation => ({
        id: `first-party.${pack}.${index}`,
        enabled: true,
        package: JSON.parse(text),
      })),
    ),
  );
});

/** Every catalogue API no pack provides, at its newest version, as a current host has it. */
function hostApis(
  installations: readonly ResolutionInstallation[],
  overrides: Record<string, string> = {},
): ApiDefinition[] {
  const packProvided = new Set(
    installations.flatMap((item) => (item.package.provides ?? []).map(({ id }) => id)),
  );
  const newest = new Map<string, ApiDefinition>();
  for (const value of Object.values(Catalogue)) {
    const definition = (value as { definition?: ApiDefinition } | null)?.definition;
    if (typeof definition?.id !== "string" || packProvided.has(definition.id)) continue;
    const current = newest.get(definition.id);
    if (!current || current.version.localeCompare(definition.version, "en", { numeric: true }) < 0)
      newest.set(definition.id, definition);
  }
  return [...newest.values()].map((definition) =>
    definition.id in overrides ? { ...definition, version: overrides[definition.id]! } : definition,
  );
}

const statuses = (
  installations: readonly ResolutionInstallation[],
  apis: readonly ApiDefinition[],
) =>
  resolveCapabilities({
    installations,
    providers: apis.map((definition) => ({ providerId: `host:${definition.id}`, definition })),
  }).plugins.map(({ status, reason }) => ({ status, reason: reason?.relatedIds }));

describe("first-party pack manifests", () => {
  it.effect("load on a host whose t3.ui/notifications is still 1.0.0", () =>
    Effect.gen(function* () {
      const installations = yield* loadInstallations;
      const available = PACKS.map(() => ({ status: "available", reason: undefined }));
      expect(statuses(installations, hostApis(installations))).toEqual(available);
      expect(
        statuses(installations, hostApis(installations, { "t3.ui/notifications": "1.0.0" })),
      ).toEqual(available);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
