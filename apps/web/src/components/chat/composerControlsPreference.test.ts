import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_COMPOSER_CONTROLS_PREFERENCE,
  type ComposerControlsPreference,
} from "@t3tools/contracts";
import {
  COMPOSER_CONTROL_BLOCKS,
  isRecommendedComposerControls,
  moveComposerControl,
  resolveComposerControls,
  setComposerControlPlacement,
} from "./composerControlsPreference";

const ALL_IDS = new Set(COMPOSER_CONTROL_BLOCKS.map((block) => block.id));
const MODE_ONLY = new Set(["mode"]);

function pref(input: {
  order?: readonly string[];
  placements?: ComposerControlsPreference["placements"];
}): ComposerControlsPreference {
  return { order: input.order ?? [], placements: input.placements ?? {} };
}

describe("resolveComposerControls", () => {
  it("pins every available block in the recommended order by default", () => {
    const resolved = resolveComposerControls(DEFAULT_COMPOSER_CONTROLS_PREFERENCE, ALL_IDS);
    expect(resolved.order).toEqual(["traits", "mode"]);
    expect(resolved.pinned).toEqual(["traits", "mode"]);
    expect(resolved.more).toEqual([]);
  });

  it("skips blocks the current provider does not offer", () => {
    const resolved = resolveComposerControls(DEFAULT_COMPOSER_CONTROLS_PREFERENCE, MODE_ONLY);
    expect(resolved.order).toEqual(["traits", "mode"]);
    expect(resolved.pinned).toEqual(["mode"]);
    expect(resolved.more).toEqual([]);
  });

  it("honors the user's order", () => {
    const resolved = resolveComposerControls(pref({ order: ["mode", "traits"] }), ALL_IDS);
    expect(resolved.pinned).toEqual(["mode", "traits"]);
  });

  it("moves a block into the ellipsis menu", () => {
    const resolved = resolveComposerControls(pref({ placements: { traits: "more" } }), ALL_IDS);
    expect(resolved.pinned).toEqual(["mode"]);
    expect(resolved.more).toEqual(["traits"]);
  });

  it("removes hidden blocks from both lists", () => {
    const resolved = resolveComposerControls(pref({ placements: { traits: "hidden" } }), ALL_IDS);
    expect(resolved.pinned).toEqual(["mode"]);
    expect(resolved.more).toEqual([]);
  });

  it("coerces a persisted hidden mode to More", () => {
    const resolved = resolveComposerControls(pref({ placements: { mode: "hidden" } }), ALL_IDS);
    expect(resolved.placements.mode).toBe("more");
    expect(resolved.pinned).toEqual(["traits"]);
    expect(resolved.more).toEqual(["mode"]);
  });

  it("never renders unknown ids but resolves the known rest", () => {
    const resolved = resolveComposerControls(
      pref({ order: ["ghost", "traits"], placements: { ghost: "pinned" } }),
      ALL_IDS,
    );
    expect(resolved.order).toEqual(["traits", "mode"]);
    expect(resolved.pinned).toEqual(["traits", "mode"]);
  });
});

describe("isRecommendedComposerControls", () => {
  it("is true for the default preference", () => {
    expect(isRecommendedComposerControls(DEFAULT_COMPOSER_CONTROLS_PREFERENCE)).toBe(true);
  });

  it("is true when placements only pin explicitly", () => {
    expect(isRecommendedComposerControls(pref({ placements: { traits: "pinned" } }))).toBe(true);
  });

  it("is false for a moved order or a changed placement", () => {
    expect(isRecommendedComposerControls(pref({ order: ["mode", "traits"] }))).toBe(false);
    expect(isRecommendedComposerControls(pref({ placements: { traits: "more" } }))).toBe(false);
  });
});

describe("setComposerControlPlacement", () => {
  it("stores the placement and coerces mode away from hidden", () => {
    const next = setComposerControlPlacement(
      DEFAULT_COMPOSER_CONTROLS_PREFERENCE,
      "traits",
      "more",
    );
    expect(next.placements).toEqual({ traits: "more" });
    const mode = setComposerControlPlacement(
      DEFAULT_COMPOSER_CONTROLS_PREFERENCE,
      "mode",
      "hidden",
    );
    expect(mode.placements).toEqual({ mode: "more" });
  });
});

describe("moveComposerControl", () => {
  it("materializes the order and moves the id", () => {
    const next = moveComposerControl(DEFAULT_COMPOSER_CONTROLS_PREFERENCE, "mode", "up");
    expect(next.order).toEqual(["mode", "traits"]);
  });

  it("keeps unknown ids in the returned preference", () => {
    const saved = pref({ order: ["ghost"], placements: { ghost: "hidden" } });
    const next = moveComposerControl(saved, "mode", "up");
    expect(next.order).toContain("ghost");
    expect(next.placements).toEqual({ ghost: "hidden" });
  });

  it("returns the same preference at the ends", () => {
    const saved = pref({ order: ["mode", "traits"] });
    expect(moveComposerControl(saved, "mode", "up")).toBe(saved);
  });
});
