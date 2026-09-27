// @vitest-environment jsdom

import type {
  BrowserCaptureTarget,
  PrsWriteActionKind,
  PrsWriteMergeMethod,
} from "@t3tools/extension-sdk/catalogue";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import * as React from "react";
import { act, type ComponentType, type CSSProperties } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TooltipProvider } from "~/components/ui/tooltip";

import { hostTooltip } from "./hostTooltip";

// First-party pack controls rendered through the real host tooltip. Packs
// are their own TypeScript projects, so they load by path, not by import.
const PACKS = new URL("../../../../packages/first-party-extensions", import.meta.url).pathname;

let PrsActionButton: ComponentType<{
  host: ClientHost;
  offer: {
    action: PrsWriteActionKind;
    label: string;
    destructive: boolean;
    methods?: readonly PrsWriteMergeMethod[];
  };
  disabled: boolean;
  pendingAction: string | null;
  method: string;
  onMethodChange: (value: string) => void;
  onRun: () => void;
}>;
let AnnotateButton: ComponentType<{
  host: ClientHost;
  blockReason: string | null;
  capturing: BrowserCaptureTarget | null;
  pageFailed: boolean;
  onPick: () => void;
  style: CSSProperties;
}>;

beforeAll(async () => {
  ({ PrsActionButton } = await import(/* @vite-ignore */ `${PACKS}/version-control/prsPanel.tsx`));
  ({ AnnotateButton } = await import(/* @vite-ignore */ `${PACKS}/browser/annotateButton.tsx`));
});

const host = { React, tooltip: hostTooltip } as unknown as ClientHost;

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

async function render(node: React.ReactNode) {
  await act(async () => root.render(<TooltipProvider delay={0}>{node}</TooltipProvider>));
}

function button() {
  const element = container.querySelector("button");
  if (!element) throw new Error("Control was not rendered");
  return element;
}

function popupText(): string | null {
  return document.querySelector('[data-slot="tooltip-popup"]')?.textContent ?? null;
}

/**
 * Moves the pointer onto the control. Enter events do not bubble, so each
 * element the pointer enters gets its own, innermost first; a disabled
 * button takes no pointer events, so the pointer lands on its parent.
 */
async function hoverControl() {
  const entered: Element[] = [];
  for (
    let node: Element | null = button().disabled ? button().parentElement : button();
    node && node !== container;
    node = node.parentElement
  ) {
    entered.push(node);
  }
  await act(async () => {
    for (const target of entered) {
      target.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
      target.dispatchEvent(new MouseEvent("mouseenter"));
    }
    entered[0]?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  });
  await act(async () => {});
}

describe("version-control header actions", () => {
  async function renderAction(
    action: PrsWriteActionKind,
    state: { disabled: boolean; pendingAction: string | null; method?: string },
  ) {
    await render(
      <PrsActionButton
        host={host}
        offer={{ action, label: action, destructive: false }}
        disabled={state.disabled}
        pendingAction={state.pendingAction}
        method={state.method ?? ""}
        onMethodChange={() => {}}
        onRun={() => {}}
      />,
    );
  }

  const cases: ReadonlyArray<{
    action: PrsWriteActionKind;
    method?: string;
    idle: string;
    running: string;
  }> = [
    { action: "ready", idle: "Ready for review", running: "Ready for review" },
    { action: "merge", method: "squash", idle: "Squash and merge", running: "Merging..." },
    {
      action: "enable-auto-merge",
      method: "rebase",
      idle: "Auto-merge (rebase and merge)",
      running: "Enabling...",
    },
    { action: "approve-workflows", idle: "Approve workflows to run", running: "Approving..." },
  ];

  for (const { action, method, idle, running } of cases) {
    it(`${action}: native name and hover help enabled, own-pending and other-pending`, async () => {
      const states = [
        { disabled: false, pendingAction: null, expected: idle },
        { disabled: true, pendingAction: action, expected: running },
        { disabled: true, pendingAction: "close", expected: idle },
      ];
      for (const { disabled, pendingAction, expected } of states) {
        await render(null);
        await renderAction(action, { disabled, pendingAction, ...(method ? { method } : {}) });
        expect(button().disabled).toBe(disabled);
        expect(button().textContent).toBe(expected);
        await hoverControl();
        expect(popupText()).toBe(expected);
      }
    });
  }

  it("keeps plain menu actions silent while another write runs", async () => {
    await renderAction("close", { disabled: true, pendingAction: "merge" });
    expect(button().textContent).toBe("Close");
    await hoverControl();
    expect(popupText()).toBeNull();
  });
});

describe("browser annotate button", () => {
  const reason = "Page didn't load — pick unavailable until the page renders";

  async function renderAnnotate(state: { blockReason: string | null; pageFailed: boolean }) {
    await render(
      <AnnotateButton host={host} capturing={null} onPick={() => {}} style={{}} {...state} />,
    );
  }

  it("disables a failed page on a supported host and explains why on hover", async () => {
    await renderAnnotate({ blockReason: null, pageFailed: true });
    expect(button().disabled).toBe(true);
    expect(button().getAttribute("aria-label")).toBe("Annotate preview");
    await hoverControl();
    expect(popupText()).toBe(reason);
  });

  it("offers annotation on a rendered page", async () => {
    await renderAnnotate({ blockReason: null, pageFailed: false });
    expect(button().disabled).toBe(false);
    await hoverControl();
    expect(popupText()).toBe("Annotate elements, regions, and drawings");
  });

  it("stays silent when capture itself is unavailable", async () => {
    await renderAnnotate({ blockReason: "Open a page to capture it.", pageFailed: false });
    expect(button().disabled).toBe(true);
    await hoverControl();
    expect(popupText()).toBeNull();
  });
});
