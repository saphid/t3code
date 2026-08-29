import { describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as BitbucketApi from "../sourceControl/BitbucketApi.ts";
import * as BitbucketPullRequestApi from "./BitbucketPullRequestApi.ts";
import {
  bitbucketProviderFailure,
  bitbucketViewerPermissions,
  make,
} from "./BitbucketPullRequestProvider.ts";

const responseError = (status: number, retryAt?: number) =>
  new BitbucketApi.BitbucketResponseError({
    operation: "request",
    status,
    responseBodyLength: 0,
    ...(retryAt === undefined ? {} : { retryAt }),
  });

describe("bitbucketProviderFailure", () => {
  it("treats only an HTTP 401 as unusable credentials", () => {
    expect(bitbucketProviderFailure(responseError(401)).reason).toBe("unauthenticated");
    expect(bitbucketProviderFailure(responseError(403)).reason).toBe("failed");
  });

  it("keeps Bitbucket's retry time on a rate limit", () => {
    expect(bitbucketProviderFailure(responseError(429, 121_000))).toEqual({
      reason: "rate-limited",
      retryAt: 121_000,
    });
  });
});

describe("bitbucketViewerPermissions", () => {
  it("offers both actions to credentials with write access", () => {
    expect(bitbucketViewerPermissions({ canWrite: true })).toEqual({
      actions: ["merge", "close"],
      comment: true,
      resolve: true,
      verdicts: ["comment", "approve", "request-changes"],
      // Bitbucket says nothing about who may set a reviewer, and an unreported permission is
      // granted.
      requestReviewers: true,
    });
  });

  it("keeps merge from credentials that can only read the repository", () => {
    expect(bitbucketViewerPermissions({ canWrite: false })).toEqual({
      actions: ["close"],
      comment: true,
      resolve: true,
      verdicts: ["comment", "approve", "request-changes"],
      requestReviewers: true,
    });
  });

  it("treats an author with read access as any other reader, which is all Bitbucket says", () => {
    // The repository permission is the whole of what Bitbucket reports per account; it says
    // nothing about who opened this pull request, and its author may decline it with read access
    // alone — so declining stays offered rather than being taken from them.
    expect(bitbucketViewerPermissions({ canWrite: false }).actions).toEqual(["close"]);
  });
});

describe("runAction", () => {
  const merge = {
    cwd: "/w",
    repository: "acme/web",
    host: "bitbucket.org",
    number: 7,
    action: "merge" as const,
    mergeMethod: "squash" as const,
  };

  it.effect("passes an allowed merge through to Bitbucket", () =>
    Effect.gen(function* () {
      const runAction = vi.fn(() => Effect.void);
      const provider = yield* make.pipe(
        Effect.provide(Layer.mock(BitbucketPullRequestApi.BitbucketPullRequestApi)({ runAction })),
      );

      yield* provider.runAction(merge);

      expect(runAction).toHaveBeenCalledWith({
        repository: "acme/web",
        number: 7,
        action: "merge",
        mergeMethod: "squash",
      });
    }),
  );

  it.effect.each([403, 409])("keeps merge HTTP %i as Bitbucket's write result", (status) =>
    Effect.gen(function* () {
      const cause = responseError(status);
      const provider = yield* make.pipe(
        Effect.provide(
          Layer.mock(BitbucketPullRequestApi.BitbucketPullRequestApi)({
            runAction: () => Effect.fail(cause),
          }),
        ),
      );

      const error = yield* Effect.flip(provider.runAction(merge));

      expect(error.reason).toBe("failed");
      expect(error.cause).toBe(cause);
    }),
  );

  it.effect("keeps a merge rate limit and its retry time", () =>
    Effect.gen(function* () {
      const cause = responseError(429, 121_000);
      const provider = yield* make.pipe(
        Effect.provide(
          Layer.mock(BitbucketPullRequestApi.BitbucketPullRequestApi)({
            runAction: () => Effect.fail(cause),
          }),
        ),
      );

      const error = yield* Effect.flip(provider.runAction(merge));

      expect(error.reason).toBe("rate-limited");
      expect(error.retryAt).toBe(121_000);
      expect(error.cause).toBe(cause);
    }),
  );
});
