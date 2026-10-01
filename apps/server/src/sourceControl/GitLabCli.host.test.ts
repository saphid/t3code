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

it.effect.each([
  { host: "gitlab.com", profile: "gitlab.com" },
  { host: "gitlab-b.example", profile: "gitlab-b.example" },
  { host: "gitlab-b.example", profile: "gitlab-b.example", apiHost: "gitlab-b.example:8443" },
  { host: "gitlab.com", profile: "gitlab.corp.example", originHost: "gitlab.corp.example" },
  { host: "gitlab-b.example:8443", profile: "gitlab-b.example", apiHost: "gitlab-b.example:8443" },
  {
    host: "gitlab-b.example:8443",
    profile: "ssh.gitlab-b.example",
    originHost: "ssh.gitlab-b.example",
    apiHost: "gitlab-b.example:8443",
  },
  {
    host: "gitlab-missing.example",
    profile: "gitlab-missing.example",
    notFound: true,
    storedUser: false,
  },
  { host: "gitlab-b.example:8443", profile: "gitlab-b.example", notFound: true, storedUser: false },
  { host: "gitlab-b.example", profile: "gitlab-b.example", notFound: true, storedUser: true },
  {
    host: "gitlab-b.example",
    profile: "gitlab-b.example",
    apiHost: "gitlab-wrong.example",
    mismatch: true,
  },
])(
  "enforces fork lookup for $host through a fake glab process (profile: $profile, missing: $notFound)",
  ({ host, profile, originHost, apiHost, notFound, storedUser, mismatch }) =>
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
const calls = fs.existsSync(process.env.FAKE_GLAB_RECORDING) ? JSON.parse(fs.readFileSync(process.env.FAKE_GLAB_RECORDING, "utf8")) : [];
calls.push({ args, host });
fs.writeFileSync(process.env.FAKE_GLAB_RECORDING, JSON.stringify(calls));
const configuredProfile = process.env.FAKE_GLAB_PROFILE;
if (args[0] === "config") {
  if (args[4] === configuredProfile) {
    process.stdout.write(args[2] === "api_host" ? process.env.FAKE_GLAB_API_HOST : process.env.USER || process.env.FAKE_GLAB_USER);
  } else if (args[2] === "user") {
    process.stdout.write(process.env.USER || "");
  }
} else {
  const flag = args.indexOf("--hostname");
  const explicit = flag === -1 ? undefined : args[flag + 1];
  if (explicit?.includes(":")) {
    process.stderr.write("error parsing --hostname: invalid hostname.");
    process.exitCode = 1;
  } else {
    const defaultHost = host ?? "gitlab.com";
    const remote = process.env.FAKE_GLAB_REMOTE;
    const selected = explicit ?? (remote && (defaultHost === "gitlab.com" || remote === defaultHost) ? remote : defaultHost);
    const destination = selected === configuredProfile ? process.env.FAKE_GLAB_API_HOST || selected : selected;
    if (process.env.FAKE_GLAB_NOT_FOUND === "true") {
      process.stderr.write("404 Project Not Found\\n");
      process.exitCode = 1;
    } else {
      process.stdout.write(JSON.stringify({
        path_with_namespace: "alex/repo",
        web_url: "https://" + destination + "/alex/repo",
        http_url_to_repo: "https://" + destination + "/alex/repo.git",
        ssh_url_to_repo: "git@" + selected + ":alex/repo.git"
      }));
    }
  }
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
                  USER: input.env?.USER ?? "local-os-user",
                  FAKE_GLAB_RECORDING: recording,
                  FAKE_GLAB_PROFILE: profile,
                  FAKE_GLAB_REMOTE: originHost ?? "",
                  FAKE_GLAB_API_HOST: apiHost ?? "",
                  FAKE_GLAB_USER: storedUser === false ? "" : "alex",
                  FAKE_GLAB_NOT_FOUND: String(notFound === true),
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
      const lookup = glab.getRepositoryCloneUrls({
        cwd: directory,
        host,
        repository: "alex/repo",
        ...(originHost
          ? {
              context: {
                provider: {
                  kind: "gitlab" as const,
                  name: "GitLab",
                  baseUrl: `https://${originHost}`,
                },
                remoteName: "origin",
                remoteUrl: `git@${originHost}:team/repo.git`,
              },
            }
          : {}),
      });

      if (notFound) {
        const error = yield* lookup.pipe(Effect.flip);
        expect(error.detail).toContain("Repository not found or inaccessible on GitLab.");
        if (storedUser) {
          expect(error.detail).not.toContain("glab auth login");
        } else {
          expect(error.detail).toContain(
            `glab auth login --hostname ${new URL(`https://${host}`).hostname}`,
          );
          if (host.includes(":")) {
            expect(error.detail).toContain(`--api-host ${host}`);
          }
        }
        expect(error.cause).toMatchObject({
          _tag: "VcsProcessExitError",
          exitCode: 1,
          failureKind: "not-found",
          detail: "Not found on GitLab.",
        });
      } else if (mismatch) {
        const error = yield* lookup.pipe(Effect.flip);
        expect(error.detail).toContain("different host");
      } else {
        const result = yield* lookup;
        expect(result.url).toBe(`https://${apiHost ?? host}/alex/repo`);
      }
      const calls = decodeCalls(yield* fileSystem.readFileString(recording));
      const apiCalls = calls.filter((call) => call.args[0] === "api");
      expect(apiCalls).toHaveLength(1);
      expect(apiCalls[0]?.host).toBe(
        originHost && apiHost === host ? profile : new URL(`https://${host}`).hostname,
      );
      expect(
        calls
          .filter((call) => call.args[0] === "config")
          .every((call) => ["api_host", "user"].includes(call.args[2] ?? "")),
      ).toBe(true);
    }).pipe(Effect.provide(NodeServices.layer)),
);
