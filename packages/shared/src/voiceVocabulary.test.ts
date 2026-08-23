import { describe, expect, it } from "vite-plus/test";

import {
  VOICE_VOCABULARY_LIMIT,
  applyVoiceVocabularyCorrections,
  extractVoiceVocabulary,
  mergeVoiceVocabulary,
} from "./voiceVocabulary.ts";

describe("extractVoiceVocabulary", () => {
  it("keeps identifier-shaped tokens on first sight", () => {
    const terms = extractVoiceVocabulary([
      { text: "Wire useVoiceTranscription into ChatComposer and check gpt-5.6 output" },
    ]);

    expect(terms).toContain("useVoiceTranscription");
    expect(terms).toContain("ChatComposer");
    expect(terms).toContain("gpt-5.6");
  });

  it("keeps repeated unusual plain words but drops ordinary prose", () => {
    const terms = extractVoiceVocabulary([
      { text: "create the worktree first, then prune the worktree after review" },
      { text: "people should always check the answer before they follow along" },
    ]);

    expect(terms).toContain("worktree");
    expect(terms).not.toContain("people");
    expect(terms).not.toContain("answer");
    expect(terms).not.toContain("review");
  });

  it("drops single-occurrence plain words", () => {
    const terms = extractVoiceVocabulary([{ text: "the zustand store" }]);

    expect(terms).not.toContain("zustand");
  });

  it("uses basenames for path-like tokens", () => {
    const terms = extractVoiceVocabulary([
      { text: "edit apps/web/src/components/chat/ChatComposer.tsx today" },
    ]);

    expect(terms).toContain("ChatComposer.tsx");
    expect(terms).not.toContain("apps/web/src/components/chat/ChatComposer.tsx");
  });

  it("drops surviving fragments of numeric-leading uuids", () => {
    // The tokenizer starts at the first letter, so a numeric-leading UUID
    // yields tokens like "da-4946-8df8-79daa38d20f8" that dodge the plain
    // hex checks; none of its fragments may become vocabulary.
    const uuid = "63052183-77da-4946-8df8-79daa38d20f8";
    const terms = extractVoiceVocabulary([
      { text: `session ${uuid} failed` },
      { text: `session ${uuid} failed` },
    ]);

    for (const term of terms) {
      expect(uuid).not.toContain(term.toLowerCase());
    }
    expect(terms).not.toContain("da-4946-8df8-79daa38d20f8");
  });

  it("filters hashes, uuids, and generic tech terms", () => {
    const terms = extractVoiceVocabulary([
      {
        text: "commit 23b550221 in 63052183-77da-4946-8df8-79daa38d20f8 broke the function export async await",
      },
      {
        text: "commit 23b550221 in 63052183-77da-4946-8df8-79daa38d20f8 broke the function export async await",
      },
    ]);

    expect(terms).not.toContain("23b550221");
    expect(terms).not.toContain("63052183-77da-4946-8df8-79daa38d20f8");
    expect(terms).not.toContain("function");
    expect(terms).not.toContain("export");
    expect(terms).not.toContain("async");
    expect(terms).not.toContain("await");
  });

  it("ranks weighted and inline-code terms first and caps the result", () => {
    const history = Array.from({ length: 150 }, (_, index) => ({
      text: `helperThing${index} seen here`,
    }));
    const current = {
      text: "run `pnpm-workspace` against pnpm-workspace now",
      weight: 5,
    };

    const terms = extractVoiceVocabulary([...history, current]);

    expect(terms).toHaveLength(VOICE_VOCABULARY_LIMIT);
    expect(terms[0]).toBe("pnpm-workspace");
  });

  it("keeps the dominant casing of a term", () => {
    const terms = extractVoiceVocabulary([
      { text: "FeatureComposerView FeatureComposerView featurecomposerview" },
    ]);

    expect(terms).toContain("FeatureComposerView");
  });
});

describe("applyVoiceVocabularyCorrections", () => {
  it("rewrites split compounds back to the vocabulary term", () => {
    const corrected = applyVoiceVocabularyCorrections("Add the word tree to the workspace", [
      "worktree",
    ]);

    expect(corrected).toBe("Add the worktree to the workspace");
  });

  it("repairs truncated acronym-like terms", () => {
    const corrected = applyVoiceVocabularyCorrections("run PNP install", ["pnpm"]);

    expect(corrected).toBe("run pnpm install");
  });

  it("adopts the vocabulary casing on exact matches", () => {
    const corrected = applyVoiceVocabularyCorrections("ask fable about the chat composer", [
      "Fable",
      "ChatComposer",
    ]);

    expect(corrected).toBe("ask Fable about the ChatComposer");
  });

  it("keeps an exact same-surface match even when a fuzzy term also matches", () => {
    const text = "add the worktree now";
    expect(applyVoiceVocabularyCorrections(text, ["worktree", "wordtree"])).toBe(text);
  });

  it("prefers a shorter exact match over a longer fuzzy one", () => {
    const corrected = applyVoiceVocabularyCorrections("voice dictation is useful", [
      "VoiceDictation",
    ]);

    expect(corrected).toBe("VoiceDictation is useful");
  });

  it("never fuzzy-rewrites an ordinary lowercase word", () => {
    const text = "please provide the details";
    expect(applyVoiceVocabularyCorrections(text, ["provider"])).toBe(text);
  });

  it("leaves unrelated words alone", () => {
    const text = "the table is stable and the bass is loud";
    expect(applyVoiceVocabularyCorrections(text, ["Fable", "rebase"])).toBe(text);
  });

  it("does not correct when the first letter differs", () => {
    const text = "take a walk tree";
    expect(applyVoiceVocabularyCorrections(text, ["worktree"])).toBe(text);
  });

  it("returns text unchanged with no vocabulary", () => {
    expect(applyVoiceVocabularyCorrections("hello there", [])).toBe("hello there");
  });
});

describe("mergeVoiceVocabulary", () => {
  it("preserves priority order and removes case-insensitive duplicates", () => {
    const merged = mergeVoiceVocabulary([
      ["Worktree", "pnpm"],
      ["worktree", "Fable", "pnpm"],
    ]);

    expect(merged).toEqual(["Worktree", "pnpm", "Fable"]);
  });

  it("enforces the cap across lists", () => {
    const merged = mergeVoiceVocabulary(
      [
        ["a1", "a2", "a3"],
        ["b1", "b2"],
      ],
      4,
    );

    expect(merged).toEqual(["a1", "a2", "a3", "b1"]);
  });
});
