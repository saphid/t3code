// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { hostUiKit as testKit } from "./hostUiKit";
import type { BrowserSession } from "@t3tools/extension-sdk/catalogue";
import type { ClientHost, FloatingPopoverProps } from "@t3tools/extension-sdk/environment";
import type { ClientUiKit, UiTreeRowProps } from "@t3tools/extension-sdk/ui";
import { TooltipProvider } from "~/components/ui/tooltip";
import { hostTooltip } from "./hostTooltip";

type PageMenuProps = {
  host: Pick<ClientHost, "React" | "tooltip" | "uiKit">;
  session: BrowserSession | null;
  blockReason: string | null;
  run: (verb: { method: string }) => void;
  zoomStep: (direction: "in" | "out") => void;
  visible: boolean;
  floating: { Popover: React.ComponentType<FloatingPopoverProps>; style: React.CSSProperties };
  children?: (close: () => void) => React.ReactNode;
};

async function loadPageMenu() {
  const menuPath = "../../../../packages/first-party-extensions/browser/pageMenu.tsx";
  const module: { PageMenu: React.ComponentType<PageMenuProps> } = await import(
    new URL(menuPath, import.meta.url).pathname
  );
  return module.PageMenu;
}

function pageMenuProps(overrides: Partial<PageMenuProps> = {}): PageMenuProps {
  return {
    host: { React, tooltip: hostTooltip, uiKit: testKit },
    session: {
      zoomFactor: 1,
      appearance: "system",
      audioMuted: null,
      devToolsOpen: false,
      pictureInPicture: null,
    } as BrowserSession,
    blockReason: null,
    run: vi.fn(),
    zoomStep: vi.fn(),
    visible: true,
    floating: { Popover: () => null, style: {} },
    ...overrides,
  };
}

async function openPageMenu() {
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Preview menu"]')!;
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  return trigger;
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("uses native file-type icons, selection and focus without changing the path", async () => {
  const rowPath = "../../../../packages/first-party-extensions/files/treeRow.tsx";
  const {
    FileTreeRow,
  }: { FileTreeRow: React.ComponentType<UiTreeRowProps & { kit: ClientUiKit | null }> } =
    await import(new URL(rowPath, import.meta.url).pathname);
  const selected = vi.fn();
  await act(async () =>
    root.render(
      <FileTreeRow
        kit={testKit}
        path="src/view.tsx"
        depth={1}
        directory={false}
        selected
        onClick={selected}
      />,
    ),
  );
  const row = container.querySelector("button")!;
  expect(row.textContent).toBe("view.tsx");
  expect(row.getAttribute("aria-selected")).toBe("true");
  expect(row.getAttribute("aria-level")).toBe("2");
  expect(container.querySelector("use")?.getAttribute("href")).toBe("#file-tree-builtin-react");
  row.focus();
  expect(document.activeElement).toBe(row);
  await act(async () => row.click());
  expect(selected).toHaveBeenCalledOnce();
});

it("the Browser more menu invokes once and returns focus on Escape", async () => {
  const PageMenu = await loadPageMenu();
  const run = vi.fn();
  await act(async () =>
    root.render(
      <TooltipProvider delay={0}>
        <PageMenu {...pageMenuProps({ run })} />
      </TooltipProvider>,
    ),
  );
  const trigger = await openPageMenu();
  const menu = document.querySelector('[role="menu"]')!;
  expect(menu).not.toBeNull();
  const reload = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (item) => item.textContent === "Hard reload",
  )!;
  await act(async () => reload.click());
  expect(run).toHaveBeenCalledExactlyOnceWith({ method: "hardReload" });
  await act(async () =>
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
  );
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});

it("opens the native appearance submenu from the keyboard and selects a reported radio value", async () => {
  const PageMenu = await loadPageMenu();
  const run = vi.fn();
  await act(async () =>
    root.render(
      <TooltipProvider delay={0}>
        <PageMenu {...pageMenuProps({ run })} />
      </TooltipProvider>,
    ),
  );
  await openPageMenu();
  const appearance = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (item) => item.textContent === "Appearance",
  )!;
  await act(async () => {
    appearance.focus();
    appearance.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  const radios = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
  expect(radios.find((item) => item.textContent === "System")?.getAttribute("aria-checked")).toBe(
    "true",
  );
  await act(async () => radios.find((item) => item.textContent === "Dark")!.click());
  expect(run).toHaveBeenCalledExactlyOnceWith({ method: "setAppearance", appearance: "dark" });
});

it("keeps zoom controls open and closes a retained menu when hidden", async () => {
  const PageMenu = await loadPageMenu();
  const zoomStep = vi.fn();
  const props = pageMenuProps({ zoomStep });
  await act(async () =>
    root.render(
      <TooltipProvider delay={0}>
        <PageMenu {...props} />
      </TooltipProvider>,
    ),
  );
  const trigger = await openPageMenu();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click(),
  );
  expect(zoomStep).toHaveBeenCalledExactlyOnceWith("in");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  await act(async () =>
    root.render(
      <TooltipProvider delay={0}>
        <PageMenu {...props} visible={false} />
      </TooltipProvider>,
    ),
  );
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  await act(async () =>
    root.render(
      <TooltipProvider delay={0}>
        <PageMenu {...props} />
      </TooltipProvider>,
    ),
  );
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("navigates past disabled page actions to an enabled profile action", async () => {
  const PageMenu = await loadPageMenu();
  const selected = vi.fn();
  const props = pageMenuProps({
    blockReason: "Needs permission",
    children: () => <testKit.MenuItem onClick={selected}>Clear cache</testKit.MenuItem>,
  });
  await act(async () =>
    root.render(
      <TooltipProvider delay={0}>
        <PageMenu {...props} />
      </TooltipProvider>,
    ),
  );
  await openPageMenu();
  expect(document.activeElement?.textContent).toBe("Clear cache");
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(selected).toHaveBeenCalledOnce();
  expect(props.run).not.toHaveBeenCalled();
});

it("preserves native address focus, submission and cancellation", async () => {
  const addressPath = "../../../../packages/first-party-extensions/browser/addressInput.tsx";
  const {
    AddressInput,
  }: {
    AddressInput: React.ComponentType<{
      host: Pick<ClientHost, "uiKit">;
      value: string;
      committed: string;
      onValueChange: (value: string) => void;
      onSubmit: (value: string) => void;
      inputRef: React.Ref<HTMLInputElement>;
      style: React.CSSProperties;
    }>;
  } = await import(new URL(addressPath, import.meta.url).pathname);
  const onSubmit = vi.fn();
  const onValueChange = vi.fn();
  const inputRef = React.createRef<HTMLInputElement>();
  await act(async () =>
    root.render(
      <AddressInput
        host={{ uiKit: testKit }}
        value="  https://draft.example/  "
        committed="https://committed.example/"
        onValueChange={onValueChange}
        onSubmit={onSubmit}
        inputRef={inputRef}
        style={{}}
      />,
    ),
  );
  const input = inputRef.current!;
  await act(async () => input.focus());
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(input.value.length);
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("https://draft.example/");
  expect(document.activeElement).not.toBe(input);
  await act(async () => input.focus());
  onValueChange.mockClear();
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith("https://committed.example/");
  expect(document.activeElement).not.toBe(input);
});

it("keeps plain tree controls functional on a host without UI primitives", async () => {
  const rowPath = "../../../../packages/first-party-extensions/files/treeRow.tsx";
  const {
    FileTreeRow,
  }: { FileTreeRow: React.ComponentType<UiTreeRowProps & { kit: ClientUiKit | null }> } =
    await import(new URL(rowPath, import.meta.url).pathname);
  const selected = vi.fn();
  await act(async () =>
    root.render(
      <FileTreeRow kit={null} path="src" depth={0} directory expanded onClick={selected} />,
    ),
  );
  const row = container.querySelector("button")!;
  expect(row.getAttribute("aria-expanded")).toBe("true");
  expect(row.textContent).toContain("src/");
  await act(async () => row.click());
  expect(selected).toHaveBeenCalledOnce();
});
