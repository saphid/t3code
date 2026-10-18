import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ConnectionClasp, connectionClaspMotionAllowed } from "./ConnectionClasp";

describe("ConnectionClasp", () => {
  it("renders a decorative settled clasp for an existing connection", () => {
    const markup = renderToStaticMarkup(<ConnectionClasp />);

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('focusable="false"');
    expect(markup).toContain('data-motion="settled"');
    expect(markup).toContain("<line");
    expect(markup.match(/<circle/g)).toHaveLength(4);
  });

  it("keeps server and hydration markup settled when fresh motion is requested", () => {
    const markup = renderToStaticMarkup(<ConnectionClasp playJoiningMotion />);

    expect(markup).toContain('data-motion="settled"');
    expect(markup).not.toContain('data-motion="joining"');
  });

  it.each([
    {
      name: "a hidden document",
      visibilityState: "hidden" as const,
      prefersReducedMotion: false,
      forcedColorsActive: false,
    },
    {
      name: "reduced motion",
      visibilityState: "visible" as const,
      prefersReducedMotion: true,
      forcedColorsActive: false,
    },
    {
      name: "forced colors",
      visibilityState: "visible" as const,
      prefersReducedMotion: false,
      forcedColorsActive: true,
    },
  ])("does not start joining motion for $name", ({ name: _name, ...environment }) => {
    expect(connectionClaspMotionAllowed(environment)).toBe(false);
  });

  it("allows one joining motion for a visible default-motion document", () => {
    expect(
      connectionClaspMotionAllowed({
        visibilityState: "visible",
        prefersReducedMotion: false,
        forcedColorsActive: false,
      }),
    ).toBe(true);
  });
});
