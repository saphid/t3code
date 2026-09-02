import { describe, expect, it } from "vite-plus/test";

import {
  parseDownstreamBuildMetadata,
  resolveDownstreamCommitUrl,
  resolveDownstreamPatchUrl,
} from "./downstreamBuild";

const buildMetadata = {
  upstreamRepository: "pingdotgg/t3code",
  upstreamTag: "v0.0.38-nightly.20260901.1250",
  upstreamUrl: "https://github.com/pingdotgg/t3code/releases/tag/v0.0.38-nightly.20260901.1250",
  releaseRepository: "saphid/t3code",
  fingerprint: "f".repeat(64),
  version: "0.0.38-nightly.20260901.1250664815",
  tag: "v0.0.38-nightly.20260901.1250664815",
  patches: [
    {
      label: "pingdotgg/t3code#8976",
      name: "feat(desktop): support custom update release sources",
      commits: ["a".repeat(40), "b".repeat(40)],
    },
    {
      label: "saphid/t3code@a47282d9e278",
      name: "feat(orchestration): add context-limit handovers",
      commits: ["c".repeat(40)],
    },
  ],
};

describe("downstream build metadata", () => {
  it("parses the generated fork build record", () => {
    const parsed = parseDownstreamBuildMetadata(JSON.stringify(buildMetadata));

    expect(parsed).toMatchObject({
      upstreamTag: buildMetadata.upstreamTag,
      version: buildMetadata.version,
      patches: [
        { label: "pingdotgg/t3code#8976", name: buildMetadata.patches[0]?.name },
        { label: "saphid/t3code@a47282d9e278", name: buildMetadata.patches[1]?.name },
      ],
    });
  });

  it("accepts older records without friendly patch names", () => {
    const withoutNames = {
      ...buildMetadata,
      patches: buildMetadata.patches.map(({ name: _, ...patch }) => patch),
    };

    expect(parseDownstreamBuildMetadata(JSON.stringify(withoutNames))?.patches[0]?.name).toBeNull();
  });

  it("hides absent or malformed metadata", () => {
    expect(parseDownstreamBuildMetadata(undefined)).toBeNull();
    expect(parseDownstreamBuildMetadata("not json")).toBeNull();
    expect(
      parseDownstreamBuildMetadata(
        JSON.stringify({ ...buildMetadata, upstreamUrl: "https://example.com/release" }),
      ),
    ).toBeNull();
  });

  it("links PR and commit entries to their exact GitHub sources", () => {
    const parsed = parseDownstreamBuildMetadata(JSON.stringify(buildMetadata));
    const pullRequest = parsed?.patches[0];
    const commit = parsed?.patches[1];
    expect(pullRequest && resolveDownstreamPatchUrl(pullRequest)).toBe(
      "https://github.com/pingdotgg/t3code/pull/8976",
    );
    expect(commit && resolveDownstreamPatchUrl(commit)).toBe(
      `https://github.com/saphid/t3code/commit/${"c".repeat(40)}`,
    );
    expect(pullRequest && resolveDownstreamCommitUrl(pullRequest, "b".repeat(40))).toBe(
      `https://github.com/pingdotgg/t3code/commit/${"b".repeat(40)}`,
    );
  });
});
