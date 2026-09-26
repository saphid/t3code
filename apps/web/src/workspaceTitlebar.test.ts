import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TITLEBAR_CONTROLS_WIDTH_VAR, publishTitlebarControlsWidth } from "./workspaceTitlebar";

// Minimal DOM: the root style the tab bar's padding reads, and resize delivery per element.
const rootProperties = new Map<string, string>();
const rootStyle = {
  getPropertyValue: (name: string) => rootProperties.get(name) ?? "",
  setProperty: (name: string, value: string) => void rootProperties.set(name, value),
  removeProperty: (name: string) => void rootProperties.delete(name),
};
const observers = new Map<object, () => void>();

class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe(target: object) {
    observers.set(target, this.callback);
  }
  disconnect() {
    for (const [target, callback] of observers)
      if (callback === this.callback) observers.delete(target);
  }
}

function cluster(initialWidth: number) {
  let width = initialWidth;
  const element = {
    ownerDocument: { documentElement: { style: rootStyle } },
    getBoundingClientRect: () => ({ width }),
  };
  return {
    element: element as unknown as HTMLElement,
    resize(next: number) {
      width = next;
      observers.get(element)?.();
    },
  };
}

const published = () => rootProperties.get(TITLEBAR_CONTROLS_WIDTH_VAR) ?? null;

beforeEach(() => {
  rootProperties.clear();
  observers.clear();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("titlebar controls width", () => {
  it("reserves the cluster's real width as it gains the Extensions menu", () => {
    const controls = cluster(96);
    const release = publishTitlebarControlsWidth(controls.element);
    expect(published()).toBe("96px");
    // Installed packs load after mount and widen the cluster past the old 112px guess.
    controls.resize(236.4);
    expect(published()).toBe("237px");
    controls.resize(96);
    expect(published()).toBe("96px");
    release?.();
  });

  it("follows the remounted cluster when a retained panel reopens", () => {
    // The retained extension panel keeps the tab bar mounted while the route
    // moves the cluster into a new element. React may detach the old ref
    // before or after attaching the new one; the new cluster wins either way.
    for (const oldReleasesFirst of [true, false]) {
      const before = cluster(236);
      const releaseBefore = publishTitlebarControlsWidth(before.element);
      const after = cluster(236);
      if (oldReleasesFirst) releaseBefore?.();
      const releaseAfter = publishTitlebarControlsWidth(after.element);
      if (!oldReleasesFirst) releaseBefore?.();
      expect(published()).toBe("236px");

      // The detached cluster measures zero; it must not shrink the reservation.
      before.resize(0);
      expect(published()).toBe("236px");
      after.resize(280);
      expect(published()).toBe("280px");
      releaseAfter?.();
    }
  });

  it("clears the reservation once no cluster is mounted", () => {
    const controls = cluster(120);
    const release = publishTitlebarControlsWidth(controls.element);
    release?.();
    expect(published()).toBeNull();
    controls.resize(300);
    expect(published()).toBeNull();
    expect(publishTitlebarControlsWidth(null)).toBeUndefined();
  });
});
