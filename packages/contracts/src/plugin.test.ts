import { describe, expect, it } from "@effect/vitest";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { PluginManifest } from "./plugin.ts";

const decode = Schema.decodeUnknownExit(PluginManifest);

const minimal = {
  id: "acme.notifier",
  name: "Notifier",
  version: "1.2.3",
  apiVersion: 1,
  entry: "dist/main.mjs",
};

describe("PluginManifest", () => {
  it("defaults optional fields and ignores keys from newer manifests", () => {
    const decoded = decode({ ...minimal, contributes: { views: [] } });
    expect(Exit.isSuccess(decoded) && decoded.value).toEqual({
      ...minimal,
      capabilities: [],
      proposedApi: false,
    });
  });

  it("keeps an unknown API version decodable so the loader can explain it", () => {
    expect(Exit.isSuccess(decode({ ...minimal, apiVersion: 2 }))).toBe(true);
  });

  it.each([
    ["an unqualified id", { id: "notifier" }],
    ["an uppercase id", { id: "Acme.Notifier" }],
    ["an absolute entry", { entry: "/tmp/main.mjs" }],
    ["a parent entry", { entry: "lib/../../main.mjs" }],
    ["a TypeScript entry", { entry: "main.ts" }],
    ["a Windows entry", { entry: "C:\\main.mjs" }],
    ["a malformed capability", { capabilities: ["Tools!"] }],
  ])("rejects %s", (_label, override) => {
    expect(Exit.isFailure(decode({ ...minimal, ...override }))).toBe(true);
  });
});
