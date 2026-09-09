import { describe, it, expect } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { PrimaryConnectionTarget, type PreparedConnection } from "../connection/model.ts";
import { remoteHttpClientLayer } from "../rpc/http.ts";
import { environmentExtensionsHttp } from "./extensions.ts";
const target = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("env"),
  label: "Fixture",
  httpBaseUrl: "https://fixture.example/base",
  wsBaseUrl: "wss://fixture.example",
});
const prepared: PreparedConnection = {
  environmentId: target.environmentId,
  label: target.label,
  httpBaseUrl: target.httpBaseUrl,
  socketUrl: "wss://fixture.example/ws",
  httpAuthorization: null,
  target,
};
describe("environment extension HTTP", () => {
  it.effect("uses the prepared environment's cookie and exact route", () =>
    Effect.gen(function* () {
      const calls: RequestInit[] = [];
      const result = yield* environmentExtensionsHttp.list(prepared).pipe(
        Effect.provide(
          remoteHttpClientLayer((url, init) => {
            expect(String(url)).toBe("https://fixture.example/api/extensions/list");
            calls.push(init ?? {});
            return Promise.resolve(Response.json({ installations: [] }));
          }),
        ),
      );
      expect(result.installations).toEqual([]);
      expect(calls[0]?.credentials).toBe("include");
      expect(calls[0]?.method).toBe("POST");
    }),
  );
  it.effect("sends bearer authorization and rejects malformed package responses", () =>
    Effect.gen(function* () {
      const result = yield* environmentExtensionsHttp
        .client(
          { ...prepared, httpAuthorization: { _tag: "Bearer", token: "fixture-token" } },
          { id: "test.reader", expectedContentHash: "a".repeat(64) },
        )
        .pipe(
          Effect.provide(
            remoteHttpClientLayer((_url, init) => {
              expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-token");
              return Promise.resolve(
                Response.json({ code: "export default null", contentHash: "wrong" }),
              );
            }),
          ),
          Effect.result,
        );
      expect(result._tag).toBe("Failure");
    }),
  );
});
