import { assert, it, afterEach, expect, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import { VcsProcessExitError } from "@t3tools/contracts";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitLabCli from "./GitLabCli.ts";
import type {
  SourceControlProvider,
  SourceControlProviderContext,
} from "./SourceControlProvider.ts";

const mockedRun = vi.fn<VcsProcess.VcsProcess["Service"]["run"]>();
const layer = it.layer(
  GitLabCli.layer.pipe(
    Layer.provide(
      Layer.mock(VcsProcess.VcsProcess)({
        run: mockedRun,
      }),
    ),
  ),
);

function processOutput(stdout: string): VcsProcess.VcsProcessOutput {
  return {
    exitCode: ChildProcessSpawner.ExitCode(0),
    stdout,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

function fakeGlab(input: {
  readonly profiles: Readonly<
    Record<string, { readonly apiHost?: string; readonly authenticated?: boolean }>
  >;
  readonly defaultHost?: string;
  readonly repositoryHost?: string;
}) {
  const requests: Array<{ readonly profile: string; readonly apiHost: string }> = [];
  const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
  mockedRun.mockImplementation((call) => {
    if (call.args[0] === "config") {
      expect(call.args.slice(0, 4)).toEqual(["config", "get", "api_host", "--host"]);
      const profile = call.args[4] ?? "";
      return Effect.succeed(processOutput(input.profiles[profile]?.apiHost ?? ""));
    }
    expect(call.command).toBe("glab");
    expect(call.args).toEqual(["api", "projects/alex%2Frepo"]);
    const profile =
      call.env?.GITLAB_HOST ??
      (input.repositoryHost && input.repositoryHost in input.profiles
        ? input.repositoryHost
        : (input.defaultHost ?? "gitlab.com"));
    const apiHost = input.profiles[profile]?.apiHost ?? profile;
    requests.push({ profile, apiHost });
    if (!(profile in input.profiles) || input.profiles[profile]?.authenticated === false) {
      return Effect.fail(
        new VcsProcessExitError({
          operation: call.operation,
          command: call.command,
          cwd: call.cwd,
          exitCode: 1,
          detail: "GitLab CLI is not authenticated for this host. Run glab auth login.",
          failureKind: "authentication",
        }),
      );
    }
    return Effect.succeed(
      processOutput(
        encodeJson({
          path_with_namespace: "alex/repo",
          web_url: `https://${apiHost}/alex/repo`,
          http_url_to_repo: `https://${apiHost}/alex/repo.git`,
          ssh_url_to_repo: `git@${profile}:alex/repo.git`,
        }),
      ),
    );
  });
  return requests;
}

function repositoryContext(host: string): SourceControlProviderContext {
  return {
    provider: { kind: "gitlab", name: "GitLab", baseUrl: `https://${host}` },
    remoteName: "origin",
    remoteUrl: `git@${host}:team/repo.git`,
  };
}

afterEach(() => {
  mockedRun.mockReset();
});

layer("GitLabCli.layer", (it) => {
  it.effect("parses merge request view output", () =>
    Effect.gen(function* () {
      mockedRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              iid: 42,
              title: "Add MR thread creation",
              web_url: "https://gitlab.com/pingdotgg/t3code/-/merge_requests/42",
              target_branch: "main",
              source_branch: "feature/mr-threads",
              state: "closed",
              closed_at: "2026-08-23T10:00:00Z",
              source_project_id: 101,
              target_project_id: 100,
              source_project: {
                path_with_namespace: "octocat/t3code",
              },
            }),
          ),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const glab = yield* GitLabCli.GitLabCli;
        return yield* glab.getMergeRequest({
          cwd: "/repo",
          reference: "42",
        });
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add MR thread creation",
        url: "https://gitlab.com/pingdotgg/t3code/-/merge_requests/42",
        baseRefName: "main",
        headRefName: "feature/mr-threads",
        state: "closed",
        closedAt: "2026-08-23T10:00:00Z",
        mergedAt: null,
        isCrossRepository: true,
        headRepositoryNameWithOwner: "octocat/t3code",
        headRepositoryOwnerLogin: "octocat",
      });
      expect(mockedRun).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "glab",
          cwd: "/repo",
          args: ["mr", "view", "42", "--output", "json"],
        }),
      );
    }),
  );

  it.effect("skips invalid entries when parsing MR lists", () =>
    Effect.gen(function* () {
      mockedRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify([
              {
                iid: 0,
                title: "invalid",
                web_url: "https://gitlab.com/pingdotgg/t3code/-/merge_requests/0",
                target_branch: "main",
                source_branch: "feature/invalid",
              },
              {
                iid: 43,
                title: "  Valid MR  ",
                web_url: " https://gitlab.com/pingdotgg/t3code/-/merge_requests/43 ",
                target_branch: " main ",
                source_branch: " feature/mr-list ",
                state: "merged",
                merged_at: "2026-08-23T11:00:00Z",
              },
            ]),
          ),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const glab = yield* GitLabCli.GitLabCli;
        return yield* glab.listMergeRequests({
          cwd: "/repo",
          headSelector: "feature/mr-list",
          state: "all",
        });
      });

      assert.deepStrictEqual(result, [
        {
          number: 43,
          title: "Valid MR",
          url: "https://gitlab.com/pingdotgg/t3code/-/merge_requests/43",
          baseRefName: "main",
          headRefName: "feature/mr-list",
          state: "merged",
          closedAt: null,
          mergedAt: "2026-08-23T11:00:00Z",
        },
      ]);
      expect(mockedRun).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "glab",
          cwd: "/repo",
          args: [
            "mr",
            "list",
            "--source-branch",
            "feature/mr-list",
            "--all",
            "--per-page",
            "20",
            "--output",
            "json",
          ],
        }),
      );
    }),
  );

  it.effect("reads repository clone URLs", () =>
    Effect.gen(function* () {
      mockedRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              path_with_namespace: "octocat/t3code",
              web_url: "https://gitlab.com/octocat/t3code",
              http_url_to_repo: "https://gitlab.com/octocat/t3code.git",
              ssh_url_to_repo: "git@gitlab.com:octocat/t3code.git",
            }),
          ),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const glab = yield* GitLabCli.GitLabCli;
        return yield* glab.getRepositoryCloneUrls({
          cwd: "/repo",
          repository: "octocat/t3code",
        });
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/t3code",
        url: "https://gitlab.com/octocat/t3code",
        sshUrl: "git@gitlab.com:octocat/t3code.git",
      });
    }),
  );

  it.effect("keeps unspecified and ported fork lookups on glab's existing host path", () =>
    Effect.gen(function* () {
      const glab = yield* GitLabCli.GitLabCli;
      for (const host of ["gitlab-b.example:8443", undefined]) {
        mockedRun.mockReset();
        mockedRun.mockImplementationOnce((input) => {
          const flag = input.args.indexOf("--hostname");
          if (flag !== -1 && (input.args[flag + 1] ?? "").includes(":")) {
            return Effect.fail(
              new VcsProcessExitError({
                operation: input.operation,
                command: input.command,
                cwd: input.cwd,
                exitCode: 1,
                detail: "error parsing --hostname: invalid hostname.",
              }),
            );
          }
          return Effect.succeed(
            processOutput(
              JSON.stringify({
                path_with_namespace: "alex/repo",
                web_url: "https://gitlab.com/alex/repo",
                http_url_to_repo: "https://gitlab.com/alex/repo.git",
                ssh_url_to_repo: "git@gitlab.com:alex/repo.git",
              }),
            ),
          );
        });
        // The provider-level lookup, which carries the repository's host when it is known.
        const lookup: Parameters<SourceControlProvider["Service"]["getRepositoryCloneUrls"]>[0] = {
          cwd: "/repo",
          ...(host === undefined ? {} : { host }),
          repository: "alex/repo",
        };

        const result = yield* glab.getRepositoryCloneUrls(lookup);

        expect(result.url).toBe("https://gitlab.com/alex/repo");
        const call = mockedRun.mock.calls[0]?.[0];
        expect(call?.args).toEqual(["api", "projects/alex%2Frepo"]);
        expect(call?.env).toBeUndefined();
      }
    }),
  );

  it.effect.each(["gitlab.com", "gitlab-b.example"])(
    "selects the %s fork profile instead of glab's default host",
    (host) =>
      Effect.gen(function* () {
        const requests = fakeGlab({
          profiles: { "gitlab.com": {}, "gitlab-b.example": {}, "gitlab-default.example": {} },
          defaultHost: "gitlab-default.example",
        });
        const lookup: Parameters<SourceControlProvider["Service"]["getRepositoryCloneUrls"]>[0] = {
          cwd: "/repo",
          host,
          repository: "alex/repo",
        };
        const glab = yield* GitLabCli.GitLabCli;
        const result = yield* glab.getRepositoryCloneUrls(lookup);

        expect(result.url).toBe(`https://${host}/alex/repo`);
        expect(requests).toEqual([{ profile: host, apiHost: host }]);
        expect(mockedRun.mock.calls.map(([call]) => call.env)).toEqual([{ GITLAB_HOST: host }]);
      }),
  );

  it.effect.each([false, true])(
    "preserves the Git hostname's authenticated API-host profile (web login present: %s)",
    (webLoginPresent) =>
      Effect.gen(function* () {
        const profile = "ssh.gitlab.corp.example";
        const host = "gitlab.corp.example";
        const requests = fakeGlab({
          profiles: {
            "gitlab.com": {},
            [profile]: { apiHost: host },
            ...(webLoginPresent ? { [host]: {} } : {}),
          },
          repositoryHost: profile,
        });
        const lookup: Parameters<SourceControlProvider["Service"]["getRepositoryCloneUrls"]>[0] = {
          cwd: "/repo",
          host,
          context: repositoryContext(profile),
          repository: "alex/repo",
        };
        const glab = yield* GitLabCli.GitLabCli;
        const result = yield* glab.getRepositoryCloneUrls(lookup);

        expect(result.url).toBe(`https://${host}/alex/repo`);
        expect(result.sshUrl).toBe(`git@${profile}:alex/repo.git`);
        expect(requests).toEqual([{ profile, apiHost: host }]);
        expect(mockedRun.mock.calls.map(([call]) => ({ args: call.args, env: call.env }))).toEqual([
          { args: ["config", "get", "api_host", "--host", profile], env: undefined },
          { args: ["api", "projects/alex%2Frepo"], env: { GITLAB_HOST: profile } },
        ]);
      }),
  );

  it.effect("does not reuse another repository host's credentials for an unrelated API host", () =>
    Effect.gen(function* () {
      const profile = "ssh.gitlab.corp.example";
      const host = "gitlab-b.example";
      const requests = fakeGlab({
        profiles: {
          [profile]: { apiHost: "gitlab.corp.example" },
          [host]: {},
        },
        repositoryHost: profile,
      });
      const lookup: Parameters<SourceControlProvider["Service"]["getRepositoryCloneUrls"]>[0] = {
        cwd: "/repo",
        host,
        context: repositoryContext(profile),
        repository: "alex/repo",
      };
      const glab = yield* GitLabCli.GitLabCli;
      const result = yield* glab.getRepositoryCloneUrls(lookup);

      expect(result.url).toBe(`https://${host}/alex/repo`);
      expect(requests).toEqual([{ profile: host, apiHost: host }]);
    }),
  );

  it.effect.each([false, true])(
    "reports a missing host credential without falling back (host configured: %s)",
    (hostConfigured) =>
      Effect.gen(function* () {
        const host = "gitlab-missing.example";
        const requests = fakeGlab({
          profiles: {
            "gitlab.com": {},
            ...(hostConfigured ? { [host]: { authenticated: false } } : {}),
          },
        });
        const lookup: Parameters<SourceControlProvider["Service"]["getRepositoryCloneUrls"]>[0] = {
          cwd: "/repo",
          host,
          repository: "alex/repo",
        };
        const glab = yield* GitLabCli.GitLabCli;
        const error = yield* glab.getRepositoryCloneUrls(lookup).pipe(Effect.flip);

        expect(error._tag).toBe("GitLabCliAuthenticationError");
        expect(requests).toEqual([{ profile: host, apiHost: host }]);
        expect(mockedRun.mock.calls).toHaveLength(1);
        expect(mockedRun.mock.calls[0]?.[0].env).toEqual({ GITLAB_HOST: host });
      }),
  );

  it.effect("creates merge requests through the GitLab API without placing the body in argv", () =>
    Effect.gen(function* () {
      mockedRun.mockReturnValueOnce(Effect.succeed(processOutput("{}")));

      const glab = yield* GitLabCli.GitLabCli;
      yield* glab.createMergeRequest({
        cwd: "/repo",
        baseBranch: "main",
        headSelector: "owner:feature/provider",
        title: "Provider MR",
        bodyFile: "/tmp/t3-mr-body.md",
      });

      expect(mockedRun).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "glab",
          cwd: "/repo",
          args: [
            "api",
            "--method",
            "POST",
            "projects/:fullpath/merge_requests",
            "--raw-field",
            "source_branch=feature/provider",
            "--raw-field",
            "target_branch=main",
            "--raw-field",
            "title=Provider MR",
            "--field",
            "description=@/tmp/t3-mr-body.md",
          ],
        }),
      );
    }),
  );

  it.effect("creates repositories under an explicit namespace", () =>
    Effect.gen(function* () {
      mockedRun

        .mockReturnValueOnce(
          Effect.succeed(
            processOutput(
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              JSON.stringify({ id: 1234 }),
            ),
          ),
        )
        .mockReturnValueOnce(
          Effect.succeed(
            processOutput(
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              JSON.stringify({
                path_with_namespace: "octocat/t3code",
                web_url: "https://gitlab.com/octocat/t3code",
                http_url_to_repo: "https://gitlab.com/octocat/t3code.git",
                ssh_url_to_repo: "git@gitlab.com:octocat/t3code.git",
              }),
            ),
          ),
        );

      const glab = yield* GitLabCli.GitLabCli;
      const result = yield* glab.createRepository({
        cwd: "/repo",
        repository: "octocat/t3code",
        visibility: "public",
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/t3code",
        url: "https://gitlab.com/octocat/t3code",
        sshUrl: "git@gitlab.com:octocat/t3code.git",
      });
      expect(mockedRun).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          command: "glab",
          cwd: "/repo",
          args: ["api", "namespaces/octocat"],
        }),
      );
      expect(mockedRun).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          command: "glab",
          cwd: "/repo",
          args: [
            "api",
            "--method",
            "POST",
            "projects",
            "--raw-field",
            "path=t3code",
            "--raw-field",
            "name=t3code",
            "--raw-field",
            "visibility=public",
            "--raw-field",
            "namespace_id=1234",
          ],
        }),
      );
    }),
  );

  it.effect("does not pass unsupported force flags when checking out merge requests", () =>
    Effect.gen(function* () {
      mockedRun.mockReturnValueOnce(Effect.succeed(processOutput("")));

      const glab = yield* GitLabCli.GitLabCli;
      yield* glab.checkoutMergeRequest({
        cwd: "/repo",
        reference: "42",
        force: true,
      });

      expect(mockedRun).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "glab",
          cwd: "/repo",
          args: ["mr", "checkout", "42"],
        }),
      );
    }),
  );

  it.effect("surfaces a friendly error when the merge request is not found", () =>
    Effect.gen(function* () {
      const cause = new VcsProcessExitError({
        operation: "GitLabCli.execute",
        command: "glab",
        cwd: "/repo",
        exitCode: 1,
        detail: "GET 404 merge request not found",
        failureKind: "not-found",
      });
      mockedRun.mockReturnValueOnce(Effect.fail(cause));

      const error = yield* Effect.gen(function* () {
        const glab = yield* GitLabCli.GitLabCli;
        return yield* glab.getMergeRequest({
          cwd: "/repo",
          reference: "4888",
        });
      }).pipe(Effect.flip);

      assert.equal(error.message.includes("Merge request 4888 was not found"), true);
      assert.strictEqual(error._tag, "GitLabMergeRequestNotFoundError");
      assert.strictEqual(error.command, "glab");
      assert.strictEqual(error.cwd, "/repo");
      assert.strictEqual(error.cause, cause);
      assert.equal(error.message.includes(cause.detail), false);
    }),
  );

  it.effect("keeps non-merge-request not-found failures generic", () =>
    Effect.gen(function* () {
      const cause = new VcsProcessExitError({
        operation: "GitLabCli.execute",
        command: "glab",
        cwd: "/repo",
        exitCode: 1,
        detail: "GET 404 project not found",
        failureKind: "not-found",
      });
      mockedRun.mockReturnValueOnce(Effect.fail(cause));

      const error = yield* Effect.gen(function* () {
        const glab = yield* GitLabCli.GitLabCli;
        return yield* glab.getRepositoryCloneUrls({
          cwd: "/repo",
          repository: "missing/project",
        });
      }).pipe(Effect.flip);

      assert.strictEqual(error._tag, "GitLabCliCommandError");
      assert.strictEqual(error.cause, cause);
    }),
  );

  it.effect("preserves rate-limit failures as a distinct error", () =>
    Effect.gen(function* () {
      const cause = new VcsProcessExitError({
        operation: "GitLabCli.execute",
        command: "glab",
        cwd: "/repo",
        exitCode: 1,
        detail: "API rate limit exceeded.",
        failureKind: "rate-limited",
      });
      mockedRun.mockReturnValueOnce(Effect.fail(cause));

      const glab = yield* GitLabCli.GitLabCli;
      const error = yield* glab
        .execute({ cwd: "/repo", args: ["api", "projects"] })
        .pipe(Effect.flip);

      assert.strictEqual(error._tag, "GitLabCliRateLimitError");
      assert.strictEqual(error.cause, cause);
    }),
  );
});
