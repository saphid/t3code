import type { TooltipProps } from "@t3tools/extension-sdk/environment";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// Records what reaches the native tooltip; base-ui's delay, positioning and
// focus handling are the native tooltip's and are exercised there.
const native = vi.hoisted(() => ({
  triggers: [] as ReactElement[],
  popups: [] as { side?: string; align?: string; children?: ReactNode }[],
}));

vi.mock("~/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => children,
  TooltipTrigger: ({ render }: { render: ReactElement }) => {
    native.triggers.push(render);
    return render;
  },
  TooltipPopup: (props: { side?: string; align?: string; children?: ReactNode }) => {
    native.popups.push(props);
    return null;
  },
}));

const { hostTooltip } = await import("./hostTooltip");
const { Tooltip } = hostTooltip;

let renderer: ReactTestRenderer | undefined;
function render(props: Omit<TooltipProps, "children">, disabled: boolean) {
  act(() => {
    renderer?.unmount();
    renderer = create(
      <Tooltip {...props}>
        <button type="button" disabled={disabled} aria-label="Capture">
          C
        </button>
      </Tooltip>,
    );
  });
  return renderer!;
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  native.triggers = [];
  native.popups = [];
});

describe("host tooltip", () => {
  it("makes an enabled control its own trigger so hover and keyboard focus open it", () => {
    render({ label: "Screenshot page to chat" }, false);
    const [trigger] = native.triggers;
    expect(trigger?.type).toBe("button");
    expect(native.popups).toEqual([
      expect.objectContaining({ children: "Screenshot page to chat" }),
    ]);
  });

  it("hovers a disabled control through a wrapper that takes its pointer events", () => {
    render({ label: "Open a page first" }, true);
    const [trigger] = native.triggers;
    expect(trigger?.type).toBe("span");
    const props = trigger!.props as { className: string; children: ReactNode };
    expect(props.className).toContain("*:pointer-events-none");
    expect(isValidElement(props.children) && props.children.type).toBe("button");
    expect(native.popups[0]?.children).toBe("Open a page first");
    expect(renderer!.root.findByType("button").props.disabled).toBe(true);
  });

  it("passes placement to the native popup and keeps its defaults when omitted", () => {
    render({ label: "Back", side: "bottom", align: "start" }, false);
    render({ label: "Back" }, false);
    expect(native.popups.map(({ side, align }) => ({ side, align }))).toEqual([
      { side: "bottom", align: "start" },
      { side: undefined, align: undefined },
    ]);
  });

  it("renders the control alone when there is nothing to say", () => {
    for (const label of ["", null, undefined]) {
      const tree = render({ label }, true).toJSON();
      expect(tree).toMatchObject({ type: "button", props: { disabled: true } });
    }
    expect(native.triggers).toHaveLength(0);
    expect(native.popups).toHaveLength(0);
  });
});
