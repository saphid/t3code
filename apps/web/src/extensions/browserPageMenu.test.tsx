import { createElement, type ComponentType } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { FloatingPopoverProps } from "@t3tools/extension-sdk/environment";

// The pack is not a web dependency, so this project cannot type-check its
// source; the menu is loaded by path and typed by the props used here.
const { PageMenu } = (await import(
  "../../../../packages/first-party-extensions/browser/pageMenu.tsx" as string
)) as {
  PageMenu: ComponentType<{
    session: object | null;
    blockReason: string | null;
    run: () => void;
    zoomStep: () => void;
    floating: { Popover: ComponentType<FloatingPopoverProps>; style: object };
    visible: boolean;
  }>;
};

// Stands in for the host layer, which portals the menu out of the panel: nothing
// the panel's hidden shell does can reach it.
function Popover({
  anchor: _anchor,
  elementRef: _elementRef,
  ...attributes
}: FloatingPopoverProps) {
  return createElement("div", attributes);
}

const session = {
  appearance: "system",
  zoomFactor: 1,
  audioMuted: false,
  devToolsOpen: false,
  pictureInPicture: false,
};

function menu(visible: boolean) {
  return createElement(PageMenu, {
    session,
    blockReason: null,
    run: () => {},
    zoomStep: () => {},
    floating: { Popover, style: {} },
    visible,
  });
}

const openMenus = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.type === "div" && node.props.role === "menu");

function toggle(renderer: ReactTestRenderer) {
  const trigger = renderer.root.find((node) => node.props["aria-label"] === "Page menu");
  act(() => trigger.props.onClick());
}

describe("Browser page menu", () => {
  // The open menu listens on the document for outside presses and Escape.
  beforeEach(() => {
    vi.stubGlobal("document", { addEventListener: () => {}, removeEventListener: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("closes when the retained panel is hidden and stays closed when it returns", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(menu(true));
    });
    toggle(renderer);
    expect(openMenus(renderer)).toHaveLength(1);

    act(() => renderer.update(menu(false)));
    expect(openMenus(renderer)).toHaveLength(0);

    act(() => renderer.update(menu(true)));
    expect(openMenus(renderer)).toHaveLength(0);

    toggle(renderer);
    expect(openMenus(renderer)).toHaveLength(1);
    act(() => renderer.unmount());
  });
});
