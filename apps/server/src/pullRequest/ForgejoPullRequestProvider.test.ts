import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as ForgejoCli from "../sourceControl/ForgejoCli.ts";
import * as ForgejoPullRequestProvider from "./ForgejoPullRequestProvider.ts";

const input = { cwd: "/repo", repository: "acme/project", host: "forgejo.test", number: 7 };
const pull = {
  number: 7,
  title: "Fix reviewers",
  body: null,
  html_url: "https://forgejo.test/acme/project/pulls/7",
  user: { login: "Author" },
  state: "open",
  merged: false,
  head: { ref: "feature", sha: "head", repo: { full_name: "acme/project" } },
  base: { ref: "main", sha: "base", repo: { full_name: "acme/project" } },
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  closed_at: null,
  merged_at: null,
  labels: null,
  requested_reviewers: [{ login: "REVIEWER" }],
};
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const response = (value: unknown) =>
  encodeJson(value).pipe(
    Effect.orDie,
    Effect.map((stdout) => ({
      exitCode: ChildProcessSpawner.ExitCode(0),
      stdout,
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
    })),
  );
const providerWith = (api: ForgejoCli.ForgejoCli["Service"]["api"]) =>
  ForgejoPullRequestProvider.make.pipe(Effect.provide(Layer.mock(ForgejoCli.ForgejoCli)({ api })));
const candidatesWith = (users: unknown, calls: string[] = [], pr: unknown = pull) =>
  providerWith(({ path }) => {
    calls.push(path);
    switch (path.split("?")[0]) {
      case "repos/acme/project/pulls/7":
        return response(pr);
      case "repos/acme/project/assignees":
        return response(users);
      default:
        return Effect.die(`Unexpected request: ${path}`);
    }
  });

describe("Forgejo reviewer candidates", () => {
  it.effect("reads the complete assignee list once without repeating users", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const provider = yield* candidatesWith([{ login: "reviewer" }], calls);
      const result = yield* provider.listReviewerCandidates(input);

      expect(calls.sort()).toEqual(["repos/acme/project/assignees", "repos/acme/project/pulls/7"]);
      expect(result.candidates.map((candidate) => candidate.id)).toEqual(["reviewer"]);
      expect(result.truncated).toBe(false);
    }),
  );

  it.effect("excludes the author and matches requested reviewers case-insensitively", () =>
    Effect.gen(function* () {
      const provider = yield* candidatesWith([
        { login: "author" },
        { login: "reviewer", full_name: "Reviewer", avatar_url: "https://forgejo.test/avatar/1" },
        { login: "Reviewer" },
        { login: "" },
        { login: "another" },
      ]);
      expect(yield* provider.listReviewerCandidates(input)).toEqual({
        candidates: [
          {
            id: "reviewer",
            login: "reviewer",
            name: "Reviewer",
            avatarUrl: "https://forgejo.test/avatar/1",
            kind: "user",
            isRequested: true,
          },
          {
            id: "another",
            login: "another",
            name: null,
            avatarUrl: null,
            kind: "user",
            isRequested: false,
          },
        ],
        truncated: false,
      });
    }),
  );

  for (const count of [500, 501]) {
    it.effect(`caps unique eligible users at 500 (${count} candidates)`, () =>
      Effect.gen(function* () {
        const provider = yield* candidatesWith([
          { login: "author" },
          ...Array.from({ length: count }, (_, index) => ({ login: `user-${index}` })),
          { login: "USER-0" },
        ]);
        const result = yield* provider.listReviewerCandidates(input);

        expect(result.candidates.map((candidate) => candidate.id)).toEqual(
          Array.from({ length: 500 }, (_, index) => `user-${index}`),
        );
        expect(result.truncated).toBe(count > 500);
      }),
    );
  }

  it.effect("accepts null assignees and missing or null reviewer fields", () =>
    Effect.gen(function* () {
      const { requested_reviewers: _users, ...legacyPull } = pull;
      const provider = yield* candidatesWith(null, [], legacyPull);
      expect(yield* provider.listReviewerCandidates(input)).toEqual({
        candidates: [],
        truncated: false,
      });
      for (const pr of [legacyPull, { ...pull, requested_reviewers: null, user: null }]) {
        const nullable = yield* candidatesWith([{ login: "reviewer" }], [], pr);
        const result = yield* nullable.listReviewerCandidates(input);
        expect(result.candidates).toHaveLength(1);
        expect(result.candidates[0]).toMatchObject({ id: "reviewer", isRequested: false });
        expect(result.truncated).toBe(false);
      }
    }),
  );
});
