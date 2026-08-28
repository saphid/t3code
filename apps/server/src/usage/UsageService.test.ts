import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { UsageDay } from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient } from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import { make } from "./UsageService.ts";

/** A minimal Codex rollout: one session, one turn, one usage event. */
const codexRollout = (sessionId: string, outputTokens: number) =>
  [
    JSON.stringify({
      type: "session_meta",
      timestamp: "2026-08-01T05:00:00.000Z",
      payload: { type: "session_meta", id: sessionId },
    }),
    JSON.stringify({
      type: "turn_context",
      timestamp: "2026-08-01T05:00:01.000Z",
      payload: { type: "turn_context", model: "gpt-5.6-sol" },
    }),
    JSON.stringify({
      type: "event_msg",
      timestamp: "2026-08-01T05:00:09.000Z",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: outputTokens,
            reasoning_output_tokens: 0,
          },
        },
      },
    }),
  ].join("\n");

it.layer(NodeServices.layer)("UsageService", (it) => {
  describe("readSummary", () => {
    it.effect("counts rollouts from both codex sessions directories", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        // Every provider home points into the sandbox so the scan can never
        // wander into the developer's real transcript directories.
        const codexHome = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3code-usage-codex-",
        });
        const claudeHome = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3code-usage-claude-",
        });
        const grokHome = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3code-usage-grok-",
        });

        // Archiving a Codex thread moves its rollout from `sessions` to
        // `archived_sessions`; both must contribute to the summary.
        yield* fileSystem.makeDirectory(path.join(codexHome, "sessions"), { recursive: true });
        yield* fileSystem.makeDirectory(path.join(codexHome, "archived_sessions"), {
          recursive: true,
        });
        yield* fileSystem.writeFileString(
          path.join(codexHome, "sessions", "rollout-live.jsonl"),
          codexRollout("live-session", 10),
        );
        yield* fileSystem.writeFileString(
          path.join(codexHome, "archived_sessions", "rollout-archived.jsonl"),
          codexRollout("archived-session", 20),
        );

        const summary = yield* Effect.gen(function* () {
          const usage = yield* make;
          return yield* usage.readSummary({
            sinceDay: UsageDay.make("2026-07-31"),
            untilDay: UsageDay.make("2026-08-02"),
            timeZone: "UTC",
          });
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              ServerConfig.layerTest(process.cwd(), { prefix: "t3code-usage-service-test-" }),
              ServerSettings.layerTest({
                providers: {
                  claudeAgent: { homePath: claudeHome },
                  codex: { homePath: codexHome },
                },
              }),
            ),
          ),
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("usage tests must not fetch rates")),
          ),
          Effect.provideService(HostProcessEnvironment, { GROK_HOME: grokHome }),
        );

        const codexSources = summary.sources.filter(
          (source) => source.fingerprint.provider === "codex",
        );
        expect(
          codexSources.map((source) => ({
            dir: path.basename(source.fingerprint.resolvedHomePath),
            status: source.status,
            distinctSessions: source.distinctSessions,
          })),
        ).toEqual([
          { dir: "sessions", status: "ok", distinctSessions: 1 },
          { dir: "archived_sessions", status: "ok", distinctSessions: 1 },
        ]);

        // Same day and model, so live and archived usage land in one bucket.
        const codexBuckets = summary.buckets.filter((bucket) => bucket.provider === "codex");
        expect(codexBuckets).toHaveLength(1);
        expect(codexBuckets[0]?.totals.outputTokens).toBe(30);
        expect(codexBuckets[0]?.sessions).toBe(2);
      }).pipe(Effect.scoped),
    );
  });
});
