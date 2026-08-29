import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  SourceControlRepositorySearchInput,
  SourceControlRepositorySearchResult,
} from "./sourceControl.ts";

const decodeRepositorySearchInput = Schema.decodeUnknownSync(SourceControlRepositorySearchInput);
const decodeRepositorySearchResult = Schema.decodeUnknownSync(SourceControlRepositorySearchResult);

describe("SourceControlRepositorySearch", () => {
  it("decodes a bounded page of repository identities and classifications", () => {
    const input = decodeRepositorySearchInput({
      provider: "github",
      query: " t3code ",
      page: 2,
    });
    const result = decodeRepositorySearchResult({
      items: [
        {
          provider: "github",
          nameWithOwner: "pingdotgg/t3code",
          url: "https://github.com/pingdotgg/t3code",
          sshUrl: "git@github.com:pingdotgg/t3code.git",
          visibility: "private",
          isFork: true,
          isArchived: false,
          ownerKind: "organization",
        },
      ],
      nextPage: 3,
    });

    expect(input.query).toBe("t3code");
    expect(result.items[0]?.ownerKind).toBe("organization");
    expect(result.nextPage).toBe(3);
  });

  it("rejects unbounded or empty searches", () => {
    expect(() => decodeRepositorySearchInput({ provider: "github", query: "", page: 1 })).toThrow();
    expect(() =>
      decodeRepositorySearchInput({ provider: "github", query: "t3", page: 0 }),
    ).toThrow();
    expect(() =>
      decodeRepositorySearchInput({ provider: "github", query: "t3", page: 51 }),
    ).toThrow();
  });
});
