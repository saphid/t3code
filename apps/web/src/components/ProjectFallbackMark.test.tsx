import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { describeProjectFallbackMark, ProjectFallbackMark } from "./ProjectFallbackMark";

describe("describeProjectFallbackMark", () => {
  it("is stable for an environment and project path", () => {
    const first = describeProjectFallbackMark("environment-a", "/workspace/t3-code");
    const second = describeProjectFallbackMark("environment-a", "/workspace/t3-code");

    expect(second).toEqual(first);
  });

  it("varies the inner geometry across project identities", () => {
    const variants = new Set(
      ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"].map(
        (cwd) => describeProjectFallbackMark("environment-a", `/workspace/${cwd}`)?.variant,
      ),
    );

    expect(variants.size).toBeGreaterThan(1);
  });

  it("leaves an empty project identity to the existing folder fallback", () => {
    expect(describeProjectFallbackMark("environment-a", "  ")).toBeNull();
  });
});

describe("ProjectFallbackMark", () => {
  it("renders as a decorative, theme-aware static svg", () => {
    const descriptor = describeProjectFallbackMark("environment-a", "/workspace/t3-code");
    if (!descriptor) throw new Error("Expected a project mark descriptor");

    const markup = renderToStaticMarkup(<ProjectFallbackMark descriptor={descriptor} />);

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('focusable="false"');
    expect(markup).toContain('fill="currentColor"');
    expect(markup).not.toContain("animate");
  });
});
