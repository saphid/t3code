import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitLabCli from "./GitLabCli.ts";

const decodeCalls = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        args: Schema.Array(Schema.String),
        host: Schema.NullOr(Schema.String),
      }),
    ),
  ),
);

it.effect.each(["gitlab.com", "gitlab-b.example", "gitlab-missing.example"])(
  "delivers the %s profile to a fake glab process and preserves its exit status",
  (host) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-fake-glab-" });
      const executable = path.join(directory, "glab.mjs");
      const recording = path.join(directory, "calls.json");
      yield* fileSystem.writeFileString(
        executable,
        `import fs from "node:fs";
const args = process.argv.slice(2);
const host = process.env.GITLAB_HOST ?? null;
fs.writeFileSync(process.env.FAKE_GLAB_RECORDING, JSON.stringify([{ args, host }]));
if (host === "gitlab-missing.example") {
  process.stderr.write("404 Project Not Found\\n");
  process.exitCode = 1;
} else {
  process.stdout.write(JSON.stringify({
    path_with_namespace: "alex/repo",
    web_url: "https://" + host + "/alex/repo",
    http_url_to_repo: "https://" + host + "/alex/repo.git",
    ssh_url_to_repo: "git@" + host + ":alex/repo.git"
  }));
}
`,
      );
      const fakeRunner = Layer.effect(
        ProcessRunner.ProcessRunner,
        Effect.gen(function* () {
          const runner = yield* ProcessRunner.make();
          return ProcessRunner.ProcessRunner.of({
            run: (input) => {
              expect(input.command).toBe("glab");
              return runner.run({
                ...input,
                command: process.execPath,
                args: [executable, ...input.args],
                env: {
                  ...input.env,
                  FAKE_GLAB_RECORDING: recording,
                },
              });
            },
          });
        }),
      ).pipe(Layer.provide(NodeServices.layer));
      const glab = yield* GitLabCli.make.pipe(
        Effect.provide(
          Layer.effect(VcsProcess.VcsProcess, VcsProcess.make).pipe(Layer.provide(fakeRunner)),
        ),
      );
      const lookup = glab.getRepositoryCloneUrls({ cwd: directory, host, repository: "alex/repo" });

      if (host === "gitlab-missing.example") {
        const error = yield* lookup.pipe(Effect.flip);
        expect(error._tag).toBe("GitLabCliCommandError");
        expect(error.cause).toMatchObject({
          _tag: "VcsProcessExitError",
          exitCode: 1,
          failureKind: "not-found",
          detail: "Merge request not found.",
        });
      } else {
        const result = yield* lookup;
        expect(result.url).toBe(`https://${host}/alex/repo`);
      }
      expect(decodeCalls(yield* fileSystem.readFileString(recording))).toEqual([
        { args: ["api", "projects/alex%2Frepo"], host },
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
);
